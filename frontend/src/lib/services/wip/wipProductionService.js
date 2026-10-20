import { supabaseServer } from '../../supabaseServer.js';
import { adminOdooClient } from '../../odoo/odooClient.js';
import { rawMovesCache } from './wipCache.js';
import { getOrderDetails } from './wipQueryService.js';

/**
 * Submit final production results (locks result stage)
 */
export async function submitProductionResult({
  user,
  orderId,
  qtyGradeA,
  qtyGradeB,
  sisaPotongPanjang,
  sisaPotongSedang,
  sisaPotongPendek,
  sisaMakloonKg,
  noSuratJalan
}) {
  const { order } = await getOrderDetails({ user, orderId, includeRawMoves: false });

  const aGrade = Math.max(0, Number(qtyGradeA || 0));
  const bGrade = Math.max(0, Number(qtyGradeB || 0));
  const panjangKg = Math.max(0, Number(sisaPotongPanjang || 0));
  const sedangKg = Math.max(0, Number(sisaPotongSedang || 0));
  const pendekKg = Math.max(0, Number(sisaPotongPendek || 0));

  const hasCategories = sisaPotongPanjang !== undefined || sisaPotongSedang !== undefined || sisaPotongPendek !== undefined;
  const calculatedTotal = Number((panjangKg + sedangKg + pendekKg).toFixed(2));
  const totalSisaKg = hasCategories ? calculatedTotal : Math.max(0, Number(sisaMakloonKg || 0));
  const suratJalan = (noSuratJalan || '').trim();

  // 1. Update in Supabase (with graceful column fallback)
  const updatePayload = {
    qty_grade_a: aGrade,
    qty_grade_b: bGrade,
    sisa_makloon_kg: totalSisaKg,
    sisa_potong_panjang: panjangKg,
    sisa_potong_sedang: sedangKg,
    sisa_potong_pendek: pendekKg,
    status_produksi: 'Selesai',
    result_locked_at: new Date().toISOString(),
    result_locked_by: user.id
  };
  if (suratJalan) {
    updatePayload.no_surat_jalan_sfp = suratJalan;
  }

  const { error: updateErr } = await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  if (updateErr && (updateErr.message?.includes('sisa_potong') || updateErr.details?.includes('sisa_potong'))) {
    console.warn('[WipProductionService] Fallback update without sisa_potong columns:', updateErr.message);
    delete updatePayload.sisa_potong_panjang;
    delete updatePayload.sisa_potong_sedang;
    delete updatePayload.sisa_potong_pendek;
    await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  }

  // 2. Audit log
  await supabaseServer.from('audit_logs').insert({
    user_id: user.id,
    wip_order_id: orderId,
    action: 'submit_result',
    before_data: {
      qty_grade_a: order.qty_grade_a,
      qty_grade_b: order.qty_grade_b,
      sisa_makloon_kg: order.sisa_makloon_kg,
      sisa_potong_panjang: order.sisa_potong_panjang,
      sisa_potong_sedang: order.sisa_potong_sedang,
      sisa_potong_pendek: order.sisa_potong_pendek
    },
    after_data: {
      qtyGradeA: aGrade,
      qtyGradeB: bGrade,
      sisaPotongPanjang: panjangKg,
      sisaPotongSedang: sedangKg,
      sisaPotongPendek: pendekKg,
      sisaMakloonKg: totalSisaKg,
      noSuratJalan: suratJalan
    }
  });

  // 3. Enqueue to sync_outbox
  await supabaseServer.from('sync_outbox').insert({
    wip_order_id: orderId,
    action: 'production_result',
    payload: {
      qtyGradeA: aGrade,
      qtyGradeB: bGrade,
      sisaPotongPanjang: panjangKg,
      sisaPotongSedang: sedangKg,
      sisaPotongPendek: pendekKg,
      sisaMakloonKg: totalSisaKg,
      noSuratJalan: suratJalan
    },
    created_by: user.id
  });

  // 4. Push to Odoo
  try {
    await syncProductionToOdoo(order, aGrade, bGrade, totalSisaKg, {
      sisaPanjang: panjangKg,
      sisaSedang: sedangKg,
      sisaPendek: pendekKg
    });
    if (order.odoo_mo_id) {
      rawMovesCache.delete(order.odoo_mo_id);
    }
  } catch (err) {
    console.warn(`[WipProductionService] Odoo async production push warning: ${err.message}`);
  }

  return {
    success: true,
    message: 'Hasil jahit dan rincian sisa potong berhasil dilaporkan dan disinkronkan ke Odoo.',
    qtyGradeA: aGrade,
    qtyGradeB: bGrade,
    sisaPotongPanjang: panjangKg,
    sisaPotongSedang: sedangKg,
    sisaPotongPendek: pendekKg,
    sisaMakloonKg: totalSisaKg,
    noSuratJalan: suratJalan
  };
}

/**
 * Push production result changes to Odoo ERP
 */
export async function syncProductionToOdoo(orderOrWipId, aGrade, bGrade, sisaKg, categories = {}) {
  const odooWipId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_wip_id : orderOrWipId;
  const odooMoId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_mo_id : null;
  if (!odooWipId && !odooMoId) return;

  await adminOdooClient.authenticate();

  let pKg = 0, sKg = 0, pdkKg = 0;
  if (typeof categories === 'object' && categories !== null) {
    pKg = Math.max(0, Number(categories.sisaPanjang || 0));
    sKg = Math.max(0, Number(categories.sisaSedang || 0));
    pdkKg = Math.max(0, Number(categories.sisaPendek || 0));
  }

  const catSum = Number((pKg + sKg + pdkKg).toFixed(2));
  const totalSisa = catSum > 0 ? catSum : Math.max(0, Number(sisaKg || 0));

  const wipUpdateVals = {
    x_studio_qty_kirim_a_grade: aGrade,
    x_studio_qty_kirim_b_grade: bGrade,
    x_studio_sisa_potong_panjang: pKg,
    x_studio_sisa_potong_sedang: sKg,
    x_studio_sisa_potong_pendek: pdkKg,
    x_studio_sisa_reject: totalSisa,
    x_studio_sisa_makloon_kg: totalSisa
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

  // 3. Sisa Potong Kain (BSKL) -> Create / update Internal Transfer for BSKL with up to 3 stock.move lines
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

          if (totalSisa > 0) {
            // Find destination location WHGB/Stock
            const destLocs = await adminOdooClient._callObject('stock.location', 'search_read', [
              [
                ['complete_name', 'ilike', 'WHGB/Stock'],
                ['usage', '=', 'internal'],
                ['company_id', 'in', [parentMo.company_id[0], false]]
              ]
            ], { fields: ['id'], limit: 1 });

            // Fetch master products for BSKL categories
            const bsklProds = await adminOdooClient._callObject('product.product', 'search_read', [
              [['name', 'in', ['BSKL PANJANG', 'BSKL SEDANG', 'BSKL PENDEK', 'BSKL']]]
            ], { fields: ['id', 'name', 'uom_id'] });

            const prodMap = {};
            (bsklProds || []).forEach(p => {
              prodMap[p.name] = p;
            });

            // Prepare target item lines to transfer
            const targetItems = [];
            if (pKg > 0) {
              const prod = prodMap['BSKL PANJANG'] || { id: 320936, name: 'BSKL PANJANG', uom_id: [12, 'kg'] };
              targetItems.push({ prod, qty: pKg });
            }
            if (sKg > 0) {
              const prod = prodMap['BSKL SEDANG'] || { id: 320937, name: 'BSKL SEDANG', uom_id: [12, 'kg'] };
              targetItems.push({ prod, qty: sKg });
            }
            if (pdkKg > 0) {
              const prod = prodMap['BSKL PENDEK'] || { id: 320938, name: 'BSKL PENDEK', uom_id: [12, 'kg'] };
              targetItems.push({ prod, qty: pdkKg });
            }

            // Fallback: if categories weren't specified separately but totalSisa > 0
            if (targetItems.length === 0 && totalSisa > 0) {
              const fallbackProd = prodMap['BSKL'] || { id: 312078, name: 'BSKL', uom_id: [12, 'kg'] };
              targetItems.push({ prod: fallbackProd, qty: totalSisa });
            }

            if (destLocs && destLocs.length > 0 && targetItems.length > 0) {
              const destId = destLocs[0].id;
              const srcId = wh.lot_stock_id[0];

              if (pick) {
                if (!['done', 'cancel'].includes(pick.state)) {
                  const existingMoves = pick.move_ids && pick.move_ids.length > 0
                    ? await adminOdooClient._callObject('stock.move', 'read', [
                        pick.move_ids,
                        ['id', 'product_id', 'product_uom_qty', 'state']
                      ])
                    : [];

                  // Update or create move for each targetItem
                  for (const item of targetItems) {
                    const existingMove = existingMoves.find(m => m.product_id && m.product_id[0] === item.prod.id);
                    if (existingMove) {
                      if (parseFloat(existingMove.product_uom_qty) !== item.qty && !['done', 'cancel'].includes(existingMove.state)) {
                        await adminOdooClient._callObject('stock.move', 'write', [[existingMove.id], { product_uom_qty: item.qty }]);
                      }
                    } else {
                      await adminOdooClient._callObject('stock.move', 'create', [{
                        product_id: item.prod.id,
                        product_uom_qty: item.qty,
                        product_uom: item.prod.uom_id ? item.prod.uom_id[0] : 12,
                        picking_id: pick.id,
                        name: item.prod.name,
                        location_id: srcId,
                        location_dest_id: destId,
                        company_id: parentMo.company_id[0]
                      }]);
                    }
                  }

                  // Cancel moves for products no longer present
                  for (const m of existingMoves) {
                    const stillNeeded = targetItems.some(ti => ti.prod.id === m.product_id[0]);
                    if (!stillNeeded && !['done', 'cancel'].includes(m.state)) {
                      try {
                        await adminOdooClient._callObject('stock.move', '_action_cancel', [[m.id]]);
                      } catch (cErr) {
                        await adminOdooClient._callObject('stock.move', 'write', [[m.id], { product_uom_qty: 0 }]);
                      }
                    }
                  }

                  if (soId && !pick.x_studio_sales_order) {
                    await adminOdooClient._callObject('stock.picking', 'write', [[pick.id], { x_studio_sales_order: soId }]);
                  }
                }
                wipUpdateVals.x_studio_nama_transfer_makloon = pick.name;
              } else {
                // Create new picking
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

                  // Create stock.move lines for each active category
                  for (const item of targetItems) {
                    await adminOdooClient._callObject('stock.move', 'create', [{
                      product_id: item.prod.id,
                      product_uom_qty: item.qty,
                      product_uom: item.prod.uom_id ? item.prod.uom_id[0] : 12,
                      picking_id: newPickId,
                      name: item.prod.name,
                      location_id: srcId,
                      location_dest_id: destId,
                      company_id: parentMo.company_id[0]
                    }]);
                  }

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
