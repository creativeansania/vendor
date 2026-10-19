import { supabaseServer } from '../../supabaseServer.js';
import { adminOdooClient } from '../../odoo/odooClient.js';
import { wipRepo } from '../wipRepository.js';
import { rawMovesCache } from './wipCache.js';
import { getOrderDetails } from './wipQueryService.js';

/**
 * Submit physical roll weights & actual cutting
 */
export async function submitCuttingRolls({ user, orderId, rollUpdates = [], actualCutting }) {
  const { order } = await getOrderDetails({ user, orderId, includeRawMoves: false });

  // 1. Process roll updates
  let sumRollWeights = 0;
  const formattedRollUpdates = [];

  for (const update of rollUpdates) {
    const lineId = Number(update.lineId || update.id);
    const rawVal = update.qtyBeratKg !== undefined ? update.qtyBeratKg : update.qty_berat_kg;
    const weight = (rawVal !== undefined && rawVal !== null && rawVal !== '') ? Math.max(0, parseFloat(rawVal) || 0) : null;

    const rawPenerimaan = update.qtyPenerimaan !== undefined ? update.qtyPenerimaan : update.qty_penerimaan;
    const penerimaan = (rawPenerimaan !== undefined && rawPenerimaan !== null && rawPenerimaan !== '') ? Math.max(0, parseFloat(rawPenerimaan) || 0) : null;

    if (lineId) {
      const updateData = { updated_at: new Date().toISOString() };
      if (weight !== null) updateData.qty_berat_kg = weight;
      if (penerimaan !== null) updateData.qty_penerimaan = penerimaan;

      const { error: lineErr } = await supabaseServer
        .from('wip_roll_lines')
        .update(updateData)
        .eq('id', lineId);

      if (lineErr && lineErr.message && lineErr.message.includes('qty_penerimaan')) {
        delete updateData.qty_penerimaan;
        await supabaseServer
          .from('wip_roll_lines')
          .update(updateData)
          .eq('id', lineId);
      }
    }

    if (weight !== null) {
      sumRollWeights += weight;
    }
    formattedRollUpdates.push({ lineId, qtyBeratKg: weight, qtyPenerimaan: penerimaan });
  }

  // If vendor didn't input explicit actualCutting, fallback to sum of roll weights
  let finalActualCutting = (actualCutting !== undefined && actualCutting !== null && actualCutting !== '')
    ? Math.max(0, parseFloat(actualCutting) || 0)
    : (sumRollWeights > 0 ? sumRollWeights : (order.actual_cutting || 0));

  const estimasiSpb = parseFloat(order.estimasi_dari_spb || 0);
  const selisihCutting = finalActualCutting - estimasiSpb;

  // 2. Update WIP Order in Supabase
  await supabaseServer
    .from('wip_orders')
    .update({
      actual_cutting: finalActualCutting,
      selisih_hasil_cutting: selisihCutting,
      cutting_locked_at: new Date().toISOString(),
      cutting_locked_by: user.id
    })
    .eq('id', orderId);

  // 3. Propagate to child backorders
  await wipRepo.propagateRollWeightsToBackorders(orderId);

  // 4. Record audit log
  await supabaseServer.from('audit_logs').insert({
    user_id: user.id,
    wip_order_id: orderId,
    action: 'submit_cutting',
    before_data: { actual_cutting: order.actual_cutting, selisih_hasil_cutting: order.selisih_hasil_cutting },
    after_data: { actualCutting: finalActualCutting, selisihCutting, rollUpdates: formattedRollUpdates }
  });

  // 5. Enqueue outbox & trigger background push to Odoo
  await supabaseServer.from('sync_outbox').insert({
    wip_order_id: orderId,
    action: 'cutting_rolls',
    payload: { actualCutting: finalActualCutting, rollUpdates: formattedRollUpdates },
    created_by: user.id
  });

  // Synchronously push to Odoo so Vercel Serverless Function waits for completion
  try {
    await syncCuttingToOdoo(order, formattedRollUpdates, finalActualCutting);
    if (order.odoo_mo_id) {
      rawMovesCache.delete(order.odoo_mo_id);
    }
  } catch (err) {
    console.warn(`[WipCuttingService] Odoo cutting push warning: ${err.message}`);
  }

  return {
    success: true,
    message: 'Hasil potong berhasil disimpan dan disinkronkan ke Odoo.',
    actualCutting: finalActualCutting,
    selisihCutting
  };
}

/**
 * Synchronize cutting roll weights and consumption to Odoo
 */
export async function syncCuttingToOdoo(orderOrWipId, rollUpdates, actualCutting) {
  const odooWipId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_wip_id : orderOrWipId;
  const odooMoId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_mo_id : null;
  if (!odooWipId && !odooMoId) return;
  await adminOdooClient.authenticate();

  // 1. Sync to Monitoring WIP Vendor lines
  if (odooWipId) {
    for (const update of rollUpdates) {
      if (update.lineId) {
        // Read Odoo line ID
        const { data: rl } = await supabaseServer.from('wip_roll_lines').select('odoo_line_id').eq('id', update.lineId).single();
        if (rl && rl.odoo_line_id) {
          const odooPayload = {};
          if (update.qtyBeratKg !== null && update.qtyBeratKg !== undefined) {
            odooPayload.x_studio_qty_berat_kg = update.qtyBeratKg;
          }
          if (update.qtyPenerimaan !== null && update.qtyPenerimaan !== undefined) {
            odooPayload.x_studio_qty_penerimaan = update.qtyPenerimaan;
          }

          if (Object.keys(odooPayload).length > 0) {
            await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'write', [
              [rl.odoo_line_id],
              odooPayload
            ]);
          }
        }
      }
    }

    if (actualCutting !== undefined && actualCutting !== null) {
      const wips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[odooWipId]], {
        fields: ['x_studio_estimasi_dari_spb']
      });
      const estimasi = wips && wips[0] ? (parseFloat(wips[0].x_studio_estimasi_dari_spb) || 0) : 0;
      await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [[odooWipId], {
        x_studio_actual_cutting: actualCutting,
        x_studio_selisih_hasil_cutting: actualCutting - estimasi
      }]);
    }
  }

  // 2. Sync to Manufacturing Order (mrp.production raw moves / components)
  if (odooMoId) {
    try {
      const mos = await adminOdooClient._callObject('mrp.production', 'read', [[odooMoId]], {
        fields: ['id', 'move_raw_ids', 'state']
      });
      if (mos && mos[0] && mos[0].move_raw_ids && mos[0].move_raw_ids.length > 0 && !['done', 'cancel'].includes(mos[0].state)) {
        const rawMoves = await adminOdooClient._callObject('stock.move', 'read', [
          mos[0].move_raw_ids,
          ['id', 'product_id', 'product_uom_qty', 'quantity', 'state']
        ]);

        const lineIds = rollUpdates.map(u => u.lineId).filter(Boolean);
        if (lineIds.length > 0) {
          const { data: dbLines } = await supabaseServer
            .from('wip_roll_lines')
            .select('id, nama_item, qty_berat_kg')
            .in('id', lineIds);

          // Group cutting quantity by product name
          const qtyByProduct = {};
          for (const update of rollUpdates) {
            const matchedLine = dbLines?.find(l => l.id === update.lineId);
            if (!matchedLine || !matchedLine.nama_item) continue;
            const weight = update.qtyBeratKg !== null && update.qtyBeratKg !== undefined
              ? update.qtyBeratKg
              : (matchedLine.qty_berat_kg || 0);

            const key = matchedLine.nama_item.trim().toLowerCase();
            qtyByProduct[key] = (qtyByProduct[key] || 0) + weight;
          }

          // Write quantity consumed to each matching stock.move
          for (const move of rawMoves) {
            const moveProdName = (Array.isArray(move.product_id) ? move.product_id[1] : (move.product_id || '')).trim().toLowerCase();
            let targetQty = null;
            for (const [prodKey, qtyVal] of Object.entries(qtyByProduct)) {
              if (moveProdName === prodKey || moveProdName.includes(prodKey) || prodKey.includes(moveProdName)) {
                targetQty = qtyVal;
                break;
              }
            }

            if (targetQty !== null) {
              await adminOdooClient._callObject('stock.move', 'write', [
                [move.id],
                { quantity: targetQty, picked: true }
              ]);
            }
          }
        }
      }
    } catch (moErr) {
      console.warn(`[WipCuttingService] Sync cutting to MO #${odooMoId} warning:`, moErr.message);
    }
  }
}
