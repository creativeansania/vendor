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
    const moId = payload._id || payload.id || payload.mo_id || searchParams.get('id') || searchParams.get('mo_id');

    if (!moId) {
      return NextResponse.json({ success: false, message: 'MO ID is required' }, { status: 400 });
    }

    // 0ms fast-filter when Odoo includes name/warehouse/picking_type in webhook payload
    const rawName = String(payload.name || payload.x_name || '').trim();
    const rawPt = Array.isArray(payload.picking_type_id) ? String(payload.picking_type_id[1] || '') : String(payload.picking_type_name || '');
    const rawWh = Array.isArray(payload.warehouse_id) ? String(payload.warehouse_id[1] || '') : String(payload.warehouse_name || '');
    if (rawName && !rawName.startsWith('VD') && rawPt && !rawPt.toUpperCase().includes('VENDOR') && (!rawWh || !rawWh.toUpperCase().includes('VENDOR'))) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: `Skipped non-vendor MO ${rawName} at webhook edge (0 Odoo RPC calls)`
      });
    }

    const acquired = await acquireDistributedWebhookLock(`mo_confirmed:${moId}`, 15000);
    if (!acquired) {
      return NextResponse.json({
        success: true,
        deduplicated: true,
        message: `MO #${moId} already queued within cooldown window`
      });
    }

    console.log('[WIP Webhook] Received MO Confirmed event:', { moId });

    after(async () => {
      try {
        await wipService.onMoConfirmed(moId);
      } catch (err) {
        console.error(`[WIP Webhook] Error creating WIP for MO #${moId}:`, err.message);
      }
    });

    return NextResponse.json({
      success: true,
      message: `WIP creation triggered for MO #${moId}`
    });
  } catch (err) {
    console.error('[WIP Webhook] Handler error:', err.message);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
