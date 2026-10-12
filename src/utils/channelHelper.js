import { config } from '../config/env.js';

const MARKETPLACE_KEYWORDS = ['SHOPEE', 'TOKOPEDIA', 'TIKTOK', 'BLIBLI', 'LAZADA', 'EVERMOS', 'INTERNAL'];

/**
 * Detects channel type from channel_name, store_name, customer_name, source, order_type, ref_no, or salesorder_no
 * @param {Object} data 
 * @returns {string} Channel type: 'shopee', 'tokopedia', 'tiktok', 'blibli', 'lazada', 'evermos', 'internal', or 'other'
 */
export function detectChannelType(data = {}) {
  const channelName = String(data.channel_name || data.channel || '').toLowerCase();
  const storeName = String(data.store_name || data.store || '').toLowerCase();
  const customerName = String(data.customer_name || '').toLowerCase();
  const sourceName = String(data.source_name || '').toLowerCase();
  const orderType = String(data.order_type || '').toLowerCase();
  const salesOrderNo = String(data.salesorder_no || '').toLowerCase();
  const invoiceNo = String(data.invoice_no || data.doc_number || '').toLowerCase();
  const refNo = String(data.ref_no || '').toLowerCase();
  const courier = String(data.courier || data.shipper || '').toLowerCase();
  const source = data.source;

  const combined = [
    channelName,
    storeName,
    customerName,
    sourceName,
    orderType,
    salesOrderNo,
    invoiceNo,
    refNo,
    courier,
    data.marketplace
  ]
    .filter(Boolean)
    .join(' ');

  // 1. Shopee
  if (
    combined.includes('shopee') ||
    combined.includes('shoppe') ||
    combined.includes('spx') ||
    salesOrderNo.startsWith('sp-') ||
    salesOrderNo.startsWith('shp-') ||
    refNo.startsWith('sp-') ||
    refNo.startsWith('shp-') ||
    orderType.includes('shopee') ||
    source === 64 ||
    source === '64'
  ) {
    return 'shopee';
  }

  // 2. Tokopedia
  if (
    combined.includes('tokopedia') ||
    combined.includes('tokped') ||
    combined.includes('shop | tokopedia') ||
    salesOrderNo.startsWith('tkp-') ||
    salesOrderNo.startsWith('tp-') ||
    refNo.startsWith('tkp-') ||
    refNo.startsWith('tp-') ||
    refNo.startsWith('inv/') ||
    orderType.includes('tokopedia')
  ) {
    return 'tokopedia';
  }

  // 3. TikTok
  if (
    combined.includes('tiktok') ||
    combined.includes('tik tok') ||
    combined.includes('ttshop') ||
    salesOrderNo.startsWith('tt-') ||
    salesOrderNo.startsWith('tts-') ||
    refNo.startsWith('tt-') ||
    refNo.startsWith('tts-') ||
    orderType.includes('tiktok')
  ) {
    return 'tiktok';
  }

  // 4. Blibli
  if (
    combined.includes('blibli') ||
    combined.includes('bli-') ||
    salesOrderNo.startsWith('bli-') ||
    salesOrderNo.startsWith('bl-') ||
    refNo.startsWith('bli-') ||
    refNo.startsWith('bl-') ||
    orderType.includes('blibli') ||
    source === 32 ||
    source === '32'
  ) {
    return 'blibli';
  }

  // 5. Lazada
  if (
    combined.includes('lazada') ||
    combined.includes('lzd') ||
    salesOrderNo.startsWith('lzd-') ||
    salesOrderNo.startsWith('lz-') ||
    refNo.startsWith('lzd-') ||
    refNo.startsWith('lz-') ||
    orderType.includes('lazada')
  ) {
    return 'lazada';
  }

  // 6. Evermos
  if (
    combined.includes('evermos') ||
    combined.includes('ev-') ||
    salesOrderNo.startsWith('ev-') ||
    salesOrderNo.startsWith('evm-') ||
    refNo.startsWith('ev-') ||
    refNo.startsWith('evm-') ||
    orderType.includes('evermos') ||
    source === 131078 ||
    source === '131078'
  ) {
    return 'evermos';
  }

  // 7. Internal / Offline B2B / Direct
  if (
    combined.includes('internal') ||
    combined.includes('telemarketing') ||
    combined.includes('mitra') ||
    combined.includes('kanvasing') ||
    salesOrderNo.startsWith('so-') ||
    salesOrderNo.startsWith('sj/') ||
    source === 1 ||
    source === '1'
  ) {
    return 'internal';
  }

  return 'other';
}

/**
 * Resolves target Odoo customer information and builds formatted order note
 * @param {Object} rawData 
 * @returns {{ customer: { name: string, email: string, phone: string, isChannelCustomer: boolean }, channelInfo: Object, orderNote: string }}
 */
export function resolveCustomerAndNotes(rawData = {}) {
  const channelType = detectChannelType(rawData);
  const useChannelCustomer = config.channels.useChannelCustomer;

  const rawCustomerName = (rawData.customer_name || '').trim();
  const isGenericMarketplaceCustomer = MARKETPLACE_KEYWORDS.includes(rawCustomerName.toUpperCase());

  const originalBuyerName = (
    rawData.buyer_name ||
    rawData.shipping_full_name ||
    (!isGenericMarketplaceCustomer ? rawCustomerName : '') ||
    rawData.so_customer_name ||
    ''
  ).trim();

  const originalEmail = rawData.customer_email || rawData.email || '';
  const originalPhone = rawData.customer_phone || rawData.phone || rawData.shipping_phone || '';
  const storeName = rawData.store_name || rawData.store || '';
  const trackingNo = rawData.tracking_number || rawData.tracking_no || rawData.waybill_no || '';
  const shipper = rawData.shipper || rawData.courier || '';
  const refNo = rawData.ref_no || rawData.salesorder_no || rawData.invoice_no || '';

  let customerName = originalBuyerName || config.channels.fallback;
  let isChannelCustomer = false;

  if (useChannelCustomer) {
    switch (channelType) {
      case 'shopee':
        customerName = config.channels.shopee;
        isChannelCustomer = true;
        break;
      case 'tokopedia':
        customerName = config.channels.tokopedia;
        isChannelCustomer = true;
        break;
      case 'tiktok':
        customerName = config.channels.tiktok;
        isChannelCustomer = true;
        break;
      case 'blibli':
        customerName = config.channels.blibli;
        isChannelCustomer = true;
        break;
      case 'lazada':
        customerName = config.channels.lazada;
        isChannelCustomer = true;
        break;
      case 'evermos':
        customerName = config.channels.evermos;
        isChannelCustomer = true;
        break;
      case 'internal':
      case 'other':
      default:
        // Keep individual buyer / customer name for internal B2B / offline orders
        customerName = originalBuyerName || config.channels.fallback;
        isChannelCustomer = false;
        break;
    }
  }

  // Build structured note for Odoo Sales Order
  const noteLines = [];
  const channelLabel = rawData.channel_name || rawData.source_name || channelType.toUpperCase();
  
  noteLines.push(`[Channel: ${channelLabel}]${storeName ? ` [Store: ${storeName}]` : ''}`);
  if (originalBuyerName) noteLines.push(`Buyer: ${originalBuyerName}`);
  if (originalPhone) noteLines.push(`Phone: ${originalPhone}`);
  if (originalEmail) noteLines.push(`Email: ${originalEmail}`);
  if (shipper || trackingNo) {
    noteLines.push(`Courier: ${shipper || '-'}${trackingNo ? ` | Resi/Tracking: ${trackingNo}` : ''}`);
  }
  if (refNo) noteLines.push(`Ref Jubelio: ${refNo}`);

  if (rawData.note && rawData.note.trim()) {
    noteLines.push(`Buyer Note: ${rawData.note.trim()}`);
  }

  return {
    customer: {
      name: customerName,
      email: isChannelCustomer ? '' : originalEmail,
      phone: isChannelCustomer ? '' : originalPhone,
      isChannelCustomer
    },
    channelInfo: {
      type: channelType,
      channelName: channelLabel,
      storeName: storeName
    },
    orderNote: noteLines.join('\n')
  };
}

