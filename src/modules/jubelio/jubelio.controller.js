import { jubelioService } from './jubelio.service.js';
import { jubelioService as jubelioApiService } from '../../services/jubelioService.js';
import { resolveCustomerAndNotes } from '../../utils/channelHelper.js';
import { logger } from '../../utils/logger.js';

/**
 * Normalizes Jubelio webhook payload into standard format
 */
async function parseJubelioPayload(body) {
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
      logger.info(`Payload items empty. Fetching full details for invoice ID ${invoiceId || salesOrderId} from Jubelio API...`);
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
      logger.warn('Could not fetch additional invoice details from Jubelio API. Will try parsing payload directly.', err.message);
    }
  }

  // Resolve target customer (Generic Marketplace Partner or Individual Buyer) and Sales Order Note
  const { customer, channelInfo, orderNote } = resolveCustomerAndNotes(mergedData);

  logger.info(`Channel Resolution: Detected channel "${channelInfo.channelName}" (Type: ${channelInfo.type}) -> Odoo Customer: "${customer.name}" (Generic: ${customer.isChannelCustomer})`);

  // Map items to standard format
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
 * Background worker to process invoice sync to Odoo asynchronously
 */
async function processInvoiceAsync(body) {
  try {
    const { invoiceNo, customer, items, orderDate, note, channelInfo } = await parseJubelioPayload(body);

    if (!items || items.length === 0) {
      logger.warn(`Async processing: Invoice "${invoiceNo}" has no items.`);
      return;
    }

    logger.info(`Async processing: Invoice "${invoiceNo}" [${channelInfo.type.toUpperCase()}] with ${items.length} items for customer "${customer.name}"...`);

    const result = await jubelioService.createSalesOrder({
      invoiceNo,
      customer,
      items,
      orderDate,
      note
    });

    if (result.success) {
      logger.info(`Async Processing Completed: Sales Order ${result.soName} (ID: ${result.soId}) for Jubelio invoice "${invoiceNo}"`);
    } else {
      logger.error(`Async Processing Failed for invoice "${invoiceNo}": ${result.error || result.message}`);
    }
  } catch (error) {
    logger.error('Async Processing Error during Jubelio -> Odoo sync', error);
  }
}

/**
 * Webhook handler for Jubelio Invoice creation event
 */
export const handleJubelioInvoiceWebhook = async (req, res) => {
  logger.info('Received Jubelio invoice webhook event', {
    headers: req.headers['content-type'],
    invoiceNo: req.body?.invoice_no || req.body?.invoice_id
  });
  logger.debug('Webhook Payload:', req.body);

  // Send 200 OK immediately to Jubelio to prevent 5000ms timeout
  res.status(200).json({
    success: true,
    message: 'Webhook received. Processing Sales Order in background.'
  });

  // Process asynchronously in background
  processInvoiceAsync(req.body);
};
