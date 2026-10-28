import { adminOdooClient } from '../../../odoo/odooClient.js';
import { syncGradeAToOdoo, syncGradeBToOdoo } from './odooGradeSync.js';

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
    } catch {}
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
          const soName = currentWip.x_studio_sales_order
            ? (Array.isArray(currentWip.x_studio_sales_order) ? currentWip.x_studio_sales_order[1] : currentWip.x_studio_sales_order)
            : '';
          const prefix = `Sisa Makloon - ${currentWip.x_name || parentMo.name} |`;
          const originM = soName ? `${prefix} SO ${soName}` : `${prefix} MO ${parentMo.name}`;
          const soId = parentMo.x_studio_sales_order
            ? parentMo.x_studio_sales_order[0]
            : (currentWip?.x_studio_sales_order ? currentWip.x_studio_sales_order[0] : false);

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
            (bsklProds || []).forEach((p) => { prodMap[p.name] = p; });

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
                    const existingMove = existingMoves.find((m) => m.product_id && m.product_id[0] === item.prod.id);
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
                    const stillNeeded = targetItems.some((ti) => ti.prod.id === m.product_id[0]);
                    if (!stillNeeded && !['done', 'cancel'].includes(m.state)) {
                      try {
                        await adminOdooClient._callObject('stock.move', '_action_cancel', [[m.id]]);
                      } catch {
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
                  const chosenPtype = ptypes.find((p) => p.warehouse_id && p.warehouse_id[0] === wh.id) || ptypes[0];
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
      console.warn('[syncBsklToOdoo] Transfer Makloon creation error:', e.message);
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

