import { NextResponse } from 'next/server';
import { adminOdooClient } from '@/lib/odoo/odooClient';
import { config } from '@/lib/config';
import { authenticateRequest } from '@/lib/auth';
import { verifyReportToken } from '@/lib/webhookAuth';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const recordId = Number(String(id).replace(/\.pdf$/i, ''));
    const { searchParams } = new URL(req.url);
    const reportType = searchParams.get('report') || config.odoo.invoiceReport;
    const sig = searchParams.get('sig') || searchParams.get('token') || '';

    if (!recordId || isNaN(recordId)) {
      return new NextResponse('Invalid invoice ID', { status: 400 });
    }

    // Require either a valid HMAC report signature (?sig=...) or an authenticated internal admin JWT
    const hasValidSignature = verifyReportToken(recordId, sig);
    if (!hasValidSignature) {
      const auth = await authenticateRequest(req);
      if (auth.error || !auth.user || !['master_admin', 'admin'].includes(auth.user.role)) {
        return new NextResponse('Unauthorized access to invoice document', { status: 401 });
      }
    }

    const { buffer, filename } = await adminOdooClient.downloadDocumentPdf('account.move', recordId, reportType);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, max-age=3600'
      }
    });
  } catch (err) {
    console.error('[Report Controller] Error streaming invoice PDF:', err.message);
    return new NextResponse(`Failed to generate PDF: ${err.message}`, { status: 500 });
  }
}
