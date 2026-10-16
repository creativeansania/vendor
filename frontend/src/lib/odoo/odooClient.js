import xmlrpc from 'xmlrpc';

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
    this.username = options.username || process.env.ODOO_ADMIN_USERNAME || process.env.ODOO_USERNAME || 'it@kantiss.com';
    this.password = options.password || process.env.ODOO_ADMIN_PASSWORD || process.env.ODOO_PASSWORD || 'jadiapaya';
    this.uid = null;
    this.companyId = null;
    this.allowedCompanyIds = [];
  }

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
  }

  async executeKw(model, method, args, kwargs = {}) {
    return this._callObject(model, method, args, kwargs);
  }

  async authenticate() {
    try {
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
      console.error(`[Odoo] Auth failed for ${this.username}:`, error.message);
      throw error;
    }
  }
}

export const adminOdooClient = new OdooClient({
  url: 'https://kanti-sehati-sukses.odoo.com',
  db: 'kanti-sehati-sukses',
  username: process.env.ODOO_ADMIN_USERNAME || 'it@kantiss.com',
  password: process.env.ODOO_ADMIN_PASSWORD || 'jadiapaya'
});
