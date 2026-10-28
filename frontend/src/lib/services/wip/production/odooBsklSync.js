import { adminOdooClient } from '../../../odoo/odooClient.js';
import {
  getCachedBsklProducts,
  getCachedWhgbDestLocationId,
  getCachedWarehouseInternalMeta
} from '../../../odoo/odooStaticCache.js';
import {
  syncGradeAToOdoo,
  syncGradeBToOdoo,
  SHARED_PRODUCTION_MO_FIELDS
} from './odooGradeSync.js';

/**
 * Sync BSKL sisa potong to Odoo Internal Transfer using static caches & batched One2many moves
 * (reduces 9-12 sequential RPC calls down to 3-4 RPC calls)
 */
export async function syncBsklToOdoo(
  orderOrWipId,
  { pKg = 0, sKg = 0, pdkKg = 0, totalSisa = 0, noSuratJalanBskl = '' } = {},
  { preloadedMo = null, deferWipWrite = false } = {}
) {
  const odooWipId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_wip_id : orderOrWipId;
  const odooMoId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_mo_id : null;
  if (!odooWipId && !odooMoId) return {};

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

  if (odooWipId && (odooMoId || preloadedMo)) {
    try {
      // Parallel fetch of MO (if not preloaded) and WIP warehouse metadata
      const [mos, wips] = await Promise.all([
        preloadedMo
          ? Promise.resolve([preloadedMo])
          : adminOdooClient._callObject('mrp.production', 'read', [[odooMoId]], {
              fields: ['id', 'name', 'state', 'company_id', 'product_id', 'product_qty', 'x_studio_sales_order']
            }).catch(() => []),
        adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[odooWipId]], {
          fields: ['x_name', 'x_studio_warehouse', 'x_studio_sales_order']
        }).catch(() => [])
      ]);

      const parentMo = mos && mos[0] ? mos[0] : null;
      const currentWip = wips && wips[0] ? wips[0] : null;
      const whId = currentWip?.x_studio_warehouse ? currentWip.x_studio_warehouse[0] : null;
      const companyId = parentMo?.company_id ? parentMo.company_id[0] : 1;

      if (parentMo && whId) {
        const prefix = `Sisa Makloon - ${currentWip.x_name || parentMo.name} |`;

        // Fetch cached warehouse/dest/products in parallel with existing picking check
        const [whMeta, existingPicks, destId, prodMap] = await Promise.all([
          getCachedWarehouseInternalMeta(adminOdooClient, whId, companyId),
          adminOdooClient._callObject('stock.picking', 'search_read', [
            [['origin', '=like', `${prefix}%`]]
          ], {
            fields: ['id', 'name', 'state', 'move_ids', 'x_studio_sales_order', 'x_studio_delivery_slip_pabrikvendor'],
            limit: 1
          }),
          effectiveTotal > 0 ? getCachedWhgbDestLocationId(adminOdooClient, companyId) : Promise.resolve(null),
          effectiveTotal > 0 ? getCachedBsklProducts(adminOdooClient) : Promise.resolve({})
        ]);

        if (whMeta && whMeta.lotStockId) {
          const soName = currentWip.x_studio_sales_order
            ? (Array.isArray(currentWip.x_studio_sales_order) ? currentWip.x_studio_sales_order[1] : currentWip.x_studio_sales_order)
            : '';
          const originM = soName ? `${prefix} SO ${soName}` : `${prefix} MO ${parentMo.name}`;
          const soId = parentMo.x_studio_sales_order
            ? parentMo.x_studio_sales_order[0]
            : (currentWip?.x_studio_sales_order ? currentWip.x_studio_sales_order[0] : false);

          const pick = existingPicks && existingPicks.length > 0 ? existingPicks[0] : null;

          if (effectiveTotal > 0 && destId) {
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

            const srcId = whMeta.lotStockId;

            if (pick) {
              if (!['done', 'cancel'].includes(pick.state)) {
                const existingMoves = pick.move_ids && pick.move_ids.length > 0
                  ? await adminOdooClient._callObject('stock.move', 'read', [
                      pick.move_ids,
                      ['id', 'product_id', 'product_uom_qty', 'state']
                    ])
                  : [];

                const moveCommands = [];
                for (const item of targetItems) {
                  const existingMove = existingMoves.find((m) => m.product_id && m.product_id[0] === item.prod.id);
                  if (existingMove) {
                    if (parseFloat(existingMove.product_uom_qty) !== item.qty && !['done', 'cancel'].includes(existingMove.state)) {
                      moveCommands.push([1, existingMove.id, { product_uom_qty: item.qty }]);
                    }
                  } else {
                    moveCommands.push([0, 0, {
                      product_id: item.prod.id,
                      product_uom_qty: item.qty,
                      product_uom: item.prod.uom_id ? item.prod.uom_id[0] : 12,
                      description_picking: item.prod.name,
                      location_id: srcId,
                      location_dest_id: destId,
                      company_id: companyId
                    }]);
                  }
                }

                const pickUpdates = {};
                if (noSuratJalanBskl && pick.x_studio_delivery_slip_pabrikvendor !== noSuratJalanBskl) {
                  pickUpdates.x_studio_delivery_slip_pabrikvendor = noSuratJalanBskl;
                }
                if (soId && !pick.x_studio_sales_order) {
                  pickUpdates.x_studio_sales_order = soId;
                }
                if (moveCommands.length > 0) {
                  pickUpdates.move_ids = moveCommands;
                }

                if (Object.keys(pickUpdates).length > 0) {
                  await adminOdooClient._callObject('stock.picking', 'write', [[pick.id], pickUpdates], {
                    context: { tracking_disable: true, no_automation: true }
                  });
                }

                // Cancel removed BSKL category lines if any
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
            } else if (whMeta.internalPickingTypeId) {
              // Single atomic create: stock.picking + all nested BSKL stock.move lines in 1 RPC call!
              const pickPayload = {
                picking_type_id: whMeta.internalPickingTypeId,
                location_id: srcId,
                location_dest_id: destId,
                origin: originM,
                company_id: companyId,
                note: `Sisa bahan makloon dari MO ${parentMo.name}`,
                move_ids: targetItems.map((item) => [0, 0, {
                  product_id: item.prod.id,
                  product_uom_qty: item.qty,
                  product_uom: item.prod.uom_id ? item.prod.uom_id[0] : 12,
                  description_picking: item.prod.name,
                  location_id: srcId,
                  location_dest_id: destId,
                  company_id: companyId
                }])
              };
              if (soId) pickPayload.x_studio_sales_order = soId;
              if (noSuratJalanBskl) pickPayload.x_studio_delivery_slip_pabrikvendor = noSuratJalanBskl;
              if (parentMo.product_id) pickPayload.x_studio_product_mo = parentMo.product_id[0];
              if (parentMo.product_qty) pickPayload.x_studio_quantity_mo = parentMo.product_qty;

              const newPickId = await adminOdooClient._callObject('stock.picking', 'create', [pickPayload], {
                context: { tracking_disable: true, no_automation: true }
              });

              const readPick = await adminOdooClient._callObject('stock.picking', 'read', [[newPickId]], { fields: ['name'] });
              wipUpdateVals.x_studio_nama_transfer_makloon = readPick && readPick[0] ? readPick[0].name : `PICK#${newPickId}`;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[syncBsklToOdoo] Transfer Makloon creation error:', e.message);
    }
  }

  if (odooWipId && !deferWipWrite) {
    await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [[odooWipId], wipUpdateVals], {
      context: { tracking_disable: true, no_automation: true }
    });
  }

  return wipUpdateVals;
}

/**
 * Push full production result changes to Odoo ERP with single MO read & single WIP write
 */
export async function syncProductionToOdoo(orderOrWipId, aGrade, bGrade, sisaKg, categories = {}) {
  const odooWipId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_wip_id : orderOrWipId;
  const odooMoId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_mo_id : null;
  if (!odooWipId && !odooMoId) return;

  await adminOdooClient.authenticate();

  let preloadedMo = null;
  if (odooMoId) {
    try {
      const mos = await adminOdooClient._callObject('mrp.production', 'read', [[odooMoId]], {
        fields: SHARED_PRODUCTION_MO_FIELDS
      });
      preloadedMo = mos && mos[0] ? mos[0] : null;
    } catch {}
  }

  const sharedOpts = { preloadedMo, deferWipWrite: Boolean(odooWipId) };

  const [gradeAVals, gradeBVals, bsklVals] = await Promise.all([
    syncGradeAToOdoo(orderOrWipId, aGrade, sharedOpts),
    syncGradeBToOdoo(orderOrWipId, bGrade, sharedOpts),
    syncBsklToOdoo(
      orderOrWipId,
      {
        pKg: categories.sisaPanjang || 0,
        sKg: categories.sisaSedang || 0,
        pdkKg: categories.sisaPendek || 0,
        totalSisa: sisaKg,
        noSuratJalanBskl: categories.noSuratJalanBskl || ''
      },
      sharedOpts
    )
  ]);

  if (odooWipId) {
    const combinedWipVals = {
      ...gradeAVals,
      ...gradeBVals,
      ...bsklVals
    };
    if (Object.keys(combinedWipVals).length > 0) {
      await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [[odooWipId], combinedWipVals], {
        context: { tracking_disable: true, no_automation: true }
      });
    }
  }
}
