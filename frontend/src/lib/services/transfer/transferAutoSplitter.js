import { acquireDistributedWebhookLock } from '../wip/distributedWebhookLock.js';
import { transfersCache } from '../wip/wipCache.js';

const NO_TRACK_CTX = { tracking_disable: true, no_automation: true, mail_auto_delete: true };
const SPLIT_LOCK_TTL_MS = 60 * 1000; // 60s cross-instance lock per shared picking ID

/**
 * Ensure all stock.move.line records belonging to `moveIds` point to `targetPickingId`
 */
async function syncMoveLinesPicking(odoo, moveIds, targetPickingId) {
  if (!moveIds || moveIds.length === 0 || !targetPickingId) return;
  try {
    const moveLines = await odoo._callObject('stock.move.line', 'search_read', [
      [['move_id', 'in', moveIds]]
    ], { fields: ['id', 'picking_id'] });

    const mismatchedIds = (moveLines || [])
      .filter((ml) => !ml.picking_id || ml.picking_id[0] !== targetPickingId)
      .map((ml) => ml.id);

    if (mismatchedIds.length > 0) {
      await odoo._callObject('stock.move.line', 'write', [
        mismatchedIds,
        { picking_id: targetPickingId }
      ], { context: NO_TRACK_CTX });
    }
  } catch (err) {
    console.warn(`[Transfer Auto-Split] Warning aligning move_lines for picking #${targetPickingId}: ${err.message}`);
  }
}

/**
 * Auto-split a multi-MO internal transfer so 1 MO = 1 Transfer (protected against concurrent races)
 */
export async function executeAutoSplitPicking(odoo, plan, resolvedSo, moMap) {
  const { picking, pickingName, seqCode, isFactoryInternal, movesByMo } = plan;
  const rawGroups = Array.from(movesByMo.values()).filter((g) => g.moveIds && g.moveIds.length > 0);
  if (rawGroups.length <= 1) {
    return null;
  }

  // 1. Distributed lock on the shared source picking ID across ALL endpoints (mo-confirmed + transfer-mo-reference)
  const lockAcquired = await acquireDistributedWebhookLock(`split_picking:${picking.id}`, SPLIT_LOCK_TTL_MS);
  if (!lockAcquired) {
    console.log(`[Transfer Auto-Split] Skipping ${pickingName} (#${picking.id}) — already being split by another worker.`);
    return {
      pickingId: picking.id,
      pickingName,
      seqCode,
      action: 'skipped_split_locked',
      createdPickingIds: [],
      updated: false
    };
  }

  // 2. Fresh re-read of all candidate stock.move records AFTER acquiring lock to ensure no move was already moved
  const allCandidateMoveIds = rawGroups.flatMap((g) => g.moveIds);
  const freshMoves = await odoo._callObject('stock.move', 'read', [
    allCandidateMoveIds,
    ['id', 'picking_id', 'state']
  ]);
  const freshMoveMap = new Map((freshMoves || []).map((m) => [m.id, m]));

  const moGroups = rawGroups
    .map((g) => ({
      ...g,
      moveIds: g.moveIds.filter((mid) => {
        const fm = freshMoveMap.get(mid);
        return fm && fm.picking_id && fm.picking_id[0] === picking.id && !['done', 'cancel'].includes(fm.state);
      })
    }))
    .filter((g) => g.moveIds.length > 0);

  if (moGroups.length <= 1) {
    console.log(`[Transfer Auto-Split] ${pickingName} (#${picking.id}) already dedicated (${moGroups.length} active MO group). Skipping.`);
    return null;
  }

  console.log(`[Transfer Auto-Split] Splitting ${pickingName} (#${picking.id}) across ${moGroups.length} distinct MOs...`);

  const firstMoGroup = moGroups[0];
  const splitTargetGroups = moGroups.slice(1);
  const splitTargetMoIds = splitTargetGroups.map((g) => Number(g.moId)).filter(Boolean);
  const pickingTypeId = picking.picking_type_id ? picking.picking_type_id[0] : false;
  const locationId = picking.location_id ? picking.location_id[0] : false;
  const locationDestId = picking.location_dest_id ? picking.location_dest_id[0] : false;

  // 3. Preload existing open dedicated pickings & WIP records for target MOs in parallel (idempotency + append link)
  const [existingDedicatedPicks, targetWips] = await Promise.all([
    splitTargetMoIds.length > 0 && pickingTypeId
      ? odoo._callObject('stock.picking', 'search_read', [
          [
            ['id', '!=', picking.id],
            ['picking_type_id', '=', pickingTypeId],
            ['location_id', '=', locationId],
            ['location_dest_id', '=', locationDestId],
            ['x_studio_manufacturing_order', 'in', splitTargetMoIds],
            ['state', 'not in', ['done', 'cancel']]
          ]
        ], { fields: ['id', 'x_studio_manufacturing_order', 'origin'], order: 'id desc' }).catch(() => [])
      : Promise.resolve([]),
    splitTargetMoIds.length > 0
      ? odoo._callObject('x_monitoring_wip_vendo', 'search_read', [
          [['x_studio_manufacturing_order', 'in', splitTargetMoIds]]
        ], { fields: ['id', 'x_studio_manufacturing_order'] }).catch(() => [])
      : Promise.resolve([])
  ]);

  const openPickingByMoId = new Map();
  for (const ep of existingDedicatedPicks || []) {
    const epMoId = ep.x_studio_manufacturing_order ? ep.x_studio_manufacturing_order[0] : null;
    if (epMoId && !openPickingByMoId.has(epMoId)) {
      openPickingByMoId.set(epMoId, ep.id);
    }
  }

  const wipByMoId = new Map();
  for (const tw of targetWips || []) {
    if (tw.x_studio_manufacturing_order) {
      wipByMoId.set(tw.x_studio_manufacturing_order[0], tw.id);
    }
  }

  const newCreatedPickings = [];

  for (const moGroup of splitTargetGroups) {
    // Verify once more right before creating/moving that moves are still on source picking
    const checkMoves = await odoo._callObject('stock.move', 'read', [
      moGroup.moveIds,
      ['id', 'picking_id', 'state']
    ]);
    const stillHereMoveIds = (checkMoves || [])
      .filter((m) => m.picking_id && m.picking_id[0] === picking.id && !['done', 'cancel'].includes(m.state))
      .map((m) => m.id);

    if (stillHereMoveIds.length === 0) {
      continue;
    }

    const moInfo = moMap.get(moGroup.moId) || {};
    const moSo = (moInfo.x_studio_sales_order && moInfo.x_studio_sales_order[0])
      ? { id: moInfo.x_studio_sales_order[0], name: moInfo.x_studio_sales_order[1] }
      : resolvedSo;

    let targetPickingId = openPickingByMoId.get(Number(moGroup.moId)) || null;
    let wasCreatedFresh = false;

    if (!targetPickingId) {
      const newPickVals = {
        picking_type_id: pickingTypeId,
        location_id: locationId,
        location_dest_id: locationDestId,
        move_type: picking.move_type || 'direct',
        partner_id: picking.partner_id ? picking.partner_id[0] : false,
        origin: moGroup.moName || picking.origin,
        scheduled_date: picking.scheduled_date,
        date_deadline: picking.date_deadline,
        company_id: picking.company_id ? picking.company_id[0] : false,
        x_studio_manufacturing_order: moGroup.moId,
        x_studio_manufacturing_orders: moGroup.moName || false,
        x_studio_sales_order: moSo ? moSo.id : false,
        x_studio_source_warehouse: picking.x_studio_source_warehouse,
        x_studio_destination_warehouse: picking.x_studio_destination_warehouse,
        note: picking.note
      };

      targetPickingId = await odoo._callObject('stock.picking', 'create', [newPickVals], {
        context: NO_TRACK_CTX
      });
      wasCreatedFresh = true;
    }

    await odoo._callObject('stock.move', 'write', [
      stillHereMoveIds,
      { picking_id: targetPickingId }
    ], { context: NO_TRACK_CTX });

    // Atomically align all stock.move.line records to the same targetPickingId
    await syncMoveLinesPicking(odoo, stillHereMoveIds, targetPickingId);

    // Self-cleanup guard: if for any reason targetPickingId ended up with 0 moves in draft, delete it immediately
    const verifyPick = await odoo._callObject('stock.picking', 'read', [
      [targetPickingId],
      ['id', 'state', 'move_ids']
    ]);
    if (verifyPick && verifyPick[0] && verifyPick[0].state === 'draft' && (!verifyPick[0].move_ids || verifyPick[0].move_ids.length === 0)) {
      if (wasCreatedFresh) {
        await odoo._callObject('stock.picking', 'unlink', [[targetPickingId]], { context: NO_TRACK_CTX }).catch(() => {});
      }
      continue;
    }

    if (['assigned', 'confirmed'].includes(picking.state)) {
      try {
        await odoo._callObject('stock.picking', 'action_assign', [[targetPickingId]], {
          context: NO_TRACK_CTX
        });
      } catch (errAssign) {
        console.warn(`[Transfer Auto-Split] Note on action_assign for picking #${targetPickingId}: ${errAssign.message}`);
      }
    }

    // Append (command 4) to x_studio_daftar_transfer without wiping existing PC/SPB/SFP links!
    const linkedWipId = wipByMoId.get(Number(moGroup.moId));
    if (linkedWipId) {
      await odoo._callObject('x_monitoring_wip_vendo', 'write', [
        [linkedWipId],
        { x_studio_daftar_transfer: [[4, targetPickingId]] }
      ], { context: NO_TRACK_CTX }).catch(() => {});
    }

    transfersCache.delete(Number(moGroup.moId));
    if (wasCreatedFresh) {
      newCreatedPickings.push(targetPickingId);
    }
    console.log(`[Transfer Auto-Split] Dedicated transfer #${targetPickingId} ready for MO ${moGroup.moName} (${stillHereMoveIds.length} move(s)).`);
  }

  const firstMoInfo = moMap.get(firstMoGroup.moId) || {};
  const firstMoSo = (firstMoInfo.x_studio_sales_order && firstMoInfo.x_studio_sales_order[0])
    ? { id: firstMoInfo.x_studio_sales_order[0], name: firstMoInfo.x_studio_sales_order[1] }
    : resolvedSo;

  const origVals = {
    origin: firstMoGroup.moName || picking.origin,
    x_studio_manufacturing_order: firstMoGroup.moId,
    x_studio_manufacturing_orders: firstMoGroup.moName || false
  };
  if (firstMoSo) {
    origVals.x_studio_sales_order = firstMoSo.id;
  }
  if (isFactoryInternal && picking.sale_id) {
    origVals.sale_id = false;
  }

  await odoo._callObject('stock.picking', 'write', [[picking.id], origVals], {
    context: NO_TRACK_CTX
  });
  await syncMoveLinesPicking(odoo, firstMoGroup.moveIds, picking.id);
  transfersCache.delete(Number(firstMoGroup.moId));

  if (['assigned', 'confirmed'].includes(picking.state)) {
    try {
      await odoo._callObject('stock.picking', 'action_assign', [[picking.id]], {
        context: NO_TRACK_CTX
      });
    } catch (errAssign) {
      console.warn(`[Transfer Auto-Split] Note on action_assign for orig picking ${picking.id}: ${errAssign.message}`);
    }
  }

  return {
    pickingId: picking.id,
    pickingName,
    seqCode,
    isFactoryInternal,
    action: 'auto_split',
    totalMos: moGroups.length,
    originalPickingMo: firstMoGroup.moName,
    createdPickingsCount: newCreatedPickings.length,
    createdPickingIds: newCreatedPickings,
    updated: true
  };
}

/**
 * Link MO and SO fields on a standard single-MO stock.picking
 */
export async function executeSinglePickingLink(odoo, plan, resolvedMo, resolvedSo) {
  const { picking, pickingName, seqCode, isFactoryInternal, isDeliveryType } = plan;

  // Never touch empty cancelled/draft shell pickings
  if (picking.state === 'cancel' || (picking.state === 'draft' && (!picking.move_ids || picking.move_ids.length === 0))) {
    return {
      pickingId: picking.id,
      pickingName,
      seqCode,
      updated: false,
      skippedEmptyOrCancel: true
    };
  }

  const currentMoId = picking.x_studio_manufacturing_order ? picking.x_studio_manufacturing_order[0] : null;
  const currentStudioSoId = picking.x_studio_sales_order ? picking.x_studio_sales_order[0] : null;

  const vals = {};

  if (resolvedMo && resolvedMo.id !== currentMoId) {
    vals.x_studio_manufacturing_order = resolvedMo.id;
  }

  if (resolvedSo && resolvedSo.id !== currentStudioSoId) {
    vals.x_studio_sales_order = resolvedSo.id;
  }

  if (isFactoryInternal) {
    // Internal factory movements (PC, SPB, SFP, INT) must NEVER have native sale_id
    if (picking.sale_id) {
      vals.sale_id = false;
    }
  } else if (isDeliveryType) {
    if (resolvedSo && (!picking.sale_id || picking.sale_id[0] !== resolvedSo.id)) {
      vals.sale_id = resolvedSo.id;
    }
  }

  let updated = false;
  if (Object.keys(vals).length > 0) {
    console.log(`[Transfer MO/SO] Writing updates to picking ${pickingName} (ID: ${picking.id}):`, vals);
    await odoo._callObject('stock.picking', 'write', [[picking.id], vals], {
      context: NO_TRACK_CTX
    });
    updated = true;
  }

  return {
    pickingId: picking.id,
    pickingName,
    seqCode,
    isFactoryInternal,
    isDeliveryType,
    resolvedMo: resolvedMo ? { id: resolvedMo.id, name: resolvedMo.name } : null,
    resolvedSo: resolvedSo ? { id: resolvedSo.id, name: resolvedSo.name } : null,
    updatedFields: Object.keys(vals),
    updated
  };
}
