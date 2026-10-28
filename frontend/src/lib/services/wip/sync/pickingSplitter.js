import { adminOdooClient } from '../../../odoo/odooClient.js';
import { transferService } from '../../transferService.js';

/**
 * Ensures all component & finished-goods transfers (PC/SPB/SFP) for an MO are dedicated 1:1 to this MO.
 * Delegates multi-MO splitting to the unified lock-protected `transferService.resolveTransferMoAndSo`
 * so `mo-confirmed` and `transfer-mo-reference` never race or create empty draft shells.
 */
export async function ensureDedicatedComponentPickings(moId, { preloadedMo = null } = {}) {
  try {
    const id = Number(moId);
    if (!id || isNaN(id)) return { splitOccurred: false };

    await adminOdooClient.authenticate();
    let mo = preloadedMo;
    if (!mo || !Array.isArray(mo.picking_ids)) {
      const mos = await adminOdooClient._callObject('mrp.production', 'read', [[id]], {
        fields: ['id', 'name', 'picking_ids']
      });
      if (!mos || !mos[0]) return { splitOccurred: false };
      mo = mos[0];
    }

    const pickingIds = mo.picking_ids || [];
    if (pickingIds.length === 0) return { splitOccurred: false, pickings: [] };

    const pickings = await adminOdooClient._callObject('stock.picking', 'read', [pickingIds], {
      fields: [
        'id', 'name', 'picking_type_id', 'state', 'move_ids', 'origin',
        'location_id', 'location_dest_id', 'create_uid'
      ]
    });

    const candidateSharedIds = (pickings || [])
      .filter((pick) => {
        if (pick.state === 'done' || pick.state === 'cancel') return false;
        const pName = (pick.name || '').toUpperCase();
        if (!pName.includes('/PC/') && !pName.includes('/SPB/') && !pName.includes('/SFP/')) return false;
        if (!pick.move_ids || pick.move_ids.length <= 1) return false;
        const isBotCreated = pick.create_uid && (
          Array.isArray(pick.create_uid) ? pick.create_uid[0] === 7 : pick.create_uid === 7
        );
        return !isBotCreated;
      })
      .map((pick) => pick.id);

    if (candidateSharedIds.length === 0) {
      return { splitOccurred: false, pickings };
    }

    const res = await transferService.resolveTransferMoAndSo(candidateSharedIds);
    const splitOccurred = Boolean(
      res?.results?.some((r) => r.action === 'auto_split' && r.createdPickingsCount > 0)
    );

    if (splitOccurred) {
      // Re-read updated MO pickings after split so downstream sync sees dedicated transfers
      const refreshedMos = await adminOdooClient._callObject('mrp.production', 'read', [[id]], {
        fields: ['picking_ids']
      });
      const refreshedIds = refreshedMos?.[0]?.picking_ids || pickingIds;
      const refreshedPickings = refreshedIds.length > 0
        ? await adminOdooClient._callObject('stock.picking', 'read', [refreshedIds], {
            fields: ['id', 'name', 'picking_type_id', 'state', 'move_ids', 'origin', 'location_id', 'location_dest_id']
          })
        : [];
      return { splitOccurred: true, pickings: refreshedPickings };
    }

    return { splitOccurred: false, pickings };
  } catch (splitErr) {
    console.warn(`[WipSyncService] Warning in ensureDedicatedComponentPickings for MO #${moId}:`, splitErr.message);
    return { splitOccurred: false };
  }
}
