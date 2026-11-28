import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  const envText = fs.readFileSync(envPath, 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}

const DRY_RUN = process.argv.includes('--dry-run');

const { adminOdooClient } = await import('../src/lib/odoo/odooClient.js');
const { listBuyerDashboards, saveBuyerSnapshot } = await import(
  '../src/lib/services/buyerDashboard/buyerDashboardRepo.js'
);
const { syncBuyerSnapshotFromOdoo } = await import(
  '../src/lib/services/buyerDashboard/buyerWipSyncService.js'
);

console.log(`=== External SO stock.move.sale_line_id Audit & Repair (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}) ===`);

// 1. Fetch all confirmed External SOs with pickings
const sos = await adminOdooClient.executeKw(
  'sale.order',
  'search_read',
  [[
    ['state', '=', 'sale'],
    ['x_studio_jenis_so', '=', 'Eksternal'],
    ['picking_ids', '!=', false]
  ]],
  {
    fields: ['id', 'name', 'partner_id', 'picking_ids', 'order_line'],
    order: 'id desc',
    limit: 2000
  }
);
console.log(`Loaded ${sos.length} External SOs with pickings.`);

const soById = new Map(sos.map((s) => [s.id, s]));
const soIdByPickingId = new Map();
const allPickingIds = [];
const allOrderLineIds = [];

for (const s of sos) {
  for (const pid of s.picking_ids || []) {
    if (!soIdByPickingId.has(pid)) {
      soIdByPickingId.set(pid, s.id);
      allPickingIds.push(pid);
    }
  }
  for (const lid of s.order_line || []) {
    allOrderLineIds.push(lid);
  }
}

// 2. Batch-read all SO lines
const soLineById = new Map();
const soLinesBySoId = new Map();
for (let i = 0; i < allOrderLineIds.length; i += 500) {
  const chunk = allOrderLineIds.slice(i, i + 500);
  const rows = await adminOdooClient.executeKw('sale.order.line', 'read', [chunk], {
    fields: ['id', 'order_id', 'product_id', 'product_uom_qty', 'qty_delivered', 'display_type']
  });
  for (const l of rows || []) {
    soLineById.set(l.id, l);
    const sid = l.order_id?.[0];
    if (!sid || l.display_type || !l.product_id) continue;
    if (!soLinesBySoId.has(sid)) soLinesBySoId.set(sid, []);
    soLinesBySoId.get(sid).push(l);
  }
}

// 3. Batch-read all non-cancelled moves on those pickings
const allMoves = [];
for (let i = 0; i < allPickingIds.length; i += 250) {
  const chunk = allPickingIds.slice(i, i + 250);
  const rows = await adminOdooClient.executeKw(
    'stock.move',
    'search_read',
    [[
      ['picking_id', 'in', chunk],
      ['state', '!=', 'cancel']
    ]],
    {
      fields: ['id', 'picking_id', 'picking_type_id', 'product_id', 'product_uom_qty', 'quantity', 'state', 'sale_line_id'],
      limit: 5000
    }
  );
  allMoves.push(...(rows || []));
}
console.log(`Scanned ${allMoves.length} non-cancelled stock.moves across ${allPickingIds.length} pickings.`);

// 4. Identify mismatched moves cleanly with strict uniqueness guard
const repairsByTargetLine = new Map(); // targetLineId -> [moveId...]
const affectedSoIds = new Set();
const affectedPartnerIds = new Set();
const repairDetailsBySo = new Map();
const skippedAmbiguous = [];
const skippedNotOnSo = [];

for (const m of allMoves) {
  const pickId = m.picking_id?.[0];
  const soId = soIdByPickingId.get(pickId);
  if (!soId || !m.product_id) continue;

  const currentSlId = m.sale_line_id?.[0] || null;
  if (!currentSlId) continue; // Only fix linked SO moves whose sale_line_id points to the wrong product

  const currentSl = soLineById.get(currentSlId);
  const moveProdId = m.product_id[0];

  // Already pointing to a valid SO line with matching product on this SO -> healthy
  if (currentSl && currentSl.order_id?.[0] === soId && currentSl.product_id?.[0] === moveProdId) {
    continue;
  }

  // Mismatch detected! Find exact matching line(s) on this SO
  const lines = soLinesBySoId.get(soId) || [];
  const candidates = lines.filter((l) => l.product_id?.[0] === moveProdId);
  const so = soById.get(soId);

  if (candidates.length === 0) {
    skippedNotOnSo.push({
      so: so?.name,
      picking: m.picking_id?.[1],
      move_id: m.id,
      prod: m.product_id?.[1],
      state: m.state
    });
    continue;
  }
  if (candidates.length > 1) {
    skippedAmbiguous.push({
      so: so?.name,
      picking: m.picking_id?.[1],
      move_id: m.id,
      prod: m.product_id?.[1],
      candidate_line_ids: candidates.map((c) => c.id),
      state: m.state
    });
    continue;
  }

  const targetLine = candidates[0];
  if (!repairsByTargetLine.has(targetLine.id)) repairsByTargetLine.set(targetLine.id, []);
  repairsByTargetLine.get(targetLine.id).push(m.id);

  affectedSoIds.add(soId);
  if (so?.partner_id?.[0]) affectedPartnerIds.add(so.partner_id[0]);

  if (!repairDetailsBySo.has(so.name)) {
    repairDetailsBySo.set(so.name, {
      so_id: soId,
      partner: so.partner_id?.[1],
      moves: 0,
      done_out_moves: 0,
      pickings: new Set(),
      target_line_ids: new Set()
    });
  }
  const d = repairDetailsBySo.get(so.name);
  d.moves++;
  if (m.state === 'done' && m.picking_type_id?.[0] === 2) d.done_out_moves++;
  d.pickings.add(m.picking_id?.[1]);
  d.target_line_ids.add(targetLine.id);
}

const totalMovesToRepair = Array.from(repairsByTargetLine.values()).reduce((a, b) => a + b.length, 0);
console.log(`\nFound ${totalMovesToRepair} unambiguous mismatched moves across ${affectedSoIds.size} External SOs.`);
console.log(`Skipped (ambiguous duplicate product on SO): ${skippedAmbiguous.length}`);
console.log(`Skipped (product not found on SO lines): ${skippedNotOnSo.length}`);

for (const [soName, info] of repairDetailsBySo.entries()) {
  console.log(
    `  - ${soName} (${info.partner}): ${info.moves} moves (${info.done_out_moves} done OUT) across ${info.pickings.size} pickings`
  );
}

if (skippedAmbiguous.length > 0) {
  console.log('\nAmbiguous moves skipped (manual review):', skippedAmbiguous.slice(0, 10));
}

if (DRY_RUN || totalMovesToRepair === 0) {
  console.log(DRY_RUN ? '\nDry-run complete — no writes performed.' : '\nNo repairs needed.');
  process.exit(0);
}

// 5. Apply repairs cleanly in batches by targetLineId
console.log('\nApplying sale_line_id fixes in Odoo...');
let repairedMovesCount = 0;
const repairedLineIds = Array.from(repairsByTargetLine.keys());

for (const [targetSlId, moveIds] of repairsByTargetLine.entries()) {
  for (let i = 0; i < moveIds.length; i += 100) {
    const chunk = moveIds.slice(i, i + 100);
    await adminOdooClient.executeKw('stock.move', 'write', [chunk, { sale_line_id: targetSlId }]);
    repairedMovesCount += chunk.length;
  }
}
console.log(`Successfully updated ${repairedMovesCount} stock.moves across ${repairedLineIds.length} SO lines.`);

// 6. Verify recomputed qty_delivered on all repaired SO lines
const afterLines = [];
for (let i = 0; i < repairedLineIds.length; i += 400) {
  const rows = await adminOdooClient.executeKw('sale.order.line', 'read', [repairedLineIds.slice(i, i + 400)], {
    fields: ['id', 'order_id', 'product_id', 'product_uom_qty', 'qty_delivered']
  });
  afterLines.push(...(rows || []));
}

let totalDeliveredDelta = 0;
let linesWithDelta = 0;
const deltaBySo = new Map();

for (const after of afterLines) {
  const before = soLineById.get(after.id);
  const delta = Math.round(((after.qty_delivered || 0) - (before?.qty_delivered || 0)) * 100) / 100;
  if (delta !== 0) {
    linesWithDelta++;
    totalDeliveredDelta += delta;
    const soName = after.order_id?.[1] || `SO#${after.order_id?.[0]}`;
    deltaBySo.set(soName, (deltaBySo.get(soName) || 0) + delta);
  }
}

console.log('\n=== VERIFIED qty_delivered RECOVERY ===');
console.log(`Lines whose qty_delivered changed: ${linesWithDelta} / ${afterLines.length}`);
console.log(`Total newly recorded Delivered pcs: +${Math.round(totalDeliveredDelta * 100) / 100} pcs`);
for (const [soName, delta] of deltaBySo.entries()) {
  console.log(`  - ${soName}: ${delta >= 0 ? '+' : ''}${Math.round(delta * 100) / 100} pcs`);
}

// 7. Refresh Supabase buyer dashboard snapshots for every affected buyer!
const dashboards = await listBuyerDashboards();
const affectedDashboards = dashboards.filter((d) =>
  (d.odoo_partner_ids || []).some((pid) => affectedPartnerIds.has(pid))
);

console.log(`\nRefreshing ${affectedDashboards.length} affected buyer dashboard snapshot(s) in Supabase...`);
for (const d of affectedDashboards) {
  const snap = await syncBuyerSnapshotFromOdoo(d);
  await saveBuyerSnapshot(d.token, snap);
  console.log(
    `  Refreshed ${d.buyer_name} -> Delivered total: ${snap.summary.total_qty_delivered} pcs, % Finish: ${snap.summary.pct_finish}%`
  );
}

console.log('\nALL DONE!');
