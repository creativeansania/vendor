import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { soBypassService } from '@/lib/services/soBypassService';
import { verifyOdooWebhook } from '@/lib/webhookAuth';

export const maxDuration = 60;

export async function POST(req) {
  try {
    const webhookAuth = await verifyOdooWebhook(req);
    if (!webhookAuth.authorized) return webhookAuth.response;

    let body = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const { searchParams } = new URL(req.url);

    const soIdentifier =
      body._id ||
      body.id ||
      body.order_id ||
      body.so_id ||
      body.sales_order_id ||
      body.name ||
      body.order_name ||
      searchParams.get('id') ||
      searchParams.get('order_id') ||
      searchParams.get('so_id') ||
      searchParams.get('name');

    console.log('[Odoo Webhook] Received SO confirmation event:', { soIdentifier });

    if (!soIdentifier) {
      return NextResponse.json({
        success: false,
        message: 'Sales Order ID or Name is required (e.g. { "id": 123 } or { "name": "SO001" })'
      }, { status: 400 });
    }

    const isSync = Boolean(body.sync || searchParams.get('sync'));

    if (isSync) {
      const result = await soBypassService.processSOBypass(soIdentifier);
      return NextResponse.json({
        success: !result.error,
        message: result.message || 'SO Bypass processed synchronously',
        data: result
      });
    }

    // Use Next.js after() to keep Vercel serverless context alive until background execution completes
    after(async () => {
      try {
        console.log(`[Odoo Webhook] Starting background bypass for SO: ${soIdentifier}`);
        const result = await soBypassService.processSOBypass(soIdentifier);
        if (result.skipped) {
          console.log(`[Odoo Webhook] ${result.reason || result.error}`);
        } else if (result.success) {
          const pickMsg = result.pickings && result.pickings.length > 0 ? ` | Delivery: ${result.pickings.join(', ')}` : '';
          const invMsg = result.invoices && result.invoices.length > 0 ? ` | Invoice: ${result.invoices.join(', ')}` : '';
          console.log(`[Odoo Webhook] Successfully processed bypass for ${result.soName} (ID: ${result.soId})${pickMsg}${invMsg}`);
        } else {
          console.error(`[Odoo Webhook] Bypass failed for "${soIdentifier}": ${result.message || result.error}`);
        }
      } catch (err) {
        console.error(`[Odoo Webhook] Unexpected error during bypass for "${soIdentifier}":`, err.message);
      }
    });

    return NextResponse.json({
      success: true,
      message: `Webhook received for Sales Order "${soIdentifier}". Processing delivery and invoice bypass in background.`
    });
  } catch (err) {
    console.error('[Odoo Webhook] Handler error:', err.message);
    return NextResponse.json({
      success: false,
      message: err.message
    }, { status: 500 });
  }
}
