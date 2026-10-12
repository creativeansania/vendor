import { defaultOdooClient } from '../../core/odoo/odooClient.js';
import { soBypassService } from '../so-bypass/soBypass.service.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

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

export class JubelioService {
  constructor(odooClient = defaultOdooClient) {
    this.odoo = odooClient;
  }

  /**
   * Find product by SKU in product.product model
   */
  async findProductBySKU(sku) {
    if (!sku) return null;
    const cleanSku = String(sku).trim();

    try {
      logger.debug(`Searching Odoo product by exact SKU (default_code): ${cleanSku}`);
      let products = await this.odoo._callObject('product.product', 'search_read', [
        [['default_code', '=', cleanSku]]
      ], {
        fields: ['id', 'name', 'default_code', 'list_price', 'uom_id'],
        limit: 1
      });

      if (!products || products.length === 0) {
        logger.debug(`SKU default_code "${cleanSku}" not found. Trying exact barcode search...`);
        products = await this.odoo._callObject('product.product', 'search_read', [
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

      if (companyId) {
        domain.push(['company_id', 'in', [companyId, false]]);
      }

      logger.debug(`Searching partner in Odoo: "${name}"`);
      const partners = await this.odoo._callObject('res.partner', 'search_read', [domain], {
        fields: ['id', 'name', 'company_id'],
        limit: 1
      });

      if (partners && partners.length > 0) {
        logger.info(`Found existing Odoo partner ID ${partners[0].id} for "${name}"`);
        return partners[0].id;
      }

      logger.info(`Creating new partner in Odoo for "${name}" (Company ID: ${companyId})...`);
      const partnerData = {
        name: name,
        email: email || false,
        phone: phone || false,
        company_id: companyId,
        is_company: isChannelCustomer ? true : false,
        customer_rank: 1
      };

      const partnerId = await this.odoo._callObject('res.partner', 'create', [partnerData]);
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
      const orders = await this.odoo._callObject('sale.order', 'search_read', [
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
   * Create Sales Order in Odoo for company Ansania using matching SKUs
   */
  async createSalesOrder({ invoiceNo, customer, items, orderDate, note }) {
    try {
      const companyId = await this.odoo.getCompanyId();
      const warehouseId = await this.odoo.getWarehouseId(config.odoo.warehouseName, companyId);

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
      const soId = await this.odoo._callObject('sale.order', 'create', [saleOrderData]);

      const createdSO = await this.odoo._callObject('sale.order', 'read', [[soId]], { fields: ['name', 'state'] });
      const soName = createdSO && createdSO[0] ? createdSO[0].name : `SO#${soId}`;

      logger.info(`Successfully created Sales Order in Odoo! SO Name: ${soName}, ID: ${soId}`);

      let pickings = [];
      let invoices = [];

      // Auto confirm if configured
      if (config.settings.autoConfirmSO) {
        logger.info(`Auto-confirming Sales Order ${soName} (ID: ${soId})...`);
        await this.odoo._callObject('sale.order', 'action_confirm', [[soId]]);
        logger.info(`Sales Order ${soName} confirmed (Status: SALE).`);

        const confirmedSO = await this.odoo._callObject('sale.order', 'read', [[soId]], {
          fields: ['picking_ids']
        });
        const pickingIds = confirmedSO && confirmedSO[0] ? confirmedSO[0].picking_ids : [];

        if (config.settings.autoValidateDelivery && pickingIds.length > 0) {
          pickings = await soBypassService.validateDelivery(pickingIds);
        }

        if (config.settings.autoCreateInvoice) {
          invoices = await soBypassService.createAndPostInvoice(soId, orderDate);
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
}

export const jubelioService = new JubelioService();
