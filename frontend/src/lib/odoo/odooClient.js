import http from 'http';
import https from 'https';
import xmlrpc from 'xmlrpc';
import axios from 'axios';
import crypto from 'crypto';

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
            const rateErr = new Error("Odoo XML-RPC Rate Limit Exceeded (HTTP 429). Server Odoo membatasi kuota sementara.");
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
              const rateErr = new Error("Odoo XML-RPC Rate Limit Exceeded (HTTP 429). Server Odoo membatasi kuota sementara.");
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
        } catch (e) {
          // Multi-company fetch non-fatal
        }

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
    } catch (err) {
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
    } catch (err) {
      return null;
    }
  }

  async getWebSessionCookie() {
    if (this.sessionCookie && this.sessionCookieExpires && Date.now() < this.sessionCookieExpires) {
      return this.sessionCookie;
    }

    const authUrl = `${this.url.replace(/\/+$/, '')}/web/session/authenticate`;
    const response = await axios.post(authUrl, {
      jsonrpc: '2.0',
      params: {
        db: this.db,
        login: this.username,
        password: this.password
      }
    });

    if (!response.data?.result?.uid) {
      throw new Error(`Failed to authenticate web session with Odoo`);
    }

    const cookies = response.headers['set-cookie'];
    if (!cookies || cookies.length === 0) {
      throw new Error('No session cookies returned by Odoo');
    }

    this.sessionCookie = cookies.map(c => c.split(';')[0]).join('; ');
    this.sessionCookieExpires = Date.now() + 2 * 60 * 60 * 1000;
    return this.sessionCookie;
  }

  async getDocumentDetails(model, recordId) {
    if (!this.uid) await this.authenticate();

    const isInvoice = model === 'account.move';
    const fields = isInvoice
      ? ['id', 'name', 'state', 'partner_id', 'amount_total', 'currency_id', 'invoice_date', 'payment_state', 'access_token', 'access_url']
      : ['id', 'name', 'state', 'partner_id', 'amount_total', 'currency_id', 'date_order', 'access_token', 'access_url'];

    const records = await this._callObject(model, 'read', [[Number(recordId)]], { fields });
    if (!records || records.length === 0) {
      throw new Error(`Record ${model} with ID ${recordId} not found in Odoo`);
    }

    const doc = records[0];
    let partner = null;
    let phone = null;

    if (doc.partner_id && doc.partner_id[0]) {
      const partnerId = doc.partner_id[0];
      try {
        const partnerRecs = await this._callObject('res.partner', 'read', [[partnerId]], {
          fields: ['id', 'name', 'phone', 'phone_sanitized', 'email']
        });
        if (partnerRecs && partnerRecs.length > 0) {
          partner = partnerRecs[0];
          phone = partner.phone_sanitized || partner.phone || null;
        }
      } catch (err) {}
    }

    return {
      id: doc.id,
      name: doc.name,
      model,
      state: doc.state,
      amountTotal: doc.amount_total,
      currency: Array.isArray(doc.currency_id) ? doc.currency_id[1] : 'IDR',
      date: isInvoice ? doc.invoice_date : doc.date_order,
      accessToken: doc.access_token,
      accessUrl: doc.access_url,
      partnerId: doc.partner_id ? doc.partner_id[0] : null,
      partnerName: partner?.name || (Array.isArray(doc.partner_id) ? doc.partner_id[1] : 'Pelanggan'),
      phone,
      rawDoc: doc,
      rawPartner: partner
    };
  }

  async downloadDocumentPdf(model, recordId, customReportName = null) {
    const docInfo = await this.getDocumentDetails(model, recordId);

    let targetReport = customReportName;
    if (model === 'account.move') {
      if (!targetReport || targetReport === 'internal' || targetReport === 'invoice_internal') {
        targetReport = process.env.ODOO_INVOICE_REPORT || 'account.report_invoice_copy_3';
      } else if (targetReport === 'external_ppn') {
        targetReport = 'account.report_invoice_copy_1';
      } else if (targetReport === 'external_non_ppn') {
        targetReport = 'account.report_invoice_copy_2';
      } else if (targetReport === 'default') {
        targetReport = 'account.report_invoice_with_payments';
      }
    }

    if (targetReport) {
      try {
        const cookie = await this.getWebSessionCookie();
        const reportUrl = `${this.url.replace(/\/+$/, '')}/report/pdf/${targetReport}/${recordId}`;

        const response = await axios.get(reportUrl, {
          headers: { Cookie: cookie },
          responseType: 'arraybuffer',
          timeout: 30000
        });

        const filename = `${(docInfo.name || 'invoice').replace(/[/\\?%*:|"<>]/g, '_')}.pdf`;
        const buffer = Buffer.from(response.data);

        let publicAttachmentUrl = null;
        try {
          const att = await this.getOrCreatePublicAttachment(model, recordId, buffer, filename);
          publicAttachmentUrl = att.publicUrl;
        } catch (attErr) {}

        return {
          buffer,
          filename,
          docInfo,
          reportName: targetReport,
          publicAttachmentUrl
        };
      } catch (err) {}
    }

    let { accessUrl, accessToken, name } = docInfo;
    if (!accessUrl || !accessToken) {
      throw new Error(`Document ${model} ID ${recordId} does not have portal access_token or access_url`);
    }

    const downloadUrl = `${this.url.replace(/\/+$/, '')}${accessUrl}?report_type=pdf&download=true&access_token=${accessToken}`;
    const response = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      timeout: 30000
    });

    const filename = `${(name || 'document').replace(/[/\\?%*:|"<>]/g, '_')}.pdf`;
    const buffer = Buffer.from(response.data);

    let publicAttachmentUrl = null;
    try {
      const att = await this.getOrCreatePublicAttachment(model, recordId, buffer, filename);
      publicAttachmentUrl = att.publicUrl;
    } catch (attErr) {}

    return {
      buffer,
      filename,
      docInfo,
      reportName: 'portal_default',
      publicAttachmentUrl: publicAttachmentUrl || downloadUrl
    };
  }

  async getOrCreatePublicAttachment(model, recordId, buffer, filename) {
    if (!this.uid) await this.authenticate();

    const existing = await this._callObject('ir.attachment', 'search_read', [
      [['res_model', '=', model], ['res_id', '=', Number(recordId)], ['name', '=', filename]]
    ], { fields: ['id', 'access_token', 'name'], limit: 1 });

    let attachmentId = null;
    let accessToken = null;

    if (existing && existing.length > 0) {
      attachmentId = existing[0].id;
      accessToken = existing[0].access_token || crypto.randomUUID();
      await this._callObject('ir.attachment', 'write', [[attachmentId], {
        datas: buffer.toString('base64'),
        mimetype: 'application/pdf',
        access_token: accessToken,
        public: false
      }]);
    } else {
      accessToken = crypto.randomUUID();
      attachmentId = await this._callObject('ir.attachment', 'create', [{
        name: filename,
        type: 'binary',
        datas: buffer.toString('base64'),
        res_model: model,
        res_id: Number(recordId),
        mimetype: 'application/pdf',
        access_token: accessToken,
        public: false
      }]);
    }

    const publicUrl = `${this.url.replace(/\/+$/, '')}/web/content/${attachmentId}?download=true&access_token=${accessToken}`;
    return {
      attachmentId,
      accessToken,
      publicUrl
    };
  }
}

// Default instance (Ansania)
export const defaultOdooClient = new OdooClient();

// Dedicated Admin instance
export const adminOdooClient = new OdooClient({
  url: process.env.ODOO_URL || 'https://kanti-sehati-sukses.odoo.com',
  db: process.env.ODOO_DB || 'kanti-sehati-sukses',
  username: process.env.ODOO_ADMIN_USERNAME || '',
  password: process.env.ODOO_ADMIN_PASSWORD || ''
});
