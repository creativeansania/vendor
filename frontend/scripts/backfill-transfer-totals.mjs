import { adminOdooClient } from '../src/lib/odoo/odooClient.js';
import { computePickingTotalsFromMoves } from '../src/lib/services/transfer/transferTotalsService.js';

const IMPORT_CTX = {
  tracking_disable: true,
  no_automation: true,
  mail_auto_delete: true,
  lang: 'en_US'
};

const PICKING_PAGE_SIZE = 2000;
const MOVE_READ_CHUNK = 5000;

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function parseArgs(argv) {
  let pickingIds = null;
  let activeOnly = false;
  let dryRun = false;
  let recentDays = null;
  let batchSize = 50;
  let delayMs = 200;

  for (const arg of argv) {
    if (arg.startsWith('--picking=')) {
      pickingIds = arg
        .slice('--picking='.length)
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => !isNaN(n) && n > 0);
    } else if (arg === '--active-only') {
      activeOnly = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--recent-days=')) {
      const n = Number(arg.slice('--recent-days='.length));
      if (!isNaN(n) && n > 0) recentDays = n;
    } else if (arg.startsWith('--batch-size=')) {
      const n = Number(arg.slice('--batch-size='.length));
      if (!isNaN(n) && n >= 1) batchSize = Math.min(n, 1000);
    } else if (arg.startsWith('--delay=')) {
      const n = Number(arg.slice('--delay='.length));
      if (!isNaN(n) && n >= 0) delayMs = n;
    }
  }

  return { pickingIds, activeOnly, dryRun, recentDays, batchSize, delayMs };
}

function buildDomain({ pickingIds, activeOnly, recentDays }) {
  if (pickingIds && pickingIds.length > 0) {
    return [['id', 'in', pickingIds]];
  }

  const domain = [];
  if (recentDays) {
    const cutoff = new Date(Date.now() - recentDays * 86400 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');
    domain.push(['create_date', '>=', cutoff]);
  }
  if (activeOnly) {
    domain.push(
      '|',
      ['state', 'not in', ['done', 'cancel']],
      '&',
      ['state', '=', 'done'],
      ['is_locked', '=', false]
    );
  }
  return domain;
}

async function fetchMovesById(moveIds) {
  const movesByPicking = new Map();
  for (let i = 0; i < moveIds.length; i += MOVE_READ_CHUNK) {
    const chunk = moveIds.slice(i, i + MOVE_READ_CHUNK);
    const moves = await adminOdooClient._callObject('stock.move', 'read', [
      chunk,
      ['id', 'picking_id', 'product_uom_qty', 'quantity']
    ]);
    for (const mv of moves || []) {
      const pid = Array.isArray(mv.picking_id) ? mv.picking_id[0] : mv.picking_id;
      if (!pid) continue;
      if (!movesByPicking.has(pid)) movesByPicking.set(pid, []);
      movesByPicking.get(pid).push(mv);
    }
  }
  return movesByPicking;
}

async function fallbackWriteChunk(chunk) {
  let written = 0;
  for (const item of chunk) {
    await adminOdooClient._callObject(
      'stock.picking',
      'write',
      [
        [item.id],
        {
          x_studio_total_demand: item.totalDemand,
          x_studio_total_quantity: item.totalQuantity
        }
      ],
      { context: IMPORT_CTX }
    );
    written++;
  }
  return written;
}

async function flushChunkViaLoad(chunk) {
  const rows = chunk.map((u) => [
    String(u.id),
    String(u.totalDemand),
    String(u.totalQuantity)
  ]);

  let res;
  try {
    res = await adminOdooClient._callObject(
      'stock.picking',
      'load',
      [
        ['.id', 'x_studio_total_demand', 'x_studio_total_quantity'],
        rows
      ],
      { context: IMPORT_CTX }
    );
  } catch (err) {
    if (chunk.length > 10) {
      const mid = Math.ceil(chunk.length / 2);
      console.warn(`Batch load (${chunk.length}) failed (${err.message}); splitting into ${mid} + ${chunk.length - mid}...`);
      const left = await flushChunkViaLoad(chunk.slice(0, mid));
      const right = await flushChunkViaLoad(chunk.slice(mid));
      return left + right;
    }
    console.warn(`Batch load (${chunk.length}) failed (${err.message}); falling back to individual writes...`);
    return fallbackWriteChunk(chunk);
  }

  const errorMsgs = (res?.messages || []).filter((m) => m?.type === 'error');
  if (Array.isArray(res?.ids) && res.ids.length === chunk.length && errorMsgs.length === 0) {
    return chunk.length;
  }

  console.warn(`Batch load warning (${JSON.stringify(res?.messages || [])}); falling back to individual writes for ${chunk.length} pickings...`);
  return fallbackWriteChunk(chunk);
}

async function main() {
  const { pickingIds, activeOnly, dryRun, recentDays, batchSize, delayMs } = parseArgs(process.argv.slice(2));
  const baseDomain = buildDomain({ pickingIds, activeOnly, recentDays });

  const modeParts = [];
  if (pickingIds) modeParts.push(`picking=[${pickingIds.join(',')}]`);
  else if (activeOnly) modeParts.push('active-only');
  else modeParts.push('full');
  if (recentDays) modeParts.push(`last-${recentDays}d`);
  if (dryRun) modeParts.push('DRY RUN');

  console.log(`=== BACKFILL TRANSFER TOTALS (${modeParts.join(', ')}) ===`);
  await adminOdooClient.authenticate();

  const totalCount = await adminOdooClient._callObject('stock.picking', 'search_count', [baseDomain]);
  console.log(`Matching stock.picking records: ${totalCount}`);
  if (totalCount === 0) return;

  const startedAt = Date.now();
  let lastId = 0;
  let scanned = 0;
  let pendingUpdates = 0;
  let written = 0;
  let loadCalls = 0;
  let pendingBuffer = [];

  async function drainBuffer(forceAll = false) {
    while (pendingBuffer.length >= batchSize || (forceAll && pendingBuffer.length > 0)) {
      const size = Math.min(batchSize, pendingBuffer.length);
      const chunk = pendingBuffer.splice(0, size);
      written += await flushChunkViaLoad(chunk);
      loadCalls++;
      const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`Write progress: ${written}/${pendingUpdates} updated (${loadCalls} load RPCs, scanned=${scanned}/${totalCount}, ${elapsedSec}s)`);
      if (pendingBuffer.length > 0 || !forceAll) {
        await sleep(delayMs);
      }
    }
  }

  while (true) {
    const pageDomain = lastId > 0 ? [...baseDomain, ['id', '<', lastId]] : baseDomain;
    const pickings = await adminOdooClient._callObject('stock.picking', 'search_read', [
      pageDomain
    ], {
      fields: ['id', 'name', 'state', 'move_ids', 'x_studio_total_demand', 'x_studio_total_quantity'],
      limit: PICKING_PAGE_SIZE,
      order: 'id desc'
    });

    if (!pickings || pickings.length === 0) break;
    lastId = pickings[pickings.length - 1].id;
    scanned += pickings.length;

    const allMoveIds = [...new Set(pickings.flatMap((p) => p.move_ids || []))];
    const movesByPicking = allMoveIds.length > 0 ? await fetchMovesById(allMoveIds) : new Map();

    for (const picking of pickings) {
      const moves = movesByPicking.get(picking.id) || [];
      const { totalDemand, totalQuantity } = computePickingTotalsFromMoves(moves);
      const curDemand = Number(picking.x_studio_total_demand || 0);
      const curQuantity = Number(picking.x_studio_total_quantity || 0);

      if (Math.abs(curDemand - totalDemand) > 1e-6 || Math.abs(curQuantity - totalQuantity) > 1e-6) {
        pendingUpdates++;
        if (pickingIds) {
          console.log(`  Target ${picking.name} (#${picking.id}): Demand=${totalDemand}, Quantity=${totalQuantity}`);
        }
        if (!dryRun) {
          pendingBuffer.push({
            id: picking.id,
            totalDemand,
            totalQuantity
          });
        }
      }
    }

    if (dryRun) {
      const scanSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`Scan progress: ${scanned}/${totalCount}, wouldUpdate=${pendingUpdates} (${scanSec}s)`);
    } else {
      await drainBuffer(false);
    }

    if (pickings.length < PICKING_PAGE_SIZE) break;
  }

  if (!dryRun) {
    await drainBuffer(true);
  }

  const totalSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n=== COMPLETE (${totalSec}s): scanned=${scanned}, ${dryRun ? 'wouldUpdate' : 'updated'}=${dryRun ? pendingUpdates : written}, loadCalls=${loadCalls} ===`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
