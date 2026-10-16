import { defaultOdooClient } from '../odoo/odooClient.js';
import { soBypassService } from './soBypassService.js';
import { config } from '../config.js';
import { jubelioApiService } from './jubelioApiService.js';
import { resolveCustomerAndNotes } from './channelHelper.js';

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
      let products = await this.odoo._callObject('product.product', 'search_read', [
        [['default_code', '=', cleanSku]]
      ], {
        fields: ['id', 'name', 'default_code', 'list_price', 'uom_id'],
        limit: 1
      });

      if (!products || products.length === 0) {
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

      console.warn(`[JubelioService] Product with SKU "${cleanSku}" not found in Odoo.`);
      return null;
    } catch (error) {
      console.error(`[JubelioService] Error searching product by SKU "${cleanSku}":`, error.message);
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

      const partners = await this.odoo._callObject('res.partner', 'search_read', [domain], {
        fields: ['id', 'name', 'company_id'],
        limit: 1
      });

      if (partners && partners.length > 0) {
        return partners[0].id;
      }

      const partnerData = {
        name: name,
        email: email || false,
        phone: phone || false,
        company_id: companyId,
        is_company: Boolean(isChannelCustomer),
        customer_rank: 1
      };

      const partnerId = await this.odoo._callObject('res.partner', 'create', [partnerData]);
      return partnerId;
    } catch (error) {
      console.error(`[JubelioService] Error finding/creating partner for "${name}":`, error.message);
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
      console.error(`[JubelioService] Error checking existing SO for ref "${clientOrderRef}":`, error.message);
      return null;
    }
  }

  /**
   * Normalize Jubelio webhook payload
   */
  async parseJubelioPayload(body) {
    const data = body.data || body;

    const invoiceId = data.invoice_id || data.id || data.doc_id;
    const salesOrderId = data.salesorder_id || data.sales_order_id || data.order_id;
    let invoiceNo = data.invoice_no || data.invoice_number || data.doc_number || data.ref_no || data.order_no || (invoiceId ? `INV-${invoiceId}` : `SO-${Date.now()}`);

    let rawItems = data.items || data.details || data.item_lines || [];
    let mergedData = { ...data };
    let orderDate = data.created_date || data.created_at || data.transaction_date || data.invoice_date;

    // If payload does not contain items, fetch full invoice or order details from Jubelio API
    if ((!rawItems || rawItems.length === 0) && (invoiceId || salesOrderId)) {
      try {
        console.log(`[JubelioService] Payload items empty. Fetching full details for invoice ID ${invoiceId || salesOrderId}...`);
        let details = null;
        if (invoiceId) {
          details = await jubelioApiService.getInvoiceDetails(invoiceId);
        } else if (salesOrderId) {
          details = await jubelioApiService.getSalesOrderDetails(salesOrderId);
        }

        if (details) {
          mergedData = { ...mergedData, ...details };
          invoiceNo = details.invoice_no || details.doc_number || details.salesorder_no || details.ref_no || invoiceNo;
          rawItems = details.items || details.details || details.item_lines || rawItems;
          orderDate = details.created_date || details.created_at || details.transaction_date || orderDate;
        }
      } catch (err) {
        console.warn('[JubelioService] Could not fetch additional invoice details from Jubelio API:', err.message);
      }
    }

    const { customer, channelInfo, orderNote } = resolveCustomerAndNotes(mergedData);

    const items = (rawItems || []).map(item => {
      const qty = parseFloat(item.qty_in_base || item.qty || item.quantity || item.amount || 1);
      const rawPrice = parseFloat(item.sell_price || item.price || item.unit_price || 0);
      const amount = parseFloat(item.amount || (rawPrice * qty));
      const finalUnitPrice = qty > 0 ? (amount / qty) : rawPrice;

      return {
        sku: item.item_code || item.sku,
        item_name: item.description || item.item_name || `Item ${item.item_code || item.sku}`,
        qty: qty > 0 ? qty : 1,
        price: finalUnitPrice
      };
    });

    return {
      invoiceNo,
      customer,
      items,
      orderDate,
      note: orderNote,
      channelInfo
    };
  }

  /**
   * Create Sales Order in Odoo for company Ansania
   */
  async createSalesOrder({ invoiceNo, customer, items, orderDate, note }) {
    try {
      const companyId = await this.odoo.getCompanyId();
      const warehouseId = await this.odoo.getWarehouseId(config.odoo.warehouseName, companyId);

      // Check idempotency
      const existingSO = await this.checkExistingSalesOrder(invoiceNo, companyId);
      if (existingSO) {
        console.warn(`[JubelioService] Sales Order with reference "${invoiceNo}" already exists in Odoo (SO Name: ${existingSO.name}, ID: ${existingSO.id})`);
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

      // Build Order Lines
      const orderLines = [];
      const unmappedSkus = [];

      for (const item of items) {
        const sku = item.sku || item.item_code;
        const qty = parseFloat(item.qty || item.quantity || item.amount || 1);
        const priceUnit = parseFloat(item.price || item.unit_price || 0);

        if (!sku) {
          console.warn('[JubelioService] Skipping item without SKU or item_code', item);
          continue;
        }

        const odooProduct = await this.findProductBySKU(sku);

        if (!odooProduct) {
          unmappedSkus.push(sku);
          console.error(`[JubelioService] SKU "${sku}" not found in Odoo product catalog.`);
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
        console.error(`[JubelioService] ${msg}`);
        return {
          success: false,
          error: msg,
          unmappedSkus
        };
      }

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

      console.log(`[JubelioService] Creating Sales Order in Odoo for company Ansania (ID: ${companyId}) with ${orderLines.length} item lines...`);
      const soId = await this.odoo._callObject('sale.order', 'create', [saleOrderData]);

      const createdSO = await this.odoo._callObject('sale.order', 'read', [[soId]], { fields: ['name', 'state'] });
      const soName = createdSO && createdSO[0] ? createdSO[0].name : `SO#${soId}`;

      console.log(`[JubelioService] Successfully created Sales Order in Odoo! SO Name: ${soName}, ID: ${soId}`);

      let pickings = [];
      let invoices = [];

      // Auto confirm if configured
      if (config.settings.autoConfirmSO) {
        console.log(`[JubelioService] Auto-confirming Sales Order ${soName} (ID: ${soId})...`);
        await this.odoo._callObject('sale.order', 'action_confirm', [[soId]]);

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
      console.error(`[JubelioService] Error creating Sales Order for invoice "${invoiceNo}":`, error.message);
      throw error;
    }
  }

  /**
   * Process invoice payload asynchronously
   */
  async processInvoiceAsync(body) {
    try {
      const { invoiceNo, customer, items, orderDate, note, channelInfo } = await this.parseJubelioPayload(body);

      if (!items || items.length === 0) {
        console.warn(`[JubelioService] Invoice "${invoiceNo}" has no items.`);
        return;
      }

      console.log(`[JubelioService] Processing: Invoice "${invoiceNo}" [${channelInfo.type.toUpperCase()}] with ${items.length} items for customer "${customer.name}"...`);

      const result = await this.createSalesOrder({
        invoiceNo,
        customer,
        items,
        orderDate,
        note
      });

      if (result.success) {
        console.log(`[JubelioService] Completed: Sales Order ${result.soName} (ID: ${result.soId}) for Jubelio invoice "${invoiceNo}"`);
      } else {
        console.error(`[JubelioService] Failed for invoice "${invoiceNo}": ${result.error || result.message}`);
      }
    } catch (error) {
      console.error('[JubelioService] Error during Jubelio -> Odoo sync:', error.message);
    }
  }
}

export const jubelioService = new JubelioService();
