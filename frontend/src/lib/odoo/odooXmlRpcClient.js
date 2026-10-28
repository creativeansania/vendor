import {
  getWebSessionCookie,
  getDocumentDetails,
  downloadDocumentPdf,
  getOrCreatePublicAttachment
} from './odooReportHelper.js';
import {
  getCachedAuthSession,
  setCachedAuthSession,
  clearCachedAuthSession,
  getCachedCompanyByName,
  setCachedCompanyByName,
  getCachedWarehouseByName,
  setCachedWarehouseByName
} from './odooStaticCache.js';

const RPC_TIMEOUT_MS = 20000;
const MAX_CONCURRENT_RPC = 6;
const MAX_RETRIES = 3;

let activeRpcCount = 0;
const rpcWaitQueue = [];
let rpcSeq = 1;

function acquireRpcSlot() {
  if (activeRpcCount < MAX_CONCURRENT_RPC) {
    activeRpcCount++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    rpcWaitQueue.push(resolve);
  });
}

function releaseRpcSlot() {
  if (rpcWaitQueue.length > 0) {
    const next = rpcWaitQueue.shift();
    next();
  } else {
    activeRpcCount = Math.max(0, activeRpcCount - 1);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientNetworkError(err) {
  if (!err) return false;
  if (err.isRateLimit || err.isTransientGateway) return true;
  const msg = String(err.message || err.cause?.message || '');
  return /ECONNRESET|ETIMEDOUT|UND_ERR_SOCKET|fetch failed|network|socket hang up/i.test(msg);
}

export class OdooClient {
  constructor(options = {}) {
    let url = options.url || process.env.ODOO_URL || 'https://kanti-sehati-sukses.odoo.com';
    let db = options.db || process.env.ODOO_DB || 'kanti-sehati-sukses';
    if (url.includes('jangansusahsusahtestingvendoran')) {
      url = 'https://kanti-sehati-sukses.odoo.com';
    }
    if (db === 'jangansusahsusahtestingvendoran') {
      db = 'kanti-sehati-sukses';
    }

    this.url = url.replace(/\/+$/, '');
    this.jsonRpcUrl = `${this.url}/jsonrpc`;
    this.db = db;
    this.username = options.username || process.env.ODOO_USERNAME || '';
    this.password = options.password || process.env.ODOO_PASSWORD || '';
    this.authCacheKey = `${this.url}|${this.db}|${this.username}`;

    this.uid = null;
    this._authPromise = null;
    this.companyId = null;
    this.allowedCompanyIds = [];
    this.sessionCookie = null;
    this.sessionCookieExpires = 0;
  }

  /**
   * High-efficiency JSON-RPC 2.0 transport with concurrency cap & jittered 429/5xx backoff
   */
  async _jsonRpc(service, method, args) {
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await acquireRpcSlot();
      let retryDelayMs = 0;

      try {
        const res = await fetch(this.jsonRpcUrl, {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'call',
            params: { service, method, args },
            id: rpcSeq++
          }),
          signal: AbortSignal.timeout(RPC_TIMEOUT_MS)
        });

        if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
          const retryAfterHeader = Number(res.headers.get('retry-after') || 0);
          const baseBackoff = retryAfterHeader > 0
            ? retryAfterHeader * 1000
            : [900, 2000, 4000][attempt] || 4000;
          retryDelayMs = baseBackoff + Math.floor(Math.random() * 400);

          const err = new Error(
            res.status === 429
              ? 'Odoo RPC Rate Limit Exceeded (HTTP 429). Server Odoo membatasi kuota sementara.'
              : `Odoo Gateway Temporary Error (HTTP ${res.status}).`
          );
          if (res.status === 429) err.isRateLimit = true;
          else err.isTransientGateway = true;
          err.code = res.status;
          throw err;
        }

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          const textBody = await res.text();
          if (res.status === 429 || /<title>.*429|Too Many Requests/i.test(textBody)) {
            retryDelayMs = ([900, 2000, 4000][attempt] || 4000) + Math.floor(Math.random() * 400);
            const rateErr = new Error('Odoo RPC Rate Limit Exceeded (HTTP 429). Server Odoo membatasi kuota sementara.');
            rateErr.isRateLimit = true;
            rateErr.code = 429;
            throw rateErr;
          }
          throw new Error(`Unexpected non-JSON response from Odoo (HTTP ${res.status})`);
        }

        const payload = await res.json();
        if (payload.error) {
          const errData = payload.error.data || {};
          const detail = errData.message || payload.error.message || 'Odoo JSON-RPC Error';
          const errName = errData.name || '';
          const rpcErr = new Error(errName ? `${errName}: ${detail}` : detail);
          rpcErr.odooErrorName = errName;
          rpcErr.odooDebug = errData.debug;
          throw rpcErr;
        }

        return payload.result;
      } catch (err) {
        if (err.name === 'TimeoutError' || err.name === 'AbortError') {
          lastError = new Error(`Odoo JSON-RPC timeout (${service}.${method}) after ${RPC_TIMEOUT_MS / 1000}s`);
        } else {
          lastError = err;
        }

        const canRetry = attempt < MAX_RETRIES && isTransientNetworkError(lastError);
        if (!canRetry) {
          throw lastError;
        }
        if (!retryDelayMs) {
          retryDelayMs = ([800, 1800, 3500][attempt] || 3500) + Math.floor(Math.random() * 350);
        }
      } finally {
        releaseRpcSlot();
      }

      if (retryDelayMs > 0) {
        console.warn(`[Odoo RPC] Transient error (${lastError?.message}). Retrying ${service}.${method} in ${retryDelayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
        await sleep(retryDelayMs);
      }
    }

    throw lastError;
  }

  async _callCommon(method, params) {
    return this._jsonRpc('common', method, params);
  }

  async _callObject(model, method, args, kwargs = {}, _retriedAuth = false) {
    if (!this.uid) {
      await this.authenticate();
    }

    const context = {
      ...(this.allowedCompanyIds && this.allowedCompanyIds.length > 0 ? { allowed_company_ids: this.allowedCompanyIds } : {}),
      ...(kwargs.context || {})
    };

    const finalKwargs = {
      ...kwargs,
      context
    };

    const params = [
      this.db,
      this.uid,
      this.password,
      model,
      method,
      args,
      finalKwargs
    ];

    try {
      return await this._jsonRpc('object', 'execute_kw', params);
    } catch (err) {
      if (!_retriedAuth && err.message && /AccessDenied|SessionExpired/i.test(err.message)) {
        this.uid = null;
        clearCachedAuthSession(this.authCacheKey);
        await this.authenticate(true);
        return this._callObject(model, method, args, kwargs, true);
      }
      throw err;
    }
  }

  async executeKw(model, method, args, kwargs = {}) {
    return this._callObject(model, method, args, kwargs);
  }

  async authenticate(force = false) {
    if (!force && this.uid) {
      return this.uid;
    }

    if (!force) {
      const cachedSession = getCachedAuthSession(this.authCacheKey);
      if (cachedSession && cachedSession.uid) {
        this.uid = cachedSession.uid;
        this.companyId = cachedSession.companyId || this.companyId;
        this.allowedCompanyIds = cachedSession.allowedCompanyIds || [];
        return this.uid;
      }

      // Zero-call cold start shortcut when static ODOO_UID is provided in env for the default admin account
      const envUid = Number(process.env.ODOO_UID || 0);
      if (envUid > 0 && this.username === (process.env.ODOO_USERNAME || '')) {
        const envCompanyId = Number(process.env.ODOO_COMPANY_ID || 0) || null;
        const envAllowedIds = process.env.ODOO_ALLOWED_COMPANY_IDS
          ? process.env.ODOO_ALLOWED_COMPANY_IDS.split(',').map((n) => Number(n.trim())).filter(Boolean)
          : (envCompanyId ? [envCompanyId] : []);
        this.uid = envUid;
        if (envCompanyId) this.companyId = envCompanyId;
        if (envAllowedIds.length > 0) this.allowedCompanyIds = envAllowedIds;
        setCachedAuthSession(this.authCacheKey, {
          uid: this.uid,
          companyId: this.companyId,
          allowedCompanyIds: this.allowedCompanyIds
        });
        return this.uid;
      }
    }

    if (!force && this._authPromise) {
      return this._authPromise;
    }

    this._authPromise = (async () => {
      try {
        if (!this.username || !this.password) {
          throw new Error('Kredensial Odoo (username/password) belum dikonfigurasi di environment.');
        }

        const uid = await this._callCommon('authenticate', [
          this.db,
          this.username,
          this.password,
          {}
        ]);

        if (!uid) {
          throw new Error(`Odoo authentication failed for "${this.username}".`);
        }

        this.uid = uid;

        try {
          const userRecs = await this._callObject('res.users', 'read', [[this.uid]], {
            fields: ['company_ids', 'company_id']
          });
          if (userRecs && userRecs.length > 0) {
            this.allowedCompanyIds = userRecs[0].company_ids || [];
            if (!this.companyId && userRecs[0].company_id) {
              this.companyId = userRecs[0].company_id[0];
            }
          }
        } catch {}

        setCachedAuthSession(this.authCacheKey, {
          uid: this.uid,
          companyId: this.companyId,
          allowedCompanyIds: this.allowedCompanyIds
        });

        return this.uid;
      } catch (error) {
        this.uid = null;
        console.error(`[Odoo] Auth failed for ${this.username}:`, error.message);
        throw error;
      } finally {
        this._authPromise = null;
      }
    })();

    return this._authPromise;
  }

  async getCompanyId(companyName = process.env.ODOO_COMPANY_NAME || 'Ansania') {
    if (this.companyId) return this.companyId;
    const cached = getCachedCompanyByName(companyName);
    if (cached) {
      this.companyId = cached;
      return cached;
    }

    try {
      const companies = await this._callObject('res.company', 'search_read', [
        [['name', 'ilike', companyName]]
      ], { fields: ['id', 'name'], limit: 1 });

      if (companies && companies.length > 0) {
        this.companyId = companies[0].id;
        setCachedCompanyByName(companyName, this.companyId);
        return this.companyId;
      }

      return 1;
    } catch {
      return 1;
    }
  }

  async getWarehouseId(warehouseName = process.env.ODOO_WAREHOUSE_NAME || 'Gudang Online', companyId = null) {
    const cacheKey = `${warehouseName}|${companyId || ''}`;
    const cached = getCachedWarehouseByName(cacheKey);
    if (cached) return cached;

    try {
      const domain = [['name', 'ilike', warehouseName]];
      if (companyId) domain.push(['company_id', '=', companyId]);

      const warehouses = await this._callObject('stock.warehouse', 'search_read', [domain], {
        fields: ['id', 'name', 'code', 'company_id'],
        limit: 1
      });

      if (warehouses && warehouses.length > 0) {
        setCachedWarehouseByName(cacheKey, warehouses[0].id);
        return warehouses[0].id;
      }
      return null;
    } catch {
      return null;
    }
  }

  getWebSessionCookie() {
    return getWebSessionCookie(this);
  }

  getDocumentDetails(model, recordId) {
    return getDocumentDetails(this, model, recordId);
  }

  downloadDocumentPdf(model, recordId, customReportName = null) {
    return downloadDocumentPdf(this, model, recordId, customReportName);
  }

  getOrCreatePublicAttachment(model, recordId, buffer, filename) {
    return getOrCreatePublicAttachment(this, model, recordId, buffer, filename);
  }
}
