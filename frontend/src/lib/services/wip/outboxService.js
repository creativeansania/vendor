import { after } from 'next/server';
import { supabaseServer } from '../../supabaseServer.js';
import { invalidateOrderCache } from './wipCache.js';

const MAX_OUTBOX_ATTEMPTS = 5;

/**
 * Insert a durable sync_outbox record before pushing to Odoo
 */
export async function enqueueOutboxTask({ wipOrderId, action, payload, createdBy }) {
  try {
    const { data } = await supabaseServer
      .from('sync_outbox')
      .insert({
        wip_order_id: wipOrderId,
        action,
        status: 'processing',
        attempts: 1,
        payload,
        created_by: createdBy || null
      })
      .select('id')
      .maybeSingle();
    return data?.id || null;
  } catch (err) {
    console.warn(`[OutboxService] Failed to enqueue ${action} for order #${wipOrderId}: ${err.message}`);
    return null;
  }
}

export async function markOutboxSynced(outboxId) {
  if (!outboxId) return;
  await supabaseServer
    .from('sync_outbox')
    .update({
      status: 'synced',
      synced_at: new Date().toISOString(),
      last_error: null
    })
    .eq('id', outboxId);
}

export async function markOutboxFailed(outboxId, errMsg, nextAttempts = undefined) {
  if (!outboxId) return;
  const patch = {
    status: 'failed',
    last_error: String(errMsg || 'Unknown error').slice(0, 500)
  };
  if (nextAttempts !== undefined) {
    patch.attempts = nextAttempts;
  }
  await supabaseServer.from('sync_outbox').update(patch).eq('id', outboxId);
}

/**
 * Schedule an Odoo push task in Next.js `after()` so the HTTP response returns immediately (~200ms),
 * and opportunistically retry up to 2 older failed outbox entries afterwards.
 */
export function scheduleOutboxExecution({ outboxId, order, taskFn }) {
  const runner = async () => {
    try {
      await taskFn();
      if (order) {
        invalidateOrderCache(order.odoo_mo_id, order.id);
      }
      await markOutboxSynced(outboxId);
    } catch (err) {
      console.warn(`[OutboxService] Background Odoo sync failed (outbox #${outboxId}): ${err.message}`);
      await markOutboxFailed(outboxId, err.message);
      return;
    }

    // Opportunistically drain up to 2 older failed/pending outbox jobs while Odoo connection is warm
    try {
      await processPendingOutbox(2, outboxId);
    } catch {}
  };

  try {
    after(runner);
  } catch {
    // Fallback when invoked outside a Next.js request scope (e.g. standalone CLI script)
    runner();
  }
}

/**
 * Replay a single failed/pending sync_outbox row against Odoo
 */
async function replayOutboxRow(row) {
  const { data: order } = await supabaseServer
    .from('wip_orders')
    .select('*')
    .eq('id', row.wip_order_id)
    .maybeSingle();

  if (!order) {
    await markOutboxSynced(row.id);
    return false;
  }

  const p = row.payload || {};

  if (row.action === 'cutting_rolls') {
    const { syncCuttingToOdoo } = await import('./wipCuttingService.js');
    await syncCuttingToOdoo(order, p.rollUpdates || [], p.actualCutting);
  } else if (row.action === 'grade_a') {
    const { syncGradeAToOdoo } = await import('./production/odooGradeSync.js');
    await syncGradeAToOdoo(order, Number(p.qtyGradeA || 0));
  } else if (row.action === 'grade_b') {
    const { syncGradeBToOdoo } = await import('./production/odooGradeSync.js');
    await syncGradeBToOdoo(order, Number(p.qtyGradeB || 0));
  } else if (row.action === 'bskl') {
    const { syncBsklToOdoo } = await import('./production/odooBsklSync.js');
    await syncBsklToOdoo(order, {
      pKg: Number(p.sisaPotongPanjang || 0),
      sKg: Number(p.sisaPotongSedang || 0),
      pdkKg: Number(p.sisaPotongPendek || 0),
      totalSisa: Number(p.sisaMakloonKg || 0),
      noSuratJalanBskl: p.noSuratJalanBskl || ''
    });
  } else if (row.action === 'production_result') {
    const { syncProductionToOdoo } = await import('./production/odooBsklSync.js');
    await syncProductionToOdoo(
      order,
      Number(p.qtyGradeA || 0),
      Number(p.qtyGradeB || 0),
      Number(p.sisaMakloonKg || 0),
      {
        sisaPanjang: Number(p.sisaPotongPanjang || 0),
        sisaSedang: Number(p.sisaPotongSedang || 0),
        sisaPendek: Number(p.sisaPotongPendek || 0),
        noSuratJalanBskl: p.noSuratJalan || ''
      }
    );
  } else {
    throw new Error(`Unsupported outbox action: ${row.action}`);
  }

  invalidateOrderCache(order.odoo_mo_id, order.id);
  return true;
}

/**
 * Drain pending / failed rows in sync_outbox (up to MAX_OUTBOX_ATTEMPTS)
 */
export async function processPendingOutbox(limit = 10, excludeId = null) {
  let query = supabaseServer
    .from('sync_outbox')
    .select('id, wip_order_id, action, payload, status, attempts')
    .in('status', ['pending', 'failed'])
    .lt('attempts', MAX_OUTBOX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (excludeId) {
    query = query.neq('id', excludeId);
  }

  const { data: rows, error } = await query;
  if (error || !rows || rows.length === 0) {
    return { processed: 0, synced: 0, failed: 0 };
  }

  let synced = 0;
  let failed = 0;

  for (const row of rows) {
    const nextAttempt = Number(row.attempts || 0) + 1;

    // Optimistic claim so parallel workers don't replay the same outbox row
    const { data: claimed } = await supabaseServer
      .from('sync_outbox')
      .update({ status: 'processing', attempts: nextAttempt })
      .eq('id', row.id)
      .in('status', ['pending', 'failed'])
      .select('id')
      .maybeSingle();

    if (!claimed) continue;

    try {
      await replayOutboxRow(row);
      await markOutboxSynced(row.id);
      synced++;
    } catch (err) {
      failed++;
      await markOutboxFailed(row.id, err.message, nextAttempt);
    }
  }

  return { processed: synced + failed, synced, failed };
}

