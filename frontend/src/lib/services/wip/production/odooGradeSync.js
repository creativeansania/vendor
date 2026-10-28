import { supabaseServer } from '../../../supabaseServer.js';
import { adminOdooClient } from '../../../odoo/odooClient.js';
import { findMatchingGradeBVariant } from './gradeBVariantResolver.js';

export const SHARED_PRODUCTION_MO_FIELDS = [
  'id',
  'name',
  'state',
  'qty_producing',
  'product_id',
  'product_uom_id',
  'company_id',
  'picking_type_id',
  'production_group_id',
  'bom_id',
  'x_studio_sales_order',
  'product_qty'
];

/**
 * Sync Grade A producing qty to Odoo MO
 */
export async function syncGradeAToOdoo(orderOrWipId, aGrade, { preloadedMo = null, deferWipWrite = false } = {}) {
  const odooWipId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_wip_id : orderOrWipId;
  const odooMoId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_mo_id : null;
  if (!odooWipId && !odooMoId) return {};

  await adminOdooClient.authenticate();
  const wipUpdateVals = {
    x_studio_qty_kirim_a_grade: aGrade
  };

  if (odooMoId) {
    try {
      let mo = preloadedMo;
      if (!mo) {
        const mos = await adminOdooClient._callObject('mrp.production', 'read', [[odooMoId]], {
          fields: ['id', 'name', 'state', 'qty_producing']
        });
        mo = mos && mos[0] ? mos[0] : null;
      }

      if (mo) {
        if (typeof orderOrWipId === 'object') {
          const dbMoPatch = {};
          if (mo.name && mo.name !== orderOrWipId.mo_name) {
            orderOrWipId.mo_name = mo.name;
            dbMoPatch.mo_name = mo.name;
          }
          if (mo.state && mo.state !== orderOrWipId.mo_state) {
            orderOrWipId.mo_state = mo.state;
            dbMoPatch.mo_state = mo.state;
          }
          if (Object.keys(dbMoPatch).length > 0 && orderOrWipId.id) {
            supabaseServer.from('wip_orders').update(dbMoPatch).eq('id', orderOrWipId.id).then(() => {}).catch(() => {});
          }
        }

        if (!['done', 'cancel'].includes(mo.state) && Number(mo.qty_producing || 0) !== Number(aGrade)) {
          await adminOdooClient._callObject('mrp.production', 'write', [[mo.id], {
            qty_producing: aGrade
          }], { context: { tracking_disable: true, no_automation: true } });
        }
      }
    } catch (e) {
      console.warn(`[syncGradeAToOdoo] Error syncing to MO #${odooMoId}:`, e.message);
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
 * Sync Grade B qty to Odoo (Creates or updates MO Turunan Grade B)
 */
export async function syncGradeBToOdoo(orderOrWipId, bGrade, { preloadedMo = null, deferWipWrite = false } = {}) {
  const odooWipId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_wip_id : orderOrWipId;
  const odooMoId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_mo_id : null;
  if (!odooWipId && !odooMoId) return {};

  await adminOdooClient.authenticate();
  const wipUpdateVals = {
    x_studio_qty_kirim_b_grade: bGrade
  };

  let parentMo = preloadedMo;
  if (!parentMo && odooMoId && bGrade > 0) {
    try {
      const mos = await adminOdooClient._callObject('mrp.production', 'read', [[odooMoId]], {
        fields: SHARED_PRODUCTION_MO_FIELDS
      });
      if (mos && mos[0]) parentMo = mos[0];
    } catch (e) {
      console.warn('[syncGradeBToOdoo] Read parent MO error:', e.message);
    }
  }

  if (parentMo && bGrade > 0) {
    try {
      const originB = `Turunan Grade B - ${parentMo.name}`;
      const existingMoBs = await adminOdooClient._callObject('mrp.production', 'search_read', [
        [['origin', '=', originB]]
      ], { fields: ['id', 'name', 'state', 'product_qty', 'x_studio_sales_order', 'product_id'], limit: 1 });

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
          } catch {}
        }
        if (Object.keys(moBUpdates).length > 0) {
          await adminOdooClient._callObject('mrp.production', 'write', [[moB.id], moBUpdates], {
            context: { tracking_disable: true, no_automation: true }
          });
        }
        wipUpdateVals.x_studio_nama_mo_grade_b = moB.name;
      } else {
        let targetProdBId = parentMo.product_id ? parentMo.product_id[0] : null;
        if (targetProdBId) {
          try {
            targetProdBId = await findMatchingGradeBVariant(targetProdBId);
          } catch {}
        }

        let targetBomId = parentMo.bom_id ? parentMo.bom_id[0] : false;
        if (targetProdBId && parentMo.product_id && targetProdBId !== parentMo.product_id[0]) {
          try {
            const boms = await adminOdooClient._callObject('mrp.bom', 'search_read', [
              [['product_id', '=', targetProdBId]]
            ], { fields: ['id'], limit: 1 });
            if (boms && boms.length > 0) targetBomId = boms[0].id;
          } catch {}
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

        const newMoBId = await adminOdooClient._callObject('mrp.production', 'create', [moPayload], {
          context: { tracking_disable: true, no_automation: true }
        });
        const readMoB = await adminOdooClient._callObject('mrp.production', 'read', [[newMoBId]], { fields: ['name'] });
        wipUpdateVals.x_studio_nama_mo_grade_b = readMoB && readMoB[0] ? readMoB[0].name : `MO#${newMoBId}`;
      }
    } catch (e) {
      console.warn('[syncGradeBToOdoo] MO Grade B creation error:', e.message);
    }
  }

  if (odooWipId && !deferWipWrite) {
    await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [[odooWipId], wipUpdateVals], {
      context: { tracking_disable: true, no_automation: true }
    });
  }

  return wipUpdateVals;
}
