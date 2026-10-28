import { supabaseServer } from '../../supabaseServer.js';
import { adminOdooClient } from '../../odoo/odooClient.js';
import { wipRepo } from '../wipRepository.js';
import { invalidateOrderCache } from './wipCache.js';
import { getOrderDetails } from './wipQueryService.js';
import { isFabricLine } from '../../utils/materialClassifier.js';
import { enqueueOutboxTask, scheduleOutboxExecution } from './outboxService.js';

/**
 * Submit physical roll weights & actual cutting
 */
export async function submitCuttingRolls({ user, orderId, rollUpdates = [], actualCutting }) {
  const { order } = await getOrderDetails({ user, orderId, includeRawMoves: false });

  if (!order.can_edit_cutting) {
    throw new Error('Tahap potong untuk SPK ini sudah terkunci. Hubungi Master Admin jika perlu melakukan revisi.');
  }

  // Fetch existing roll lines strictly belonging to this orderId (prevents cross-order IDOR)
  const { data: existingLines } = await supabaseServer
    .from('wip_roll_lines')
    .select('id, wip_order_id, odoo_line_id, line_type, nama_item, kode_lot, qty, uom, qty_penerimaan, qty_berat_kg')
    .eq('wip_order_id', orderId);

  const linesById = new Map((existingLines || []).map((l) => [Number(l.id), l]));

  // 1. Process roll updates scoped to orderId
  const nowIso = new Date().toISOString();
  const formattedRollUpdates = [];
  const rowsToUpsert = [];
  const updatedById = new Map();

  for (const update of rollUpdates) {
    const lineId = Number(update.lineId || update.id);
    if (!lineId || !linesById.has(lineId)) {
      continue;
    }

    const existingLine = linesById.get(lineId);
    const rawVal = update.qtyBeratKg !== undefined ? update.qtyBeratKg : update.qty_berat_kg;
    const weight = (rawVal !== undefined && rawVal !== null && rawVal !== '')
      ? Math.max(0, parseFloat(rawVal) || 0)
      : null;

    const rawPenerimaan = update.qtyPenerimaan !== undefined ? update.qtyPenerimaan : update.qty_penerimaan;
    const penerimaan = (rawPenerimaan !== undefined && rawPenerimaan !== null && rawPenerimaan !== '')
      ? Math.max(0, parseFloat(rawPenerimaan) || 0)
      : null;

    const mergedRow = {
      id: existingLine.id,
      wip_order_id: orderId,
      line_type: existingLine.line_type,
      nama_item: existingLine.nama_item,
      kode_lot: existingLine.kode_lot,
      qty: existingLine.qty,
      uom: existingLine.uom,
      qty_berat_kg: weight !== null ? weight : existingLine.qty_berat_kg,
      qty_penerimaan: penerimaan !== null ? penerimaan : existingLine.qty_penerimaan,
      updated_at: nowIso
    };
    if (existingLine.odoo_line_id) {
      mergedRow.odoo_line_id = existingLine.odoo_line_id;
    }

    rowsToUpsert.push(mergedRow);
    updatedById.set(lineId, mergedRow);
    formattedRollUpdates.push({
      lineId,
      odooLineId: existingLine.odoo_line_id || null,
      lineType: existingLine.line_type,
      namaItem: existingLine.nama_item,
      qty: existingLine.qty,
      qtyBeratKg: weight,
      qtyPenerimaan: penerimaan
    });
  }

  // Single batch upsert instead of N sequential UPDATE calls
  if (rowsToUpsert.length > 0) {
    const { error: batchErr } = await supabaseServer
      .from('wip_roll_lines')
      .upsert(rowsToUpsert, { onConflict: 'id' });

    if (batchErr && batchErr.message && batchErr.message.includes('qty_penerimaan')) {
      const strippedRows = rowsToUpsert.map((row) => {
        const copy = { ...row };
        delete copy.qty_penerimaan;
        return copy;
      });
      await supabaseServer
        .from('wip_roll_lines')
        .upsert(strippedRows, { onConflict: 'id' });
    }
  }

  // Sum cut PCS strictly from FABRIC ('kain') lines, excluding accessories ('aksesoris')
  let sumFabricCutPcs = 0;
  for (const baseLine of existingLines || []) {
    if (!isFabricLine(baseLine)) continue;
    const latest = updatedById.get(Number(baseLine.id)) || baseLine;
    const cutVal = Number(latest.qty_berat_kg || 0);
    if (cutVal > 0) {
      sumFabricCutPcs += cutVal;
    }
  }

  const finalActualCutting = (actualCutting !== undefined && actualCutting !== null && actualCutting !== '')
    ? Math.max(0, parseFloat(actualCutting) || 0)
    : (sumFabricCutPcs > 0 ? sumFabricCutPcs : Number(order.actual_cutting || 0));

  const estimasiSpb = parseFloat(order.estimasi_dari_spb || 0);
  const selisihCutting = finalActualCutting > 0 ? finalActualCutting - estimasiSpb : Number(order.selisih_hasil_cutting || 0);

  // 2. Update WIP Order in Supabase (only mark cutting_locked_at when actual cutting PCS > 0)
  const orderUpdatePayload = {
    actual_cutting: finalActualCutting,
    selisih_hasil_cutting: selisihCutting,
    updated_at: nowIso
  };
  if (finalActualCutting > 0) {
    orderUpdatePayload.cutting_locked_at = order.cutting_locked_at || nowIso;
    orderUpdatePayload.cutting_locked_by = order.cutting_locked_by || user.id;
  }

  await supabaseServer
    .from('wip_orders')
    .update(orderUpdatePayload)
    .eq('id', orderId);

  // 3. Propagate to child backorders & record audit log in parallel
  const [, outboxId] = await Promise.all([
    Promise.all([
      wipRepo.propagateRollWeightsToBackorders(orderId),
      supabaseServer.from('audit_logs').insert({
        user_id: user.id,
        wip_order_id: orderId,
        action: 'submit_cutting',
        before_data: { actual_cutting: order.actual_cutting, selisih_hasil_cutting: order.selisih_hasil_cutting },
        after_data: { actualCutting: finalActualCutting, selisihCutting, rollUpdates: formattedRollUpdates }
      })
    ]),
    enqueueOutboxTask({
      wipOrderId: orderId,
      action: 'cutting_rolls',
      payload: { actualCutting: finalActualCutting, rollUpdates: formattedRollUpdates },
      createdBy: user.id
    })
  ]);

  invalidateOrderCache(order.odoo_mo_id, order.id);

  const mergedAllLines = (existingLines || []).map((l) => updatedById.get(Number(l.id)) || l);

  // 4. Push to Odoo asynchronously via Next.js after() + sync_outbox durability
  scheduleOutboxExecution({
    outboxId,
    order,
    taskFn: () => syncCuttingToOdoo(order, formattedRollUpdates, finalActualCutting, mergedAllLines)
  });

  return {
    success: true,
    odooSynced: true,
    queuedInBackground: true,
    message: 'Hasil potong berhasil disimpan dan sedang disinkronkan ke Odoo.',
    actualCutting: finalActualCutting,
    selisihCutting
  };
}

/**
 * Synchronize cutting roll weights and consumption to Odoo using batched One2many commands
 * (reduces 15-20 sequential RPC calls down to 2-3 RPC calls total)
 */
export async function syncCuttingToOdoo(orderOrWipId, rollUpdates, actualCutting, preloadedLines = null) {
  const odooWipId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_wip_id : orderOrWipId;
  const odooMoId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_mo_id : null;
  const orderId = typeof orderOrWipId === 'object' ? orderOrWipId.id : null;
  if (!odooWipId && !odooMoId) return;
  await adminOdooClient.authenticate();

  let dbLines = preloadedLines;
  if (!dbLines) {
    const lineIds = (rollUpdates || []).map((u) => Number(u.lineId)).filter(Boolean);
    if (lineIds.length > 0) {
      let query = supabaseServer
        .from('wip_roll_lines')
        .select('id, wip_order_id, odoo_line_id, line_type, nama_item, qty, uom, qty_penerimaan, qty_berat_kg')
        .in('id', lineIds);
      if (orderId) query = query.eq('wip_order_id', orderId);
      const { data } = await query;
      dbLines = data || [];
    } else {
      dbLines = [];
    }
  }
  const dbLineMap = new Map((dbLines || []).map((l) => [Number(l.id), l]));

  // 1. Single batched One2many write on x_monitoring_wip_vendo (all roll lines + actual cutting in 1 RPC call!)
  if (odooWipId) {
    const lineCommands = [];
    for (const update of rollUpdates || []) {
      const rl = dbLineMap.get(Number(update.lineId));
      const odooLineId = update.odooLineId || rl?.odoo_line_id;
      if (!odooLineId) continue;

      const odooPayload = {};
      if (update.qtyBeratKg !== null && update.qtyBeratKg !== undefined) {
        odooPayload.x_studio_qty_berat_kg = update.qtyBeratKg;
      }
      if (update.qtyPenerimaan !== null && update.qtyPenerimaan !== undefined) {
        odooPayload.x_studio_qty_penerimaan = update.qtyPenerimaan;
      }

      if (Object.keys(odooPayload).length > 0) {
        lineCommands.push([1, Number(odooLineId), odooPayload]);
      }
    }

    const wipWriteVals = {};
    if (lineCommands.length > 0) {
      wipWriteVals.x_studio_detail_roll_kain = lineCommands;
    }

    if (actualCutting !== undefined && actualCutting !== null && Number(actualCutting) > 0) {
      const estimasiLocal = typeof orderOrWipId === 'object' && orderOrWipId.estimasi_dari_spb !== undefined
        ? parseFloat(orderOrWipId.estimasi_dari_spb) || 0
        : null;

      let estimasi = estimasiLocal;
      if (estimasi === null) {
        const wips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[odooWipId]], {
          fields: ['x_studio_estimasi_dari_spb']
        });
        estimasi = wips && wips[0] ? (parseFloat(wips[0].x_studio_estimasi_dari_spb) || 0) : 0;
      }

      wipWriteVals.x_studio_actual_cutting = actualCutting;
      wipWriteVals.x_studio_selisih_hasil_cutting = actualCutting - estimasi;
    }

    if (Object.keys(wipWriteVals).length > 0) {
      await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [[odooWipId], wipWriteVals], {
        context: { tracking_disable: true, no_automation: true }
      });
    }
  }

  // 2. Sync to Manufacturing Order BOM moves (delta-checked + batched One2many write)
  if (odooMoId && dbLines.length > 0) {
    try {
      const mos = await adminOdooClient._callObject('mrp.production', 'read', [[odooMoId]], {
        fields: ['id', 'move_raw_ids', 'state']
      });
      if (mos && mos[0] && mos[0].move_raw_ids && mos[0].move_raw_ids.length > 0 && !['done', 'cancel'].includes(mos[0].state)) {
        const rawMoves = await adminOdooClient._callObject('stock.move', 'read', [
          mos[0].move_raw_ids,
          ['id', 'product_id', 'product_uom', 'product_uom_qty', 'quantity', 'picked', 'state']
        ]);

        const usageByProduct = new Map();
        for (const line of dbLines) {
          if (!line.nama_item) continue;
          const key = line.nama_item.trim().toLowerCase();
          const current = usageByProduct.get(key) || {
            isFabric: isFabricLine(line),
            physicalReceivedQty: 0,
            usedOrCutQty: 0
          };

          const physVal = line.qty_penerimaan !== null && line.qty_penerimaan !== undefined
            ? Number(line.qty_penerimaan || 0)
            : Number(line.qty || 0);
          const cutOrUsedVal = Number(line.qty_berat_kg || 0);

          current.physicalReceivedQty += physVal;
          current.usedOrCutQty += cutOrUsedVal;
          usageByProduct.set(key, current);
        }

        const rawMoveCommands = [];
        for (const move of rawMoves) {
          if (['done', 'cancel'].includes(move.state)) continue;
          const moveProdName = (Array.isArray(move.product_id) ? move.product_id[1] : (move.product_id || '')).trim().toLowerCase();
          const moveUomName = (Array.isArray(move.product_uom) ? move.product_uom[1] : (move.product_uom || '')).trim().toLowerCase();
          const moveExpectsPcs = ['pcs', 'unit', 'units', 'buah', 'lembar', 'biji'].includes(moveUomName);

          let matchedUsage = null;
          for (const [prodKey, usage] of usageByProduct.entries()) {
            if (moveProdName === prodKey || moveProdName.includes(prodKey) || prodKey.includes(moveProdName)) {
              matchedUsage = usage;
              break;
            }
          }
          if (!matchedUsage) continue;

          let targetQty = null;
          if (matchedUsage.isFabric && !moveExpectsPcs) {
            if (matchedUsage.physicalReceivedQty > 0) {
              targetQty = Number(matchedUsage.physicalReceivedQty.toFixed(4));
            }
          } else if (matchedUsage.usedOrCutQty > 0) {
            targetQty = matchedUsage.usedOrCutQty;
          }

          if (targetQty !== null && targetQty > 0) {
            const currentQty = Number(move.quantity || 0);
            if (Math.abs(currentQty - targetQty) > 0.0001 || !move.picked) {
              rawMoveCommands.push([1, move.id, { quantity: targetQty, picked: true }]);
            }
          }
        }

        if (rawMoveCommands.length > 0) {
          try {
            await adminOdooClient._callObject('mrp.production', 'write', [
              [odooMoId],
              { move_raw_ids: rawMoveCommands }
            ], { context: { tracking_disable: true, no_automation: true } });
          } catch {
            // Fallback to individual writes only if Odoo restricts One2many write on MO state
            for (const [, moveId, payload] of rawMoveCommands) {
              await adminOdooClient._callObject('stock.move', 'write', [[moveId], payload], {
                context: { tracking_disable: true, no_automation: true }
              });
            }
          }
        }
      }
    } catch (moErr) {
      console.warn(`[WipCuttingService] Sync cutting to MO #${odooMoId} warning:`, moErr.message);
    }
  }
}
