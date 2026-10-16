import { NextResponse } from 'next/server';
import { adminOdooClient } from '@/lib/odoo/odooClient';
import { config } from '@/lib/config';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const recordId = Number(String(id).replace(/\.pdf$/i, ''));
    const { searchParams } = new URL(req.url);
    const reportType = searchParams.get('report') || config.odoo.invoiceReport;

    if (!recordId || isNaN(recordId)) {
      return new NextResponse('Invalid invoice ID', { status: 400 });
    }

    const { buffer, filename } = await adminOdooClient.downloadDocumentPdf('account.move', recordId, reportType);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400'
      }
    });
  } catch (err) {
    console.error('[Report Controller] Error streaming invoice PDF:', err.message);
    return new NextResponse(`Failed to generate PDF: ${err.message}`, { status: 500 });
  }
}
