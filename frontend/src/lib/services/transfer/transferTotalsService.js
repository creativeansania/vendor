import { adminOdooClient } from '../../odoo/odooClient.js';
import { isVendorSfpPicking, handleVendorSfpDone } from '../soSfpService.js';

const NO_TRACK_CTX = { tracking_disable: true, no_automation: true, mail_auto_delete: true };

function roundQty(val) {
  return Math.round((Number(val) || 0) * 1e6) / 1e6;
}

/**
 * Sum `product_uom_qty` (Demand) and `quantity` (Quantity) across all stock.move lines,
 * regardless of UoM differences.
 */
export function computePickingTotalsFromMoves(moves = []) {
  let totalDemand = 0;
  let totalQuantity = 0;

  for (const mv of moves || []) {
    totalDemand += Number(mv.product_uom_qty || 0);
    totalQuantity += Number(mv.quantity || 0);
  }

  return {
    totalDemand: roundQty(totalDemand),
    totalQuantity: roundQty(totalQuantity)
  };
}

function parseNumericId(raw) {
  if (Array.isArray(raw)) {
    const n = Number(raw[0]);
    return !isNaN(n) && n > 0 ? n : null;
  }
  const n = Number(raw);
  return !isNaN(n) && n > 0 ? n : null;
}

function parseIdList(raw) {
  if (Array.isArray(raw)) {
    return raw.map(parseNumericId).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.includes(',')) {
    return raw.split(',').map((s) => parseNumericId(s.trim())).filter(Boolean);
  }
  const single = parseNumericId(raw);
  return single ? [single] : [];
}

/**
 * Resolve unique `stock.picking` IDs from either a `stock.picking` or `stock.move` webhook payload.
 */
export async function resolvePickingIdsFromWebhookPayload(odoo = adminOdooClient, payload = {}, searchParams = null) {
  const model = String(payload._model || payload.model || '').trim();

  if (model === 'stock.move') {
    const directPickingIds = [
      ...parseIdList(payload.picking_id),
      ...parseIdList(payload.picking_ids)
    ];
    if (directPickingIds.length > 0) {
      return [...new Set(directPickingIds)];
    }

    const moveIds = [
      ...parseIdList(payload._ids),
      ...parseIdList(payload.active_ids),
      ...parseIdList(payload._id),
      ...parseIdList(payload.id),
      ...parseIdList(payload.ids)
    ];
    if (moveIds.length === 0) return [];

    await odoo.authenticate();
    const moves = await odoo._callObject('stock.move', 'read', [
      [...new Set(moveIds)],
      ['id', 'picking_id']
    ]);
    return [...new Set((moves || []).map((m) => parseNumericId(m.picking_id)).filter(Boolean))];
  }

  const rawPickingIds = [
    ...parseIdList(payload._ids),
    ...parseIdList(payload.active_ids),
    ...parseIdList(payload._id),
    ...parseIdList(payload.id),
    ...parseIdList(payload.ids),
    ...parseIdList(payload.res_id),
    ...parseIdList(payload.res_ids),
    ...parseIdList(payload.picking_id),
    ...parseIdList(payload.picking_ids)
  ];

  if (rawPickingIds.length === 0 && searchParams) {
    rawPickingIds.push(
      ...parseIdList(searchParams.get('_ids')),
      ...parseIdList(searchParams.get('_id')),
      ...parseIdList(searchParams.get('id')),
      ...parseIdList(searchParams.get('picking_id'))
    );
  }

  return [...new Set(rawPickingIds)];
}

/**
 * Recalculate `x_studio_total_demand` and `x_studio_total_quantity` on one or more `stock.picking` records.
 * Also recalculates SO `Qty SFP` (without creating duplicate Activity) when an unlocked Done Vendor SFP changes.
 */
export async function syncTransferTotals(pickingIds, {
  odoo = adminOdooClient,
  syncVendorSfpSo = true
} = {}) {
  const uniqueIds = [...new Set((Array.isArray(pickingIds) ? pickingIds : [pickingIds]).map(parseNumericId).filter(Boolean))];
  if (uniqueIds.length === 0) return { success: true, count: 0, updatedCount: 0, results: [] };

  await odoo.authenticate();

  const pickings = await odoo._callObject('stock.picking', 'read', [
    uniqueIds,
    [
      'id', 'name', 'state', 'picking_type_id', 'move_ids',
      'x_studio_total_demand', 'x_studio_total_quantity'
    ]
  ]);

  if (!pickings || pickings.length === 0) {
    return { success: true, count: 0, updatedCount: 0, results: [] };
  }

  const allMoveIds = [...new Set(pickings.flatMap((p) => p.move_ids || []))];
  const movesByPicking = new Map();

  if (allMoveIds.length > 0) {
    const moves = await odoo._callObject('stock.move', 'read', [
      allMoveIds,
      ['id', 'picking_id', 'product_uom_qty', 'quantity']
    ]);
    for (const mv of moves || []) {
      const pid = parseNumericId(mv.picking_id);
      if (!pid) continue;
      if (!movesByPicking.has(pid)) movesByPicking.set(pid, []);
      movesByPicking.get(pid).push(mv);
    }
  }

  const results = [];
  let updatedCount = 0;

  for (const picking of pickings) {
    const moves = movesByPicking.get(picking.id) || [];
    const { totalDemand, totalQuantity } = computePickingTotalsFromMoves(moves);

    const curDemand = Number(picking.x_studio_total_demand || 0);
    const curQuantity = Number(picking.x_studio_total_quantity || 0);
    const demandChanged = Math.abs(curDemand - totalDemand) > 1e-6;
    const qtyChanged = Math.abs(curQuantity - totalQuantity) > 1e-6;

    if (demandChanged || qtyChanged) {
      await odoo._callObject('stock.picking', 'write', [
        [picking.id],
        {
          x_studio_total_demand: totalDemand,
          x_studio_total_quantity: totalQuantity
        }
      ], { context: NO_TRACK_CTX });
      updatedCount++;

      if (syncVendorSfpSo && qtyChanged && isVendorSfpPicking(picking)) {
        try {
          await handleVendorSfpDone(picking.id, {
            odoo,
            createActivity: false,
            updateLineQty: true
          });
        } catch (sfpErr) {
          console.warn(`[Transfer Totals] Non-fatal SO Qty SFP sync warning for ${picking.name}:`, sfpErr.message);
        }
      }
    }

    results.push({
      pickingId: picking.id,
      pickingName: picking.name,
      totalDemand,
      totalQuantity,
      updated: demandChanged || qtyChanged
    });
  }

  return {
    success: true,
    count: results.length,
    updatedCount,
    results
  };
}
