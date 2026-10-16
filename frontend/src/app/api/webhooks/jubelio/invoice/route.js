import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { jubelioService } from '@/lib/services/jubelioService';
import { verifyJubelioSignature } from '@/lib/jubelioSignature';

export const maxDuration = 60;

export async function POST(req) {
  try {
    const rawBody = await req.text();
    
    // Verify signature
    if (!verifyJubelioSignature(req, rawBody)) {
      return NextResponse.json({
        success: false,
        message: 'Unauthorized: Invalid webhook signature'
      }, { status: 401 });
    }

    let body = {};
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({
        success: false,
        message: 'Invalid JSON payload'
      }, { status: 400 });
    }

    console.log('[Jubelio Webhook] Received invoice event', {
      invoiceNo: body?.invoice_no || body?.invoice_id || body?.data?.invoice_no
    });

    // Send 200 OK fast-ack to prevent Jubelio timeout
    // Process asynchronously in after() to keep Vercel serverless context alive
    after(async () => {
      try {
        await jubelioService.processInvoiceAsync(body);
      } catch (err) {
        console.error('[Jubelio Webhook] Async error:', err.message);
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Webhook received. Processing Sales Order in background.'
    });
  } catch (error) {
    console.error('[Jubelio Webhook] Handler error:', error.message);
    return NextResponse.json({
      success: false,
      message: error.message
    }, { status: 500 });
  }
}
