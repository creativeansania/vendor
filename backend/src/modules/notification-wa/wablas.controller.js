import { adminOdooClient as odooService } from '../../core/odoo/odooClient.js';
import { wablasService } from './wablas.service.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

function formatRupiah(amount) {
  if (typeof amount !== 'number') return amount || '0';
  return 'Rp ' + Number(amount).toLocaleString('id-ID');
}

/**
 * Controller to handle Odoo Server Action "Send Webhook Notification"
 */
export const handleOdooWablasWebhook = async (req, res) => {
  const payload = req.body || {};
  const query = req.query || {};

  const recordId =
    payload._id ||
    payload.id ||
    payload.res_id ||
    payload.invoice_id ||
    payload.order_id ||
    payload.so_id ||
    query._id ||
    query.id ||
    query.res_id;

  const model =
    payload._model ||
    payload.model ||
    payload.res_model ||
    query._model ||
    query.model ||
    query.res_model ||
    'account.move';

  const customReport = payload.report || query.report || null;
  const host = req.get('host');
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const serverBaseUrl = config.baseUrl || (host ? `${protocol}://${host}` : 'https://api.kantiss.com');

  logger.info('[Wablas Webhook] Received Odoo webhook trigger', {
    recordId,
    model,
    customReport,
    customPhone: payload.phone || payload.mobile || query.phone || null
  });

  if (!recordId) {
    logger.warn('[Wablas Webhook] Request missing record ID');
    return res.status(400).json({
      success: false,
      message: 'Record ID is required (e.g. { "_id": 12345, "_model": "account.move" })'
    });
  }

  // Acknowledge Odoo immediately with 200 OK
  res.status(200).json({
    success: true,
    message: `Webhook received for ${model} (ID: ${recordId}). Processing PDF and WhatsApp delivery in background.`
  });

  // Background execution
  setImmediate(async () => {
    try {
      logger.info(`[Wablas Webhook] Starting background processing for ${model} ID: ${recordId}`);

      const { buffer, filename, docInfo, reportName, publicAttachmentUrl } = await odooService.downloadDocumentPdf(model, recordId, customReport);
      logger.info(`[Wablas Webhook] Downloaded ${filename} (${buffer.length} bytes, report: ${reportName}) for ${docInfo.name}`);

      const rawPhone =
        payload.phone ||
        payload.mobile ||
        payload.partner_phone ||
        query.phone ||
        docInfo.phone;

      if (!rawPhone) {
        logger.error(`[Wablas Webhook] Cannot send WhatsApp: Customer "${docInfo.partnerName}" has no phone number on record.`);
        return;
      }

      let caption = payload.caption || query.caption;
      const formattedTotal = formatRupiah(docInfo.amountTotal);

      if (!caption) {
        if (model === 'account.move') {
          caption = `Halo Kak *${docInfo.partnerName}*,\n\n` +
            `Terima kasih telah berbelanja di *Ansania*.\n` +
            `Berikut kami lampirkan dokumen faktur/invoice resmi Anda:\n\n` +
            `📄 *No. Faktur*: ${docInfo.name}\n` +
            `💰 *Total Tagihan*: ${formattedTotal}\n` +
            `📅 *Tanggal*: ${docInfo.date || '-'}\n\n` +
            `Dokumen PDF faktur terlampir pada pesan ini.\n` +
            `Jika ada pertanyaan, silakan hubungi tim kami dengan membalas pesan ini.\n\n` +
            `Salam hangat,\n*Ansania*`;
        } else if (model === 'sale.order') {
          caption = `Halo Kak *${docInfo.partnerName}*,\n\n` +
            `Terima kasih atas pesanan Anda di *Ansania*.\n` +
            `Berikut kami lampirkan dokumen konfirmasi pesanan Anda:\n\n` +
            `📄 *No. Pesanan*: ${docInfo.name}\n` +
            `💰 *Total*: ${formattedTotal}\n` +
            `📅 *Tanggal*: ${docInfo.date || '-'}\n\n` +
            `Dokumen PDF pesanan terlampir pada pesan ini.\n\n` +
            `Salam hangat,\n*Ansania*`;
        } else {
          caption = `Halo Kak *${docInfo.partnerName}*,\n\n` +
            `Berikut kami lampirkan dokumen resmi Anda (${docInfo.name}) dari *Ansania*.\n\n` +
            `Salam hangat,\n*Ansania*`;
        }
      }

      const directPdfUrl = serverBaseUrl ? `${serverBaseUrl}/api/reports/invoice/${recordId}.pdf` : null;
      const portalPdfUrl = docInfo.accessUrl && docInfo.accessToken
        ? `${config.odoo.url.replace(/\/+$/, '')}${docInfo.accessUrl}?report_type=pdf&download=true&access_token=${docInfo.accessToken}`
        : null;
      const effectivePdfUrl = publicAttachmentUrl || directPdfUrl || portalPdfUrl;

      let sendResult;
      try {
        if (effectivePdfUrl) {
          sendResult = await wablasService.sendDocument(rawPhone, effectivePdfUrl, caption);
        } else {
          throw new Error('No download URL available');
        }
      } catch (urlErr) {
        const errMsg = urlErr.response?.data?.message || urlErr.message;
        logger.warn(`[Wablas Webhook] Send via URL failed (${errMsg}).`);

        if (errMsg && errMsg.includes('package not support')) {
          logger.info(`[Wablas Webhook] Wablas package does not support document attachments. Sending text message with link...`);
          const msgWithLink = `${caption}\n\n📥 *Unduh Dokumen Faktur (PDF)*:\n${effectivePdfUrl}`;
          sendResult = await wablasService.sendMessage(rawPhone, msgWithLink);
        } else {
          logger.info(`[Wablas Webhook] Trying send-document-from-local...`);
          sendResult = await wablasService.sendDocumentFromLocal(rawPhone, buffer, filename, caption);
        }
      }

      logger.info(`[Wablas Webhook] WhatsApp notification processed successfully for ${docInfo.name} to ${rawPhone}`);
    } catch (err) {
      logger.error(`[Wablas Webhook] Failed to process WA notification for ${model} ID ${recordId}`, err.response?.data || err.message);
    }
  });
};

/**
 * Public endpoint to stream/download the rendered invoice PDF
 */
export const handleStreamInvoicePdf = async (req, res) => {
  try {
    const rawId = req.params.id;
    const recordId = Number(String(rawId).replace(/\.pdf$/i, ''));
    const reportType = req.query.report || config.odoo.invoiceReport;

    if (!recordId || isNaN(recordId)) {
      return res.status(400).send('Invalid invoice ID');
    }

    const { buffer, filename } = await odooService.downloadDocumentPdf('account.move', recordId, reportType);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.end(buffer);
  } catch (err) {
    logger.error('[Report Controller] Error streaming invoice PDF:', err);
    return res.status(500).send(`Failed to generate PDF: ${err.message}`);
  }
};
