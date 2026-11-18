import { adminOdooClient } from '../src/lib/odoo/odooClient.js';
import {
  TARGET_SFP_PICKING_DOMAIN,
  recalculateSoSfpQuantities
} from '../src/lib/services/soSfpService.js';

const NO_TRACK_CTX = { tracking_disable: true, no_automation: true, mail_auto_delete: true };
const PAGE_SIZE = 2000;

async function fetchAllPaginated(model, domain, fields) {
  const all = [];
  let lastId = 0;
  while (true) {
    const batch = await adminOdooClient._callObject(model, 'search_read', [
      [['id', '>', lastId], ...domain],
      fields,
      0,
      PAGE_SIZE,
      'id asc'
    ]);
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    lastId = batch[batch.length - 1].id;
    if (batch.length < PAGE_SIZE) break;
  }
  return all;
}

async function runFullBulkBackfill() {
  console.log('1/4 Fetching all Done Vendor & Pabrik SFPs...');
  const sfps = await fetchAllPaginated(
    'stock.picking',
    [
      ...TARGET_SFP_PICKING_DOMAIN,
      '|',
      ['x_studio_sales_order', '!=', false],
      ['sale_id', '!=', false]
    ],
    ['id', 'x_studio_sales_order', 'sale_id']
  );

  const soByPickingId = new Map();
  const soIdSet = new Set();
  for (const p of sfps) {
    const soId = (Array.isArray(p.x_studio_sales_order) && p.x_studio_sales_order[0]) ||
      (Array.isArray(p.sale_id) && p.sale_id[0]) ||
      null;
    if (soId) {
      soByPickingId.set(p.id, soId);
      soIdSet.add(soId);
    }
  }
  console.log(`Found ${sfps.length} Done Vendor/Pabrik SFPs across ${soIdSet.size} unique Sales Order(s).`);

  console.log('2/4 Fetching all Done stock moves for Vendor & Pabrik SFPs...');
  const sfpIds = sfps.map((p) => p.id);
  const moves = [];
  for (let i = 0; i < sfpIds.length; i += 500) {
    const chunk = sfpIds.slice(i, i + 500);
    const batchMoves = await fetchAllPaginated(
      'stock.move',
      [
        ['picking_id', 'in', chunk],
        ['state', '=', 'done']
      ],
      ['id', 'picking_id', 'product_id', 'quantity', 'product_uom_qty']
    );
    moves.push(...batchMoves);
  }

  const qtyBySoAndProduct = new Map();
  for (const mv of moves) {
    const pickId = Array.isArray(mv.picking_id) ? mv.picking_id[0] : null;
    const prodId = Array.isArray(mv.product_id) ? mv.product_id[0] : null;
    const soId = pickId ? soByPickingId.get(pickId) : null;
    if (!soId || !prodId) continue;

    const moveQty = Number(mv.quantity ?? mv.product_uom_qty ?? 0) || 0;
    if (moveQty <= 0) continue;

    if (!qtyBySoAndProduct.has(soId)) qtyBySoAndProduct.set(soId, new Map());
    const prodMap = qtyBySoAndProduct.get(soId);
    prodMap.set(prodId, (prodMap.get(prodId) || 0) + moveQty);
  }
  console.log(`Aggregated ${moves.length} Done moves across ${qtyBySoAndProduct.size} Sales Order(s).`);

  console.log('3/4 Fetching Sales Order lines...');
  const soIds = Array.from(soIdSet);
  const allSoLines = [];
  for (let i = 0; i < soIds.length; i += 200) {
    const chunk = soIds.slice(i, i + 200);
    const lines = await fetchAllPaginated(
      'sale.order.line',
      [
        ['order_id', 'in', chunk],
        ['display_type', '=', false],
        ['is_downpayment', '=', false],
        ['product_id', '!=', false]
      ],
      ['id', 'order_id', 'product_id', 'product_uom_qty', 'x_studio_qty_sfp_done']
    );
    allSoLines.push(...lines);
  }
  console.log(`Fetched ${allSoLines.length} eligible Sales Order lines.`);

  // Group SO lines by (soId -> prodId -> lines[])
  const linesBySoAndProd = new Map();
  for (const line of allSoLines) {
    const soId = Array.isArray(line.order_id) ? line.order_id[0] : null;
    const prodId = Array.isArray(line.product_id) ? line.product_id[0] : null;
    if (!soId || !prodId) continue;
    if (!linesBySoAndProd.has(soId)) linesBySoAndProd.set(soId, new Map());
    const prodLines = linesBySoAndProd.get(soId);
    if (!prodLines.has(prodId)) prodLines.set(prodId, []);
    prodLines.get(prodId).push(line);
  }

  const updates = [];
  const updatedSoSet = new Set();
  for (const [soId, prodLines] of linesBySoAndProd.entries()) {
    const prodTotals = qtyBySoAndProduct.get(soId) || new Map();
    for (const [prodId, groupLines] of prodLines.entries()) {
      let remaining = prodTotals.get(prodId) || 0;
      for (let i = 0; i < groupLines.length; i++) {
        const line = groupLines[i];
        const isLast = i === groupLines.length - 1;
        const ordered = Number(line.product_uom_qty || 0);
        const assigned = isLast ? remaining : Math.min(remaining, Math.max(ordered, 0));
        remaining = Math.max(0, remaining - assigned);

        const currentVal = Number(line.x_studio_qty_sfp_done || 0);
        if (Math.abs(currentVal - assigned) > 1e-6) {
          updates.push({ id: line.id, qty: assigned });
          updatedSoSet.add(soId);
        }
      }
    }
  }

  console.log(`4/4 Writing ${updates.length} line update(s) across ${updatedSoSet.size} Sales Order(s)...`);

  // Group line IDs that share the exact same target qty so we can batch-write cleanly
  const idsByQty = new Map();
  for (const u of updates) {
    if (!idsByQty.has(u.qty)) idsByQty.set(u.qty, []);
    idsByQty.get(u.qty).push(u.id);
  }

  const tasks = [];
  for (const [qty, ids] of idsByQty.entries()) {
    for (let i = 0; i < ids.length; i += 100) {
      tasks.push({ ids: ids.slice(i, i + 100), qty });
    }
  }

  let doneCount = 0;
  const CONCURRENCY = 4;
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const slice = tasks.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map((t) =>
        adminOdooClient._callObject(
          'sale.order.line',
          'write',
          [t.ids, { x_studio_qty_sfp_done: t.qty }],
          { context: NO_TRACK_CTX }
        )
      )
    );
    doneCount += slice.reduce((s, t) => s + t.ids.length, 0);
    if (doneCount % 500 === 0 || i + CONCURRENCY >= tasks.length) {
      console.log(`Progress: ${doneCount} / ${updates.length} lines written...`);
    }
  }

  console.log(`Done! Updated ${updates.length} line(s) across ${updatedSoSet.size} Sales Order(s).`);
}

async function main() {
  await adminOdooClient.authenticate();

  const args = process.argv.slice(2);
  const targetSoArg = args.find((a) => a.startsWith('--so='));
  const targetSoIds = targetSoArg
    ? targetSoArg.replace('--so=', '').split(',').map((s) => Number(s.trim())).filter(Boolean)
    : [];

  if (targetSoIds.length === 0) {
    await runFullBulkBackfill();
    return;
  }

  console.log(`Backfilling Qty SFP (x_studio_qty_sfp_done) for ${targetSoIds.length} Sales Order(s)...`);
  let updatedSos = 0;
  let updatedLines = 0;
  for (const soId of targetSoIds) {
    const res = await recalculateSoSfpQuantities(adminOdooClient, soId);
    if (res.updatedLineCount > 0) {
      updatedSos++;
      updatedLines += res.updatedLineCount;
    }
  }
  console.log(`Done! Updated ${updatedLines} line(s) across ${updatedSos} Sales Order(s).`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
