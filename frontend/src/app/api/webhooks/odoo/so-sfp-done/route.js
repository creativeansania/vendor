import { NextResponse, after } from 'next/server';
import { verifyOdooWebhook } from '@/lib/webhookAuth';
import { acquireDistributedWebhookLock } from '@/lib/services/wip/distributedWebhookLock';
import { handleVendorSfpDone } from '@/lib/services/soSfpService';

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
      payload.picking_id ||
      searchParams.get('_id') ||
      searchParams.get('id') ||
      searchParams.get('picking_id');

    const pickingId = Number(rawId);
    if (!pickingId || isNaN(pickingId)) {
      return NextResponse.json(
        { success: false, message: 'Picking ID is required (e.g. { "_id": 123 })' },
        { status: 400 }
      );
    }

    // 0ms fast-filter when Odoo includes picking name in webhook payload
    const rawName = String(payload.name || '').trim().toUpperCase();
    if (rawName && !rawName.includes('/SFP/')) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: `Skipped non-SFP transfer ${rawName} at webhook edge`
      });
    }

    const acquired = await acquireDistributedWebhookLock(`so_sfp_done:${pickingId}`, 15000);
    if (!acquired) {
      return NextResponse.json({
        success: true,
        deduplicated: true,
        message: `SFP #${pickingId} already queued within cooldown window`
      });
    }

    const isSync = Boolean(payload.sync || searchParams.get('sync'));
    if (isSync) {
      const result = await handleVendorSfpDone(pickingId);
      return NextResponse.json(result);
    }

    after(async () => {
      try {
        console.log(`[SO SFP Webhook] Processing Vendor/Pabrik SFP Done: #${pickingId}`);
        const res = await handleVendorSfpDone(pickingId);
        console.log(`[SO SFP Webhook] Finished SFP #${pickingId}:`, JSON.stringify(res));
      } catch (err) {
        console.error(`[SO SFP Webhook] Error processing SFP #${pickingId}:`, err.message);
      }
    });

    return NextResponse.json({
      success: true,
      message: `SO SFP Done sync enqueued for Picking #${pickingId}`
    });
  } catch (err) {
    console.error('[SO SFP Webhook] Handler error:', err.message);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
