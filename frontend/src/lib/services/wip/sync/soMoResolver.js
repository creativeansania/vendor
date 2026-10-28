import { adminOdooClient } from '../../../odoo/odooClient.js';

/**
 * Resolves and saves the Sales Order (x_studio_sales_order) for an MO.
 * Accepts optional `preloadedMo` to eliminate duplicate mrp.production reads.
 */
export async function resolveSalesOrderForMo(moId, { preloadedMo = null } = {}) {
  const id = Number(moId);
  if (!id || isNaN(id)) return null;

  try {
    let mo = preloadedMo;
    if (!mo || (mo.origin === undefined && mo.sale_line_id === undefined)) {
      const mos = await adminOdooClient._callObject('mrp.production', 'read', [
        [id],
        ['id', 'name', 'origin', 'sale_line_id', 'x_studio_sales_order', 'x_studio_origin_mo']
      ]);
      if (!mos || mos.length === 0) return null;
      mo = mos[0];
    }

    if (mo.x_studio_sales_order && mo.x_studio_sales_order[0]) {
      return { id: mo.x_studio_sales_order[0], name: mo.x_studio_sales_order[1] };
    }

    let resolvedSo = null;

    // 1. sale_line_id
    if (mo.sale_line_id && mo.sale_line_id[0]) {
      try {
        const lines = await adminOdooClient._callObject('sale.order.line', 'read', [
          [mo.sale_line_id[0]],
          ['order_id']
        ]);
        if (lines && lines[0] && lines[0].order_id) {
          resolvedSo = { id: lines[0].order_id[0], name: lines[0].order_id[1] };
        }
      } catch {}
    }

    // 2 & 3. Direct or comma-separated origin tokens in a SINGLE batched search_read
    if (!resolvedSo && mo.origin) {
      const originTokens = Array.from(
        new Set(
          mo.origin
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean)
        )
      );
      if (originTokens.length > 0) {
        const sos = await adminOdooClient._callObject('sale.order', 'search_read', [
          [['name', 'in', originTokens], ['state', '!=', 'cancel']]
        ], { fields: ['id', 'name'], limit: 1 });
        if (sos && sos.length > 0) {
          resolvedSo = { id: sos[0].id, name: sos[0].name };
        }
      }
    }

    // 4. Parent MO in origin (Turunan Grade B, Sisa Makloon, Pecahan, etc.) — single batched search_read
    if (!resolvedSo && mo.origin) {
      const moMatches = (mo.origin.match(/([A-Z0-9]+(?:\/[A-Z0-9]+)+\/\d+(?:-\d+)?)/g) || [])
        .filter((name) => name !== mo.name);

      if (moMatches.length > 0) {
        const parentMos = await adminOdooClient._callObject('mrp.production', 'search_read', [
          [['name', 'in', Array.from(new Set(moMatches))]]
        ], { fields: ['id', 'name', 'x_studio_sales_order', 'origin', 'sale_line_id'], limit: 5 });

        for (const pMo of parentMos || []) {
          if (pMo.x_studio_sales_order) {
            resolvedSo = { id: pMo.x_studio_sales_order[0], name: pMo.x_studio_sales_order[1] };
            break;
          } else if (pMo.sale_line_id) {
            const pLines = await adminOdooClient._callObject('sale.order.line', 'read', [
              [pMo.sale_line_id[0]],
              ['order_id']
            ]);
            if (pLines && pLines[0] && pLines[0].order_id) {
              resolvedSo = { id: pLines[0].order_id[0], name: pLines[0].order_id[1] };
              break;
            }
          } else if (pMo.origin) {
            const pSos = await adminOdooClient._callObject('sale.order', 'search_read', [
              [['name', '=', pMo.origin.trim()], ['state', '!=', 'cancel']]
            ], { fields: ['id', 'name'], limit: 1 });
            if (pSos && pSos.length > 0) {
              resolvedSo = { id: pSos[0].id, name: pSos[0].name };
              break;
            }
          }
        }
      }
    }

    // 5. Backorder base prefix (e.g. VDKWS/MO/04623-014 -> sibling with SO)
    if (!resolvedSo && mo.name && mo.name.includes('-')) {
      const basePrefix = mo.name.replace(/-\d+$/, '');
      const siblings = await adminOdooClient._callObject('mrp.production', 'search_read', [
        [['name', '=like', basePrefix + '%'], ['x_studio_sales_order', '!=', false]]
      ], { fields: ['id', 'name', 'x_studio_sales_order'], limit: 1 });
      if (siblings && siblings.length > 0 && siblings[0].x_studio_sales_order) {
        resolvedSo = { id: siblings[0].x_studio_sales_order[0], name: siblings[0].x_studio_sales_order[1] };
      }
    }

    // 6. x_studio_origin_mo
    if (!resolvedSo && mo.x_studio_origin_mo) {
      const origMos = await adminOdooClient._callObject('mrp.production', 'search_read', [
        [['name', '=', mo.x_studio_origin_mo.trim()]]
      ], { fields: ['id', 'name', 'x_studio_sales_order', 'origin'], limit: 1 });
      if (origMos && origMos.length > 0) {
        if (origMos[0].x_studio_sales_order) {
          resolvedSo = { id: origMos[0].x_studio_sales_order[0], name: origMos[0].x_studio_sales_order[1] };
        } else if (origMos[0].origin) {
          const pSos = await adminOdooClient._callObject('sale.order', 'search_read', [
            [['name', '=', origMos[0].origin.trim()], ['state', '!=', 'cancel']]
          ], { fields: ['id', 'name'], limit: 1 });
          if (pSos && pSos.length > 0) {
            resolvedSo = { id: pSos[0].id, name: pSos[0].name };
          }
        }
      }
    }

    if (resolvedSo) {
      console.log(`[WipSyncService] Resolved Sales Order for MO ${mo.name} (#${id}): ${resolvedSo.name} (ID: ${resolvedSo.id})`);
      await adminOdooClient._callObject('mrp.production', 'write', [
        [id],
        { x_studio_sales_order: resolvedSo.id }
      ], {
        context: { tracking_disable: true, no_automation: true }
      });
      if (preloadedMo) {
        preloadedMo.x_studio_sales_order = [resolvedSo.id, resolvedSo.name];
      }
      return resolvedSo;
    }

    return null;
  } catch (err) {
    console.warn(`[WipSyncService] Warning resolving SO for MO #${moId}: ${err.message}`);
    return null;
  }
}
