import { adminOdooClient } from '../../../odoo/odooClient.js';

/**
 * Resolves and saves the Sales Order (x_studio_sales_order) for an MO.
 */
export async function resolveSalesOrderForMo(moId) {
  const id = Number(moId);
  if (!id || isNaN(id)) return null;

  try {
    const mos = await adminOdooClient._callObject('mrp.production', 'read', [
      [id],
      ['id', 'name', 'origin', 'sale_line_id', 'x_studio_sales_order', 'x_studio_origin_mo']
    ]);
    if (!mos || mos.length === 0) return null;
    const mo = mos[0];

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

    // 2. Direct origin
    if (!resolvedSo && mo.origin) {
      const cleanOrigin = mo.origin.trim();
      const sos = await adminOdooClient._callObject('sale.order', 'search_read', [
        [['name', '=', cleanOrigin], ['state', '!=', 'cancel']]
      ], { fields: ['id', 'name'], limit: 1 });
      if (sos && sos.length > 0) {
        resolvedSo = { id: sos[0].id, name: sos[0].name };
      }
    }

    // 3. Comma-separated origin tokens
    if (!resolvedSo && mo.origin && mo.origin.includes(',')) {
      const parts = mo.origin.split(',').map((p) => p.trim()).filter(Boolean);
      for (const part of parts) {
        const sos = await adminOdooClient._callObject('sale.order', 'search_read', [
          [['name', '=', part], ['state', '!=', 'cancel']]
        ], { fields: ['id', 'name'], limit: 1 });
        if (sos && sos.length > 0) {
          resolvedSo = { id: sos[0].id, name: sos[0].name };
          break;
        }
      }
    }

    // 4. Parent MO in origin (Turunan Grade B, Sisa Makloon, Pecahan, etc.)
    if (!resolvedSo && mo.origin) {
      const moMatches = mo.origin.match(/([A-Z0-9]+(?:\/[A-Z0-9]+)+\/\d+(?:-\d+)?)/g);
      if (moMatches) {
        for (const pMoName of moMatches) {
          if (pMoName === mo.name) continue;
          const parentMos = await adminOdooClient._callObject('mrp.production', 'search_read', [
            [['name', '=', pMoName]]
          ], { fields: ['id', 'name', 'x_studio_sales_order', 'origin', 'sale_line_id'], limit: 1 });
          if (parentMos && parentMos.length > 0) {
            const pMo = parentMos[0];
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
      return resolvedSo;
    }

    return null;
  } catch (err) {
    console.warn(`[WipSyncService] Warning resolving SO for MO #${moId}: ${err.message}`);
    return null;
  }
}

