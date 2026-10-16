import { NextResponse } from 'next/server';
import { adminOdooClient } from '@/lib/odoo/odooClient';
import { wablasService } from '@/lib/services/wablasService';
import { config } from '@/lib/config';

function formatRupiah(amount) {
  if (typeof amount !== 'number') return amount || '0';
  return 'Rp ' + Number(amount).toLocaleString('id-ID');
}

export async function POST(req) {
  try {
    let payload = {};
    try {
      payload = await req.json();
    } catch (e) {
      payload = {};
    }

    const { searchParams } = new URL(req.url);

    const recordId =
      payload._id ||
      payload.id ||
      payload.res_id ||
      payload.invoice_id ||
      payload.order_id ||
      payload.so_id ||
      searchParams.get('_id') ||
      searchParams.get('id') ||
      searchParams.get('res_id');

    const model =
      payload._model ||
      payload.model ||
      payload.res_model ||
      searchParams.get('_model') ||
      searchParams.get('model') ||
      searchParams.get('res_model') ||
      'account.move';

    const customReport = payload.report || searchParams.get('report') || null;
    const host = req.headers.get('host');
    const proto = req.headers.get('x-forwarded-proto') || 'https';
    const serverBaseUrl = config.baseUrl || (host ? `${proto}://${host}` : 'https://api.kantiss.com');

    console.log('[Wablas Webhook] Received trigger:', { recordId, model, customReport });

    if (!recordId) {
      return NextResponse.json({
        success: false,
        message: 'Record ID is required (e.g. { "_id": 12345, "_model": "account.move" })'
      }, { status: 400 });
    }

    // Acknowledge Odoo immediately with 200 OK
    setImmediate(async () => {
      try {
        console.log(`[Wablas Webhook] Background processing for ${model} ID: ${recordId}`);
        const { buffer, filename, docInfo, reportName, publicAttachmentUrl } = await adminOdooClient.downloadDocumentPdf(model, recordId, customReport);
        console.log(`[Wablas Webhook] Downloaded ${filename} (${buffer.length} bytes) for ${docInfo.name}`);

        const rawPhone =
          payload.phone ||
          payload.mobile ||
          payload.partner_phone ||
          searchParams.get('phone') ||
          docInfo.phone;

        if (!rawPhone) {
          console.error(`[Wablas Webhook] Cannot send WhatsApp: Customer "${docInfo.partnerName}" has no phone number.`);
          return;
        }

        let caption = payload.caption || searchParams.get('caption');
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

        try {
          if (effectivePdfUrl) {
            await wablasService.sendDocument(rawPhone, effectivePdfUrl, caption);
          } else {
            throw new Error('No download URL available');
          }
        } catch (urlErr) {
          const errMsg = urlErr.response?.data?.message || urlErr.message;
          console.warn(`[Wablas Webhook] Send via URL failed (${errMsg}).`);

          if (errMsg && errMsg.includes('package not support')) {
            const msgWithLink = `${caption}\n\n📥 *Unduh Dokumen Faktur (PDF)*:\n${effectivePdfUrl}`;
            await wablasService.sendMessage(rawPhone, msgWithLink);
          } else {
            await wablasService.sendDocumentFromLocal(rawPhone, buffer, filename, caption);
          }
        }

        console.log(`[Wablas Webhook] WA notification sent successfully for ${docInfo.name} to ${rawPhone}`);
      } catch (err) {
        console.error(`[Wablas Webhook] Error processing WA notification for ${model} ID ${recordId}:`, err.message);
      }
    });

    return NextResponse.json({
      success: true,
      message: `Webhook received for ${model} (ID: ${recordId}). Processing PDF and WhatsApp delivery in background.`
    });
  } catch (err) {
    console.error('[Wablas Webhook] Handler error:', err.message);
    return NextResponse.json({
      success: false,
      message: err.message
    }, { status: 500 });
  }
}
