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
    const pickingId = payload._id || payload.id || payload.picking_id || searchParams.get('id') || searchParams.get('picking_id');

    if (!pickingId) {
      return NextResponse.json({ success: false, message: 'Picking ID is required' }, { status: 400 });
    }

    // 0ms fast-filter when Odoo includes picking `name` in webhook payload
    const rawName = String(payload.name || '').trim();
    if (rawName) {
      const isRelevantCode = ['/PC/', '/SPB/', '/SFP/'].some((code) => rawName.includes(code));
      if (!isRelevantCode) {
        return NextResponse.json({
          success: true,
          skipped: true,
          message: `Skipped non-WIP transfer ${rawName} at webhook edge (0 Odoo RPC calls)`
        });
      }
    }

    const acquired = await acquireDistributedWebhookLock(`transfer_done:${pickingId}`, 15000);
    if (!acquired) {
      return NextResponse.json({
        success: true,
        deduplicated: true,
        message: `Picking #${pickingId} already queued within cooldown window`
      });
    }

    console.log('[WIP Webhook] Received Transfer Done event:', { pickingId });

    after(async () => {
      try {
        await wipService.onTransferDone(pickingId);
      } catch (err) {
        console.error(`[WIP Webhook] Error syncing WIP for Picking #${pickingId}:`, err.message);
      }
    });

    return NextResponse.json({
      success: true,
      message: `WIP sync triggered for Picking #${pickingId}`
    });
  } catch (err) {
    console.error('[WIP Webhook] Handler error:', err.message);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
