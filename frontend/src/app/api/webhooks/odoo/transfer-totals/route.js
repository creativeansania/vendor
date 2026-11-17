import { NextResponse, after } from 'next/server';
import { adminOdooClient } from '@/lib/odoo/odooClient';
import { verifyOdooWebhook } from '@/lib/webhookAuth';
import { acquireDistributedWebhookLock } from '@/lib/services/wip/distributedWebhookLock';
import {
  resolvePickingIdsFromWebhookPayload,
  syncTransferTotals
} from '@/lib/services/transfer/transferTotalsService';

export const maxDuration = 60;

const LOCK_TTL_MS = 3000;

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
    const pickingIds = await resolvePickingIdsFromWebhookPayload(adminOdooClient, payload, searchParams);

    if (pickingIds.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Picking ID (or stock.move picking_id) is required' },
        { status: 400 }
      );
    }

    const sourceModel = String(payload._model || payload.model || 'stock.picking').trim();
    const stateTag = String(payload.state || 'any').trim();

    const lockResults = await Promise.all(
      pickingIds.map(async (id) => ({
        id,
        acquired: await acquireDistributedWebhookLock(
          `transfer_totals:${id}:${sourceModel}:${stateTag}`,
          LOCK_TTL_MS
        )
      }))
    );

    const pendingIds = lockResults.filter((r) => r.acquired).map((r) => r.id);
    if (pendingIds.length === 0) {
      return NextResponse.json({
        success: true,
        deduplicated: true,
        skippedIds: pickingIds
      });
    }

    const isSync = Boolean(payload.sync || searchParams.get('sync'));
    if (isSync) {
      const result = await syncTransferTotals(pendingIds);
      return NextResponse.json(result);
    }

    after(async () => {
      try {
        await syncTransferTotals(pendingIds);
      } catch (err) {
        console.error(`[Transfer Totals Webhook] Error syncing totals for [${pendingIds.join(', ')}]:`, err.message);
      }
    });

    return NextResponse.json({
      success: true,
      message: `Transfer totals sync enqueued for [${pendingIds.join(', ')}]`
    });
  } catch (err) {
    console.error('[Transfer Totals Webhook] Handler error:', err.message);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
