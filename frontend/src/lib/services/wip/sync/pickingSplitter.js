import { adminOdooClient } from '../../../odoo/odooClient.js';
import { transfersCache } from '../wipCache.js';
import { transferService } from '../../transferService.js';
import { resolveSalesOrderForMo } from './soMoResolver.js';

const NO_TRACK_CTX = { tracking_disable: true, no_automation: true, mail_auto_delete: true };

/**
 * Ensures all component transfers (PC/SPB/SFP) for an MO are dedicated 1:1 to this MO.
 * Accepts optional `preloadedMo` to eliminate redundant mrp.production reads.
 */
export async function ensureDedicatedComponentPickings(moId, { preloadedMo = null } = {}) {
  try {
    const id = Number(moId);
    if (!id || isNaN(id)) return { splitOccurred: false };

    await adminOdooClient.authenticate();
    let mo = preloadedMo;
    if (!mo || !Array.isArray(mo.picking_ids)) {
      const mos = await adminOdooClient._callObject('mrp.production', 'read', [[id]], {
        fields: ['id', 'name', 'picking_ids', 'production_group_id', 'origin', 'company_id']
      });
      if (!mos || !mos[0]) return { splitOccurred: false };
      mo = mos[0];
    }

    const pickingIds = mo.picking_ids || [];
    if (pickingIds.length === 0) return { splitOccurred: false };

    const pickings = await adminOdooClient._callObject('stock.picking', 'read', [pickingIds], {
      fields: [
        'id', 'name', 'picking_type_id', 'state', 'move_ids', 'origin', 'location_id',
        'location_dest_id', 'move_type', 'company_id', 'scheduled_date', 'date_deadline',
        'note', 'x_studio_sales_order', 'x_studio_source_warehouse', 'x_studio_destination_warehouse', 'create_uid'
      ]
    });

    let splitOccurred = false;

    for (const pick of pickings) {
      if (pick.state === 'done' || pick.state === 'cancel') continue;
      const pName = (pick.name || '').toUpperCase();
      if (!pName.includes('/PC/') && !pName.includes('/SPB/') && !pName.includes('/SFP/')) continue;
      if (!pick.move_ids || pick.move_ids.length <= 1) continue; // Single-move picking cannot span multiple MOs!

      const isMasterAdmin = pick.create_uid && (
        Array.isArray(pick.create_uid) ? pick.create_uid[0] === 7 : pick.create_uid === 7
      );
      if (isMasterAdmin) continue;

      const isSfp = pName.includes('/SFP/');

      const moves = await adminOdooClient._callObject('stock.move', 'read', [pick.move_ids], {
        fields: ['id', 'product_id', 'product_uom_qty', 'state', 'production_group_id', 'raw_material_production_id', 'move_line_ids', 'origin', 'move_orig_ids', 'production_id']
      });

      const allOrigMoveIds = [...new Set(moves.flatMap((m) => m.move_orig_ids || []))];
      const origMovesMap = new Map();
      if (allOrigMoveIds.length > 0) {
        try {
          const origMoves = await adminOdooClient._callObject('stock.move', 'read', [
            allOrigMoveIds,
            ['id', 'raw_material_production_id', 'production_id', 'production_group_id', 'origin']
          ]);
          origMoves.forEach((om) => origMovesMap.set(om.id, om));
        } catch {}
      }

      const potentialMoveMoNames = [
        ...new Set([
          ...moves.map((m) => (m.origin || '').trim()).filter((o) => o.includes('/MO/')),
          ...Array.from(origMovesMap.values()).map((om) => (om.origin || '').trim()).filter((o) => o.includes('/MO/'))
        ])
      ];
      const groupIds = [
        ...new Set([
          ...moves.filter((m) => m.production_group_id && m.production_group_id[0]).map((m) => m.production_group_id[0]),
          ...Array.from(origMovesMap.values()).filter((om) => om.production_group_id && om.production_group_id[0]).map((om) => om.production_group_id[0])
        ])
      ];

      // Fetch origin MOs and production groups in parallel
      const [mosByOrigin, groups] = await Promise.all([
        potentialMoveMoNames.length > 0
          ? adminOdooClient._callObject('mrp.production', 'search_read', [
              [['name', 'in', potentialMoveMoNames]]
            ], { fields: ['id', 'name'] }).catch(() => [])
          : Promise.resolve([]),
        groupIds.length > 0
          ? adminOdooClient._callObject('mrp.production.group', 'read', [groupIds], {
              fields: ['id', 'name', 'production_ids']
            }).catch(() => [])
          : Promise.resolve([])
      ]);

      const moNameMap = new Map((mosByOrigin || []).map((m) => [m.name, m]));
      const prodGroupMap = new Map((groups || []).map((g) => [g.id, g]));

      const movesByMo = new Map();
      for (const m of moves) {
        let mMoId = null;

        if (m.raw_material_production_id && m.raw_material_production_id[0]) {
          mMoId = m.raw_material_production_id[0];
        }
        if (!mMoId && m.production_id && m.production_id[0]) {
          mMoId = m.production_id[0];
        }
        if (!mMoId && m.move_orig_ids && m.move_orig_ids.length > 0) {
          for (const omId of m.move_orig_ids) {
            const om = origMovesMap.get(omId);
            if (om && om.production_id && om.production_id[0]) {
              mMoId = om.production_id[0];
              break;
            }
          }
        }
        if (!mMoId && m.origin) {
          const origTrimmed = m.origin.trim();
          if (origTrimmed === mo.name) {
            mMoId = id;
          } else if (moNameMap.has(origTrimmed)) {
            mMoId = moNameMap.get(origTrimmed).id;
          }
        }
        if (!mMoId && m.move_orig_ids && m.move_orig_ids.length > 0) {
          for (const omId of m.move_orig_ids) {
            const om = origMovesMap.get(omId);
            const omOrig = (om && om.origin ? om.origin : '').trim();
            if (omOrig && moNameMap.has(omOrig)) {
              mMoId = moNameMap.get(omOrig).id;
              break;
            }
          }
        }
        if (!mMoId && !isSfp && m.production_group_id && m.production_group_id[0]) {
          const g = prodGroupMap.get(m.production_group_id[0]);
          if (g && g.production_ids && g.production_ids.length === 1) {
            mMoId = typeof g.production_ids[0] === 'object' ? g.production_ids[0].id : g.production_ids[0];
          }
        }

        const key = mMoId || 'unassigned';
        if (!movesByMo.has(key)) {
          movesByMo.set(key, []);
        }
        movesByMo.get(key).push(m);
      }

      const entries = Array.from(movesByMo.entries()).filter(([k, list]) => k !== 'unassigned' && list && list.length > 0);
      if (entries.length <= 1) continue;

      splitOccurred = true;
      console.log(`[WipSyncService] Shared picking ${pick.name} (#${pick.id}) contains moves for ${entries.length} MOs. Splitting into 1 document per MO...`);

      const [firstMoIdKey, firstMoves] = entries[0];
      const firstMoId = Number(firstMoIdKey);
      if (!firstMoves || firstMoves.length === 0) continue;

      const allMoIds = entries.map(([k]) => Number(k)).filter(Boolean);
      const moInfoMap = new Map();
      try {
        const moList = await adminOdooClient._callObject('mrp.production', 'read', [allMoIds], {
          fields: ['id', 'name', 'origin', 'sale_line_id', 'x_studio_sales_order', 'x_studio_origin_mo']
        });
        moList.forEach((item) => moInfoMap.set(item.id, item));
      } catch {}

      const firstMoObj = moInfoMap.get(firstMoId);
      const firstMoName = firstMoObj?.name || `MO#${firstMoId}`;
      const firstMoSo = await resolveSalesOrderForMo(firstMoId, { preloadedMo: firstMoObj });
      const firstPickVals = {
        origin: firstMoName,
        x_studio_manufacturing_order: firstMoId
      };
      if (firstMoSo) {
        firstPickVals.x_studio_sales_order = firstMoSo.id;
      }
      await adminOdooClient._callObject('stock.picking', 'write', [[pick.id], firstPickVals], { context: NO_TRACK_CTX });
      transfersCache.delete(firstMoId);

      const createdPickIds = [];

      // Preload existing WIP records for all split MOs in 1 query instead of N queries
      const targetMoIdsForWip = entries.slice(1).map(([k]) => Number(k)).filter(Boolean);
      const wipByMoId = new Map();
      if (targetMoIdsForWip.length > 0) {
        try {
          const targetWips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search_read', [
            [['x_studio_manufacturing_order', 'in', targetMoIdsForWip]]
          ], { fields: ['id', 'x_studio_manufacturing_order'] });
          for (const tw of targetWips || []) {
            if (tw.x_studio_manufacturing_order) {
              wipByMoId.set(tw.x_studio_manufacturing_order[0], tw.id);
            }
          }
        } catch {}
      }

      for (let i = 1; i < entries.length; i++) {
        const [targetMoIdKey, targetMoves] = entries[i];
        if (!targetMoves || targetMoves.length === 0) continue;

        const targetMoId = Number(targetMoIdKey);
        const targetMoObj = moInfoMap.get(targetMoId);
        const targetMoName = targetMoObj?.name || `MO#${targetMoId}`;
        const targetMoSo = await resolveSalesOrderForMo(targetMoId, { preloadedMo: targetMoObj });
        const targetMoveIds = targetMoves.map((m) => m.id);
        const targetMoveLineIds = targetMoves.flatMap((m) => m.move_line_ids || []);

        const newPickPayload = {
          picking_type_id: pick.picking_type_id ? pick.picking_type_id[0] : (isSfp ? 384 : 383),
          location_id: pick.location_id ? pick.location_id[0] : (isSfp ? 284 : 8),
          location_dest_id: pick.location_dest_id ? pick.location_dest_id[0] : (isSfp ? 8 : 284),
          move_type: pick.move_type || 'direct',
          origin: targetMoName,
          company_id: pick.company_id ? pick.company_id[0] : 1,
          scheduled_date: pick.scheduled_date,
          date_deadline: pick.date_deadline,
          x_studio_manufacturing_order: targetMoId,
          x_studio_manufacturing_orders: targetMoName,
          x_studio_sales_order: targetMoSo ? targetMoSo.id : (pick.x_studio_sales_order ? pick.x_studio_sales_order[0] : false),
          x_studio_source_warehouse: pick.x_studio_source_warehouse,
          x_studio_destination_warehouse: pick.x_studio_destination_warehouse,
          note: pick.note
        };

        const newPickId = await adminOdooClient._callObject('stock.picking', 'create', [newPickPayload], {
          context: NO_TRACK_CTX
        });
        createdPickIds.push(newPickId);

        await adminOdooClient._callObject('stock.move', 'write', [
          targetMoveIds,
          { picking_id: newPickId }
        ], { context: NO_TRACK_CTX });

        if (targetMoveLineIds.length > 0) {
          await adminOdooClient._callObject('stock.move.line', 'write', [
            targetMoveLineIds,
            { picking_id: newPickId }
          ], { context: NO_TRACK_CTX });
        }

        const linkedWipId = wipByMoId.get(targetMoId);
        if (linkedWipId) {
          await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [
            [linkedWipId],
            { x_studio_daftar_transfer: [[6, 0, [newPickId]]] }
          ], { context: NO_TRACK_CTX });
        }

        transfersCache.delete(targetMoId);
        console.log(`[WipSyncService] Created dedicated picking #${newPickId} for MO #${targetMoId} (${targetMoName}) with ${targetMoveIds.length} move(s)`);
      }

      try {
        await transferService.resolveTransferMoAndSo([pick.id, ...createdPickIds]);
      } catch (errSyncRefs) {
        console.warn(`[WipSyncService] Transfer reference resolution warning: ${errSyncRefs.message}`);
      }
    }

    return { splitOccurred, pickings };
  } catch (splitErr) {
    console.warn(`[WipSyncService] Warning in ensureDedicatedComponentPickings for MO #${moId}:`, splitErr.message);
    return { splitOccurred: false };
  }
}
