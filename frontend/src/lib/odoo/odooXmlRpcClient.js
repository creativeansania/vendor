import http from 'http';
import https from 'https';
import xmlrpc from 'xmlrpc';
import {
  getWebSessionCookie,
  getDocumentDetails,
  downloadDocumentPdf,
  getOrCreatePublicAttachment
} from './odooReportHelper.js';

const sharedHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 25 });
const sharedHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 25 });

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

    this.url = url;
    this.db = db;
    this.username = options.username || process.env.ODOO_USERNAME || '';
    this.password = options.password || process.env.ODOO_PASSWORD || '';
    this.uid = null;
    this._authPromise = null;
    this.companyId = null;
    this.allowedCompanyIds = [];
    this.sessionCookie = null;
    this.sessionCookieExpires = 0;
  }

  async _callCommon(method, params) {
    const urlParts = new URL(this.url);
    const isSecure = urlParts.protocol === 'https:';
    const clientOptions = {
      host: urlParts.hostname,
      port: urlParts.port || (isSecure ? 443 : 80),
      path: '/xmlrpc/2/common',
      agent: isSecure ? sharedHttpsAgent : sharedHttpAgent
    };

    const client = isSecure
      ? xmlrpc.createSecureClient(clientOptions)
      : xmlrpc.createClient(clientOptions);

    return new Promise((resolve, reject) => {
      let isSettled = false;
      const timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          reject(new Error(`Odoo XML-RPC timeout (${method}) after 20s`));
        }
      }, 20000);
      if (timer && timer.unref) timer.unref();

      client.methodCall(method, params, (error, value) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);

        if (error) {
          if (error.message && (error.message.includes("tag 'TITLE'") || error.message.includes("tag 'title'"))) {
            const rateErr = new Error('Odoo XML-RPC Rate Limit Exceeded (HTTP 429). Server Odoo membatasi kuota sementara.');
            rateErr.isRateLimit = true;
            rateErr.code = 429;
            return reject(rateErr);
          }
          reject(error);
        } else {
          resolve(value);
        }
      });
    });
  }

  async _callObject(model, method, args, kwargs = {}, _retriedAuth = false) {
    if (!this.uid) {
      await this.authenticate();
    }

    const urlParts = new URL(this.url);
    const isSecure = urlParts.protocol === 'https:';
    const clientOptions = {
      host: urlParts.hostname,
      port: urlParts.port || (isSecure ? 443 : 80),
      path: '/xmlrpc/2/object',
      agent: isSecure ? sharedHttpsAgent : sharedHttpAgent
    };

    const client = isSecure
      ? xmlrpc.createSecureClient(clientOptions)
      : xmlrpc.createClient(clientOptions);

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
      return await new Promise((resolve, reject) => {
        let isSettled = false;
        const timer = setTimeout(() => {
          if (!isSettled) {
            isSettled = true;
            reject(new Error(`Odoo XML-RPC timeout (${model}.${method}) after 20s`));
          }
        }, 20000);
        if (timer && timer.unref) timer.unref();

        client.methodCall('execute_kw', params, (error, value) => {
          if (isSettled) return;
          isSettled = true;
          clearTimeout(timer);

          if (error) {
            if (error.message && (error.message.includes("tag 'TITLE'") || error.message.includes("tag 'title'"))) {
              const rateErr = new Error('Odoo XML-RPC Rate Limit Exceeded (HTTP 429). Server Odoo membatasi kuota sementara.');
              rateErr.isRateLimit = true;
              rateErr.code = 429;
              return reject(rateErr);
            }
            reject(error);
          } else {
            resolve(value);
          }
        });
      });
    } catch (err) {
      if (!_retriedAuth && err.message && /AccessDenied|SessionExpired/i.test(err.message)) {
        this.uid = null;
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

    try {
      const companies = await this._callObject('res.company', 'search_read', [
        [['name', 'ilike', companyName]]
      ], { fields: ['id', 'name'], limit: 1 });

      if (companies && companies.length > 0) {
        this.companyId = companies[0].id;
        return this.companyId;
      }

      const users = await this._callObject('res.users', 'search_read', [
        [['id', '=', this.uid]]
      ], { fields: ['company_id'] });

      if (users && users.length > 0 && users[0].company_id) {
        this.companyId = users[0].company_id[0];
        return this.companyId;
      }

      return 1;
    } catch {
      return 1;
    }
  }

  async getWarehouseId(warehouseName = process.env.ODOO_WAREHOUSE_NAME || 'Gudang Online', companyId = null) {
    try {
      const domain = [['name', 'ilike', warehouseName]];
      if (companyId) domain.push(['company_id', '=', companyId]);

      const warehouses = await this._callObject('stock.warehouse', 'search_read', [domain], {
        fields: ['id', 'name', 'code', 'company_id'],
        limit: 1
      });

      if (warehouses && warehouses.length > 0) {
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
