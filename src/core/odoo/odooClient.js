import xmlrpc from 'xmlrpc';
import axios from 'axios';
import crypto from 'crypto';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

export class OdooClient {
  constructor(options = {}) {
    this.username = options.username || config.odoo.username;
    this.password = options.password || config.odoo.password;
    this.url = options.url || config.odoo.url;
    this.db = options.db || config.odoo.db;
    this.uid = null;
    this.companyId = null;
    this.allowedCompanyIds = [];
    this.sessionCookie = null;
    this.sessionCookieExpires = 0;
  }

  /**
   * Helper to execute XML-RPC call to Odoo common endpoint
   */
  async _callCommon(method, params) {
    const urlParts = new URL(this.url);
    const clientOptions = {
      host: urlParts.hostname,
      port: urlParts.port || (urlParts.protocol === 'https:' ? 443 : 80),
      path: '/xmlrpc/2/common'
    };

    const client = urlParts.protocol === 'https:' 
      ? xmlrpc.createSecureClient(clientOptions)
      : xmlrpc.createClient(clientOptions);

    return new Promise((resolve, reject) => {
      client.methodCall(method, params, (error, value) => {
        if (error) {
          if (error.message && (error.message.includes("tag 'TITLE'") || error.message.includes("tag 'title'"))) {
            const rateErr = new Error("Odoo XML-RPC Rate Limit Exceeded (HTTP 429). Server Odoo membatasi kuota request sementara. Silakan tunggu 1-2 menit.");
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

  /**
   * Helper to execute XML-RPC call to Odoo object endpoint
   */
  async _callObject(model, method, args, kwargs = {}) {
    if (!this.uid) {
      await this.authenticate();
    }

    const urlParts = new URL(this.url);
    const clientOptions = {
      host: urlParts.hostname,
      port: urlParts.port || (urlParts.protocol === 'https:' ? 443 : 80),
      path: '/xmlrpc/2/object'
    };

    const client = urlParts.protocol === 'https:' 
      ? xmlrpc.createSecureClient(clientOptions)
      : xmlrpc.createClient(clientOptions);

    // Auto-inject allowed_company_ids into context for multi-company support
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

    return new Promise((resolve, reject) => {
      client.methodCall('execute_kw', params, (error, value) => {
        if (error) {
          if (error.message && (error.message.includes("tag 'TITLE'") || error.message.includes("tag 'title'"))) {
            const rateErr = new Error("Odoo XML-RPC Rate Limit Exceeded (HTTP 429). Server Odoo membatasi kuota request sementara. Silakan tunggu 1-2 menit.");
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

  /**
   * Convenient alias for execute_kw
   */
  async executeKw(model, method, args, kwargs = {}) {
    return this._callObject(model, method, args, kwargs);
  }

  /**
   * Authenticate with Odoo XML-RPC common service
   */
  async authenticate() {
    try {
      logger.info(`Authenticating with Odoo as "${this.username}" at ${this.url} (DB: ${this.db})...`);
      const uid = await this._callCommon('authenticate', [
        this.db,
        this.username,
        this.password,
        {}
      ]);

      if (!uid) {
        throw new Error(`Odoo authentication failed for user "${this.username}". Check credentials and DB name.`);
      }

      this.uid = uid;
      logger.info(`Odoo authentication successful for "${this.username}". UID: ${this.uid}`);

      // Fetch all allowed company IDs for this user
      try {
        const userRecs = await this._callObject('res.users', 'read', [[this.uid]], {
          fields: ['company_ids', 'company_id']
        });
        if (userRecs && userRecs.length > 0) {
          this.allowedCompanyIds = userRecs[0].company_ids || [];
          if (!this.companyId && userRecs[0].company_id) {
            this.companyId = userRecs[0].company_id[0];
          }
          logger.info(`Loaded allowed company IDs for "${this.username}" (UID: ${this.uid}): [${this.allowedCompanyIds.join(', ')}]`);
        }
      } catch (companyFetchErr) {
        logger.debug(`Could not load user's allowed company IDs: ${companyFetchErr.message}`);
      }

      return this.uid;
    } catch (error) {
      logger.error(`Failed to authenticate with Odoo as "${this.username}"`, error);
      throw error;
    }
  }

  /**
   * Fetch company ID for company name (e.g. 'Ansania')
   */
  async getCompanyId(companyName = config.odoo.companyName) {
    if (this.companyId) {
      return this.companyId;
    }

    try {
      logger.info(`Searching for Odoo company named: "${companyName}"...`);
      const companies = await this._callObject('res.company', 'search_read', [
        [['name', 'ilike', companyName]]
      ], {
        fields: ['id', 'name'],
        limit: 1
      });

      if (companies && companies.length > 0) {
        this.companyId = companies[0].id;
        logger.info(`Found Odoo company "${companies[0].name}" with ID: ${this.companyId}`);
        return this.companyId;
      }

      logger.warn(`Company "${companyName}" not found in Odoo. Fetching user default company...`);
      const users = await this._callObject('res.users', 'search_read', [
        [['id', '=', this.uid]]
      ], {
        fields: ['company_id']
      });

      if (users && users.length > 0 && users[0].company_id) {
        this.companyId = users[0].company_id[0];
        logger.info(`Using default user company ID: ${this.companyId}`);
        return this.companyId;
      }

      throw new Error(`Company "${companyName}" not found in Odoo.`);
    } catch (error) {
      logger.error(`Error resolving Odoo company ID for "${companyName}"`, error);
      throw error;
    }
  }

  /**
   * Fetch Warehouse ID by name and company
   */
  async getWarehouseId(warehouseName = config.odoo.warehouseName, companyId = null) {
    try {
      logger.info(`Searching for Odoo warehouse named: "${warehouseName}"...`);
      const domain = [['name', 'ilike', warehouseName]];
      if (companyId) {
        domain.push(['company_id', '=', companyId]);
      }

      const warehouses = await this._callObject('stock.warehouse', 'search_read', [domain], {
        fields: ['id', 'name', 'code', 'company_id'],
        limit: 1
      });

      if (warehouses && warehouses.length > 0) {
        logger.info(`Found Odoo warehouse "${warehouses[0].name}" (Code: ${warehouses[0].code}) with ID: ${warehouses[0].id}`);
        return warehouses[0].id;
      }

      logger.warn(`Warehouse "${warehouseName}" not found in Odoo for company ID ${companyId}.`);
      return null;
    } catch (error) {
      logger.error(`Error resolving warehouse "${warehouseName}"`, error);
      return null;
    }
  }

  /**
   * Authenticate web session with Odoo to obtain session cookie for report downloading
   */
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
      throw new Error(`Failed to authenticate web session with Odoo: ${JSON.stringify(response.data?.error || 'Unknown error')}`);
    }

    const cookies = response.headers['set-cookie'];
    if (!cookies || cookies.length === 0) {
      throw new Error('No session cookies returned by Odoo');
    }

    this.sessionCookie = cookies.map(c => c.split(';')[0]).join('; ');
    this.sessionCookieExpires = Date.now() + 2 * 60 * 60 * 1000;
    return this.sessionCookie;
  }

  /**
   * Fetch document details along with customer/partner information
   */
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
      } catch (err) {
        logger.warn(`[Odoo] Could not fetch partner details for partner ID ${partnerId}: ${err.message}`);
      }
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

  /**
   * Download official Odoo report PDF for a given document
   */
  async downloadDocumentPdf(model, recordId, customReportName = null) {
    const docInfo = await this.getDocumentDetails(model, recordId);

    let targetReport = customReportName;
    if (model === 'account.move') {
      if (!targetReport || targetReport === 'internal' || targetReport === 'invoice_internal') {
        targetReport = config.odoo.invoiceReport || 'account.report_invoice_copy_3';
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
        logger.info(`[Odoo] Downloading report "${targetReport}" from ${reportUrl}...`);

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
        } catch (attErr) {
          logger.warn(`[Odoo] Could not create public attachment: ${attErr.message}`);
        }

        return {
          buffer,
          filename,
          docInfo,
          reportName: targetReport,
          publicAttachmentUrl
        };
      } catch (err) {
        logger.warn(`[Odoo] Failed downloading report "${targetReport}" via web session: ${err.message}. Falling back to portal access URL...`);
      }
    }

    let { accessUrl, accessToken, name } = docInfo;
    if (!accessUrl || !accessToken) {
      throw new Error(`Document ${model} ID ${recordId} does not have portal access_token or access_url`);
    }

    const downloadUrl = `${this.url.replace(/\/+$/, '')}${accessUrl}?report_type=pdf&download=true&access_token=${accessToken}`;
    logger.info(`[Odoo] Downloading PDF report from portal URL ${downloadUrl}...`);

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
    } catch (attErr) {
      logger.warn(`[Odoo] Could not create public attachment: ${attErr.message}`);
    }

    return {
      buffer,
      filename,
      docInfo,
      reportName: 'portal_default',
      publicAttachmentUrl: publicAttachmentUrl || downloadUrl
    };
  }

  /**
   * Upload or update document PDF as an ir.attachment in Odoo
   */
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
        public: true
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
        public: true
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

// Dedicated Admin instance (it@kantiss.com)
export const adminOdooClient = new OdooClient({
  username: 'it@kantiss.com',
  password: 'jadiapaya'
});
