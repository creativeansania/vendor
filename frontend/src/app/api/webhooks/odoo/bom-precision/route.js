import { NextResponse, after } from 'next/server';
import { adminOdooClient } from '@/lib/odoo/odooClient';
import { verifyOdooWebhook } from '@/lib/webhookAuth';
import { supabaseServer } from '@/lib/supabaseServer';
import { acquireDistributedWebhookLock } from '@/lib/services/wip/distributedWebhookLock';

export const maxDuration = 60;

const PRODUCT_UNIT_PRECISION_ID = 6;
const NO_TRACK_CTX = { tracking_disable: true, no_automation: true, mail_auto_delete: true };
const PRECISION_MUTEX_ACTION = 'precision_mutex';
const PRECISION_MUTEX_KEY = 'decimal_prec:6';
const PRECISION_MUTEX_STALE_MS = 25000;
const PRECISION_MUTEX_WAIT_MS = 20000;

let localPrecisionQueue = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serialize temporary updates to Odoo's global `decimal.precision` #6 across
 * concurrent requests (both in-process and across Vercel serverless instances)
 * using the existing `audit_logs` table (zero DB migration required).
 */
async function withProductUnitPrecisionLock(fn) {
  const previous = localPrecisionQueue;
  let releaseLocal;
  localPrecisionQueue = new Promise((resolve) => {
    releaseLocal = resolve;
  });

  await previous;

  let lockRowId = null;
  try {
    try {
      const { data: inserted } = await supabaseServer
        .from('audit_logs')
        .insert({
          user_id: 0,
          action: PRECISION_MUTEX_ACTION,
          reason: PRECISION_MUTEX_KEY
        })
        .select('id')
        .single();

      if (inserted?.id) {
        lockRowId = inserted.id;
        const deadline = Date.now() + PRECISION_MUTEX_WAIT_MS;

        while (Date.now() < deadline) {
          const cutoffIso = new Date(Date.now() - PRECISION_MUTEX_STALE_MS).toISOString();
          const { data: headRows, error: headErr } = await supabaseServer
            .from('audit_logs')
            .select('id')
            .eq('user_id', 0)
            .eq('action', PRECISION_MUTEX_ACTION)
            .eq('reason', PRECISION_MUTEX_KEY)
            .gte('created_at', cutoffIso)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .limit(1);

          if (headErr || !headRows || headRows.length === 0 || headRows[0].id === lockRowId) {
            break;
          }
          await sleep(250);
        }
      }
    } catch {
      // Fallback safely to in-process mutex if Supabase check fails
    }

    return await fn();
  } finally {
    if (lockRowId) {
      try {
        await supabaseServer.from('audit_logs').delete().eq('id', lockRowId);
      } catch {
        // Stale mutex rows expire after PRECISION_MUTEX_STALE_MS
      }
    }
    releaseLocal();
  }
}

async function syncBomLinesPrecision(lineIds) {
  if (!lineIds || lineIds.length === 0) return { updatedProductQty: 0, updatedPresisi: 0 };

  await adminOdooClient.authenticate();

  const lines = await adminOdooClient.executeKw('mrp.bom.line', 'read', [
    lineIds,
    ['id', 'product_qty', 'x_studio_qty_presisi']
  ]);

  const toUpdateProductQty = [];
  const toUpdatePresisi = [];

  for (const line of lines || []) {
    const presisi = Number(line.x_studio_qty_presisi || 0);
    const stdQty = Number(line.product_qty || 0);

    if (presisi > 0 && Math.abs(stdQty - presisi) > 1e-14) {
      toUpdateProductQty.push({ id: line.id, qty: presisi });
    } else if (presisi === 0 && stdQty > 0) {
      toUpdatePresisi.push({ id: line.id, qty: stdQty });
    }
  }

  for (const item of toUpdatePresisi) {
    await adminOdooClient.executeKw('mrp.bom.line', 'write', [
      [item.id],
      { x_studio_qty_presisi: item.qty }
    ], { context: NO_TRACK_CTX });
  }

  if (toUpdateProductQty.length > 0) {
    await withProductUnitPrecisionLock(async () => {
      const prec = await adminOdooClient.executeKw('decimal.precision', 'read', [
        [PRODUCT_UNIT_PRECISION_ID],
        ['digits']
      ]);
      const oldDigits = prec?.[0]?.digits ?? 2;
      const shouldRestore = oldDigits < 14;

      try {
        if (shouldRestore) {
          await adminOdooClient.executeKw('decimal.precision', 'write', [
            [PRODUCT_UNIT_PRECISION_ID],
            { digits: 14 }
          ], { context: NO_TRACK_CTX });
        }

        for (const item of toUpdateProductQty) {
          await adminOdooClient.executeKw('mrp.bom.line', 'write', [
            [item.id],
            { product_qty: item.qty }
          ], { context: NO_TRACK_CTX });
        }
      } finally {
        if (shouldRestore) {
          await adminOdooClient.executeKw('decimal.precision', 'write', [
            [PRODUCT_UNIT_PRECISION_ID],
            { digits: oldDigits }
          ], { context: NO_TRACK_CTX });
        }
      }
    });
  }

  return {
    updatedProductQty: toUpdateProductQty.length,
    updatedPresisi: toUpdatePresisi.length
  };
}

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
    const rawIds =
      payload._ids ||
      payload.active_ids ||
      payload._id ||
      payload.id ||
      payload.ids ||
      payload.res_id ||
      payload.res_ids ||
      searchParams.get('_ids') ||
      searchParams.get('_id') ||
      searchParams.get('id');

    let ids = [];
    if (Array.isArray(rawIds)) {
      ids = rawIds.map((id) => Number(id)).filter((id) => !isNaN(id) && id > 0);
    } else if (typeof rawIds === 'string' && rawIds.includes(',')) {
      ids = rawIds.split(',').map((s) => Number(s.trim())).filter((id) => !isNaN(id) && id > 0);
    } else if (rawIds !== undefined && rawIds !== null && !isNaN(Number(rawIds))) {
      ids = [Number(rawIds)];
    }

    if (ids.length === 0) {
      return NextResponse.json(
        { success: false, message: 'BoM Line ID is required' },
        { status: 400 }
      );
    }

    // 0ms fast-skip self-echo when Odoo sends both precision and standard qty already matching
    const hasPresisiField = Object.prototype.hasOwnProperty.call(payload, 'x_studio_qty_presisi');
    const hasStdField = Object.prototype.hasOwnProperty.call(payload, 'product_qty');
    let valueTag = 'any';

    if (hasPresisiField && hasStdField && ids.length === 1) {
      const pPresisi = Number(payload.x_studio_qty_presisi || 0);
      const pStd = Number(payload.product_qty || 0);
      if ((pPresisi > 0 && Math.abs(pStd - pPresisi) <= 1e-14) || (pPresisi === 0 && pStd === 0)) {
        return NextResponse.json({
          success: true,
          skipped: true,
          message: `Skipped already-synced BoM line #${ids[0]} at webhook edge`
        });
      }
      valueTag = `${pPresisi}:${pStd}`;
    }

    // Value-aware lock prevents rapid sequential edits (<5s) from being dropped while deduplicating identical echoes
    const lockResults = await Promise.all(
      ids.map(async (id) => ({
        id,
        acquired: await acquireDistributedWebhookLock(`bom_line_prec:${id}:${valueTag}`, 5000)
      }))
    );

    const pendingIds = lockResults.filter((r) => r.acquired).map((r) => r.id);
    if (pendingIds.length === 0) {
      return NextResponse.json({
        success: true,
        deduplicated: true,
        skippedIds: ids
      });
    }

    const isSync = Boolean(payload.sync || searchParams.get('sync'));
    if (isSync) {
      const result = await syncBomLinesPrecision(pendingIds);
      return NextResponse.json({ success: true, ...result });
    }

    after(async () => {
      try {
        await syncBomLinesPrecision(pendingIds);
      } catch (err) {
        console.error('[BoM Precision Webhook] Error syncing precision:', err.message);
      }
    });

    return NextResponse.json({
      success: true,
      message: `BoM line precision sync enqueued for [${pendingIds.join(', ')}]`
    });
  } catch (err) {
    console.error('[BoM Precision Webhook] Handler error:', err.message);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
