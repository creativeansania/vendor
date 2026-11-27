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
    const rawName = String(payload.name || payload.x_name || '').trim().toUpperCase();
    const rawPt = Array.isArray(payload.picking_type_id) ? String(payload.picking_type_id[1] || '') : String(payload.picking_type_name || '');
    const rawWh = Array.isArray(payload.warehouse_id) ? String(payload.warehouse_id[1] || '') : String(payload.warehouse_name || '');
    const isVendorOrPabrik =
      rawName.startsWith('VD') ||
      rawName.startsWith('PB') ||
      rawPt.toUpperCase().includes('VENDOR') ||
      rawPt.toUpperCase().includes('PABRIK') ||
      rawWh.toUpperCase().includes('VENDOR') ||
      rawWh.toUpperCase().includes('PABRIK');
    if (rawName && (rawPt || rawWh) && !isVendorOrPabrik) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: `Skipped non-vendor/pabrik MO ${rawName} at webhook edge (0 Odoo RPC calls)`
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
