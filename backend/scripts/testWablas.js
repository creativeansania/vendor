import { wablasService } from '../src/services/wablasService.js';
import { odooAdminService as odooService } from '../src/services/odooService.js';
import { logger } from '../src/utils/logger.js';

async function main() {
  const targetPhone = process.argv[2];

  logger.info('=======================================================');
  logger.info('🧪 Testing Wablas WhatsApp Integration');
  logger.info('=======================================================');

  // 1. Check Device Info
  try {
    logger.info('1. Checking Wablas Device Status...');
    const deviceInfo = await wablasService.getDeviceInfo();
    logger.info('Device Status:', {
      status: deviceInfo.status,
      name: deviceInfo.data?.name,
      sender: deviceInfo.data?.sender,
      quota: deviceInfo.data?.quota,
      expired: deviceInfo.data?.expired_date,
      deviceStatus: deviceInfo.data?.status
    });
  } catch (err) {
    logger.error('Failed to get Wablas device status:', err.response?.data || err.message);
  }

  // 2. Test Odoo PDF Download
  let sampleBuffer = null;
  let sampleFilename = 'test_invoice.pdf';
  let sampleDocInfo = null;
  let samplePublicUrl = null;
  try {
    logger.info('\n2. Testing Odoo Invoice PDF Download (sample invoice ID: 90432)...');
    await odooService.authenticate();
    const pdfData = await odooService.downloadDocumentPdf('account.move', 90432);
    sampleBuffer = pdfData.buffer;
    sampleFilename = pdfData.filename;
    sampleDocInfo = pdfData.docInfo;
    samplePublicUrl = pdfData.publicAttachmentUrl;
    logger.info(`Successfully downloaded PDF from Odoo: ${sampleFilename} (${sampleBuffer.length} bytes, report: ${pdfData.reportName})`);
    logger.info('Document info:', {
      name: pdfData.docInfo.name,
      partner: pdfData.docInfo.partnerName,
      phone: pdfData.docInfo.phone,
      total: pdfData.docInfo.amountTotal,
      publicUrl: samplePublicUrl
    });
  } catch (err) {
    logger.error('Failed to download PDF from Odoo:', err.message);
  }

  // 3. Test sending WhatsApp message if phone argument is provided
  if (targetPhone) {
    logger.info(`\n3. Testing Sending to target phone: ${targetPhone}...`);
    try {
      const downloadUrl = samplePublicUrl || (sampleDocInfo?.accessUrl && sampleDocInfo?.accessToken
        ? `https://kanti-sehati-sukses.odoo.com${sampleDocInfo.accessUrl}?report_type=pdf&download=true&access_token=${sampleDocInfo.accessToken}`
        : null);

      if (downloadUrl) {
        logger.info('Sending test PDF document via Wablas URL endpoint (/api/send-document)...');
        try {
          const docResult = await wablasService.sendDocument(
            targetPhone,
            downloadUrl,
            'Halo, ini adalah pengujian pengiriman dokumen invoice PDF dari integrasi Odoo Wablas Ansania.'
          );
          logger.info('Document send result:', docResult);
        } catch (urlErr) {
          const errMsg = urlErr.response?.data?.message || urlErr.message;
          logger.warn(`Send via URL failed: "${errMsg}".`);

          if (errMsg && errMsg.includes('package not support')) {
            logger.info('⚠️ Paket Wablas saat ini belum mendukung pengiriman file media/dokumen langsung.');
            logger.info('Mengirimkan pesan teks resmi dengan tautan unduh PDF langsung...');
            const msgWithLink = `Halo Kak *${sampleDocInfo.partnerName}*,\n\n` +
              `Terima kasih telah berbelanja di *Ansania*.\n` +
              `Berikut kami sampaikan rincian faktur resmi Anda:\n\n` +
              `📄 *No. Faktur*: ${sampleDocInfo.name}\n` +
              `💰 *Total Tagihan*: Rp ${Number(sampleDocInfo.amountTotal).toLocaleString('id-ID')}\n` +
              `📅 *Tanggal*: ${sampleDocInfo.date || '-'}\n\n` +
              `📥 *Unduh Dokumen Faktur (PDF)*:\n${downloadUrl}\n\n` +
              `Salam hangat,\n*Ansania*`;

            const msgResult = await wablasService.sendMessage(targetPhone, msgWithLink);
            logger.info('Pesan dengan tautan PDF berhasil dikirim ke WhatsApp:', msgResult);
          } else if (sampleBuffer) {
            logger.info('Trying send-document-from-local...');
            const docResult = await wablasService.sendDocumentFromLocal(
              targetPhone,
              sampleBuffer,
              sampleFilename,
              'Halo, ini adalah pengujian pengiriman dokumen invoice PDF dari integrasi Odoo Wablas Ansania.'
            );
            logger.info('Document send result:', docResult);
          }
        }
      } else if (sampleBuffer) {
        logger.info('Sending test PDF document via local upload (/api/send-document-from-local)...');
        const docResult = await wablasService.sendDocumentFromLocal(
          targetPhone,
          sampleBuffer,
          sampleFilename,
          'Halo, ini adalah pengujian pengiriman dokumen invoice PDF dari integrasi Odoo Wablas Ansania.'
        );
        logger.info('Document send result:', docResult);
      } else {
        logger.info('Sending text test message (/api/send-message)...');
        const msgResult = await wablasService.sendMessage(
          targetPhone,
          'Halo, ini adalah pesan uji coba dari integrasi Odoo Wablas Ansania.'
        );
        logger.info('Message send result:', msgResult);
      }
    } catch (err) {
      logger.error('Failed to send to WhatsApp:', err.response?.data || err.message);
      if (err.response?.data?.message?.includes('not authorized') || err.response?.data?.message?.includes('secret key')) {
        logger.warn('\n⚠️ CATATAN KEAMANAN WABLAS:');
        logger.warn('Server Wablas meminta Secret Key atau Whitelist IP.');
        logger.warn('Silakan cek dashboard Wablas > Device Setting:');
        logger.warn('1. Masukkan IP server Anda ke Whitelist IP, ATAU');
        logger.warn('2. Klik "Show here" pada Secret Key lalu masukkan nilainya ke WABLAS_SECRET_KEY di file .env');
      }
    }
  } else {
    logger.info('\n💡 Tip: Untuk menguji coba kirim pesan/PDF ke nomor WA asli, jalankan:');
    logger.info('node scripts/testWablas.js 0812xxxxxxxx');
  }

  logger.info('\n=======================================================');
}

main().catch(err => {
  logger.error('Unexpected error in test script:', err);
});
