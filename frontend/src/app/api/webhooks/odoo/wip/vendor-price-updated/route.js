import { NextResponse, after } from 'next/server';
import { wipService } from '@/lib/services/wipService';
import { verifyOdooWebhook } from '@/lib/webhookAuth';
import { acquireDistributedWebhookLock } from '@/lib/services/wip/distributedWebhookLock';

export const maxDuration = 60;

export async function POST(req) {
  try {
    const webhookAuth = await verifyOdooWebhook(req);
    if (!webhookAuth.authorized) return webhookAuth.response;

    let payload = {};
    try {
      payload = await req.json();
    } catch {
      payload = {};
    }

    const { searchParams } = new URL(req.url);
    const rawId =
      payload._id ||
      payload.id ||
      payload.res_id ||
      payload.record_id ||
      searchParams.get('id') ||
      searchParams.get('_id');

    const priceId = Number(rawId);

    if (!priceId || isNaN(priceId)) {
      return NextResponse.json({ success: false, message: 'Vendor Price ID is required' }, { status: 400 });
    }

    const acquired = await acquireDistributedWebhookLock(`vendor_price:${priceId}`, 15000);
    if (!acquired) {
      return NextResponse.json({
        success: true,
        deduplicated: true,
        message: `Vendor Price #${priceId} already queued within cooldown window`
      });
    }

    console.log('[Vendor Price Webhook] Received event:', { priceId });

    after(async () => {
      try {
        await wipService.onVendorPriceUpdated(priceId);
      } catch (err) {
        console.error(`[Vendor Price Webhook] Error updating WIP pricing for Price #${priceId}:`, err.message);
      }
    });

    return NextResponse.json({
      success: true,
      message: `Vendor price sync enqueued for Price Record #${priceId}`
    });
  } catch (err) {
    console.error('[Vendor Price Webhook] Handler error:', err.message);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
