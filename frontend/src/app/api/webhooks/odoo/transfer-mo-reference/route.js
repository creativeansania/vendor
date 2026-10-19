import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { transferService } from '@/lib/services/transferService';

export const maxDuration = 60;

// In-memory debounce & lock cache to prevent concurrent race condition loops
const activeTransferLocks = new Map();
const LOCK_TTL_MS = 25000; // 25 seconds

export async function POST(req) {
  try {
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
      payload.picking_id ||
      payload.picking_ids ||
      payload.record_ids ||
      payload.records ||
      searchParams.get('_ids') ||
      searchParams.get('active_ids') ||
      searchParams.get('_id') ||
      searchParams.get('id') ||
      searchParams.get('ids');

    let ids = [];
    if (Array.isArray(rawIds)) {
      ids = rawIds.map(id => Number(id)).filter(id => !isNaN(id) && id > 0);
    } else if (typeof rawIds === 'string' && rawIds.includes(',')) {
      ids = rawIds.split(',').map(s => Number(s.trim())).filter(id => !isNaN(id) && id > 0);
    } else if (rawIds !== undefined && rawIds !== null && !isNaN(Number(rawIds))) {
      ids = [Number(rawIds)];
    }

    console.log('[Transfer Webhook] Received request:', { ids });

    if (ids.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'Stock Picking ID is required (e.g. { "_id": 123, "_model": "stock.picking" })'
      }, { status: 400 });
    }

    // Clean up expired locks
    const now = Date.now();
    for (const [lockId, lockTime] of activeTransferLocks.entries()) {
      if (now - lockTime > LOCK_TTL_MS) {
        activeTransferLocks.delete(lockId);
      }
    }

    // Filter out IDs that are currently locked / recently processed
    const pendingIds = ids.filter(id => {
      if (activeTransferLocks.has(id)) {
        console.log(`[Transfer Webhook] Picking #${id} is currently locked/debounced. Skipping to prevent loop.`);
        return false;
      }
      return true;
    });

    if (pendingIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All requested transfer IDs are already locked or in cooldown (feedback loop prevented).',
        skippedIds: ids
      });
    }

    // Acquire lock for pending IDs
    for (const id of pendingIds) {
      activeTransferLocks.set(id, now);
    }

    const isSync = Boolean(payload.sync || searchParams.get('sync'));

    if (isSync) {
      const result = await transferService.resolveTransferMoAndSo(pendingIds);
      return NextResponse.json({
        success: true,
        message: `Successfully resolved MO/SO for ${result.count} transfer(s)`,
        count: result.count,
        results: result.results
      });
    }

    // Use Next.js after() to keep Vercel serverless context alive
    after(async () => {
      try {
        console.log(`[Transfer Webhook] Processing transfers: [${pendingIds.join(', ')}]`);
        await transferService.resolveTransferMoAndSo(pendingIds);
        console.log(`[Transfer Webhook] Successfully processed transfers: [${pendingIds.join(', ')}]`);
      } catch (err) {
        console.error(`[Transfer Webhook] Error resolving MO/SO for IDs [${pendingIds.join(', ')}]:`, err.message);
      }
    });

    return NextResponse.json({
      success: true,
      message: `Webhook received for stock.picking (ID: [${pendingIds.join(', ')}]). Enqueued for background processing.`,
      targetIds: pendingIds
    });
  } catch (err) {
    console.error('[Transfer Webhook] Handler error:', err.message);
    return NextResponse.json({
      success: false,
      message: err.message
    }, { status: 500 });
  }
}
