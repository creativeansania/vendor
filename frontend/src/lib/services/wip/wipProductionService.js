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
  const { order } = await getOrderDetails({ user, orderId, includeRawMoves: false, includeTransfers: true });

  const aGrade = Math.max(0, Number(qtyGradeA || 0));
  const bGrade = Math.max(0, Number(qtyGradeB || 0));
  const panjangKg = Math.max(0, Number(sisaPotongPanjang || 0));
  const sedangKg = Math.max(0, Number(sisaPotongSedang || 0));
  const pendekKg = Math.max(0, Number(sisaPotongPendek || 0));

  const hasCategories = sisaPotongPanjang !== undefined || sisaPotongSedang !== undefined || sisaPotongPendek !== undefined;
  const calculatedTotal = Number((panjangKg + sedangKg + pendekKg).toFixed(2));
  const totalSisaKg = hasCategories ? calculatedTotal : Math.max(0, Number(sisaMakloonKg || 0));
  const suratJalan = (noSuratJalan || '').trim();

  // Enforce stage locks consistent with individual tabs
  const isChangingGradeA = aGrade !== Number(order.qty_grade_a || 0);
  if (isChangingGradeA && !order.can_edit_grade_a) {
    throw new Error('Input Grade A terkunci karena produksi telah selesai dan MO Odoo berstatus Done.');
  }

  const isChangingGradeB = bGrade !== Number(order.qty_grade_b || 0);
  if (isChangingGradeB && !order.can_edit_grade_b) {
    throw new Error('Jatah submit Grade B telah habis (Maksimal 2x submit). Hubungi Master Admin untuk membuka kunci.');
  }

  const isChangingBskl =
    totalSisaKg !== Number(order.sisa_makloon_kg || 0) ||
    panjangKg !== Number(order.sisa_potong_panjang || 0) ||
    sedangKg !== Number(order.sisa_potong_sedang || 0) ||
    pendekKg !== Number(order.sisa_potong_pendek || 0);
  if (isChangingBskl && !order.can_edit_bskl) {
    throw new Error('Input Sisa Potong (BSKL) terkunci karena dokumen transfer telah divalidasi oleh Gudang Ansania.');
  }

  const nextGradeBCount = isChangingGradeB
    ? Number(order.grade_b_submit_count || 0) + 1
    : Number(order.grade_b_submit_count || 0);

  // 1. Update in Supabase (with graceful column fallback)
  const updatePayload = {
    qty_grade_a: aGrade,
    qty_grade_b: bGrade,
    grade_b_submit_count: nextGradeBCount,
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
  if (updateErr && (updateErr.message?.includes('sisa_potong') || updateErr.details?.includes('sisa_potong') || updateErr.message?.includes('grade_b_submit_count'))) {
    console.warn('[WipProductionService] Fallback update without optional columns:', updateErr.message);
    delete updatePayload.sisa_potong_panjang;
    delete updatePayload.sisa_potong_sedang;
    delete updatePayload.sisa_potong_pendek;
    delete updatePayload.grade_b_submit_count;
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

  // 3. Enqueue to sync_outbox & track synchronous push status
  const { data: outboxRow } = await supabaseServer
    .from('sync_outbox')
    .insert({
      wip_order_id: orderId,
      action: 'production_result',
      status: 'processing',
      attempts: 1,
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
    })
    .select('id')
    .maybeSingle();

  // 4. Push to Odoo
  let odooSyncWarning = null;
  try {
    await syncProductionToOdoo(order, aGrade, bGrade, totalSisaKg, {
      sisaPanjang: panjangKg,
      sisaSedang: sedangKg,
      sisaPendek: pendekKg
    });
    if (order.odoo_mo_id) {
      rawMovesCache.delete(order.odoo_mo_id);
    }
    if (outboxRow?.id) {
      await supabaseServer
        .from('sync_outbox')
        .update({ status: 'synced', synced_at: new Date().toISOString(), last_error: null })
        .eq('id', outboxRow.id);
    }
  } catch (err) {
    odooSyncWarning = err.message;
    console.warn(`[WipProductionService] Odoo async production push warning: ${err.message}`);
    if (outboxRow?.id) {
      await supabaseServer
        .from('sync_outbox')
        .update({ status: 'failed', last_error: String(err.message).slice(0, 500) })
        .eq('id', outboxRow.id);
    }
  }

  return {
    success: true,
    odooSynced: !odooSyncWarning,
    odooSyncWarning,
    message: odooSyncWarning
      ? `Hasil produksi tersimpan di aplikasi, namun sinkronisasi ke Odoo tertunda: ${odooSyncWarning}`
      : 'Hasil jahit dan rincian sisa potong berhasil dilaporkan dan disinkronkan ke Odoo.',
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
 * Resolves the corresponding Grade B product variant for a given product.
 * If the product has attributes (e.g. POLICY / GRADE with values like 'A (GRADE A)', 'B (GRADE B)', and WARNA / COLOR),
 * it finds the matching variant with the same color/attributes but with Grade B.
 * If no Grade B variant exists, it cleanly falls back to parentProductId.
 */
export async function findMatchingGradeBVariant(parentProductId) {
  if (!parentProductId) return parentProductId;
  try {
    const [parentProd] = await adminOdooClient._callObject('product.product', 'read', [
      [parentProductId],
      ['id', 'name', 'display_name', 'product_tmpl_id', 'product_template_attribute_value_ids']
    ]);

    if (!parentProd || !parentProd.product_tmpl_id) {
      return parentProductId;
    }

    const parentPtavIds = parentProd.product_template_attribute_value_ids || [];
    if (parentPtavIds.length === 0) {
      // Plain product without variant attributes, return same product as fallback
      return parentProductId;
    }

    const tmplId = parentProd.product_tmpl_id[0];

    // Fetch all variants under this template
    const allVariants = await adminOdooClient._callObject('product.product', 'search_read', [
      [['product_tmpl_id', '=', tmplId]],
      ['id', 'display_name', 'product_template_attribute_value_ids']
    ]);

    if (!allVariants || allVariants.length <= 1) {
      return parentProductId;
    }

    // Fetch PTAV details
    const allPtavIds = [...new Set(allVariants.flatMap(v => v.product_template_attribute_value_ids || []))];
    const ptavRecords = await adminOdooClient._callObject('product.template.attribute.value', 'read', [
      allPtavIds,
      ['id', 'name', 'attribute_id']
    ]);

    const ptavMap = new Map();
    for (const p of ptavRecords) {
      ptavMap.set(p.id, {
        id: p.id,
        name: p.name,
        attributeId: p.attribute_id[0],
        attributeName: p.attribute_id[1]
      });
    }

    const isGradeBPtav = (p) => {
      const valName = (p.name || '').trim().toLowerCase();
      const attrName = (p.attribute_id ? p.attribute_id[1] : '').toLowerCase();
      if (valName.includes('grade b') || valName === 'b' || valName.startsWith('b (')) return true;
      if (attrName.includes('grade') && (valName === 'b' || valName.includes('b'))) return true;
      return false;
    };

    const gradeBPtavs = ptavRecords.filter(isGradeBPtav);
    if (gradeBPtavs.length === 0) {
      const matchByDisplay = allVariants.find(v => (v.display_name || '').toLowerCase().includes('grade b'));
      return matchByDisplay ? matchByDisplay.id : parentProductId;
    }

    const gradeBPtavIds = new Set(gradeBPtavs.map(p => p.id));
    const gradeAttributeIds = new Set(gradeBPtavs.map(p => p.attribute_id[0]));

    // Parent product's non-grade PTAVs (e.g. Color, Size)
    const parentNonGradePtavIds = parentPtavIds.filter(id => {
      const info = ptavMap.get(id);
      return info && !gradeAttributeIds.has(info.attributeId);
    });

    let bestVariant = null;
    let maxMatch = -1;

    for (const variant of allVariants) {
      const vPtavs = variant.product_template_attribute_value_ids || [];
      const hasGradeB = vPtavs.some(id => gradeBPtavIds.has(id));
      if (!hasGradeB) continue;

      const vNonGradePtavs = vPtavs.filter(id => {
        const info = ptavMap.get(id);
        return info && !gradeAttributeIds.has(info.attributeId);
      });

      const isExactNonGradeMatch =
        parentNonGradePtavIds.length === vNonGradePtavs.length &&
        parentNonGradePtavIds.every(id => vNonGradePtavs.includes(id));

      if (isExactNonGradeMatch) {
        bestVariant = variant;
        break;
      }

      const commonCount = parentNonGradePtavIds.filter(id => vNonGradePtavs.includes(id)).length;
      if (commonCount > maxMatch) {
        maxMatch = commonCount;
        bestVariant = variant;
      }
    }

    if (bestVariant) {
      console.log(`[findMatchingGradeBVariant] Resolved Grade B variant for ${parentProductId} -> ${bestVariant.id} (${bestVariant.display_name})`);
      return bestVariant.id;
    }

    return parentProductId;
  } catch (err) {
    console.warn(`[findMatchingGradeBVariant] Error resolving Grade B variant:`, err.message);
    return parentProductId;
  }
}

/**
 * Sync Grade A producing qty to Odoo MO
 */
export async function syncGradeAToOdoo(orderOrWipId, aGrade) {
  const odooWipId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_wip_id : orderOrWipId;
  const odooMoId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_mo_id : null;
  if (!odooWipId && !odooMoId) return;

  await adminOdooClient.authenticate();
  const wipUpdateVals = {
    x_studio_qty_kirim_a_grade: aGrade
  };

  if (odooMoId) {
    try {
      const mos = await adminOdooClient._callObject('mrp.production', 'read', [[odooMoId]], {
        fields: ['id', 'name', 'state', 'qty_producing']
      });
      if (mos && mos[0]) {
        const mo = mos[0];
        if (typeof orderOrWipId === 'object' && mo.name && mo.name !== orderOrWipId.mo_name) {
          orderOrWipId.mo_name = mo.name;
          supabaseServer.from('wip_orders').update({ mo_name: mo.name }).eq('id', orderOrWipId.id).then();
        }
        if (typeof orderOrWipId === 'object' && mo.state && mo.state !== orderOrWipId.mo_state) {
          orderOrWipId.mo_state = mo.state;
          supabaseServer.from('wip_orders').update({ mo_state: mo.state }).eq('id', orderOrWipId.id).then();
        }

        if (!['done', 'cancel'].includes(mo.state)) {
          await adminOdooClient._callObject('mrp.production', 'write', [[mo.id], {
            qty_producing: aGrade
          }]);
        }
      }
    } catch (e) {
      console.warn(`[syncGradeAToOdoo] Error syncing to MO #${odooMoId}:`, e.message);
    }
  }

  if (odooWipId) {
    await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [[odooWipId], wipUpdateVals], {
      context: { tracking_disable: true, no_automation: true }
    });
  }
}

/**
 * Sync Grade B qty to Odoo (Creates or updates MO Turunan Grade B)
 */
export async function syncGradeBToOdoo(orderOrWipId, bGrade) {
  const odooWipId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_wip_id : orderOrWipId;
  const odooMoId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_mo_id : null;
  if (!odooWipId && !odooMoId) return;

  await adminOdooClient.authenticate();
  const wipUpdateVals = {
    x_studio_qty_kirim_b_grade: bGrade
  };

  let parentMo = null;
  if (odooMoId) {
    try {
      const mos = await adminOdooClient._callObject('mrp.production', 'read', [[odooMoId]], {
        fields: ['id', 'name', 'state', 'product_id', 'product_uom_id', 'company_id', 'picking_type_id', 'production_group_id', 'bom_id', 'x_studio_sales_order', 'product_qty']
      });
      if (mos && mos[0]) parentMo = mos[0];
    } catch (e) {
      console.warn(`[syncGradeBToOdoo] Read parent MO error:`, e.message);
    }
  }

  if (parentMo && bGrade > 0) {
    try {
      const originB = `Turunan Grade B - ${parentMo.name}`;
      const existingMoBs = await adminOdooClient._callObject('mrp.production', 'search_read', [
        [['origin', '=', originB]]
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
        if (moB.state === 'draft' && parentMo.product_id) {
          try {
            const targetProdBId = await findMatchingGradeBVariant(parentMo.product_id[0]);
            if (targetProdBId && moB.product_id && moB.product_id[0] !== targetProdBId) {
              moBUpdates.product_id = targetProdBId;
            }
          } catch (e) {}
        }
        if (Object.keys(moBUpdates).length > 0) {
          await adminOdooClient._callObject('mrp.production', 'write', [[moB.id], moBUpdates]);
        }
        wipUpdateVals.x_studio_nama_mo_grade_b = moB.name;
      } else {
        let targetProdBId = parentMo.product_id ? parentMo.product_id[0] : null;
        if (targetProdBId) {
          try {
            targetProdBId = await findMatchingGradeBVariant(targetProdBId);
          } catch (e) {}
        }

        let targetBomId = parentMo.bom_id ? parentMo.bom_id[0] : false;
        if (targetProdBId && targetProdBId !== parentMo.product_id[0]) {
          try {
            const boms = await adminOdooClient._callObject('mrp.bom', 'search_read', [
              [['product_id', '=', targetProdBId]],
              ['id'],
              { limit: 1 }
            ]);
            if (boms && boms.length > 0) targetBomId = boms[0].id;
          } catch (e) {}
        }

        const moPayload = {
          product_id: targetProdBId,
          product_qty: bGrade,
          product_uom_id: parentMo.product_uom_id ? parentMo.product_uom_id[0] : 1,
          origin: originB,
          company_id: parentMo.company_id ? parentMo.company_id[0] : 1,
          picking_type_id: parentMo.picking_type_id ? parentMo.picking_type_id[0] : false
        };
        if (parentMo.production_group_id) moPayload.production_group_id = parentMo.production_group_id[0];
        if (targetBomId) moPayload.bom_id = targetBomId;
        if (parentMo.x_studio_sales_order) moPayload.x_studio_sales_order = parentMo.x_studio_sales_order[0];

        const newMoBId = await adminOdooClient._callObject('mrp.production', 'create', [moPayload]);
        const readMoB = await adminOdooClient._callObject('mrp.production', 'read', [[newMoBId]], { fields: ['name'] });
        wipUpdateVals.x_studio_nama_mo_grade_b = readMoB && readMoB[0] ? readMoB[0].name : `MO#${newMoBId}`;
      }
    } catch (e) {
      console.warn(`[syncGradeBToOdoo] MO Grade B creation error:`, e.message);
    }
  }

  if (odooWipId) {
    await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [[odooWipId], wipUpdateVals], {
      context: { tracking_disable: true, no_automation: true }
    });
  }
}

/**
 * Sync BSKL sisa potong to Odoo Internal Transfer (with customer delivery slip)
 */
export async function syncBsklToOdoo(orderOrWipId, { pKg = 0, sKg = 0, pdkKg = 0, totalSisa = 0, noSuratJalanBskl = '' } = {}) {
  const odooWipId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_wip_id : orderOrWipId;
  const odooMoId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_mo_id : null;
  if (!odooWipId && !odooMoId) return;

  await adminOdooClient.authenticate();
  const catSum = Number((pKg + sKg + pdkKg).toFixed(2));
  const effectiveTotal = catSum > 0 ? catSum : totalSisa;

  const wipUpdateVals = {
    x_studio_sisa_potong_panjang: pKg,
    x_studio_sisa_potong_sedang: sKg,
    x_studio_sisa_potong_pendek: pdkKg,
    x_studio_sisa_reject: effectiveTotal,
    x_studio_sisa_makloon_kg: effectiveTotal
  };

  let parentMo = null;
  if (odooMoId) {
    try {
      const mos = await adminOdooClient._callObject('mrp.production', 'read', [[odooMoId]], {
        fields: ['id', 'name', 'state', 'company_id', 'product_id', 'product_qty', 'x_studio_sales_order']
      });
      if (mos && mos[0]) parentMo = mos[0];
    } catch (e) {}
  }

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
          ], { fields: ['id', 'name', 'state', 'move_ids', 'x_studio_sales_order', 'x_studio_delivery_slip_pabrikvendor'], limit: 1 });

          const pick = existingPicks && existingPicks.length > 0 ? existingPicks[0] : null;

          if (effectiveTotal > 0) {
            const destLocs = await adminOdooClient._callObject('stock.location', 'search_read', [
              [
                ['complete_name', 'ilike', 'WHGB/Stock'],
                ['usage', '=', 'internal'],
                ['company_id', 'in', [parentMo.company_id[0], false]]
              ]
            ], { fields: ['id'], limit: 1 });

            const bsklProds = await adminOdooClient._callObject('product.product', 'search_read', [
              [['name', 'in', ['BSKL PANJANG', 'BSKL SEDANG', 'BSKL PENDEK', 'BSKL']]]
            ], { fields: ['id', 'name', 'uom_id'] });

            const prodMap = {};
            (bsklProds || []).forEach(p => { prodMap[p.name] = p; });

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
            if (targetItems.length === 0 && effectiveTotal > 0) {
              const fallbackProd = prodMap['BSKL'] || { id: 312078, name: 'BSKL', uom_id: [12, 'kg'] };
              targetItems.push({ prod: fallbackProd, qty: effectiveTotal });
            }

            if (destLocs && destLocs.length > 0 && targetItems.length > 0) {
              const destId = destLocs[0].id;
              const srcId = wh.lot_stock_id[0];

              if (pick) {
                if (!['done', 'cancel'].includes(pick.state)) {
                  const pickUpdates = {};
                  if (noSuratJalanBskl && pick.x_studio_delivery_slip_pabrikvendor !== noSuratJalanBskl) {
                    pickUpdates.x_studio_delivery_slip_pabrikvendor = noSuratJalanBskl;
                  }
                  if (soId && !pick.x_studio_sales_order) {
                    pickUpdates.x_studio_sales_order = soId;
                  }
                  if (Object.keys(pickUpdates).length > 0) {
                    await adminOdooClient._callObject('stock.picking', 'write', [[pick.id], pickUpdates]);
                  }

                  const existingMoves = pick.move_ids && pick.move_ids.length > 0
                    ? await adminOdooClient._callObject('stock.move', 'read', [
                        pick.move_ids,
                        ['id', 'product_id', 'product_uom_qty', 'state']
                      ])
                    : [];

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
                        description_picking: item.prod.name,
                        location_id: srcId,
                        location_dest_id: destId,
                        company_id: parentMo.company_id[0]
                      }]);
                    }
                  }

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
                  if (soId) pickPayload.x_studio_sales_order = soId;
                  if (noSuratJalanBskl) pickPayload.x_studio_delivery_slip_pabrikvendor = noSuratJalanBskl;
                  if (parentMo.product_id) pickPayload.x_studio_product_mo = parentMo.product_id[0];
                  if (parentMo.product_qty) pickPayload.x_studio_quantity_mo = parentMo.product_qty;

                  const newPickId = await adminOdooClient._callObject('stock.picking', 'create', [pickPayload]);

                  for (const item of targetItems) {
                    await adminOdooClient._callObject('stock.move', 'create', [{
                      product_id: item.prod.id,
                      product_uom_qty: item.qty,
                      product_uom: item.prod.uom_id ? item.prod.uom_id[0] : 12,
                      picking_id: newPickId,
                      description_picking: item.prod.name,
                      location_id: srcId,
                      location_dest_id: destId,
                      company_id: parentMo.company_id[0]
                    }]);
                  }

                  const readPick = await adminOdooClient._callObject('stock.picking', 'read', [[newPickId]], { fields: ['name'] });
                  wipUpdateVals.x_studio_nama_transfer_makloon = readPick && readPick[0] ? readPick[0].name : `PICK#${newPickId}`;
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn(`[syncBsklToOdoo] Transfer Makloon creation error:`, e.message);
    }
  }

  if (odooWipId) {
    await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [[odooWipId], wipUpdateVals], {
      context: { tracking_disable: true, no_automation: true }
    });
  }
}

/**
 * Push production result changes to Odoo ERP (Backward compatibility wrapper)
 */
export async function syncProductionToOdoo(orderOrWipId, aGrade, bGrade, sisaKg, categories = {}) {
  await syncGradeAToOdoo(orderOrWipId, aGrade);
  await syncGradeBToOdoo(orderOrWipId, bGrade);
  await syncBsklToOdoo(orderOrWipId, {
    pKg: categories.sisaPanjang || 0,
    sKg: categories.sisaSedang || 0,
    pdkKg: categories.sisaPendek || 0,
    totalSisa: sisaKg,
    noSuratJalanBskl: categories.noSuratJalanBskl || ''
  });
}

/**
 * Submit Grade A only (locks Grade A once MO state is done)
 */
export async function submitGradeA({ user, orderId, qtyGradeA, noSuratJalan }) {
  const { order } = await getOrderDetails({ user, orderId, includeRawMoves: false });

  if (order.is_grade_a_locked && user.role !== 'master_admin' && !order.is_unlocked_by_admin) {
    throw new Error('Input Grade A terkunci karena produksi telah selesai dan MO Odoo berstatus Done.');
  }

  const aGrade = Math.max(0, Number(qtyGradeA || 0));
  const suratJalan = (noSuratJalan || '').trim();

  const updatePayload = {
    qty_grade_a: aGrade,
    updated_at: new Date().toISOString()
  };
  if (suratJalan) {
    updatePayload.no_surat_jalan_sfp = suratJalan;
  }

  await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);

  await supabaseServer.from('audit_logs').insert({
    user_id: user.id,
    wip_order_id: orderId,
    action: 'submit_grade_a',
    before_data: { qty_grade_a: order.qty_grade_a, no_surat_jalan_sfp: order.no_surat_jalan_sfp },
    after_data: { qtyGradeA: aGrade, noSuratJalan: suratJalan }
  });

  try {
    await syncGradeAToOdoo(order, aGrade);
    if (order.odoo_mo_id) rawMovesCache.delete(order.odoo_mo_id);
  } catch (err) {
    console.warn(`[WipProductionService] Odoo Grade A push warning: ${err.message}`);
  }

  return {
    success: true,
    message: 'Qty Grade A dan Surat Jalan berhasil disimpan dan disinkronkan ke Odoo!',
    qtyGradeA: aGrade,
    noSuratJalan: suratJalan
  };
}

/**
 * Submit Grade B only (with max 2x submit quota: 1 initial + 1 revision)
 */
export async function submitGradeB({ user, orderId, qtyGradeB, noSuratJalanGradeB }) {
  const { order } = await getOrderDetails({ user, orderId, includeRawMoves: false });

  let currentCount = Number(order.grade_b_submit_count || 0);
  if (order.grade_b_submit_count === undefined || order.grade_b_submit_count === null) {
    const { count } = await supabaseServer
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('wip_order_id', orderId)
      .eq('action', 'submit_grade_b');
    currentCount = count || 0;
  }

  const isUnlocked = Boolean(order.is_unlocked_by_admin);
  if (currentCount >= 2 && user.role !== 'master_admin' && !isUnlocked) {
    throw new Error('Jatah submit Grade B telah habis (Maksimal 2x submit: 1x awal + 1x revisi). Hubungi Master Admin untuk membuka kunci.');
  }

  const bGrade = Math.max(0, Number(qtyGradeB || 0));
  const sjB = (noSuratJalanGradeB || '').trim();
  const newCount = currentCount + 1;

  const updatePayload = {
    qty_grade_b: bGrade,
    grade_b_submit_count: newCount,
    updated_at: new Date().toISOString()
  };
  if (sjB) {
    updatePayload.no_surat_jalan_grade_b = sjB;
  }

  const { error: updErr } = await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  if (updErr && (updErr.message?.includes('grade_b') || updErr.details?.includes('grade_b'))) {
    console.warn('[WipProductionService] Fallback update without new grade_b columns:', updErr.message);
    delete updatePayload.grade_b_submit_count;
    delete updatePayload.no_surat_jalan_grade_b;
    await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  }

  await supabaseServer.from('audit_logs').insert({
    user_id: user.id,
    wip_order_id: orderId,
    action: 'submit_grade_b',
    before_data: { qty_grade_b: order.qty_grade_b, count: currentCount },
    after_data: { qtyGradeB: bGrade, noSuratJalanGradeB: sjB, count: newCount }
  });

  try {
    await syncGradeBToOdoo(order, bGrade);
    if (order.odoo_mo_id) rawMovesCache.delete(order.odoo_mo_id);
  } catch (err) {
    console.warn(`[WipProductionService] Odoo Grade B push warning: ${err.message}`);
  }

  return {
    success: true,
    message: newCount === 1
      ? 'Qty Grade B berhasil disubmit! Anda memiliki jatah 1x revisi.'
      : 'Revisi Grade B berhasil disimpan. Input Grade B kini terkunci.',
    qtyGradeB: bGrade,
    submitCount: newCount,
    isLocked: newCount >= 2
  };
}

/**
 * Submit BSKL only (locks when internal transfer is validated in Odoo)
 */
export async function submitBskl({ user, orderId, sisaPotongPanjang, sisaPotongSedang, sisaPotongPendek, sisaMakloonKg, noSuratJalanBskl }) {
  const { order } = await getOrderDetails({ user, orderId, includeRawMoves: false, includeTransfers: true });

  if (order.is_bskl_locked && user.role !== 'master_admin' && !order.is_unlocked_by_admin) {
    throw new Error('Input Sisa Potong (BSKL) terkunci karena dokumen transfer telah divalidasi oleh Gudang Ansania.');
  }

  const panjangKg = Math.max(0, Number(sisaPotongPanjang || 0));
  const sedangKg = Math.max(0, Number(sisaPotongSedang || 0));
  const pendekKg = Math.max(0, Number(sisaPotongPendek || 0));
  const hasCategories = sisaPotongPanjang !== undefined || sisaPotongSedang !== undefined || sisaPotongPendek !== undefined;
  const calculatedTotal = Number((panjangKg + sedangKg + pendekKg).toFixed(2));
  const totalSisaKg = hasCategories ? calculatedTotal : Math.max(0, Number(sisaMakloonKg || 0));
  const sjBskl = (noSuratJalanBskl || '').trim();

  const updatePayload = {
    sisa_makloon_kg: totalSisaKg,
    sisa_potong_panjang: panjangKg,
    sisa_potong_sedang: sedangKg,
    sisa_potong_pendek: pendekKg,
    updated_at: new Date().toISOString()
  };
  if (sjBskl) {
    updatePayload.no_surat_jalan_bskl = sjBskl;
  }

  const { error: updErr } = await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  if (updErr && (updErr.message?.includes('sisa_potong') || updErr.message?.includes('no_surat_jalan_bskl'))) {
    console.warn('[WipProductionService] Fallback update without sisa_potong/sj columns:', updErr.message);
    delete updatePayload.sisa_potong_panjang;
    delete updatePayload.sisa_potong_sedang;
    delete updatePayload.sisa_potong_pendek;
    delete updatePayload.no_surat_jalan_bskl;
    await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  }

  await supabaseServer.from('audit_logs').insert({
    user_id: user.id,
    wip_order_id: orderId,
    action: 'submit_bskl',
    before_data: { sisa_makloon_kg: order.sisa_makloon_kg },
    after_data: {
      sisaPotongPanjang: panjangKg,
      sisaPotongSedang: sedangKg,
      sisaPotongPendek: pendekKg,
      sisaMakloonKg: totalSisaKg,
      noSuratJalanBskl: sjBskl
    }
  });

  try {
    await syncBsklToOdoo(order, {
      pKg: panjangKg,
      sKg: sedangKg,
      pdkKg: pendekKg,
      totalSisa: totalSisaKg,
      noSuratJalanBskl: sjBskl
    });
  } catch (err) {
    console.warn(`[WipProductionService] Odoo BSKL transfer push warning: ${err.message}`);
  }

  return {
    success: true,
    message: 'Rincian sisa potong (BSKL) berhasil disimpan dan transfer Odoo berhasil dibuat/diperbarui!',
    sisaPotongPanjang: panjangKg,
    sisaPotongSedang: sedangKg,
    sisaPotongPendek: pendekKg,
    sisaMakloonKg: totalSisaKg,
    noSuratJalanBskl: sjBskl
  };
}

/**
 * Master Admin Explicit Unlock: Buka Kunci agar user/vendor dapat mengedit kembali
 */
export async function adminUnlockOrder({ user, orderId, reason = '' }) {
  if (user.role !== 'master_admin') {
    throw new Error('Hanya Master Admin yang berhak membuka kunci (unlock).');
  }

  const updatePayload = {
    is_unlocked_by_admin: true,
    unlocked_at: new Date().toISOString(),
    unlocked_by: user.id,
    cutting_locked_at: null,
    cutting_locked_by: null,
    result_locked_at: null,
    result_locked_by: null,
    grade_b_submit_count: 0
  };

  const { error: updErr } = await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  if (updErr && updErr.message?.includes('is_unlocked_by_admin')) {
    delete updatePayload.is_unlocked_by_admin;
    delete updatePayload.unlocked_at;
    delete updatePayload.unlocked_by;
    delete updatePayload.grade_b_submit_count;
    await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  }

  await supabaseServer.from('audit_logs').insert({
    user_id: user.id,
    wip_order_id: orderId,
    action: 'admin_unlock_order',
    reason: (reason || 'Dibuka manual oleh Master Admin').trim()
  });

  return {
    success: true,
    message: 'Kunci order berhasil dibuka oleh Master Admin. Seluruh user & vendor dapat mengedit kembali.'
  };
}

/**
 * Master Admin Explicit Relock: Kunci Kembali
 */
export async function adminRelockOrder({ user, orderId }) {
  if (user.role !== 'master_admin') {
    throw new Error('Hanya Master Admin yang berhak mengunci kembali (relock).');
  }

  const { data: currentOrder } = await supabaseServer
    .from('wip_orders')
    .select('id, actual_cutting, qty_grade_a, status_produksi, cutting_locked_at, result_locked_at')
    .eq('id', orderId)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  const updatePayload = {
    is_unlocked_by_admin: false,
    updated_at: nowIso
  };

  // Restore stage lock timestamps cleared by adminUnlockOrder if stage already has data
  if (currentOrder) {
    if (Number(currentOrder.actual_cutting || 0) > 0 && !currentOrder.cutting_locked_at) {
      updatePayload.cutting_locked_at = nowIso;
      updatePayload.cutting_locked_by = user.id;
    }
    const isFinished =
      Number(currentOrder.qty_grade_a || 0) > 0 ||
      String(currentOrder.status_produksi || '').trim().toLowerCase() === 'selesai';
    if (isFinished && !currentOrder.result_locked_at) {
      updatePayload.result_locked_at = nowIso;
      updatePayload.result_locked_by = user.id;
    }
  }

  const { error: updErr } = await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  if (updErr && updErr.message?.includes('is_unlocked_by_admin')) {
    delete updatePayload.is_unlocked_by_admin;
    await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  }

  await supabaseServer.from('audit_logs').insert({
    user_id: user.id,
    wip_order_id: orderId,
    action: 'admin_relock_order'
  });

  return {
    success: true,
    message: 'Order berhasil dikunci kembali oleh Master Admin.'
  };
}

/**
 * Unlock Order stage (Backward compatibility)
 */
export async function unlockOrder({ user, orderId, unlockType, reason }) {
  return adminUnlockOrder({ user, orderId, reason });
}

