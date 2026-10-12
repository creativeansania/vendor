import xmlrpc from 'xmlrpc';
import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const VALID_JENIS_SO = [
  'Internal',
  'Eksternal',
  'Internal Fresh Order',
  'Sample',
  'Order Depo',
  'Penjualan Depo',
  'Penjualan Konsinyasi'
];

function sanitizeJenisSO(rawVal) {
  if (!rawVal) return 'Penjualan Konsinyasi';
  const val = String(rawVal).trim().replace(/^["']|["']$/g, '');
  const exact = VALID_JENIS_SO.find(v => v.toLowerCase() === val.toLowerCase());
  if (exact) return exact;
  if (val.toLowerCase().includes('konsinyasi') || val.toLowerCase() === 'penjualan') {
    return 'Penjualan Konsinyasi';
  }
  if (val.toLowerCase().includes('depo')) {
    return 'Penjualan Depo';
  }
  return 'Penjualan Konsinyasi';
}

class OdooService {
  constructor(options = {}) {
    this.username = options.username || config.odoo.username;
    this.password = options.password || config.odoo.password;
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
    const urlParts = new URL(config.odoo.url);
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

    const urlParts = new URL(config.odoo.url);
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
      config.odoo.db,
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
   * Authenticate with Odoo XML-RPC common service
   */
  async authenticate() {
    try {
      logger.info(`Authenticating with Odoo as "${this.username}" at ${config.odoo.url} (DB: ${config.odoo.db})...`);
      const uid = await this._callCommon('authenticate', [
        config.odoo.db,
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
   * Find product by SKU in product.product model
   * Requires exact match on default_code or barcode
   */
  async findProductBySKU(sku) {
    if (!sku) return null;
    const cleanSku = String(sku).trim();

    try {
      logger.debug(`Searching Odoo product by exact SKU (default_code): ${cleanSku}`);
      let products = await this._callObject('product.product', 'search_read', [
        [['default_code', '=', cleanSku]]
      ], {
        fields: ['id', 'name', 'default_code', 'list_price', 'uom_id'],
        limit: 1
      });

      if (!products || products.length === 0) {
        logger.debug(`SKU default_code "${cleanSku}" not found. Trying exact barcode search...`);
        products = await this._callObject('product.product', 'search_read', [
          [['barcode', '=', cleanSku]]
        ], {
          fields: ['id', 'name', 'default_code', 'list_price', 'uom_id'],
          limit: 1
        });
      }

      if (products && products.length > 0) {
        return products[0];
      }

      logger.warn(`Product with SKU "${cleanSku}" not found in Odoo.`);
      return null;
    } catch (error) {
      logger.error(`Error searching product by SKU "${cleanSku}"`, error);
      return null;
    }
  }

  /**
   * Find or create customer (res.partner) in Odoo bound to companyId
   */
  async findOrCreatePartner(customerInfo, companyId) {
    const name = customerInfo?.name || customerInfo?.customer_name || config.channels.fallback;
    const email = customerInfo?.email || '';
    const phone = customerInfo?.phone || customerInfo?.mobile || '';
    const isChannelCustomer = customerInfo?.isChannelCustomer || false;

    try {
      let domain = [];
      if (isChannelCustomer || !email) {
        domain = [['name', '=', name]];
      } else {
        domain = [['email', '=', email]];
      }

      // Match partner in current company or global
      if (companyId) {
        domain.push(['company_id', 'in', [companyId, false]]);
      }

      logger.debug(`Searching partner in Odoo: "${name}"`);
      const partners = await this._callObject('res.partner', 'search_read', [domain], {
        fields: ['id', 'name', 'company_id'],
        limit: 1
      });

      if (partners && partners.length > 0) {
        logger.info(`Found existing Odoo partner ID ${partners[0].id} for "${name}"`);
        return partners[0].id;
      }

      // Create new partner
      logger.info(`Creating new partner in Odoo for "${name}" (Company ID: ${companyId})...`);
      const partnerData = {
        name: name,
        email: email || false,
        phone: phone || false,
        company_id: companyId,
        is_company: isChannelCustomer ? true : false,
        customer_rank: 1
      };

      const partnerId = await this._callObject('res.partner', 'create', [partnerData]);
      logger.info(`Created new Odoo partner ID ${partnerId} for "${name}"`);
      return partnerId;
    } catch (error) {
      logger.error(`Error finding/creating partner for "${name}"`, error);
      throw error;
    }
  }

  /**
   * Check if Sales Order already exists in Odoo by client_order_ref (Idempotency)
   */
  async checkExistingSalesOrder(clientOrderRef, companyId) {
    try {
      const orders = await this._callObject('sale.order', 'search_read', [
        [
          ['client_order_ref', '=', clientOrderRef],
          ['company_id', '=', companyId]
        ]
      ], {
        fields: ['id', 'name', 'state'],
        limit: 1
      });

      if (orders && orders.length > 0) {
        return orders[0];
      }
      return null;
    } catch (error) {
      logger.error(`Error checking existing Sales Order for ref "${clientOrderRef}"`, error);
      return null;
    }
  }

  /**
   * Automatically validates stock pickings (Delivery Orders) linked to confirmed Sales Order
   * Sets quantity done to demand and validates immediately (allowing negative stock)
   */
  async validateDelivery(pickingIds) {
    if (!pickingIds || pickingIds.length === 0) return [];

    const validatedPickings = [];

    for (const pickingId of pickingIds) {
      try {
        const pickings = await this._callObject('stock.picking', 'read', [[pickingId]], {
          fields: ['id', 'name', 'state', 'move_ids']
        });

        if (!pickings || pickings.length === 0) continue;
        const picking = pickings[0];

        if (picking.state === 'done') {
          logger.info(`Picking ${picking.name} (ID: ${pickingId}) is already in "done" state.`);
          validatedPickings.push(picking.name);
          continue;
        }

        // If picking is still in draft, confirm it first
        if (picking.state === 'draft') {
          await this._callObject('stock.picking', 'action_confirm', [[pickingId]]);
        }

        if (picking.move_ids && picking.move_ids.length > 0) {
          const moves = await this._callObject('stock.move', 'read', [picking.move_ids], {
            fields: ['id', 'product_uom_qty', 'quantity', 'picked']
          });

          for (const m of moves) {
            try {
              await this._callObject('stock.move', 'write', [[m.id], {
                quantity: m.product_uom_qty,
                picked: true
              }]);
            } catch (moveErr) {
              logger.debug(`Could not write quantity on stock.move ${m.id}, trying quantity_done fallback: ${moveErr.message}`);
              await this._callObject('stock.move', 'write', [[m.id], {
                quantity_done: m.product_uom_qty
              }]);
            }
          }
        }

        logger.info(`Validating Delivery Order ${picking.name} (ID: ${pickingId})...`);
        const validateRes = await this._callObject('stock.picking', 'button_validate', [[pickingId]], {
          context: {
            skip_backorder: true,
            skip_immediate: true,
            skip_sms: true
          }
        });

        // Handle backorder wizard if prompted by Odoo
        if (validateRes && typeof validateRes === 'object' && validateRes.res_model === 'stock.backorder.confirmation') {
          const wizardId = validateRes.res_id;
          logger.info(`Handling backorder confirmation wizard for picking ${picking.name} (Wizard ID: ${wizardId})...`);
          try {
            await this._callObject('stock.backorder.confirmation', 'process_cancel_backorder', [[wizardId]], {
              context: { skip_backorder: true }
            });
          } catch (wizErr) {
            logger.warn(`process_cancel_backorder failed: ${wizErr.message}. Calling process()...`);
            await this._callObject('stock.backorder.confirmation', 'process', [[wizardId]]);
          }
        }

        logger.info(`Successfully validated Delivery Order ${picking.name} (Status: DONE).`);
        validatedPickings.push(picking.name);
      } catch (err) {
        logger.error(`Error validating delivery picking ID ${pickingId}`, err.message);
      }
    }

    return validatedPickings;
  }

  /**
   * Automatically creates customer invoice from confirmed Sales Order and posts it
   */
  async createAndPostInvoice(soId, invoiceDate, forcePost = false) {
    try {
      logger.info(`Creating customer invoice for Sales Order ID ${soId}...`);

      // Use standard sale.advance.payment.inv wizard
      try {
        const wizardId = await this._callObject('sale.advance.payment.inv', 'create', [{
          sale_order_ids: [[6, 0, [soId]]]
        }]);
        try {
          await this._callObject('sale.advance.payment.inv', 'create_invoices', [[wizardId]]);
        } catch (wizErr) {
          // Odoo's create_invoices returns an action dict that may contain None,
          // which can raise an XML-RPC marshal error in Python client response,
          // but the invoice is created in the database.
          logger.debug('Wizard create_invoices response handled:', wizErr.message);
        }
      } catch (wizardCreateErr) {
        logger.warn(`Could not create invoice via wizard: ${wizardCreateErr.message}`);
      }

      // Read created invoice IDs from sale.order
      const soRecords = await this._callObject('sale.order', 'read', [[soId]], {
        fields: ['name', 'invoice_ids']
      });

      const invoiceIds = soRecords && soRecords[0] ? soRecords[0].invoice_ids : [];
      if (!invoiceIds || invoiceIds.length === 0) {
        logger.warn(`No invoice found for Sales Order ID ${soId}.`);
        return [];
      }

      const postedInvoices = [];

      for (const invId of invoiceIds) {
        try {
          const invList = await this._callObject('account.move', 'read', [[invId]], {
            fields: ['id', 'name', 'state']
          });

          if (!invList || invList.length === 0) continue;
          const inv = invList[0];

          if (inv.state === 'draft' && (forcePost || config.settings.autoPostInvoice)) {
            // Set invoice date if provided
            if (invoiceDate) {
              const d = new Date(invoiceDate);
              if (!isNaN(d.getTime())) {
                const dateStr = d.toISOString().split('T')[0];
                await this._callObject('account.move', 'write', [[invId], {
                  invoice_date: dateStr
                }]);
              }
            }

            logger.info(`Posting Customer Invoice ID ${invId}...`);
            await this._callObject('account.move', 'action_post', [[invId]]);

            const postedInv = await this._callObject('account.move', 'read', [[invId]], {
              fields: ['name', 'state', 'payment_state']
            });
            const invName = postedInv && postedInv[0] ? postedInv[0].name : `INV#${invId}`;
            logger.info(`Successfully posted Customer Invoice ${invName} (ID: ${invId}, State: POSTED).`);
            postedInvoices.push(invName);
          } else if (inv.state === 'posted') {
            postedInvoices.push(inv.name);
          }
        } catch (invErr) {
          logger.error(`Error posting invoice ID ${invId}`, invErr.message);
        }
      }

      return postedInvoices;
    } catch (error) {
      logger.error(`Error in createAndPostInvoice for SO ID ${soId}`, error);
      return [];
    }
  }

  /**
   * Process bypass of delivery and invoice for a Sales Order confirmed in Odoo.
   * Excludes company "PT. KANTI SEHATI SUKSES".
   * Forces delivery completion (allowing negative stock) and posts the invoice.
   */
  async processSOBypass(soIdOrName) {
    if (!soIdOrName) {
      throw new Error('Missing Sales Order ID or Name');
    }

    logger.info(`[Odoo SO Bypass] Processing Sales Order identifier: ${soIdOrName}...`);

    let soRecords = [];
    const isNumeric = !isNaN(soIdOrName) && !isNaN(parseFloat(soIdOrName));

    if (isNumeric) {
      soRecords = await this._callObject('sale.order', 'read', [[parseInt(soIdOrName, 10)]], {
        fields: ['id', 'name', 'state', 'company_id', 'picking_ids', 'invoice_ids', 'date_order']
      });
    } else {
      soRecords = await this._callObject('sale.order', 'search_read', [
        [['name', '=', String(soIdOrName).trim()]]
      ], {
        fields: ['id', 'name', 'state', 'company_id', 'picking_ids', 'invoice_ids', 'date_order'],
        limit: 1
      });
    }

    if (!soRecords || soRecords.length === 0) {
      const msg = `[Odoo SO Bypass] Sales Order not found for identifier: "${soIdOrName}"`;
      logger.warn(msg);
      return { success: false, notFound: true, message: msg };
    }

    const so = soRecords[0];
    const soId = so.id;
    const soName = so.name;
    const companyId = so.company_id ? so.company_id[0] : null;
    const companyName = so.company_id ? so.company_id[1] : '';

    logger.info(`[Odoo SO Bypass] Found Sales Order: ${soName} (ID: ${soId}, State: ${so.state}, Company: "${companyName}")`);

    // Hardcoded check: Skip if company is PT. KANTI SEHATI SUKSES
    const isExcludedCompany = companyName && companyName.toUpperCase().includes('KANTI SEHATI SUKSES');
    if (isExcludedCompany) {
      const skipMsg = `[Odoo SO Bypass] Skipped Sales Order ${soName} because company "${companyName}" matches exclusion rule (PT. KANTI SEHATI SUKSES).`;
      logger.info(skipMsg);
      return {
        success: true,
        skipped: true,
        reason: skipMsg,
        soId,
        soName,
        companyName
      };
    }

    // 1. Confirm SO if it's still in draft or sent state
    if (so.state === 'draft' || so.state === 'sent') {
      logger.info(`[Odoo SO Bypass] Confirming Sales Order ${soName} (ID: ${soId})...`);
      await this._callObject('sale.order', 'action_confirm', [[soId]]);
      logger.info(`[Odoo SO Bypass] Sales Order ${soName} confirmed.`);
    }

    // 2. Fetch fresh picking_ids from SO
    const refreshedSO = await this._callObject('sale.order', 'read', [[soId]], {
      fields: ['picking_ids', 'invoice_ids']
    });
    const pickingIds = refreshedSO && refreshedSO[0] ? refreshedSO[0].picking_ids : (so.picking_ids || []);

    // 3. Bypass Delivery (force done, allow negative stock)
    let pickings = [];
    if (pickingIds && pickingIds.length > 0) {
      logger.info(`[Odoo SO Bypass] Validating ${pickingIds.length} delivery picking(s) for ${soName}...`);
      pickings = await this.validateDelivery(pickingIds);
    } else {
      logger.info(`[Odoo SO Bypass] No delivery pickings linked to ${soName}.`);
    }

    // 4. Bypass Invoice (create if not exists & post it)
    logger.info(`[Odoo SO Bypass] Creating/Posting invoice for ${soName}...`);
    const invoices = await this.createAndPostInvoice(soId, so.date_order, true);

    logger.info(`[Odoo SO Bypass] Finished processing ${soName}: Delivery=[${pickings.join(', ')}], Invoices=[${invoices.join(', ')}]`);

    return {
      success: true,
      soId,
      soName,
      companyName,
      pickings,
      invoices
    };
  }

  /**
   * Create Sales Order in Odoo for company Ansania using matching SKUs
   */
  async createSalesOrder({ invoiceNo, customer, items, orderDate, note }) {
    try {
      const companyId = await this.getCompanyId();
      const warehouseId = await this.getWarehouseId(config.odoo.warehouseName, companyId);

      // Check idempotency
      const existingSO = await this.checkExistingSalesOrder(invoiceNo, companyId);
      if (existingSO) {
        logger.warn(`Sales Order with reference "${invoiceNo}" already exists in Odoo (SO Name: ${existingSO.name}, ID: ${existingSO.id})`);
        return {
          success: true,
          skipped: true,
          soId: existingSO.id,
          soName: existingSO.name,
          message: 'Sales Order already exists in Odoo'
        };
      }

      // Find or Create Partner
      const partnerId = await this.findOrCreatePartner(customer, companyId);

      // Build Order Lines by matching SKU
      const orderLines = [];
      const unmappedSkus = [];

      for (const item of items) {
        const sku = item.sku || item.item_code;
        const qty = parseFloat(item.qty || item.quantity || item.amount || 1);
        const priceUnit = parseFloat(item.price || item.unit_price || 0);

        if (!sku) {
          logger.warn('Skipping item without SKU or item_code', item);
          continue;
        }

        const odooProduct = await this.findProductBySKU(sku);

        if (!odooProduct) {
          unmappedSkus.push(sku);
          logger.error(`SKU "${sku}" not found in Odoo product catalog.`);
          continue;
        }

        orderLines.push([0, 0, {
          product_id: odooProduct.id,
          name: item.item_name || odooProduct.name || `Item ${sku}`,
          product_uom_qty: qty,
          price_unit: priceUnit
        }]);
      }

      if (orderLines.length === 0) {
        const msg = `Cannot create Sales Order for invoice "${invoiceNo}": No valid matching SKUs found in Odoo. Unmapped SKUs: ${unmappedSkus.join(', ')}`;
        logger.error(msg);
        return {
          success: false,
          error: msg,
          unmappedSkus
        };
      }

      // Prepare Sale Order payload
      const saleOrderData = {
        partner_id: partnerId,
        company_id: companyId,
        client_order_ref: invoiceNo,
        order_line: orderLines
      };

      if (warehouseId) {
        saleOrderData.warehouse_id = warehouseId;
      }

      if (config.odoo.jenisSO) {
        saleOrderData.x_studio_jenis_so = sanitizeJenisSO(config.odoo.jenisSO);
      }

      if (note) {
        saleOrderData.note = note;
      }

      if (config.settings.defaultPricelistId) {
        saleOrderData.pricelist_id = config.settings.defaultPricelistId;
      }

      if (orderDate) {
        const d = new Date(orderDate);
        if (!isNaN(d.getTime())) {
          saleOrderData.date_order = d.toISOString().replace('T', ' ').substring(0, 19);
        }
      }

      logger.info(`Creating Sales Order in Odoo for company Ansania (ID: ${companyId}) with ${orderLines.length} item lines...`);
      const soId = await this._callObject('sale.order', 'create', [saleOrderData]);

      // Fetch created SO name
      const createdSO = await this._callObject('sale.order', 'read', [[soId]], { fields: ['name', 'state'] });
      const soName = createdSO && createdSO[0] ? createdSO[0].name : `SO#${soId}`;

      logger.info(`Successfully created Sales Order in Odoo! SO Name: ${soName}, ID: ${soId}`);

      let pickings = [];
      let invoices = [];

      // Auto confirm if configured
      if (config.settings.autoConfirmSO) {
        logger.info(`Auto-confirming Sales Order ${soName} (ID: ${soId})...`);
        await this._callObject('sale.order', 'action_confirm', [[soId]]);
        logger.info(`Sales Order ${soName} confirmed (Status: SALE).`);

        // Fetch picking_ids
        const confirmedSO = await this._callObject('sale.order', 'read', [[soId]], {
          fields: ['picking_ids']
        });
        const pickingIds = confirmedSO && confirmedSO[0] ? confirmedSO[0].picking_ids : [];

        // Auto validate delivery if configured
        if (config.settings.autoValidateDelivery && pickingIds.length > 0) {
          pickings = await this.validateDelivery(pickingIds);
        }

        // Auto create and post invoice if configured
        if (config.settings.autoCreateInvoice) {
          invoices = await this.createAndPostInvoice(soId, orderDate);
        }
      }

      return {
        success: true,
        soId,
        soName,
        pickings,
        invoices,
        unmappedSkus: unmappedSkus.length > 0 ? unmappedSkus : undefined
      };
    } catch (error) {
      logger.error(`Error creating Sales Order for invoice "${invoiceNo}"`, error);
      throw error;
    }
  }

  /**
   * Fetch document details (Invoice or Sales Order) along with customer/partner information
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
   * Authenticate web session with Odoo to obtain session cookie for report downloading
   */
  async getWebSessionCookie() {
    if (this.sessionCookie && this.sessionCookieExpires && Date.now() < this.sessionCookieExpires) {
      return this.sessionCookie;
    }

    const authUrl = `${config.odoo.url.replace(/\/+$/, '')}/web/session/authenticate`;
    const response = await axios.post(authUrl, {
      jsonrpc: '2.0',
      params: {
        db: config.odoo.db,
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
   * Download official Odoo report PDF for a given document (account.move or sale.order)
   * Supports custom report layouts like "Invoice Internal" (account.report_invoice_copy_3)
   */
  async downloadDocumentPdf(model, recordId, customReportName = null) {
    const docInfo = await this.getDocumentDetails(model, recordId);

    // Map common aliases for invoice reports
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

    // Try downloading via session-authenticated report endpoint (e.g. Invoice Internal)
    if (targetReport) {
      try {
        const cookie = await this.getWebSessionCookie();
        const reportUrl = `${config.odoo.url.replace(/\/+$/, '')}/report/pdf/${targetReport}/${recordId}`;
        logger.info(`[Odoo] Downloading report "${targetReport}" from ${reportUrl}...`);

        const response = await axios.get(reportUrl, {
          headers: { Cookie: cookie },
          responseType: 'arraybuffer',
          timeout: 30000
        });

        const filename = `${(docInfo.name || 'invoice').replace(/[/\\?%*:|"<>]/g, '_')}.pdf`;
        const buffer = Buffer.from(response.data);

        // Upload/Update attachment in Odoo for direct public download link
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

    // Fallback: download via portal access_token
    let { accessUrl, accessToken, name } = docInfo;
    if (!accessUrl || !accessToken) {
      throw new Error(`Document ${model} ID ${recordId} does not have portal access_token or access_url`);
    }

    const downloadUrl = `${config.odoo.url.replace(/\/+$/, '')}${accessUrl}?report_type=pdf&download=true&access_token=${accessToken}`;
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
   * Upload or update document PDF as an ir.attachment in Odoo and return direct public download URL
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

    const publicUrl = `${config.odoo.url.replace(/\/+$/, '')}/web/content/${attachmentId}?download=true&access_token=${accessToken}`;
    return {
      attachmentId,
      accessToken,
      publicUrl
    };
  }

  /**
   * Duplicate stock.landed.cost record(s) preserving mrp_production_ids (Manufacturing Orders)
   * Equivalent to Odoo Python Server Action:
   *   for record in records:
   *     record.copy(default={'mrp_production_ids': [(6, 0, record.mrp_production_ids.ids)]})
   */
  async duplicateLandedCostWithMO(landedCostIds) {
    if (!this.uid) await this.authenticate();

    let ids = [];
    if (Array.isArray(landedCostIds)) {
      ids = landedCostIds.map(id => Number(id)).filter(id => !isNaN(id) && id > 0);
    } else if (typeof landedCostIds === 'number' || !isNaN(Number(landedCostIds))) {
      ids = [Number(landedCostIds)];
    }

    if (ids.length === 0) {
      throw new Error('No valid Landed Cost ID provided for duplication');
    }

    logger.info(`[Landed Cost] Starting duplication with MO for ${ids.length} record(s): [${ids.join(', ')}]`);

    const originalRecords = await this._callObject('stock.landed.cost', 'read', [
      ids,
      ['id', 'name', 'target_model', 'mrp_production_ids', 'company_id', 'state']
    ]);

    if (!originalRecords || originalRecords.length === 0) {
      throw new Error(`None of the requested Landed Cost records were found in Odoo: [${ids.join(', ')}]`);
    }

    const createdRecords = [];
    const errors = [];

    for (const record of originalRecords) {
      try {
        const mrpIds = record.mrp_production_ids || [];
        const defaultVals = {
          mrp_production_ids: [[6, 0, mrpIds]]
        };

        if (record.target_model) {
          defaultVals.target_model = record.target_model;
        }

        logger.info(`[Landed Cost] Duplicating LC #${record.id} (${record.name}) with ${mrpIds.length} MOs...`);

        const rawNewId = await this._callObject('stock.landed.cost', 'copy', [
          record.id,
          defaultVals
        ]);

        const newId = Array.isArray(rawNewId) ? rawNewId[0] : rawNewId;

        const newRecInfo = await this._callObject('stock.landed.cost', 'read', [
          [newId],
          ['id', 'name', 'state', 'target_model', 'mrp_production_ids']
        ]);

        const newRec = newRecInfo && newRecInfo[0] ? newRecInfo[0] : { id: newId };
        logger.info(`[Landed Cost] Successfully duplicated LC #${record.id} (${record.name}) -> New LC #${newId} (${newRec.name || 'New'}) with ${mrpIds.length} MO(s).`);

        createdRecords.push({
          originalId: record.id,
          originalName: record.name,
          newId: newId,
          newName: newRec.name,
          targetModel: newRec.target_model,
          state: newRec.state,
          mrpProductionIds: mrpIds,
          mrpProductionCount: mrpIds.length
        });
      } catch (err) {
        logger.error(`[Landed Cost] Failed to duplicate LC #${record.id} (${record.name}): ${err.message}`, err);
        errors.push({
          id: record.id,
          name: record.name,
          error: err.message
        });
      }
    }

    return {
      success: createdRecords.length > 0,
      count: createdRecords.length,
      newRecordIds: createdRecords.map(r => r.newId),
      createdRecords,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Resolve and link Manufacturing Order (x_studio_manufacturing_order) and
   * Sales Order (sale_id) on stock.picking (Transfer).
   * Supports operation types: PC (Pick Component), SFP (Store Finished Product), INT (Internal Transfer), etc.
   */
  async resolveTransferMoAndSo(pickingIds) {
    if (!this.uid) await this.authenticate();

    let ids = [];
    if (Array.isArray(pickingIds)) {
      ids = pickingIds.map(id => Number(id)).filter(id => !isNaN(id) && id > 0);
    } else if (typeof pickingIds === 'number' || !isNaN(Number(pickingIds))) {
      ids = [Number(pickingIds)];
    }

    if (ids.length === 0) {
      throw new Error('No valid picking ID provided to resolve MO/SO');
    }

    logger.info(`[Transfer MO/SO] Resolving references for ${ids.length} transfer(s): [${ids.join(', ')}]`);

    const pickings = await this._callObject('stock.picking', 'read', [
      ids,
      [
        'id', 'name', 'origin', 'picking_type_id', 'sale_id',
        'x_studio_manufacturing_order', 'x_studio_sales_order', 'move_ids',
        'company_id', 'state', 'location_id', 'location_dest_id', 'partner_id',
        'scheduled_date', 'date_deadline', 'move_type'
      ]
    ]);

    if (!pickings || pickings.length === 0) {
      throw new Error(`None of the requested pickings found in Odoo: [${ids.join(', ')}]`);
    }

    const results = [];
    const allCreatedPickingIds = [];

    // Batch Prefetch 1: Read all stock.moves across all pickings in 1 single XML-RPC call
    const allMoveIds = [...new Set(pickings.flatMap(p => p.move_ids || []))];
    const movesMap = new Map();
    const destMovesMap = new Map();

    if (allMoveIds.length > 0) {
      try {
        logger.debug(`[Transfer MO/SO] Prefetching ${allMoveIds.length} stock.moves for ${pickings.length} pickings in bulk...`);
        const moves = await this._callObject('stock.move', 'read', [
          allMoveIds,
          ['id', 'raw_material_production_id', 'production_id', 'move_dest_ids', 'production_group_id', 'move_line_ids', 'origin']
        ]);
        moves.forEach(m => movesMap.set(m.id, m));

        // Batch Prefetch 2: Read all destination moves across all moves in 1 single XML-RPC call
        const allDestMoveIds = [...new Set(moves.flatMap(m => m.move_dest_ids || []))];
        if (allDestMoveIds.length > 0) {
          logger.debug(`[Transfer MO/SO] Prefetching ${allDestMoveIds.length} dest_moves in bulk...`);
          const destMoves = await this._callObject('stock.move', 'read', [
            allDestMoveIds,
            ['id', 'raw_material_production_id', 'production_id', 'production_group_id']
          ]);
          destMoves.forEach(dm => destMovesMap.set(dm.id, dm));
        }
      } catch (errMoves) {
        logger.warn(`[Transfer MO/SO] Warning during bulk prefetch of moves: ${errMoves.message}`);
      }
    }

    // Batch Prefetch 3: Prefetch mrp.production.group in Odoo 19 (if any moves link via production_group_id)
    const allProdGroupIds = [
      ...new Set([
        ...Array.from(movesMap.values()).filter(m => m.production_group_id && m.production_group_id[0]).map(m => m.production_group_id[0]),
        ...Array.from(destMovesMap.values()).filter(dm => dm.production_group_id && dm.production_group_id[0]).map(dm => dm.production_group_id[0])
      ])
    ];
    const prodGroupMap = new Map();
    if (allProdGroupIds.length > 0) {
      try {
        logger.debug(`[Transfer MO/SO] Prefetching ${allProdGroupIds.length} production groups in bulk...`);
        const groups = await this._callObject('mrp.production.group', 'read', [
          allProdGroupIds,
          ['id', 'name', 'production_ids']
        ]);
        groups.forEach(g => prodGroupMap.set(g.id, g));
      } catch (errG) {
        logger.debug(`[Transfer MO/SO] Error prefetching production groups: ${errG.message}`);
      }
    }

    // Helper: Resolve which MO a given stock.move feeds or belongs to
    const getMoRefForMove = (m) => {
      if (!m) return null;
      // 1. Destination moves feeding an MO raw materials (Standard for PC transfers feeding an MO)
      for (const dmid of (m.move_dest_ids || [])) {
        const dm = destMovesMap.get(dmid);
        if (dm && dm.raw_material_production_id) {
          return { id: dm.raw_material_production_id[0], name: dm.raw_material_production_id[1] };
        }
        if (dm && dm.production_id) {
          return { id: dm.production_id[0], name: dm.production_id[1] };
        }
        if (dm && dm.production_group_id) {
          const g = prodGroupMap.get(dm.production_group_id[0]);
          if (g && g.production_ids && g.production_ids.length > 0) {
            const pId = typeof g.production_ids[0] === 'object' ? g.production_ids[0].id : g.production_ids[0];
            return { id: pId, name: g.name };
          }
        }
      }

      // 2. Direct move link (e.g. SFP transfers or internal manufacturing moves)
      if (m.raw_material_production_id) {
        return { id: m.raw_material_production_id[0], name: m.raw_material_production_id[1] };
      }
      if (m.production_id) {
        return { id: m.production_id[0], name: m.production_id[1] };
      }

      // 3. production_group_id (Odoo 19 mrp.production.group)
      if (m.production_group_id) {
        const g = prodGroupMap.get(m.production_group_id[0]);
        if (g && g.production_ids && g.production_ids.length > 0) {
          const pId = typeof g.production_ids[0] === 'object' ? g.production_ids[0].id : g.production_ids[0];
          return { id: pId, name: g.name };
        }
      }

      return null;
    };

    // Temporary map of pickingId -> plan data
    const pickingPlans = [];

    for (const picking of pickings) {
      const pickingName = picking.name || `PICK#${picking.id}`;
      let seqCode = '';
      const upperName = pickingName.toUpperCase();
      if (upperName.includes('/PC/')) seqCode = 'PC';
      else if (upperName.includes('/SFP/')) seqCode = 'SFP';
      else if (upperName.includes('/INT/')) seqCode = 'INT';
      else if (upperName.includes('/PICK/')) seqCode = 'PICK';
      else if (upperName.includes('/OUT/')) seqCode = 'OUT';
      else if (upperName.includes('/IN/')) seqCode = 'IN';

      const isMatchedType =
        ['PC', 'SFP', 'INT'].includes(seqCode) ||
        upperName.includes('/PC/') ||
        upperName.includes('/SFP/') ||
        upperName.includes('/INT/');

      const originClean = picking.origin ? picking.origin.split(',')[0].trim() : '';
      const namePrefix = pickingName.includes('/') ? pickingName.split('/')[0].trim() : '';

      // Analyze moves of this picking and group them by target MO
      const pMoves = (picking.move_ids || []).map(mid => movesMap.get(mid)).filter(Boolean);
      const movesByMo = new Map(); // moId -> { moId, moName, moveIds: [], moveLineIds: [] }

      for (const m of pMoves) {
        const moRef = getMoRefForMove(m);
        if (moRef && moRef.id) {
          if (!movesByMo.has(moRef.id)) {
            movesByMo.set(moRef.id, {
              moId: moRef.id,
              moName: moRef.name,
              moveIds: [],
              moveLineIds: []
            });
          }
          const grp = movesByMo.get(moRef.id);
          grp.moveIds.push(m.id);
          if (m.move_line_ids && m.move_line_ids.length > 0) {
            grp.moveLineIds.push(...m.move_line_ids);
          }
        }
      }

      let resolvedMo = null;
      if (movesByMo.size === 1) {
        const firstEntry = movesByMo.values().next().value;
        resolvedMo = { id: firstEntry.moId, name: firstEntry.moName };
      }

      const canAutoSplit =
        isMatchedType &&
        movesByMo.size > 1 &&
        !['done', 'cancel'].includes(picking.state);

      pickingPlans.push({
        picking,
        pickingName,
        seqCode,
        isMatchedType,
        originClean,
        namePrefix,
        movesByMo,
        canAutoSplit,
        resolvedMo,
        resolvedSo: null
      });
    }

    // Prefetch mrp.production for all resolved/grouped MOs to get x_studio_sales_order in 1 bulk call!
    const moIdsToRead = [
      ...new Set([
        ...pickingPlans.filter(p => p.resolvedMo && p.resolvedMo.id).map(p => p.resolvedMo.id),
        ...pickingPlans.flatMap(p => Array.from(p.movesByMo.keys()))
      ])
    ];
    const moMap = new Map();
    if (moIdsToRead.length > 0) {
      try {
        const moList = await this._callObject('mrp.production', 'read', [
          moIdsToRead,
          ['id', 'name', 'x_studio_sales_order', 'origin']
        ]);
        moList.forEach(m => moMap.set(m.id, m));
      } catch (errMoRead) {
        logger.debug(`[Transfer MO/SO] Error reading MO sales orders in bulk: ${errMoRead.message}`);
      }
    }

    // Prefetch Sales Orders in 1 bulk call for origins that are not MO names (exclude cancelled SOs)
    const potentialSoOrigins = [
      ...new Set(
        pickingPlans
          .map(p => p.originClean)
          .filter(orig => orig && !orig.includes('/MO/'))
      )
    ];
    const soMap = new Map();
    if (potentialSoOrigins.length > 0) {
      try {
        const foundSos = await this._callObject('sale.order', 'search_read', [
          [['name', 'in', potentialSoOrigins], ['state', '!=', 'cancel']]
        ], {
          fields: ['id', 'name', 'state'],
          order: 'id desc'
        });
        foundSos.forEach(so => {
          if (!soMap.has(so.name)) {
            soMap.set(so.name, so);
          }
        });
      } catch (errSoRead) {
        logger.debug(`[Transfer MO/SO] Error reading Sales Orders in bulk: ${errSoRead.message}`);
      }
    }

    for (const plan of pickingPlans) {
      try {
        const { picking, pickingName, seqCode, isMatchedType, originClean, namePrefix, movesByMo, canAutoSplit } = plan;
        let resolvedMo = plan.resolvedMo;
        let resolvedSo = null;

        // Fallback for MO: Origin Match in mrp.production (if moves did not link)
        if (!resolvedMo && originClean && movesByMo.size === 0) {
          const domainsToTry = [];
          if (namePrefix) {
            domainsToTry.push([
              '&',
              ['name', 'ilike', `${namePrefix}/MO/`],
              '|', '|',
              ['name', '=', originClean],
              ['origin', '=', originClean],
              ['x_studio_origin_mo', '=', originClean]
            ]);
          }
          domainsToTry.push([
            '|', '|', '|', '|',
            ['name', '=', originClean],
            ['name', 'ilike', originClean + '-'],
            ['origin', '=', originClean],
            ['x_studio_origin_mo', '=', originClean],
            ['x_studio_origin_mo', 'ilike', originClean + '-']
          ]);
          if (originClean.includes('/MO/')) {
            const moSuffix = originClean.substring(originClean.indexOf('/MO/'));
            domainsToTry.push([['name', 'ilike', moSuffix]]);
          }

          for (const d of domainsToTry) {
            try {
              const foundMos = await this._callObject('mrp.production', 'search_read', [d], {
                fields: ['id', 'name', 'x_studio_sales_order', 'origin'],
                limit: 1
              });
              if (foundMos && foundMos.length > 0) {
                resolvedMo = {
                  id: foundMos[0].id,
                  name: foundMos[0].name,
                  salesOrder: foundMos[0].x_studio_sales_order
                };
                moMap.set(foundMos[0].id, foundMos[0]);
                break;
              }
            } catch (errDomain) {
              logger.debug(`MO search error for domain ${JSON.stringify(d)}: ${errDomain.message}`);
            }
          }
        }

        // 2. Resolve SO (sale.order)
        // Priority 1: From MO's linked Sales Order (x_studio_sales_order) - 100% accurate link
        if (resolvedMo && moMap.has(resolvedMo.id)) {
          const moData = moMap.get(resolvedMo.id);
          if (moData && moData.x_studio_sales_order && moData.x_studio_sales_order[0]) {
            resolvedSo = {
              id: moData.x_studio_sales_order[0],
              name: moData.x_studio_sales_order[1]
            };
          }
        }

        // Priority 2: Check if origin directly matches an active Sales Order
        if (!resolvedSo && originClean && soMap.has(originClean)) {
          const so = soMap.get(originClean);
          resolvedSo = { id: so.id, name: so.name };
        }

        // ---------------------------------------------------------------------
        // 3. AUTO-SPLIT LOGIC: 1 MO = 1 PC Transfer
        // If an internal transfer (PC/SFP/INT) contains moves for MULTIPLE distinct MOs,
        // automatically split it so each MO has its own separate transfer picking!
        // ---------------------------------------------------------------------
        if (canAutoSplit) {
          logger.info(`[Transfer Auto-Split] ✂️ Transfer ${pickingName} (ID: ${picking.id}, State: ${picking.state}) contains moves for ${movesByMo.size} distinct MOs! Performing auto-split into 1 MO = 1 Transfer...`);

          const moGroups = Array.from(movesByMo.values());
          const firstMoGroup = moGroups[0];
          const newCreatedPickings = [];

          // MO #2 s/d #N: Create new stock.picking and reassign moves
          for (let i = 1; i < moGroups.length; i++) {
            const moGroup = moGroups[i];
            const moInfo = moMap.get(moGroup.moId) || {};
            const moSo = (moInfo.x_studio_sales_order && moInfo.x_studio_sales_order[0])
              ? { id: moInfo.x_studio_sales_order[0], name: moInfo.x_studio_sales_order[1] }
              : resolvedSo;

            // 3.1. Create new stock.picking
            const newPickVals = {
              picking_type_id: picking.picking_type_id[0],
              location_id: picking.location_id[0],
              location_dest_id: picking.location_dest_id[0],
              move_type: picking.move_type || 'direct',
              partner_id: picking.partner_id ? picking.partner_id[0] : false,
              origin: picking.origin || moGroup.moName,
              scheduled_date: picking.scheduled_date,
              date_deadline: picking.date_deadline,
              company_id: picking.company_id ? picking.company_id[0] : false,
              x_studio_manufacturing_order: moGroup.moId,
              x_studio_sales_order: moSo ? moSo.id : false
            };

            const newPickingId = await this._callObject('stock.picking', 'create', [newPickVals], {
              context: { tracking_disable: true, no_automation: true, mail_auto_delete: true }
            });

            // 3.2. Reassign stock.moves to new picking
            await this._callObject('stock.move', 'write', [
              moGroup.moveIds,
              { picking_id: newPickingId }
            ], {
              context: { tracking_disable: true, no_automation: true }
            });

            // 3.3. Reassign stock.move.lines (if any exist)
            if (moGroup.moveLineIds && moGroup.moveLineIds.length > 0) {
              await this._callObject('stock.move.line', 'write', [
                moGroup.moveLineIds,
                { picking_id: newPickingId }
              ], {
                context: { tracking_disable: true, no_automation: true }
              });
            }

            // 3.4. Re-check availability if original picking was already confirmed/assigned
            if (['assigned', 'confirmed'].includes(picking.state)) {
              try {
                await this._callObject('stock.picking', 'action_assign', [[newPickingId]], {
                  context: { tracking_disable: true, no_automation: true }
                });
              } catch (errAssign) {
                logger.debug(`[Transfer Auto-Split] Note on action_assign for new picking ${newPickingId}: ${errAssign.message}`);
              }
            }

            newCreatedPickings.push(newPickingId);
            allCreatedPickingIds.push(newPickingId);
            logger.info(`[Transfer Auto-Split] ✅ Created transfer #${newPickingId} for MO ${moGroup.moName} (${moGroup.moveIds.length} moves reassigned).`);
          }

          // 3.5. Update original picking for first MO
          const firstMoInfo = moMap.get(firstMoGroup.moId) || {};
          const firstMoSo = (firstMoInfo.x_studio_sales_order && firstMoInfo.x_studio_sales_order[0])
            ? { id: firstMoInfo.x_studio_sales_order[0], name: firstMoInfo.x_studio_sales_order[1] }
            : resolvedSo;

          const origVals = {
            x_studio_manufacturing_order: firstMoGroup.moId
          };
          if (firstMoSo) {
            origVals.x_studio_sales_order = firstMoSo.id;
          }
          if (picking.sale_id) {
            origVals.sale_id = false;
          }

          await this._callObject('stock.picking', 'write', [[picking.id], origVals], {
            context: { tracking_disable: true, no_automation: true, mail_auto_delete: true }
          });

          if (['assigned', 'confirmed'].includes(picking.state)) {
            try {
              await this._callObject('stock.picking', 'action_assign', [[picking.id]], {
                context: { tracking_disable: true, no_automation: true }
              });
            } catch (errAssign) {
              logger.debug(`[Transfer Auto-Split] Note on action_assign for orig picking ${picking.id}: ${errAssign.message}`);
            }
          }

          logger.info(`[Transfer Auto-Split] 🎉 Auto-split complete for ${pickingName}! Split into ${moGroups.length} transfers (Orig #${picking.id} for MO ${firstMoGroup.moName} + New: [${newCreatedPickings.join(', ')}]).`);

          results.push({
            pickingId: picking.id,
            pickingName,
            seqCode,
            isMatchedType,
            action: 'auto_split',
            totalMos: moGroups.length,
            originalPickingMo: firstMoGroup.moName,
            createdPickingsCount: newCreatedPickings.length,
            createdPickingIds: newCreatedPickings,
            updated: true
          });
          continue; // Finish processing this picking
        }

        // ---------------------------------------------------------
        // 4. Standard Single-MO Transfer Linking (when already 1 MO or non-split)
        // ---------------------------------------------------------
        const currentMoId = picking.x_studio_manufacturing_order ? picking.x_studio_manufacturing_order[0] : null;
        const currentStudioSoId = picking.x_studio_sales_order ? picking.x_studio_sales_order[0] : null;

        const vals = {};
        if (isMatchedType) {
          // Internal Manufacturing Transfers (PC, SFP, INT) -> Only for Transfer MO button
          if (resolvedMo && resolvedMo.id !== currentMoId) {
            vals.x_studio_manufacturing_order = resolvedMo.id;
          }
          if (resolvedSo && resolvedSo.id !== currentStudioSoId) {
            vals.x_studio_sales_order = resolvedSo.id;
          }
          if (picking.sale_id) {
            vals.sale_id = false;
          }
        } else {
          // Customer Delivery (PICK, OUT, etc.) -> Strictly for Delivery button
          if (resolvedSo && (!picking.sale_id || picking.sale_id[0] !== resolvedSo.id)) {
            vals.sale_id = resolvedSo.id;
          }
          if (currentStudioSoId) {
            vals.x_studio_sales_order = false;
          }
        }

        let updated = false;
        if (Object.keys(vals).length > 0) {
          logger.info(`[Transfer MO/SO] Writing updates to picking ${pickingName} (ID: ${picking.id}):`, vals);
          await this._callObject('stock.picking', 'write', [[picking.id], vals], {
            context: {
              tracking_disable: true,
              no_automation: true,
              mail_auto_delete: true
            }
          });
          updated = true;
          logger.info(`[Transfer MO/SO] Successfully updated picking ${pickingName}!`);
        } else {
          logger.info(`[Transfer MO/SO] No updates needed for ${pickingName} (already matches).`);
        }

        results.push({
          pickingId: picking.id,
          pickingName,
          seqCode,
          isMatchedType,
          resolvedMo: resolvedMo ? { id: resolvedMo.id, name: resolvedMo.name } : null,
          resolvedSo: resolvedSo ? { id: resolvedSo.id, name: resolvedSo.name } : null,
          updatedFields: Object.keys(vals),
          updated
        });
      } catch (pickErr) {
        logger.error(`[Transfer MO/SO] Error processing picking ID ${picking.id}: ${pickErr.message}`, pickErr);
        results.push({
          pickingId: picking.id,
          error: pickErr.message
        });
      }
    }

    return {
      success: true,
      count: results.length,
      createdPickingIds: allCreatedPickingIds,
      results
    };
  }
}





// Default Odoo instance: used by Jubelio integration (uses credentials from .env, e.g. ansania@kantiss.com)
export const odooService = new OdooService();

// Dedicated Admin/IT instance: used for Invoicing/Wablas and SO Confirm bypass (uses it@kantiss.com, sees all contacts)
export const odooAdminService = new OdooService({
  username: 'it@kantiss.com',
  password: 'jadiapaya'
});

export const odooBypassService = odooAdminService;



