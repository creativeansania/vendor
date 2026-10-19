import { supabaseServer } from '../../supabaseServer.js';
import { adminOdooClient } from '../../odoo/odooClient.js';
import { rawMovesCache } from './wipCache.js';
import { getOrderDetails } from './wipQueryService.js';

/**
 * Submit final production results (locks result stage)
 */
export async function submitProductionResult({ user, orderId, qtyGradeA, qtyGradeB, sisaMakloonKg, noSuratJalan }) {
  const { order } = await getOrderDetails({ user, orderId, includeRawMoves: false });

  const aGrade = Math.max(0, Number(qtyGradeA || 0));
  const bGrade = Math.max(0, Number(qtyGradeB || 0));
  const sisaKg = Math.max(0, Number(sisaMakloonKg || 0));
  const suratJalan = (noSuratJalan || '').trim();

  // 1. Update in Supabase
  const updatePayload = {
    qty_grade_a: aGrade,
    qty_grade_b: bGrade,
    sisa_makloon_kg: sisaKg,
    status_produksi: 'Selesai',
    result_locked_at: new Date().toISOString(),
    result_locked_by: user.id
  };
  if (suratJalan) {
    updatePayload.no_surat_jalan_sfp = suratJalan;
  }

  await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);

  // 2. Audit log
  await supabaseServer.from('audit_logs').insert({
    user_id: user.id,
    wip_order_id: orderId,
    action: 'submit_result',
    before_data: { qty_grade_a: order.qty_grade_a, qty_grade_b: order.qty_grade_b, sisa_makloon_kg: order.sisa_makloon_kg },
    after_data: { qtyGradeA: aGrade, qtyGradeB: bGrade, sisaMakloonKg: sisaKg, noSuratJalan: suratJalan }
  });

  // 3. Enqueue to sync_outbox
  await supabaseServer.from('sync_outbox').insert({
    wip_order_id: orderId,
    action: 'production_result',
    payload: { qtyGradeA: aGrade, qtyGradeB: bGrade, sisaMakloonKg: sisaKg, noSuratJalan: suratJalan },
    created_by: user.id
  });

  // 4. Push to Odoo
  try {
    await syncProductionToOdoo(order, aGrade, bGrade, sisaKg);
    if (order.odoo_mo_id) {
      rawMovesCache.delete(order.odoo_mo_id);
    }
  } catch (err) {
    console.warn(`[WipProductionService] Odoo async production push warning: ${err.message}`);
  }

  return {
    success: true,
    message: 'Hasil jahit berhasil dilaporkan dan disinkronkan ke Odoo.',
    qtyGradeA: aGrade,
    qtyGradeB: bGrade,
    sisaMakloonKg: sisaKg,
    noSuratJalan: suratJalan
  };
}

/**
 * Push production result changes to Odoo ERP
 */
export async function syncProductionToOdoo(orderOrWipId, aGrade, bGrade, sisaKg) {
  const odooWipId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_wip_id : orderOrWipId;
  const odooMoId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_mo_id : null;
  if (!odooWipId && !odooMoId) return;

  await adminOdooClient.authenticate();

  const wipUpdateVals = {
    x_studio_qty_kirim_a_grade: aGrade,
    x_studio_qty_kirim_b_grade: bGrade,
    x_studio_sisa_makloon_kg: sisaKg
  };

  let parentMo = null;
  if (odooMoId) {
    try {
      const mos = await adminOdooClient._callObject('mrp.production', 'read', [[odooMoId]], {
        fields: ['id', 'name', 'state', 'qty_producing', 'product_id', 'product_uom_id', 'company_id', 'picking_type_id', 'production_group_id', 'bom_id', 'x_studio_sales_order', 'product_qty']
      });
      if (mos && mos[0]) {
        parentMo = mos[0];
      }
    } catch (moErr) {
      console.warn(`[WipProductionService] Read parent MO #${odooMoId} error:`, moErr.message);
    }
  }

  // 1. Sync to Parent Manufacturing Order (qty_producing for Grade A)
  if (parentMo && aGrade !== undefined && aGrade !== null) {
    try {
      if (!['done', 'cancel'].includes(parentMo.state)) {
        await adminOdooClient._callObject('mrp.production', 'write', [[parentMo.id], {
          qty_producing: aGrade
        }]);
      }
    } catch (moErr) {
      console.warn(`[WipProductionService] Sync qty_producing to MO #${odooMoId} warning:`, moErr.message);
    }
  }

  // 2. MO Grade B creation / update if bGrade > 0
  if (parentMo && bGrade > 0) {
    try {
      const originB = `Turunan Grade B - ${parentMo.name}`;
      // Find if MO Grade B already exists
      const existingMoBs = await adminOdooClient._callObject('mrp.production', 'search_read', [
        [[ 'origin', '=', originB ]]
      ], { fields: ['id', 'name', 'state', 'product_qty', 'x_studio_sales_order'], limit: 1 });

      if (existingMoBs && existingMoBs.length > 0) {
        const moB = existingMoBs[0];
        const moBUpdates = {};
        if (!['done', 'cancel'].includes(moB.state) && parseFloat(moB.product_qty) !== bGrade) {
          moBUpdates.product_qty = bGrade;
        }
        if (parentMo.x_studio_sales_order && !moB.x_studio_sales_order) {
          moBUpdates.x_studio_sales_order = parentMo.x_studio_sales_order[0];
        }
        if (Object.keys(moBUpdates).length > 0) {
          await adminOdooClient._callObject('mrp.production', 'write', [[moB.id], moBUpdates]);
        }
        wipUpdateVals.x_studio_nama_mo_grade_b = moB.name;
      } else {
        // Search for a Grade B product variant, or fallback to the parent product
        let targetProdBId = parentMo.product_id[0];
        try {
          const prods = await adminOdooClient._callObject('product.product', 'read', [[parentMo.product_id[0]]], {
            fields: ['product_tmpl_id']
          });
          const tmplId = prods && prods[0] && prods[0].product_tmpl_id ? prods[0].product_tmpl_id[0] : null;
          if (tmplId) {
            const prodBs = await adminOdooClient._callObject('product.product', 'search_read', [
              [
                ['product_tmpl_id', '=', tmplId],
                ['name', 'ilike', 'GRADE B']
              ]
            ], { fields: ['id', 'name', 'uom_id'], limit: 1 });
            if (prodBs && prodBs.length > 0) {
              targetProdBId = prodBs[0].id;
            }
          }
        } catch (e) {}

        const moPayload = {
          product_id: targetProdBId,
          product_qty: bGrade,
          product_uom_id: parentMo.product_uom_id ? parentMo.product_uom_id[0] : 1,
          origin: originB,
          company_id: parentMo.company_id ? parentMo.company_id[0] : 1,
          picking_type_id: parentMo.picking_type_id ? parentMo.picking_type_id[0] : false
        };
        if (parentMo.production_group_id) {
          moPayload.production_group_id = parentMo.production_group_id[0];
        }
        if (parentMo.bom_id) {
          moPayload.bom_id = parentMo.bom_id[0];
        }
        if (parentMo.x_studio_sales_order) {
          moPayload.x_studio_sales_order = parentMo.x_studio_sales_order[0];
        }

        const newMoBId = await adminOdooClient._callObject('mrp.production', 'create', [moPayload]);
        const readMoB = await adminOdooClient._callObject('mrp.production', 'read', [[newMoBId]], { fields: ['name'] });
        const moBName = readMoB && readMoB[0] ? readMoB[0].name : `MO#${newMoBId}`;
        wipUpdateVals.x_studio_nama_mo_grade_b = moBName;
      }
    } catch (moBErr) {
      console.warn(`[WipProductionService] MO Grade B creation error:`, moBErr.message);
    }
  }

  // 3. Sisa Makloon (kg) -> Create / update Internal Transfer for BSKL
  if (odooWipId && parentMo) {
    try {
      const wips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[odooWipId]], {
        fields: ['x_name', 'x_studio_warehouse', 'x_studio_sales_order']
      });
      const currentWip = wips && wips[0] ? wips[0] : null;
      const whId = currentWip?.x_studio_warehouse ? currentWip.x_studio_warehouse[0] : null;

      if (whId) {
        const warehouses = await adminOdooClient._callObject('stock.warehouse', 'read', [[whId]], {
          fields: ['id', 'name', 'lot_stock_id']
        });
        const wh = warehouses && warehouses[0] ? warehouses[0] : null;

        if (wh && wh.lot_stock_id) {
          const soName = currentWip.x_studio_sales_order ? (Array.isArray(currentWip.x_studio_sales_order) ? currentWip.x_studio_sales_order[1] : currentWip.x_studio_sales_order) : '';
          const prefix = `Sisa Makloon - ${currentWip.x_name || parentMo.name} |`;
          const originM = soName ? `${prefix} SO ${soName}` : `${prefix} MO ${parentMo.name}`;
          const soId = parentMo.x_studio_sales_order ? parentMo.x_studio_sales_order[0] : (currentWip?.x_studio_sales_order ? currentWip.x_studio_sales_order[0] : false);

          const existingPicks = await adminOdooClient._callObject('stock.picking', 'search_read', [
            [['origin', '=like', `${prefix}%`]]
          ], { fields: ['id', 'name', 'state', 'move_ids', 'x_studio_sales_order'], limit: 1 });

          const pick = existingPicks && existingPicks.length > 0 ? existingPicks[0] : null;

          if (sisaKg > 0) {
            const bsklProds = await adminOdooClient._callObject('product.product', 'search_read', [
              [['name', '=', 'BSKL']]
            ], { fields: ['id', 'name', 'uom_id'], limit: 1 });

            const destLocs = await adminOdooClient._callObject('stock.location', 'search_read', [
              [
                ['complete_name', 'ilike', 'WHGB/Stock'],
                ['usage', '=', 'internal'],
                ['company_id', 'in', [parentMo.company_id[0], false]]
              ]
            ], { fields: ['id'], limit: 1 });

            if (bsklProds && bsklProds.length > 0 && destLocs && destLocs.length > 0) {
              const bskl = bsklProds[0];
              const destId = destLocs[0].id;
              const srcId = wh.lot_stock_id[0];

              if (pick) {
                if (!['done', 'cancel'].includes(pick.state)) {
                  if (pick.move_ids && pick.move_ids.length > 0) {
                    const moves = await adminOdooClient._callObject('stock.move', 'read', [
                      pick.move_ids,
                      ['id', 'product_id', 'product_uom_qty']
                    ]);
                    const bsklMove = moves.find(m => m.product_id && m.product_id[0] === bskl.id);
                    if (bsklMove && parseFloat(bsklMove.product_uom_qty) !== sisaKg) {
                      await adminOdooClient._callObject('stock.move', 'write', [[bsklMove.id], { product_uom_qty: sisaKg }]);
                    }
                  }
                  if (soId && !pick.x_studio_sales_order) {
                    await adminOdooClient._callObject('stock.picking', 'write', [[pick.id], { x_studio_sales_order: soId }]);
                  }
                }
                wipUpdateVals.x_studio_nama_transfer_makloon = pick.name;
              } else {
                const ptypes = await adminOdooClient._callObject('stock.picking.type', 'search_read', [
                  [
                    ['code', '=', 'internal'],
                    '|',
                    ['warehouse_id', '=', wh.id],
                    ['company_id', '=', parentMo.company_id[0]]
                  ]
                ], { fields: ['id', 'warehouse_id'], limit: 5 });

                if (ptypes && ptypes.length > 0) {
                  const chosenPtype = ptypes.find(p => p.warehouse_id && p.warehouse_id[0] === wh.id) || ptypes[0];
                  const pickPayload = {
                    picking_type_id: chosenPtype.id,
                    location_id: srcId,
                    location_dest_id: destId,
                    origin: originM,
                    company_id: parentMo.company_id[0],
                    note: `Sisa bahan makloon dari MO ${parentMo.name}`
                  };
                  if (soId) {
                    pickPayload.x_studio_sales_order = soId;
                  }
                  if (parentMo.product_id) {
                    pickPayload.x_studio_product_mo = parentMo.product_id[0];
                  }
                  if (parentMo.product_qty) {
                    pickPayload.x_studio_quantity_mo = parentMo.product_qty;
                  }

                  const newPickId = await adminOdooClient._callObject('stock.picking', 'create', [pickPayload]);

                  await adminOdooClient._callObject('stock.move', 'create', [{
                    product_id: bskl.id,
                    product_uom_qty: sisaKg,
                    product_uom: bskl.uom_id ? bskl.uom_id[0] : 12,
                    picking_id: newPickId,
                    location_id: srcId,
                    location_dest_id: destId,
                    company_id: parentMo.company_id[0]
                  }]);

                  const readPick = await adminOdooClient._callObject('stock.picking', 'read', [[newPickId]], { fields: ['name'] });
                  const pickName = readPick && readPick[0] ? readPick[0].name : `PICK#${newPickId}`;
                  wipUpdateVals.x_studio_nama_transfer_makloon = pickName;
                }
              }
            }
          } else if (pick && !['done', 'cancel'].includes(pick.state)) {
            await adminOdooClient._callObject('stock.picking', 'action_cancel', [[pick.id]]);
            wipUpdateVals.x_studio_nama_transfer_makloon = false;
          }
        }
      }
    } catch (sisaErr) {
      console.warn(`[WipProductionService] Transfer Makloon creation error:`, sisaErr.message);
    }
  }

  // 4. Write all values to Monitoring WIP Vendor
  if (odooWipId) {
    await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [[odooWipId], wipUpdateVals], {
      context: { tracking_disable: true, no_automation: true }
    });
  }
}

/**
 * Unlock Order stage (Master Admin only)
 */
export async function unlockOrder({ user, orderId, unlockType, reason }) {
  if (user.role !== 'master_admin') {
    throw new Error('Hanya Master Admin yang berhak membuka kunci (unlock).');
  }
  if (!reason || !reason.trim()) {
    throw new Error('Alasan unlock wajib diisi untuk catatan audit.');
  }

  if (unlockType === 'cutting') {
    await supabaseServer.from('wip_orders').update({
      cutting_locked_at: null,
      cutting_locked_by: null
    }).eq('id', orderId);
  } else if (unlockType === 'result') {
    await supabaseServer.from('wip_orders').update({
      result_locked_at: null,
      result_locked_by: null
    }).eq('id', orderId);
  } else {
    throw new Error('Tipe unlock tidak valid (pilih "cutting" atau "result").');
  }

  await supabaseServer.from('audit_logs').insert({
    user_id: user.id,
    wip_order_id: orderId,
    action: `unlock_${unlockType}`,
    reason: reason.trim()
  });

  return {
    success: true,
    message: `Kunci tahap ${unlockType} berhasil dibuka kembali.`
  };
}
