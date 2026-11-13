import { adminOdooClient } from '../../../odoo/odooClient.js';
import { wipRepo } from '../../wipRepository.js';
import { withWipLock } from '../wipLock.js';
import { resolveSalesOrderForMo } from './soMoResolver.js';
import { ensureDedicatedComponentPickings } from './pickingSplitter.js';
import { syncWipFromPickings } from './singlePassCompute.js';
import { deriveSpkInduk, syncSpkIndukRecap } from './spkRecapSync.js';
import { syncPabrikRecapForMo } from './pabrikRecapSync.js';

const FULL_MO_EVENT_FIELDS = [
  'id',
  'name',
  'state',
  'origin',
  'sale_line_id',
  'x_studio_sales_order',
  'x_studio_origin_mo',
  'product_id',
  'product_qty',
  'bom_id',
  'workorder_ids',
  'picking_ids',
  'production_group_id',
  'company_id',
  'warehouse_id',
  'picking_type_id',
  'x_studio_approval_request',
  'date_start',
  'date_deadline'
];

export function isVendorMoRecord(mo) {
  const moName = (mo.name || '').trim();
  const ptName = (mo.picking_type_id && mo.picking_type_id[1]) ? mo.picking_type_id[1].toUpperCase() : '';
  const whName = (mo.warehouse_id && mo.warehouse_id[1]) ? mo.warehouse_id[1].toUpperCase() : '';
  return ptName.includes('VENDOR') || whName.includes('VENDOR') || moName.startsWith('VD');
}

export function isPabrikMoRecord(mo) {
  const moName = (mo.name || '').trim().toUpperCase();
  const ptName = (mo.picking_type_id && mo.picking_type_id[1]) ? mo.picking_type_id[1].toUpperCase() : '';
  const whName = (mo.warehouse_id && mo.warehouse_id[1]) ? mo.warehouse_id[1].toUpperCase() : '';
  return ptName.includes('PABRIK') || whName.includes('PABRIK') || moName.startsWith('PB') || Boolean(mo.x_studio_approval_request);
}

/**
 * 1. Triggered when Manufacturing Order is Confirmed.
 * Reads MO ONCE, filters non-vendor MOs immediately (1 RPC call vs 6+ wasted calls),
 * and passes preloaded MO + workcenters downstream to eliminate redundant reads.
 */
export async function onMoConfirmed(moId, { autoSync = true, preloadedMo = null } = {}) {
  await adminOdooClient.authenticate();
  const id = Number(moId);
  if (!id || isNaN(id)) {
    throw new Error(`Invalid MO ID: ${moId}`);
  }

  return withWipLock(`mo_${id}`, async () => {
    let mo = preloadedMo;
    if (!mo || mo.bom_id === undefined) {
      const mos = await adminOdooClient._callObject('mrp.production', 'read', [[id]], {
        fields: FULL_MO_EVENT_FIELDS
      });
      if (!mos || mos.length === 0) {
        throw new Error(`Manufacturing Order #${id} not found in Odoo`);
      }
      mo = mos[0];
    }

    // Fast exit or route to Pabrik if this is not a vendor MO!
    if (!isVendorMoRecord(mo)) {
      if (isPabrikMoRecord(mo)) {
        const pabrikRes = await syncPabrikRecapForMo(id, { preloadedMo: mo }).catch((err) => {
          console.warn(`[WipSyncService] Non-fatal Pabrik recap sync warning for MO #${id}:`, err.message);
          return null;
        });
        return { success: true, pabrik: true, pabrikRes };
      }
      const ptName = (mo.picking_type_id && mo.picking_type_id[1]) ? mo.picking_type_id[1] : 'Internal';
      return { success: true, skipped: true, reason: `Non-vendor operation type: ${ptName}` };
    }

    // Resolve SO (reusing preloaded mo) & check existing WIP in parallel
    const [, existingWips] = await Promise.all([
      resolveSalesOrderForMo(id, { preloadedMo: mo }),
      adminOdooClient._callObject('x_monitoring_wip_vendo', 'search_read', [
        [['x_studio_manufacturing_order', '=', id]]
      ], { fields: ['id', 'x_name'], limit: 1 })
    ]);

    if (existingWips && existingWips.length > 0) {
      await ensureDedicatedComponentPickings(id, { preloadedMo: mo });
      return { success: true, alreadyExists: true, wipId: existingWips[0].id };
    }

    const moName = mo.name || `MO#${id}`;

    // Fetch BoM lines and Workorders in parallel (1 round-trip instead of 2)
    const [bomLines, workorders] = await Promise.all([
      mo.bom_id && mo.bom_id[0]
        ? adminOdooClient._callObject('mrp.bom.line', 'search_read', [
            [['bom_id', '=', mo.bom_id[0]]]
          ], { fields: ['id', 'product_id', 'product_qty'] }).catch(() => [])
        : Promise.resolve([]),
      mo.workorder_ids && mo.workorder_ids.length > 0
        ? adminOdooClient._callObject('mrp.workorder', 'read', [
            mo.workorder_ids,
            ['workcenter_id']
          ]).catch(() => [])
        : Promise.resolve([])
    ]);

    let consumptionPerPcs = 0.0;
    if (bomLines && bomLines.length > 0) {
      const clothLine = bomLines.find((bl) => bl.product_id && bl.product_id[1] && bl.product_id[1].toUpperCase().includes('KAIN')) || bomLines[0];
      consumptionPerPcs = parseFloat(clothLine.product_qty) || 0.0;
    }

    const qtyKebutuhanKain = (parseFloat(mo.product_qty) || 0.0) * consumptionPerPcs;
    const workcenterIds = [...new Set((workorders || []).filter((wo) => wo.workcenter_id).map((wo) => wo.workcenter_id[0]))];

    const spkInduk = deriveSpkInduk(moName);
    const newWipPayload = {
      x_name: moName,
      x_studio_spk_induk: spkInduk,
      x_studio_estimasi_spb_rekap: 0.0,
      x_studio_persentase_susut: 0.0,
      x_studio_manufacturing_order: id,
      x_studio_qty_kebutuhan_kain: qtyKebutuhanKain,
      x_studio_status_produksi: 'Proses'
    };

    if (workcenterIds.length > 0) {
      newWipPayload.x_studio_many2many_field_869_1k3jdrdl1 = [[6, 0, workcenterIds]];
    }

    const newWipId = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'create', [newWipPayload]);
    const splitResult = await ensureDedicatedComponentPickings(id, { preloadedMo: mo });

    if (autoSync && mo.picking_ids && mo.picking_ids.length > 0) {
      try {
        // Only force fresh MO read if a split actually added new pickings to the MO
        await syncWipFromPickings(newWipId, id, {
          preloadedMo: splitResult?.splitOccurred ? null : mo,
          preloadedWorkcenterIds: workcenterIds
        });
      } catch (syncErr) {
        console.warn(`[WipSyncService] Post-creation sync warning for WIP #${newWipId}: ${syncErr.message}`);
      }
    } else {
      try {
        const whId = mo.warehouse_id ? mo.warehouse_id[0] : null;
        const whNameStr = mo.warehouse_id ? mo.warehouse_id[1] : '';
        await wipRepo.upsertWipOrder({
          odoo_wip_id: newWipId,
          odoo_mo_id: id,
          odoo_warehouse_id: whId,
          vendor_name: whNameStr,
          mo_name: moName,
          mo_state: mo.state || 'confirmed',
          product_name: mo.product_id ? mo.product_id[1] : null,
          qty_spk: parseFloat(mo.product_qty || 0),
          qty_kebutuhan_kain: qtyKebutuhanKain,
          status_produksi: 'Proses'
        });
      } catch (mErr) {
        console.warn(`[WipSyncService] Initial Supabase sync warning for WIP #${newWipId}: ${mErr.message}`);
      }
      if (autoSync && spkInduk && spkInduk !== moName) {
        await syncSpkIndukRecap(spkInduk).catch((recapErr) => {
          console.warn(`[WipSyncService] Non-fatal family recap sync warning for ${spkInduk}:`, recapErr.message);
        });
      }
    }

    return {
      success: true,
      wipId: newWipId,
      moId: id,
      moName
    };
  });
}

/**
 * 2. Triggered when Transfer (/PC/, /SPB/, /SFP/) is Done
 */
export async function onTransferDone(pickingId) {
  await adminOdooClient.authenticate();
  const id = Number(pickingId);
  if (!id || isNaN(id)) {
    throw new Error(`Invalid Picking ID: ${pickingId}`);
  }

  const pickings = await adminOdooClient._callObject('stock.picking', 'read', [[id]], {
    fields: ['id', 'name', 'origin', 'state', 'x_studio_manufacturing_order', 'reference_ids', 'company_id', 'picking_type_id']
  });

  if (!pickings || pickings.length === 0) {
    return { success: false, notFound: true };
  }

  const picking = pickings[0];
  const pickingName = picking.name || '';
  const ptName = (picking.picking_type_id && picking.picking_type_id[1]) ? picking.picking_type_id[1].toUpperCase() : '';

  const isRelevantCode = ['/PC/', '/SPB/', '/SFP/'].some((code) => pickingName.includes(code));
  const isVendorTransfer = ptName.includes('VENDOR') || pickingName.startsWith('VD');
  const isPabrikTransfer = ptName.includes('PABRIK') || pickingName.startsWith('PB');

  if (!isRelevantCode || (!isVendorTransfer && !isPabrikTransfer)) {
    return { success: true, skipped: true, reason: 'Not a vendor or pabrik PC/SPB/SFP transfer' };
  }

  let moIds = [];
  if (pickingName.includes('/SFP/')) {
    if (picking.origin) {
      const origins = picking.origin.split(',').map((s) => s.trim()).filter(Boolean);
      const mos = await adminOdooClient._callObject('mrp.production', 'search_read', [
        [['name', 'in', origins]]
      ], { fields: ['id', 'name'] });
      if (mos && mos.length > 0) {
        moIds.push(...mos.map((m) => m.id));
      }
    }

    try {
      const pMoveLines = await adminOdooClient._callObject('stock.move.line', 'search_read', [
        [['picking_id', '=', id]],
        ['id', 'x_studio_manufacturing_order', 'origin']
      ]);
      const extraOrigins = [];
      for (const ml of pMoveLines || []) {
        if (Array.isArray(ml.x_studio_manufacturing_order)) {
          moIds.push(ml.x_studio_manufacturing_order[0]);
        }
        if (ml.origin && ml.origin.includes('/MO/')) {
          extraOrigins.push(ml.origin.trim());
        }
      }
      if (extraOrigins.length > 0) {
        const extraMos = await adminOdooClient._callObject('mrp.production', 'search_read', [
          [['name', 'in', [...new Set(extraOrigins)]]]
        ], { fields: ['id', 'name'] });
        if (extraMos && extraMos.length > 0) {
          moIds.push(...extraMos.map((m) => m.id));
        }
      }
    } catch (errMl) {
      console.warn(`[WipSyncService] Non-fatal move line MO lookup error: ${errMl.message}`);
    }
  }

  if (moIds.length === 0 && picking.x_studio_manufacturing_order) {
    moIds.push(picking.x_studio_manufacturing_order[0]);
  }

  if (moIds.length === 0 && picking.reference_ids && picking.reference_ids.length > 0) {
    const refMos = await adminOdooClient._callObject('mrp.production', 'search_read', [
      [['reference_ids', 'in', picking.reference_ids]]
    ], { fields: ['id', 'name'] });
    moIds.push(...refMos.map((m) => m.id));
  }

  moIds = [...new Set(moIds)];

  if (moIds.length === 0) {
    return { success: true, skipped: true, reason: 'No linked MO found' };
  }

  if (isPabrikTransfer) {
    const pabrikSynced = [];
    for (const mId of moIds) {
      const pRes = await syncPabrikRecapForMo(mId).catch((err) => {
        console.warn(`[WipSyncService] Non-fatal Pabrik transfer sync warning for MO #${mId}:`, err.message);
        return null;
      });
      if (pRes) pabrikSynced.push(pRes);
    }
    return {
      success: true,
      pabrik: true,
      pickingId: id,
      pickingName,
      pabrikSynced
    };
  }

  // Read full MO fields once so downstream syncWipFromPickings / onMoConfirmed don't re-read MOs!
  const targetMos = await adminOdooClient._callObject('mrp.production', 'read', [
    moIds,
    FULL_MO_EVENT_FIELDS
  ]);

  const vendorMosById = new Map();
  for (const m of targetMos || []) {
    if (isVendorMoRecord(m)) {
      vendorMosById.set(m.id, m);
    }
  }

  const vendorMoIds = Array.from(vendorMosById.keys());
  if (vendorMoIds.length === 0) {
    return { success: true, skipped: true, reason: 'No vendor MO found' };
  }

  // Batch lookup all existing WIPs for vendorMoIds in ONE single search_read instead of N queries!
  const existingWips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search_read', [
    [['x_studio_manufacturing_order', 'in', vendorMoIds]]
  ], { fields: ['id', 'x_name', 'x_studio_manufacturing_order'] });

  const wipIdByMoId = new Map();
  for (const w of existingWips || []) {
    if (w.x_studio_manufacturing_order) {
      wipIdByMoId.set(w.x_studio_manufacturing_order[0], w.id);
    }
  }

  const syncedWips = [];
  for (const moId of vendorMoIds) {
    const moRecord = vendorMosById.get(moId);
    let wipId = wipIdByMoId.get(moId) || null;
    if (!wipId) {
      const created = await onMoConfirmed(moId, { autoSync: false, preloadedMo: moRecord });
      if (created && created.wipId) {
        wipId = created.wipId;
      }
    }

    if (wipId) {
      const syncRes = await syncWipFromPickings(wipId, moId, {
        preloadedMo: moRecord,
        skipFamilyRecap: true
      });
      syncedWips.push(syncRes);
    }
  }

  const impactedInduks = [...new Set(syncedWips.map((s) => s?.spkInduk).filter(Boolean))];
  for (const spkInduk of impactedInduks) {
    await syncSpkIndukRecap(spkInduk).catch((recapErr) => {
      console.warn(`[WipSyncService] Non-fatal family recap sync warning for ${spkInduk}:`, recapErr.message);
    });
  }

  return {
    success: true,
    pickingId: id,
    pickingName,
    syncedWips
  };
}
