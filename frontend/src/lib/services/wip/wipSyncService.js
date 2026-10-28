import { supabaseServer } from '../../supabaseServer.js';
import { adminOdooClient } from '../../odoo/odooClient.js';
import { wipRepo } from '../wipRepository.js';
import { rawMovesCache, transfersCache, invalidateOrderCache } from './wipCache.js';
import { withWipLock } from './wipLock.js';
import { getOrderDetails } from './wipQueryService.js';
import { transferService } from '../transferService.js';
import { classifyMaterialLine } from '../../utils/materialClassifier.js';

/**
 * Helper: Fetch current pricing from x_vendor_production in Odoo
 */
export async function fetchVendorPriceFromOdoo(warehouseId, productId, workcenterIds = []) {
  await adminOdooClient.authenticate();
  if (!warehouseId || !productId) return 0.0;

  try {
    const vendorPrices = await adminOdooClient._callObject('x_vendor_production', 'search_read', [
      [
        ['x_studio_warehouse', '=', warehouseId],
        ['x_studio_product', '=', productId]
      ]
    ], { fields: ['id', 'x_studio_value', 'x_studio_many2many_field_7h1_1k3jdkeub'], order: 'id desc' });

    if (!vendorPrices || vendorPrices.length === 0) return 0.0;

    if (workcenterIds.length > 0) {
      const targetWcSet = new Set(workcenterIds);
      const matched = vendorPrices.find(vp => {
        const vpWcIds = vp.x_studio_many2many_field_7h1_1k3jdkeub || [];
        if (vpWcIds.length !== targetWcSet.size) return false;
        return vpWcIds.every(id => targetWcSet.has(id));
      });
      if (matched && matched.x_studio_value !== undefined) {
        return parseFloat(matched.x_studio_value) || 0.0;
      }
    }

    return parseFloat(vendorPrices[0].x_studio_value) || 0.0;
  } catch (err) {
    console.warn(`[WipSyncService] fetchVendorPriceFromOdoo error: ${err.message}`);
    return 0.0;
  }
}

/**
 * Helper: Mapping finishing selection value to display label
 */
export const FINISHING_LABELS = {
  'NECI': 'NECI HALUS',
  'NECI GROSIR': 'NECI GROSIR',
  'LASERCUT': 'LASERCUT',
  'RAWIS': 'RAWIS',
  'SONIC': 'SONIC',
  'STIK': 'STIK',
  'PICOT': 'PICOT',
  'EYELASH': 'EYELASH',
  'OVERDECK': 'OVERDECK',
  'PITA': 'PITA',
  'PASHMINA SINGLE STIK': 'PASHMINA SINGLE STIK',
  'DOUBLE STIK': 'PASHMINA DOUBLE STIK',
  'CUSTOM': 'CUSTOM'
};

export function resolveFinishing(val) {
  if (!val) return null;
  return FINISHING_LABELS[val] || val;
}

const WIP_ODOO_SYNC_FIELDS = [
  'id', 'x_name', 'x_studio_manufacturing_order', 'x_studio_warehouse',
  'x_studio_product', 'x_studio_consumption_per_pcs_1', 'x_studio_unit_consumption_per_pcs',
  'x_studio_qty_kebutuhan_kain', 'x_studio_kain_dari_gudang_qty', 'x_studio_unit_kain_dari_gudang',
  'x_studio_accessories_dari_gudang', 'x_studio_estimasi_dari_spb', 'x_studio_status_kebutuhan_kain',
  'x_studio_actual_cutting', 'x_studio_selisih_hasil_cutting',
  'x_studio_qty_kirim_a_grade', 'x_studio_qty_kirim_b_grade', 'x_studio_sisa_makloon_kg',
  'x_studio_sisa_potong_panjang', 'x_studio_sisa_potong_sedang', 'x_studio_sisa_potong_pendek',
  'x_studio_no_surat_jalan_sfp', 'x_studio_tanggal_sfp', 'x_studio_qty_masuk_sfp',
  'x_studio_qty_spk', 'x_studio_start_spk', 'x_studio_deadline_spk', 'x_studio_sales_order',
  'x_studio_harga', 'x_studio_total_harga', 'x_studio_status_produksi', 'x_studio_detail_roll_kain',
  'x_studio_related_field_77l_1k5rj70p4', 'x_studio_related_field_52c_1k5rj7ik0',
  'x_studio_qc_pass_1', 'x_studio_qty_qc_pass_1', 'x_studio_qc_status',
  'x_studio_keterangan_qms', 'x_studio_gambar_qc',
  'write_date'
];

function mapOdooWipToDbPayload(w, overrides = {}) {
  const cVal = w.x_studio_consumption_per_pcs_1 !== undefined && w.x_studio_consumption_per_pcs_1 !== false
    ? Number(w.x_studio_consumption_per_pcs_1)
    : null;
  const cUom = w.x_studio_unit_consumption_per_pcs
    ? (Array.isArray(w.x_studio_unit_consumption_per_pcs) ? w.x_studio_unit_consumption_per_pcs[1] : String(w.x_studio_unit_consumption_per_pcs))
    : null;

  const moId = overrides.odoo_mo_id !== undefined
    ? overrides.odoo_mo_id
    : (w.x_studio_manufacturing_order ? w.x_studio_manufacturing_order[0] : 0);
  const whId = overrides.odoo_warehouse_id !== undefined
    ? overrides.odoo_warehouse_id
    : (w.x_studio_warehouse ? w.x_studio_warehouse[0] : 0);
  const whName = overrides.vendor_name !== undefined
    ? overrides.vendor_name
    : (w.x_studio_warehouse ? w.x_studio_warehouse[1] : 'Unknown');

  const defaultSalesOrder = w.x_studio_sales_order
    ? (Array.isArray(w.x_studio_sales_order) ? w.x_studio_sales_order[1] : String(w.x_studio_sales_order))
    : null;

  return {
    odoo_wip_id: w.id,
    odoo_mo_id: moId,
    odoo_warehouse_id: whId,
    vendor_name: whName,
    mo_name: overrides.mo_name || w.x_name || `WIP#${w.id}`,
    mo_state: overrides.mo_state || 'confirmed',
    sales_order: overrides.sales_order !== undefined ? overrides.sales_order : defaultSalesOrder,
    product_name: w.x_studio_product ? w.x_studio_product[1] : (overrides.product_name || '-'),
    qty_spk: overrides.qty_spk !== undefined ? overrides.qty_spk : Number(w.x_studio_qty_spk || 0),
    start_spk: overrides.start_spk !== undefined ? overrides.start_spk : (w.x_studio_start_spk || null),
    deadline_spk: overrides.deadline_spk !== undefined ? overrides.deadline_spk : (w.x_studio_deadline_spk || null),
    qty_kebutuhan_kain: Number(w.x_studio_qty_kebutuhan_kain || 0),
    kain_dari_gudang: Number(w.x_studio_kain_dari_gudang_qty || 0),
    unit_kain: w.x_studio_unit_kain_dari_gudang
      ? (Array.isArray(w.x_studio_unit_kain_dari_gudang) ? w.x_studio_unit_kain_dari_gudang[1] : w.x_studio_unit_kain_dari_gudang)
      : 'yard',
    consumption_per_pcs: cVal,
    consumption_uom: cUom,
    accessories_dari_gudang: Number(w.x_studio_accessories_dari_gudang || 0),
    estimasi_dari_spb: Number(w.x_studio_estimasi_dari_spb || 0),
    status_kebutuhan_kain: w.x_studio_status_kebutuhan_kain || 'Belum Terpenuhi',
    actual_cutting: overrides.actual_cutting !== undefined ? overrides.actual_cutting : Number(w.x_studio_actual_cutting || 0),
    selisih_hasil_cutting: overrides.selisih_hasil_cutting !== undefined ? overrides.selisih_hasil_cutting : Number(w.x_studio_selisih_hasil_cutting || 0),
    qty_grade_a: Number(w.x_studio_qty_kirim_a_grade || 0),
    qty_grade_b: Number(w.x_studio_qty_kirim_b_grade || 0),
    sisa_makloon_kg: Number(w.x_studio_sisa_makloon_kg || 0),
    sisa_potong_panjang: Number(w.x_studio_sisa_potong_panjang || 0),
    sisa_potong_sedang: Number(w.x_studio_sisa_potong_sedang || 0),
    sisa_potong_pendek: Number(w.x_studio_sisa_potong_pendek || 0),
    finishing: resolveFinishing(w.x_studio_related_field_77l_1k5rj70p4),
    packing: w.x_studio_related_field_52c_1k5rj7ik0 || null,
    qc_pass_id: w.x_studio_qc_pass_1 ? (Array.isArray(w.x_studio_qc_pass_1) ? w.x_studio_qc_pass_1[0] : w.x_studio_qc_pass_1) : null,
    qc_pass_name: w.x_studio_qc_pass_1 && Array.isArray(w.x_studio_qc_pass_1) ? w.x_studio_qc_pass_1[1] : null,
    qty_qc_pass: Number(w.x_studio_qty_qc_pass_1 || 0),
    qc_status: w.x_studio_qc_status || null,
    keterangan_qms: w.x_studio_keterangan_qms || null,
    has_gambar_qc: Boolean(w.x_studio_gambar_qc),
    no_surat_jalan_sfp: w.x_studio_no_surat_jalan_sfp || null,
    tanggal_sfp: w.x_studio_tanggal_sfp || null,
    qty_masuk_sfp: overrides.qty_masuk_sfp !== undefined ? overrides.qty_masuk_sfp : Number(w.x_studio_qty_masuk_sfp || 0),
    harga_vendor: overrides.harga_vendor !== undefined ? overrides.harga_vendor : Number(w.x_studio_harga || 0),
    total_harga: overrides.total_harga !== undefined ? overrides.total_harga : Number(w.x_studio_total_harga || 0),
    status_produksi: w.x_studio_status_produksi || 'Proses',
    odoo_write_date: w.write_date
  };
}

/**
 * Pull single order live from Odoo into Supabase
 */
export async function syncOrderFromOdoo({ user, orderId }) {
  const { order } = await getOrderDetails({ user, orderId, includeRawMoves: false });
  if (!order.odoo_wip_id) {
    throw new Error('Order tidak memiliki link Odoo WIP ID.');
  }

  await adminOdooClient.authenticate();
  const wips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[order.odoo_wip_id]], {
    fields: WIP_ODOO_SYNC_FIELDS,
    context: { bin_size: true }
  });

  if (!wips || wips.length === 0) {
    throw new Error(`Data WIP #${order.odoo_wip_id} tidak ditemukan di Odoo.`);
  }

  const w = wips[0];
  const moId = w.x_studio_manufacturing_order ? w.x_studio_manufacturing_order[0] : order.odoo_mo_id;

  // Read MO details
  let moState = order.mo_state;
  let moName = order.mo_name || w.x_name;
  let deadlineSpk = w.x_studio_deadline_spk || order.deadline_spk;
  let startSpk = w.x_studio_start_spk || order.start_spk;
  let qtySpk = Number(w.x_studio_qty_spk || order.qty_spk || 0);
  let salesOrder = w.x_studio_sales_order ? (Array.isArray(w.x_studio_sales_order) ? w.x_studio_sales_order[1] : String(w.x_studio_sales_order)) : order.sales_order;

  if (moId) {
    try {
      const mos = await adminOdooClient._callObject('mrp.production', 'read', [[moId]], {
        fields: ['id', 'name', 'state', 'date_planned_start', 'date_deadline', 'product_qty', 'sale_line_id', 'origin', 'x_studio_sales_order']
      });
      if (mos && mos[0]) {
        const m = mos[0];
        if (m.name) moName = m.name;
        moState = m.state || moState;
        if (!startSpk && m.date_planned_start) startSpk = m.date_planned_start.split(' ')[0];
        if (!deadlineSpk && m.date_deadline) deadlineSpk = m.date_deadline.split(' ')[0];
        if (!qtySpk && m.product_qty) qtySpk = Number(m.product_qty);
        if (!salesOrder && m.x_studio_sales_order) {
          salesOrder = Array.isArray(m.x_studio_sales_order) ? m.x_studio_sales_order[1] : String(m.x_studio_sales_order);
        }
      }
    } catch (e) {}
  }

  // If still no sales order, automatically resolve using resolveSalesOrderForMo
  if (!salesOrder && moId) {
    try {
      const resolved = await resolveSalesOrderForMo(moId);
      if (resolved && resolved.name) {
        salesOrder = resolved.name;
        if (w.id && resolved.id) {
          await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [
            [w.id],
            { x_studio_sales_order: resolved.id }
          ], { context: { tracking_disable: true, no_automation: true } }).catch(() => {});
        }
      }
    } catch (e) {}
  }

  const whId = w.x_studio_warehouse ? w.x_studio_warehouse[0] : null;
  const whName = w.x_studio_warehouse ? w.x_studio_warehouse[1] : 'Unknown';
  const prodId = w.x_studio_product ? w.x_studio_product[0] : null;

  let hargaVendor = Number(w.x_studio_harga || 0);
  let totalHarga = Number(w.x_studio_total_harga || 0);
  const qtyMasukSfp = Number(w.x_studio_qty_masuk_sfp || 0);

  // Auto-check pricing from Odoo if currently 0 and status is not 'Selesai' (Kombinasi A)
  const statusProduksi = (w.x_studio_status_produksi || '').trim().toLowerCase();
  if (hargaVendor === 0 && statusProduksi !== 'selesai' && whId && prodId) {
    try {
      const freshPrice = await fetchVendorPriceFromOdoo(whId, prodId);
      if (freshPrice > 0) {
        hargaVendor = freshPrice;
        totalHarga = hargaVendor * qtyMasukSfp;
        await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [
          [w.id],
          {
            x_studio_harga: hargaVendor,
            x_studio_total_harga: totalHarga
          }
        ], { context: { tracking_disable: true, no_automation: true } });
        console.log(`[WipSyncService] Auto-resolved vendor price for WIP #${w.id}: Rp ${hargaVendor} (Total: Rp ${totalHarga})`);
      }
    } catch (errPrice) {
      console.warn(`[WipSyncService] Note on auto-fetching vendor price: ${errPrice.message}`);
    }
  }

  // Preserve local actual_cutting if Odoo returned 0 while local SPK already recorded cutting
  const odooActualCutting = Number(w.x_studio_actual_cutting || 0);
  const preservedActualCutting = odooActualCutting > 0
    ? odooActualCutting
    : Number(order.actual_cutting || 0);
  const estimasiSpbVal = Number(w.x_studio_estimasi_dari_spb || 0);
  const preservedSelisihCutting = odooActualCutting > 0
    ? Number(w.x_studio_selisih_hasil_cutting || (odooActualCutting - estimasiSpbVal))
    : (preservedActualCutting > 0 ? preservedActualCutting - estimasiSpbVal : 0);

  await wipRepo.upsertWipOrder(mapOdooWipToDbPayload(w, {
    odoo_mo_id: moId,
    odoo_warehouse_id: whId,
    vendor_name: whName,
    mo_name: moName || w.x_name,
    mo_state: moState,
    sales_order: salesOrder,
    product_name: order.product_name,
    qty_spk: qtySpk,
    start_spk: startSpk,
    deadline_spk: deadlineSpk,
    actual_cutting: preservedActualCutting,
    selisih_hasil_cutting: preservedSelisihCutting,
    qty_masuk_sfp: qtyMasukSfp,
    harga_vendor: hargaVendor,
    total_harga: totalHarga
  }));

  // Sync roll lines if any
  if (w.x_studio_detail_roll_kain && w.x_studio_detail_roll_kain.length > 0) {
    const rolls = await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'read', [
      w.x_studio_detail_roll_kain,
      ['id', 'x_name', 'x_studio_kode_warna_roll', 'x_studio_yards', 'x_studio_uom', 'x_studio_qty_penerimaan', 'x_studio_qty_berat_kg']
    ]);
    await wipRepo.upsertRollLines(order.id, rolls);
  }

  // Invalidate caches
  invalidateOrderCache(order.odoo_mo_id, order.id);

  return getOrderDetails({ user, orderId, includeRawMoves: true });
}

/**
 * Pull all active WIPs from Odoo (Initial Sync)
 */
export async function syncAllFromOdoo() {
  await adminOdooClient.authenticate();
  console.log('[WipSyncService] Pulling active WIP records from Odoo...');

  const wipIds = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search', [
    [['x_name', '!=', false]]
  ], { limit: 100, order: 'id desc' });

  console.log(`[WipSyncService] Found ${wipIds.length} WIP records in Odoo. Processing...`);

  let syncedCount = 0;
  // Process in chunks of 20
  const chunkSize = 20;
  for (let i = 0; i < wipIds.length; i += chunkSize) {
    const chunk = wipIds.slice(i, i + chunkSize);
    const wips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [
      chunk,
      WIP_ODOO_SYNC_FIELDS
    ], { context: { bin_size: true } });

    // Batch-read all roll line IDs across this chunk in 1 XML-RPC call instead of 20 sequential calls
    const allRollIdsInChunk = Array.from(
      new Set(wips.flatMap((w) => w.x_studio_detail_roll_kain || []))
    );
    const rollsById = new Map();
    if (allRollIdsInChunk.length > 0) {
      try {
        const chunkRolls = await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'read', [
          allRollIdsInChunk,
          ['id', 'x_name', 'x_studio_kode_warna_roll', 'x_studio_yards', 'x_studio_uom', 'x_studio_qty_penerimaan', 'x_studio_qty_berat_kg']
        ]);
        for (const r of chunkRolls || []) {
          rollsById.set(r.id, r);
        }
      } catch (rollErr) {
        console.warn(`[WipSyncService] Batch roll read warning: ${rollErr.message}`);
      }
    }

    for (const w of wips) {
      try {
        const savedId = await wipRepo.upsertWipOrder(mapOdooWipToDbPayload(w));

        if (w.x_studio_detail_roll_kain && w.x_studio_detail_roll_kain.length > 0) {
          const rolls = w.x_studio_detail_roll_kain
            .map((rid) => rollsById.get(rid))
            .filter(Boolean);
          if (rolls.length > 0) {
            await wipRepo.upsertRollLines(savedId, rolls);
          }
        }

        syncedCount++;
      } catch (itemErr) {
        console.warn(`[WipSyncService] Skip WIP #${w.id}: ${itemErr.message}`);
      }
    }
  }

  return {
    success: true,
    totalSynced: syncedCount
  };
}

/**
 * Ensures all component transfers (PC/SPB) for an MO are dedicated 1:1 to this MO.
 * If Odoo grouped moves of multiple MOs into one picking, this function splits them
 * into 1 document per MO.
 */
export async function ensureDedicatedComponentPickings(moId) {
  try {
    const id = Number(moId);
    if (!id || isNaN(id)) return;

    await adminOdooClient.authenticate();
    const mos = await adminOdooClient._callObject('mrp.production', 'read', [[id]], {
      fields: ['id', 'name', 'picking_ids', 'production_group_id', 'origin', 'company_id']
    });
    if (!mos || !mos[0]) return;
    const mo = mos[0];
    const pickingIds = mo.picking_ids || [];
    if (pickingIds.length === 0) return;

    const pickings = await adminOdooClient._callObject('stock.picking', 'read', [pickingIds], {
      fields: [
        'id', 'name', 'picking_type_id', 'state', 'move_ids', 'origin', 'location_id',
        'location_dest_id', 'move_type', 'company_id', 'scheduled_date', 'date_deadline',
        'note', 'x_studio_sales_order', 'x_studio_source_warehouse', 'x_studio_destination_warehouse'
      ]
    });

    for (const pick of pickings) {
      if (pick.state === 'done' || pick.state === 'cancel') continue;
      const pName = (pick.name || '').toUpperCase();
      if (!pName.includes('/PC/') && !pName.includes('/SPB/') && !pName.includes('/SFP/')) continue;
      if (!pick.move_ids || pick.move_ids.length === 0) continue;

      const isMasterAdmin = pick.create_uid && (
        Array.isArray(pick.create_uid) ? pick.create_uid[0] === 7 : pick.create_uid === 7
      );
      if (isMasterAdmin) continue;

      const isSfp = pName.includes('/SFP/');

      const moves = await adminOdooClient._callObject('stock.move', 'read', [pick.move_ids], {
        fields: ['id', 'product_id', 'product_uom_qty', 'state', 'production_group_id', 'raw_material_production_id', 'move_line_ids', 'origin', 'move_orig_ids', 'production_id']
      });

      // Prefetch move_orig_ids if any moves have them (vital for SFP finished goods)
      const allOrigMoveIds = [...new Set(moves.flatMap(m => m.move_orig_ids || []))];
      const origMovesMap = new Map();
      if (allOrigMoveIds.length > 0) {
        try {
          const origMoves = await adminOdooClient._callObject('stock.move', 'read', [
            allOrigMoveIds,
            ['id', 'raw_material_production_id', 'production_id', 'production_group_id', 'origin']
          ]);
          origMoves.forEach(om => origMovesMap.set(om.id, om));
        } catch (e) {}
      }

      // Prefetch MOs matching move origins (e.g. "VDKWS/MO/05189-002")
      const potentialMoveMoNames = [
        ...new Set([
          ...moves.map(m => (m.origin || '').trim()).filter(o => o.includes('/MO/')),
          ...Array.from(origMovesMap.values()).map(om => (om.origin || '').trim()).filter(o => o.includes('/MO/'))
        ])
      ];
      const moNameMap = new Map();
      if (potentialMoveMoNames.length > 0) {
        try {
          const mosByOrigin = await adminOdooClient._callObject('mrp.production', 'search_read', [
            [['name', 'in', potentialMoveMoNames]]
          ], { fields: ['id', 'name'] });
          mosByOrigin.forEach(m => moNameMap.set(m.name, m));
        } catch (e) {}
      }

      // Find all distinct production groups across the moves
      const groupIds = [
        ...new Set([
          ...moves.filter(m => m.production_group_id && m.production_group_id[0]).map(m => m.production_group_id[0]),
          ...Array.from(origMovesMap.values()).filter(om => om.production_group_id && om.production_group_id[0]).map(om => om.production_group_id[0])
        ])
      ];
      const prodGroupMap = new Map();
      if (groupIds.length > 0) {
        try {
          const groups = await adminOdooClient._callObject('mrp.production.group', 'read', [groupIds], {
            fields: ['id', 'name', 'production_ids']
          });
          groups.forEach(g => prodGroupMap.set(g.id, g));
        } catch (e) {}
      }

      // Group moves by MO ID
      const movesByMo = new Map();
      for (const m of moves) {
        let mMoId = null;

        // 1. Direct raw material MO (PC/SPB components)
        if (m.raw_material_production_id && m.raw_material_production_id[0]) {
          mMoId = m.raw_material_production_id[0];
        }

        // 2. Direct production MO
        if (!mMoId && m.production_id && m.production_id[0]) {
          mMoId = m.production_id[0];
        }

        // 3. For SFP finished moves: check orig move (produced by MO)
        if (!mMoId && m.move_orig_ids && m.move_orig_ids.length > 0) {
          for (const omId of m.move_orig_ids) {
            const om = origMovesMap.get(omId);
            if (om && om.production_id && om.production_id[0]) {
              mMoId = om.production_id[0];
              break;
            }
          }
        }

        // 4. Exact origin string matching MO name
        if (!mMoId && m.origin) {
          const origTrimmed = m.origin.trim();
          if (origTrimmed === mo.name) {
            mMoId = id;
          } else if (moNameMap.has(origTrimmed)) {
            mMoId = moNameMap.get(origTrimmed).id;
          }
        }

        // 5. Origin move origin string matching MO
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

        // 6. Production group fallback ONLY for non-SFP (components) if group has exactly 1 MO
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

      // If all moves belong to at most 1 MO, picking is already dedicated
      const entries = Array.from(movesByMo.entries()).filter(([k, list]) => k !== 'unassigned' && list && list.length > 0);
      if (entries.length <= 1) {
        continue;
      }

      console.log(`[WipSyncService] Shared picking ${pick.name} (#${pick.id}) contains moves for ${entries.length} MOs. Splitting into 1 document per MO...`);

      // 1st MO stays in the original picking, subsequent MOs get new pickings
      const [firstMoIdKey, firstMoves] = entries[0];
      const firstMoId = Number(firstMoIdKey);
      if (!firstMoves || firstMoves.length === 0) continue;

      // Read MO names for all entries
      const allMoIds = entries.map(([k]) => Number(k)).filter(Boolean);
      const moInfoMap = new Map();
      try {
        const moList = await adminOdooClient._callObject('mrp.production', 'read', [allMoIds], { fields: ['id', 'name'] });
        moList.forEach(item => moInfoMap.set(item.id, item.name));
      } catch (e) {}

      // Update original picking origin & references
      const firstMoName = moInfoMap.get(firstMoId) || (moNameMap.has(firstMoId) ? moNameMap.get(firstMoId).name : `MO#${firstMoId}`);
      const firstMoSo = await resolveSalesOrderForMo(firstMoId);
      const firstPickVals = {
        origin: firstMoName,
        x_studio_manufacturing_order: firstMoId
      };
      if (firstMoSo) {
        firstPickVals.x_studio_sales_order = firstMoSo.id;
      }
      await adminOdooClient._callObject('stock.picking', 'write', [
        [pick.id],
        firstPickVals
      ]);
      transfersCache.delete(firstMoId);

      const createdPickIds = [];

      // Split all other MOs into dedicated pickings
      for (let i = 1; i < entries.length; i++) {
        const [targetMoIdKey, targetMoves] = entries[i];
        if (!targetMoves || targetMoves.length === 0) continue;

        const targetMoId = Number(targetMoIdKey);
        const targetMoName = moInfoMap.get(targetMoId) || `MO#${targetMoId}`;
        const targetMoSo = await resolveSalesOrderForMo(targetMoId);
        const targetMoveIds = targetMoves.map(m => m.id);
        const targetMoveLineIds = targetMoves.flatMap(m => m.move_line_ids || []);

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

        const newPickId = await adminOdooClient._callObject('stock.picking', 'create', [newPickPayload]);
        createdPickIds.push(newPickId);

        await adminOdooClient._callObject('stock.move', 'write', [
          targetMoveIds,
          { picking_id: newPickId }
        ]);

        if (targetMoveLineIds.length > 0) {
          await adminOdooClient._callObject('stock.move.line', 'write', [
            targetMoveLineIds,
            { picking_id: newPickId }
          ]);
        }

        // Link new picking to target MO's WIP record if WIP exists
        const targetWips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search_read', [
          [['x_studio_manufacturing_order', '=', targetMoId]]
        ], { fields: ['id'] });
        if (targetWips && targetWips[0]) {
          await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [
            [targetWips[0].id],
            { x_studio_daftar_transfer: [[6, 0, [newPickId]]] }
          ], { context: { tracking_disable: true, no_automation: true } });
        }

        transfersCache.delete(targetMoId);
        console.log(`[WipSyncService] Created dedicated picking #${newPickId} for MO #${targetMoId} (${targetMoName}) with ${targetMoveIds.length} move(s)`);
      }

      // Ensure all pickings have synchronized references
      try {
        await transferService.resolveTransferMoAndSo([pick.id, ...createdPickIds]);
      } catch (errSyncRefs) {
        console.warn(`[WipSyncService] Transfer reference resolution warning: ${errSyncRefs.message}`);
      }
    }
  } catch (splitErr) {
    console.warn(`[WipSyncService] Warning in ensureDedicatedComponentPickings for MO #${moId}:`, splitErr.message);
  }
}

/**
 * Resolves and saves the Sales Order (x_studio_sales_order) for an MO.
 * Reliably handles:
 *  - Direct sale_line_id
 *  - Direct origin name matching sale.order
 *  - Comma-separated origin tokens
 *  - Parent MO in origin (e.g. "Turunan Grade B - VDKWS/MO/05358", "Pecahan dari ...", "Sisa Makloon - ...")
 *  - Backorder sibling MOs (e.g. VDKWS/MO/04623-014 -> sibling with SO)
 *  - x_studio_origin_mo
 *  - Stock move lines' sale_line_id
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

    // Already set
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
      } catch (errLine) {}
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
      const parts = mo.origin.split(',').map(p => p.trim()).filter(Boolean);
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

/**
 * 1. Triggered when Manufacturing Order is Confirmed
 * Replaces Odoo Automation: [Custom] Buat WIP dari MO
 */
export async function onMoConfirmed(moId, { autoSync = true } = {}) {
  await adminOdooClient.authenticate();
  const id = Number(moId);
  if (!id || isNaN(id)) {
    throw new Error(`Invalid MO ID: ${moId}`);
  }

  return withWipLock(`mo_${id}`, async () => {
    // 0. Ensure Sales Order reference on MO is resolved and populated
    await resolveSalesOrderForMo(id);

    console.log(`[WipSyncService] Checking WIP record for MO ID #${id}...`);

    const existingWips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search_read', [
      [['x_studio_manufacturing_order', '=', id]]
    ], { fields: ['id', 'x_name'] });

    if (existingWips && existingWips.length > 0) {
      console.log(`[WipSyncService] WIP record already exists for MO #${id} (WIP ID: ${existingWips[0].id}, Name: ${existingWips[0].x_name}). Ensuring picking isolation...`);
      await ensureDedicatedComponentPickings(id);
      return { success: true, alreadyExists: true, wipId: existingWips[0].id };
    }

    const mos = await adminOdooClient._callObject('mrp.production', 'read', [[id]], {
      fields: ['id', 'name', 'product_id', 'product_qty', 'bom_id', 'workorder_ids', 'picking_ids', 'company_id', 'warehouse_id', 'picking_type_id']
    });

    if (!mos || mos.length === 0) {
      throw new Error(`Manufacturing Order #${id} not found in Odoo`);
    }

    const mo = mos[0];
    const moName = mo.name || `MO#${id}`;
    const ptName = (mo.picking_type_id && mo.picking_type_id[1]) ? mo.picking_type_id[1].toUpperCase() : '';
    const whName = (mo.warehouse_id && mo.warehouse_id[1]) ? mo.warehouse_id[1].toUpperCase() : '';
    const isVendorMo = ptName.includes('VENDOR') || whName.includes('VENDOR') || moName.startsWith('VD');

    if (!isVendorMo) {
      console.log(`[WipSyncService] MO "${moName}" (#${id}) Operation Type "${ptName}" / Warehouse "${whName}" is not Vendor. Skipping Monitoring WIP Vendor creation.`);
      return { success: true, skipped: true, reason: `Non-vendor operation type: ${ptName}` };
    }

    console.log(`[WipSyncService] Creating new WIP record for MO "${moName}" (ID: ${id}, Operation Type: "${ptName}")...`);

    let consumptionPerPcs = 0.0;
    if (mo.bom_id && mo.bom_id[0]) {
      try {
        const bomLines = await adminOdooClient._callObject('mrp.bom.line', 'search_read', [
          [['bom_id', '=', mo.bom_id[0]]]
        ], { fields: ['id', 'product_id', 'product_qty'] });

        if (bomLines && bomLines.length > 0) {
          const clothLine = bomLines.find(bl => (bl.product_id && bl.product_id[1] && bl.product_id[1].toUpperCase().includes('KAIN'))) || bomLines[0];
          consumptionPerPcs = parseFloat(clothLine.product_qty) || 0.0;
        }
      } catch (errBom) {
        console.warn(`[WipSyncService] Could not fetch BoM lines for BoM #${mo.bom_id[0]}: ${errBom.message}`);
      }
    }

    const qtyKebutuhanKain = (parseFloat(mo.product_qty) || 0.0) * consumptionPerPcs;

    let workcenterIds = [];
    if (mo.workorder_ids && mo.workorder_ids.length > 0) {
      try {
        const workorders = await adminOdooClient._callObject('mrp.workorder', 'read', [
          mo.workorder_ids,
          ['workcenter_id']
        ]);
        workcenterIds = [...new Set(workorders.filter(wo => wo.workcenter_id).map(wo => wo.workcenter_id[0]))];
      } catch (errWo) {
        console.warn(`[WipSyncService] Could not fetch workcenters for MO #${id}: ${errWo.message}`);
      }
    }

    const newWipPayload = {
      x_name: moName,
      x_studio_manufacturing_order: id,
      x_studio_qty_kebutuhan_kain: qtyKebutuhanKain,
      x_studio_status_produksi: 'Proses'
    };

    if (workcenterIds.length > 0) {
      newWipPayload.x_studio_many2many_field_869_1k3jdrdl1 = [[6, 0, workcenterIds]];
    }

    const newWipId = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'create', [newWipPayload]);
    console.log(`[WipSyncService] Created WIP record #${newWipId} for MO "${moName}".`);

    // Ensure dedicated 1:1 component picking for this MO
    await ensureDedicatedComponentPickings(id);

    if (autoSync && mo.picking_ids && mo.picking_ids.length > 0) {
      try {
        await syncWipFromPickings(newWipId, id);
      } catch (syncErr) {
        console.warn(`[WipSyncService] Post-creation sync warning for WIP #${newWipId}: ${syncErr.message}`);
      }
    } else {
      try {
        const whId = mo.warehouse_id ? mo.warehouse_id[0] : null;
        const whName = mo.warehouse_id ? mo.warehouse_id[1] : '';
        await wipRepo.upsertWipOrder({
          odoo_wip_id: newWipId,
          odoo_mo_id: id,
          odoo_warehouse_id: whId,
          vendor_name: whName,
          mo_name: moName,
          mo_state: 'confirmed',
          product_name: mo.product_id ? mo.product_id[1] : null,
          qty_spk: parseFloat(mo.product_qty || 0),
          qty_kebutuhan_kain: qtyKebutuhanKain,
          status_produksi: 'Proses'
        });
      } catch (mErr) {
        console.warn(`[WipSyncService] Initial Supabase sync warning for WIP #${newWipId}: ${mErr.message}`);
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

  console.log(`[WipSyncService] Handling Transfer Done for Picking ID #${id}...`);

  const pickings = await adminOdooClient._callObject('stock.picking', 'read', [[id]], {
    fields: ['id', 'name', 'origin', 'state', 'x_studio_manufacturing_order', 'reference_ids', 'company_id', 'picking_type_id']
  });

  if (!pickings || pickings.length === 0) {
    console.warn(`[WipSyncService] Picking #${id} not found in Odoo.`);
    return { success: false, notFound: true };
  }

  const picking = pickings[0];
  const pickingName = picking.name || '';
  const ptName = (picking.picking_type_id && picking.picking_type_id[1]) ? picking.picking_type_id[1].toUpperCase() : '';

  const isRelevantCode = ['/PC/', '/SPB/', '/SFP/'].some(code => pickingName.includes(code));
  const isVendorTransfer = ptName.includes('VENDOR') || pickingName.startsWith('VD');

  if (!isRelevantCode || !isVendorTransfer) {
    console.log(`[WipSyncService] Picking ${pickingName} (#${id}) is not a vendor PC/SPB/SFP transfer. Skipping WIP sync.`);
    return { success: true, skipped: true, reason: 'Not a vendor PC/SPB/SFP transfer' };
  }

  let moIds = [];
  if (pickingName.includes('/SFP/') && picking.origin) {
    const origins = picking.origin.split(',').map(s => s.trim()).filter(Boolean);
    const mos = await adminOdooClient._callObject('mrp.production', 'search_read', [
      [['name', 'in', origins]]
    ], { fields: ['id', 'name'] });
    if (mos && mos.length > 0) {
      moIds.push(...mos.map(m => m.id));
    }
  }

  if (moIds.length === 0 && picking.x_studio_manufacturing_order) {
    moIds.push(picking.x_studio_manufacturing_order[0]);
  }

  if (moIds.length === 0 && picking.reference_ids && picking.reference_ids.length > 0) {
    const refMos = await adminOdooClient._callObject('mrp.production', 'search_read', [
      [['reference_ids', 'in', picking.reference_ids]]
    ], { fields: ['id', 'name'] });
    moIds.push(...refMos.map(m => m.id));
  }

  moIds = [...new Set(moIds)];

  if (moIds.length === 0) {
    console.log(`[WipSyncService] No MO associated with transfer ${pickingName} (#${id}). Skipping WIP sync.`);
    return { success: true, skipped: true, reason: 'No linked MO found' };
  }

  const vendorMoIds = [];
  const targetMos = await adminOdooClient._callObject('mrp.production', 'read', [
    moIds,
    ['id', 'name', 'warehouse_id', 'picking_type_id']
  ]);
  for (const m of targetMos) {
    const mPt = (m.picking_type_id && m.picking_type_id[1]) ? m.picking_type_id[1].toUpperCase() : '';
    const mWh = (m.warehouse_id && m.warehouse_id[1]) ? m.warehouse_id[1].toUpperCase() : '';
    const name = m.name || '';
    if (mPt.includes('VENDOR') || mWh.includes('VENDOR') || name.startsWith('VD')) {
      vendorMoIds.push(m.id);
    }
  }

  if (vendorMoIds.length === 0) {
    console.log(`[WipSyncService] Transfer ${pickingName} (#${id}) has no vendor MOs associated.`);
    return { success: true, skipped: true, reason: 'No vendor MO found' };
  }

  const syncedWips = [];
  for (const moId of vendorMoIds) {
    let wips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search_read', [
      [['x_studio_manufacturing_order', '=', moId]]
    ], { fields: ['id', 'x_name'] });

    let wipId = wips && wips.length > 0 ? wips[0].id : null;
    if (!wipId) {
      const created = await onMoConfirmed(moId, { autoSync: false });
      if (created && created.wipId) {
        wipId = created.wipId;
      }
    }

    if (wipId) {
      const syncRes = await syncWipFromPickings(wipId, moId);
      syncedWips.push(syncRes);
    }
  }

  return {
    success: true,
    pickingId: id,
    pickingName,
    syncedWips
  };
}

/**
 * Single-Pass Compute: Synchronizes all data and formulas for a WIP record
 */
export async function syncWipFromPickings(wipId, moId) {
  return withWipLock(`wip_${wipId}`, async () => {
    console.log(`[WipSyncService] Executing Single-Pass Compute for WIP #${wipId} (MO #${moId})...`);

    const wips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[wipId]], {
      fields: [
        'id', 'x_name', 'x_studio_manufacturing_order', 'x_studio_detail_roll_kain',
        'x_studio_warehouse', 'x_studio_product', 'x_studio_consumption_per_pcs_1',
        'x_studio_qty_kebutuhan_kain', 'x_studio_unit_kain_dari_gudang',
        'x_studio_unit_consumption_per_pcs', 'x_studio_actual_cutting',
        'x_studio_harga', 'x_studio_total_harga', 'x_studio_daftar_transfer',
        'x_studio_many2many_field_869_1k3jdrdl1', 'x_studio_sales_order',
        'x_studio_qty_kirim_a_grade', 'x_studio_qty_kirim_b_grade', 'x_studio_sisa_makloon_kg',
        'x_studio_sisa_potong_panjang', 'x_studio_sisa_potong_sedang', 'x_studio_sisa_potong_pendek',
        'x_studio_related_field_77l_1k5rj70p4', 'x_studio_related_field_52c_1k5rj7ik0',
        'x_studio_qc_pass_1', 'x_studio_qty_qc_pass_1', 'x_studio_qc_status',
        'x_studio_keterangan_qms', 'x_studio_gambar_qc',
        'x_studio_status_produksi', 'x_studio_qty_spk', 'x_studio_start_spk', 'x_studio_deadline_spk'
      ],
      context: { bin_size: true }
    });

    if (!wips || wips.length === 0) {
      throw new Error(`WIP record #${wipId} not found`);
    }
    const wip = wips[0];

    const mos = await adminOdooClient._callObject('mrp.production', 'read', [[moId]], {
      fields: [
        'id', 'name', 'product_id', 'product_qty', 'picking_ids',
        'warehouse_id', 'bom_id', 'workorder_ids', 'company_id',
        'state', 'x_studio_sales_order', 'date_start', 'date_deadline'
      ]
    });
    if (!mos || mos.length === 0) {
      throw new Error(`MO record #${moId} not found`);
    }
    const mo = mos[0];
    const moName = mo.name || '';

    const pickingIds = mo.picking_ids || [];
    if (pickingIds.length === 0) {
      console.log(`[WipSyncService] MO ${moName} has no pickings linked yet.`);
      return { wipId, updated: false };
    }

    const allPickings = await adminOdooClient._callObject('stock.picking', 'read', [
      pickingIds,
      ['id', 'name', 'state', 'origin', 'date_done', 'move_line_ids', 'picking_type_id']
    ]);

    const validDaftarTransferIds = allPickings
      .filter(p => {
        const name = p.name || '';
        if (name.includes('/PC/') || name.includes('/SPB/')) return true;
        if (name.includes('/SFP/')) {
          const origins = (p.origin || '').split(',').map(s => s.trim());
          if (origins.includes(moName)) return true;
        }
        return false;
      })
      .map(p => p.id);

    const donePickings = allPickings.filter(p => p.state === 'done');
    const donePcSpb = donePickings.filter(p => (p.name || '').includes('/PC/') || (p.name || '').includes('/SPB/'));
    const doneSfp = donePickings.filter(p => {
      if (!(p.name || '').includes('/SFP/')) return false;
      const origins = (p.origin || '').split(',').map(s => s.trim());
      return origins.includes(moName);
    }).sort((a, b) => new Date(a.date_done || 0) - new Date(b.date_done || 0));

    const pcMoveLineIds = [...new Set(donePcSpb.flatMap(p => p.move_line_ids || []))];
    let kainQty = 0.0;
    let totalMaterialQty = 0.0;
    let pcMoveLines = [];

    if (pcMoveLineIds.length > 0) {
      pcMoveLines = await adminOdooClient._callObject('stock.move.line', 'read', [
        pcMoveLineIds,
        ['id', 'product_id', 'lot_id', 'quantity', 'product_uom_id']
      ]);

      const activeMoveLines = pcMoveLines.filter(l => (parseFloat(l.quantity) || 0) > 0);
      for (const l of activeMoveLines) {
        const q = parseFloat(l.quantity) || 0.0;
        totalMaterialQty += q;
        const prodName = l.product_id && l.product_id[1] ? l.product_id[1] : '';
        const uomName = Array.isArray(l.product_uom_id) ? l.product_uom_id[1] : '';
        if (classifyMaterialLine(prodName, uomName) === 'kain') {
          kainQty += q;
        }
      }
    }

    const accsQty = Math.max(0, totalMaterialQty - kainQty);

    const rawRollLines = wip.x_studio_detail_roll_kain && wip.x_studio_detail_roll_kain.length > 0
      ? await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'read', [
          wip.x_studio_detail_roll_kain,
          ['id', 'x_name', 'x_studio_kode_warna_roll', 'x_studio_yards', 'x_studio_uom', 'x_studio_qty_penerimaan', 'x_studio_qty_berat_kg']
        ])
      : [];

    const seenRollKeys = new Map();
    const duplicateLineIdsToDelete = [];
    const existingRollLines = [];

    for (const line of rawRollLines) {
      const key = `${line.x_name || ''}:::${line.x_studio_kode_warna_roll || 'Tanpa Lot'}`;
      if (seenRollKeys.has(key)) {
        if ((parseFloat(line.x_studio_qty_berat_kg) || 0) === 0) {
          duplicateLineIdsToDelete.push(line.id);
          continue;
        }
      } else {
        seenRollKeys.set(key, line);
      }

      // Opsi C default: If Qty Penerimaan is 0/empty, set default from Qty (Surat Jalan Transfer)
      if ((parseFloat(line.x_studio_qty_penerimaan) || 0) === 0 && (parseFloat(line.x_studio_yards) || 0) > 0) {
        line.x_studio_qty_penerimaan = line.x_studio_yards;
        try {
          await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'write', [
            [line.id],
            { x_studio_qty_penerimaan: line.x_studio_yards }
          ]);
        } catch (writeErr) {
          console.warn(`[WipSyncService] Failed to set default Qty Penerimaan for line #${line.id}: ${writeErr.message}`);
        }
      }

      existingRollLines.push(line);
    }

    if (duplicateLineIdsToDelete.length > 0) {
      try {
        await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'unlink', [duplicateLineIdsToDelete]);
      } catch (delErr) {
        console.warn(`[WipSyncService] Failed to unlink duplicate lines: ${delErr.message}`);
      }
    }

    const newRollLines = [];
    if (existingRollLines.length === 0 && moName.includes('-')) {
      const basePrefix = moName.substring(0, moName.lastIndexOf('-'));
      try {
        const prevWips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search_read', [
          [
            ['x_studio_manufacturing_order.name', '=like', `${basePrefix}-%`],
            ['id', '<', wipId],
            ['x_studio_detail_roll_kain', '!=', false]
          ]
        ], { fields: ['id', 'x_studio_detail_roll_kain'], order: 'id desc', limit: 1 });

        if (prevWips && prevWips.length > 0 && prevWips[0].x_studio_detail_roll_kain.length > 0) {
          const prevLines = await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'read', [
            prevWips[0].x_studio_detail_roll_kain,
            ['x_name', 'x_studio_kode_warna_roll', 'x_studio_yards', 'x_studio_uom', 'x_studio_qty_penerimaan', 'x_studio_qty_berat_kg']
          ]);

          for (const l of prevLines) {
            newRollLines.push([0, 0, {
              x_name: l.x_name,
              x_studio_kode_warna_roll: l.x_studio_kode_warna_roll,
              x_studio_yards: l.x_studio_yards,
              x_studio_uom: l.x_studio_uom,
              x_studio_qty_penerimaan: l.x_studio_qty_penerimaan !== undefined ? l.x_studio_qty_penerimaan : l.x_studio_yards,
              x_studio_qty_berat_kg: l.x_studio_qty_berat_kg
            }]);
          }
        }
      } catch (errFamily) {
        console.warn(`[WipSyncService] Backorder copy warning: ${errFamily.message}`);
      }
    }

    if (newRollLines.length === 0 && pcMoveLines.length > 0) {
      const existingKeySet = new Set(
        existingRollLines.map(l => `${l.x_name || ''}:::${l.x_studio_kode_warna_roll || 'Tanpa Lot'}`)
      );

      for (const l of pcMoveLines) {
        const prodName = l.product_id ? l.product_id[1] : '';
        const lotName = l.lot_id ? l.lot_id[1] : 'Tanpa Lot';
        const key = `${prodName}:::${lotName}`;

        if (!existingKeySet.has(key)) {
          existingKeySet.add(key);
          newRollLines.push([0, 0, {
            x_name: prodName,
            x_studio_kode_warna_roll: lotName,
            x_studio_yards: l.quantity,
            x_studio_uom: l.product_uom_id ? l.product_uom_id[1] : '',
            x_studio_qty_penerimaan: l.quantity, // Default dari Surat Jalan Transfer PC
            x_studio_qty_berat_kg: 0.0
          }]);
        }
      }
    }

    let sfpVals = {};
    let sfpQtyMasuk = 0.0;
    if (doneSfp.length > 0) {
      const latestSfp = doneSfp[doneSfp.length - 1];
      let sfpLineQty = 0.0;
      if (latestSfp.move_line_ids && latestSfp.move_line_ids.length > 0) {
        const sfpLines = await adminOdooClient._callObject('stock.move.line', 'read', [
          latestSfp.move_line_ids,
          ['quantity', 'product_id']
        ]);
        const moProdId = mo.product_id ? mo.product_id[0] : null;
        const relevantLines = moProdId
          ? sfpLines.filter(l => l.product_id && l.product_id[0] === moProdId)
          : sfpLines;
        sfpLineQty = (relevantLines.length > 0 ? relevantLines : sfpLines).reduce((sum, l) => sum + (parseFloat(l.quantity) || 0.0), 0.0);
      }
      sfpQtyMasuk = sfpLineQty;
      sfpVals = {
        x_studio_no_surat_jalan_sfp: latestSfp.name,
        x_studio_tanggal_sfp: latestSfp.date_done,
        x_studio_qty_masuk_sfp: sfpQtyMasuk
      };
    }

    const consumptionPerPcs = parseFloat(wip.x_studio_consumption_per_pcs_1) || 0.0;
    const unitKain = wip.x_studio_unit_kain_dari_gudang ? (Array.isArray(wip.x_studio_unit_kain_dari_gudang) ? wip.x_studio_unit_kain_dari_gudang[1] : wip.x_studio_unit_kain_dari_gudang) : '';
    const unitCons = wip.x_studio_unit_consumption_per_pcs ? (Array.isArray(wip.x_studio_unit_consumption_per_pcs) ? wip.x_studio_unit_consumption_per_pcs[1] : wip.x_studio_unit_consumption_per_pcs) : '';
    const conversionFactor = (unitKain && unitCons && unitKain !== unitCons) ? 0.9144 : 1.0;

    const estimasiDariSpb = consumptionPerPcs > 0
      ? (conversionFactor * kainQty) / consumptionPerPcs
      : 0.0;

    const targetKebutuhanKain = parseFloat(wip.x_studio_qty_kebutuhan_kain) || 0.0;
    const statusKebutuhanKain = kainQty >= targetKebutuhanKain ? 'Cukup' : 'Kurang';

    const allLinesToSum = [
      ...existingRollLines,
      ...newRollLines.map(r => r[2])
    ];
    const actualCutting = allLinesToSum
      .filter(l => (l.x_name || '').toUpperCase().includes('KAIN'))
      .reduce((sum, l) => sum + (parseFloat(l.x_studio_qty_berat_kg) || 0.0), 0.0);

    const selisihCutting = actualCutting - estimasiDariSpb;

    let workcenterIds = [];
    if (mo.workorder_ids && mo.workorder_ids.length > 0) {
      try {
        const wos = await adminOdooClient._callObject('mrp.workorder', 'read', [
          mo.workorder_ids,
          ['workcenter_id']
        ]);
        workcenterIds = [...new Set(wos.filter(w => w.workcenter_id).map(w => w.workcenter_id[0]))];
      } catch (errWo) {
        console.warn(`[WipSyncService] Workcenter fetch error: ${errWo.message}`);
      }
    }

    let hargaVendor = parseFloat(wip.x_studio_harga) || 0.0;
    const warehouseId = mo.warehouse_id ? mo.warehouse_id[0] : (wip.x_studio_warehouse ? wip.x_studio_warehouse[0] : null);
    const productId = mo.product_id ? mo.product_id[0] : (wip.x_studio_product ? wip.x_studio_product[0] : null);

    // Only lookup vendor price if hargaVendor is currently 0 and WIP is not 'Selesai' (Kombinasi A)
    const wipStatusProduksi = (wip.x_studio_status_produksi || '').trim().toLowerCase();
    if (hargaVendor === 0 && wipStatusProduksi !== 'selesai' && warehouseId && productId && workcenterIds.length > 0) {
      try {
        const vendorPrices = await adminOdooClient._callObject('x_vendor_production', 'search_read', [
          [
            ['x_studio_warehouse', '=', warehouseId],
            ['x_studio_product', '=', productId]
          ]
        ], { fields: ['id', 'x_studio_value', 'x_studio_many2many_field_7h1_1k3jdkeub'] });

        if (vendorPrices && vendorPrices.length > 0) {
          const targetWcSet = new Set(workcenterIds);
          const matched = vendorPrices.find(vp => {
            const vpWcIds = vp.x_studio_many2many_field_7h1_1k3jdkeub || [];
            if (vpWcIds.length !== targetWcSet.size) return false;
            return vpWcIds.every(id => targetWcSet.has(id));
          }) || vendorPrices[0];

          if (matched && matched.x_studio_value !== undefined) {
            hargaVendor = parseFloat(matched.x_studio_value) || 0.0;
          }
        }
      } catch (errPrice) {
        console.warn(`[WipSyncService] Could not fetch vendor pricing: ${errPrice.message}`);
      }
    }

    const totalHarga = hargaVendor * sfpQtyMasuk;

    const vals = {
      x_studio_kain_dari_gudang_qty: kainQty,
      x_studio_accessories_dari_gudang: accsQty,
      x_studio_estimasi_dari_spb: estimasiDariSpb,
      x_studio_status_kebutuhan_kain: statusKebutuhanKain,
      x_studio_actual_cutting: actualCutting,
      x_studio_selisih_hasil_cutting: selisihCutting,
      x_studio_harga: hargaVendor,
      x_studio_total_harga: totalHarga,
      ...sfpVals
    };

    if (validDaftarTransferIds.length > 0) {
      vals.x_studio_daftar_transfer = [[6, 0, validDaftarTransferIds]];
    }

    if (workcenterIds.length > 0) {
      vals.x_studio_many2many_field_869_1k3jdrdl1 = [[6, 0, workcenterIds]];
    }

    if (newRollLines.length > 0) {
      vals.x_studio_detail_roll_kain = newRollLines;
    }

    console.log(`[WipSyncService] Writing Single-Pass computed values to WIP #${wipId}:`, vals);
    await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [[wipId], vals], {
      context: { tracking_disable: true, no_automation: true }
    });

    // Synchronize into Supabase
    try {
      const whId = mo.warehouse_id ? mo.warehouse_id[0] : (wip.x_studio_warehouse ? wip.x_studio_warehouse[0] : null);
      const whName = mo.warehouse_id ? mo.warehouse_id[1] : (wip.x_studio_warehouse ? wip.x_studio_warehouse[1] : 'Unknown');

      const savedId = await wipRepo.upsertWipOrder({
        odoo_wip_id: wipId,
        odoo_mo_id: moId,
        odoo_warehouse_id: whId,
        vendor_name: whName,
        mo_name: moName,
        mo_state: mo.state || 'confirmed',
        sales_order: mo.x_studio_sales_order ? (Array.isArray(mo.x_studio_sales_order) ? mo.x_studio_sales_order[1] : String(mo.x_studio_sales_order)) : (wip.x_studio_sales_order ? (Array.isArray(wip.x_studio_sales_order) ? wip.x_studio_sales_order[1] : String(wip.x_studio_sales_order)) : null),
        product_name: mo.product_id ? (Array.isArray(mo.product_id) ? mo.product_id[1] : String(mo.product_id)) : (wip.x_studio_product ? (Array.isArray(wip.x_studio_product) ? wip.x_studio_product[1] : String(wip.x_studio_product)) : null),
        qty_spk: parseFloat(mo.product_qty || wip.x_studio_qty_spk || 0),
        start_spk: mo.date_start || wip.x_studio_start_spk || null,
        deadline_spk: mo.date_deadline || wip.x_studio_deadline_spk || null,
        qty_kebutuhan_kain: parseFloat(wip.x_studio_qty_kebutuhan_kain || 0),
        kain_dari_gudang: kainQty,
        unit_kain: unitKain || 'yard',
        consumption_per_pcs: consumptionPerPcs,
        consumption_uom: unitCons || null,
        accessories_dari_gudang: accsQty,
        estimasi_dari_spb: estimasiDariSpb,
        status_kebutuhan_kain: statusKebutuhanKain,
        actual_cutting: actualCutting,
        selisih_hasil_cutting: selisihCutting,
        qty_grade_a: parseFloat(wip.x_studio_qty_kirim_a_grade || 0),
        qty_grade_b: parseFloat(wip.x_studio_qty_kirim_b_grade || 0),
        sisa_makloon_kg: parseFloat(wip.x_studio_sisa_makloon_kg || 0),
        sisa_potong_panjang: parseFloat(wip.x_studio_sisa_potong_panjang || 0),
        sisa_potong_sedang: parseFloat(wip.x_studio_sisa_potong_sedang || 0),
        sisa_potong_pendek: parseFloat(wip.x_studio_sisa_potong_pendek || 0),
        finishing: resolveFinishing(wip.x_studio_related_field_77l_1k5rj70p4),
        packing: wip.x_studio_related_field_52c_1k5rj7ik0 || null,
        qc_pass_id: wip.x_studio_qc_pass_1 ? (Array.isArray(wip.x_studio_qc_pass_1) ? wip.x_studio_qc_pass_1[0] : wip.x_studio_qc_pass_1) : null,
        qc_pass_name: wip.x_studio_qc_pass_1 && Array.isArray(wip.x_studio_qc_pass_1) ? wip.x_studio_qc_pass_1[1] : null,
        qty_qc_pass: Number(wip.x_studio_qty_qc_pass_1 || 0),
        qc_status: wip.x_studio_qc_status || null,
        keterangan_qms: wip.x_studio_keterangan_qms || null,
        has_gambar_qc: Boolean(wip.x_studio_gambar_qc),
        no_surat_jalan_sfp: sfpVals.x_studio_no_surat_jalan_sfp || null,
        tanggal_sfp: sfpVals.x_studio_tanggal_sfp || null,
        qty_masuk_sfp: sfpVals.x_studio_qty_masuk_sfp || 0,
        harga_vendor: hargaVendor,
        total_harga: totalHarga,
        status_produksi: wip.x_studio_status_produksi || 'Proses',
        odoo_write_date: new Date().toISOString()
      });

      if (allLinesToSum.length > 0) {
        // Re-fetch updated lines with actual Odoo line IDs if new lines were added
        let linesToSave = allLinesToSum;
        if (newRollLines.length > 0) {
          try {
            const freshWip = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[wipId]], {
              fields: ['x_studio_detail_roll_kain']
            });
            if (freshWip && freshWip[0] && freshWip[0].x_studio_detail_roll_kain && freshWip[0].x_studio_detail_roll_kain.length > 0) {
              linesToSave = await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'read', [
                freshWip[0].x_studio_detail_roll_kain,
                ['id', 'x_name', 'x_studio_kode_warna_roll', 'x_studio_yards', 'x_studio_uom', 'x_studio_qty_penerimaan', 'x_studio_qty_berat_kg']
              ]);
            }
          } catch (refErr) {
            console.warn(`[WipSyncService] Failed to read fresh lines after write: ${refErr.message}`);
          }
        }
        await wipRepo.upsertRollLines(savedId, linesToSave);
      }
    } catch (sbErr) {
      console.warn(`[WipSyncService] Supabase sync warning for WIP #${wipId}: ${sbErr.message}`);
    }

    return {
      wipId,
      moId,
      kainQty,
      accsQty,
      estimasiDariSpb,
      statusKebutuhanKain,
      actualCutting,
      selisihCutting,
      hargaVendor,
      totalHarga,
      updated: true
    };
  });
}

/**
 * 4. Triggered when Vendor Pricing (x_vendor_production) is created or updated in Odoo
 */
export async function onVendorPriceUpdated(vendorPriceId) {
  await adminOdooClient.authenticate();
  const id = Number(vendorPriceId);
  if (!id || isNaN(id)) {
    throw new Error(`Invalid Vendor Price ID: ${vendorPriceId}`);
  }

  console.log(`[WipSyncService] Handling Vendor Price Updated for ID #${id}...`);

  const records = await adminOdooClient._callObject('x_vendor_production', 'read', [[id]], {
    fields: ['id', 'x_studio_warehouse', 'x_studio_product', 'x_studio_value', 'x_studio_many2many_field_7h1_1k3jdkeub']
  });

  if (!records || records.length === 0) {
    console.warn(`[WipSyncService] Vendor Price record #${id} not found in Odoo.`);
    return { success: false, notFound: true };
  }

  const vp = records[0];
  const warehouseId = vp.x_studio_warehouse ? vp.x_studio_warehouse[0] : null;
  const productId = vp.x_studio_product ? vp.x_studio_product[0] : null;
  const newPrice = parseFloat(vp.x_studio_value) || 0.0;
  const vpWorkcenterIds = vp.x_studio_many2many_field_7h1_1k3jdkeub || [];

  if (!warehouseId || !productId) {
    console.warn(`[WipSyncService] Vendor Price #${id} missing warehouse or product.`);
    return { success: false, reason: 'Missing warehouse or product' };
  }

  console.log(`[WipSyncService] Price record #${id}: Warehouse: ${warehouseId}, Product: ${productId}, Price: Rp ${newPrice}`);

  // Search for all active WIP records with matching warehouse and product
  const wips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search_read', [
    [
      ['x_studio_warehouse', '=', warehouseId],
      ['x_studio_product', '=', productId]
    ]
  ], {
    fields: [
      'id', 'x_name', 'x_studio_harga', 'x_studio_total_harga',
      'x_studio_qty_masuk_sfp', 'x_studio_manufacturing_order',
      'x_studio_many2many_field_869_1k3jdrdl1', 'x_studio_status_produksi'
    ],
    order: 'id desc'
  });

  console.log(`[WipSyncService] Found ${wips.length} WIP record(s) matching Warehouse ${warehouseId} & Product ${productId}`);

  const updatedWips = [];

  for (const w of wips) {
    if (vpWorkcenterIds.length > 0 && w.x_studio_many2many_field_869_1k3jdrdl1 && w.x_studio_many2many_field_869_1k3jdrdl1.length > 0) {
      const wipWcSet = new Set(w.x_studio_many2many_field_869_1k3jdrdl1);
      const matchesWc = vpWorkcenterIds.every(cid => wipWcSet.has(cid));
      if (!matchesWc) {
        continue;
      }
    }

    // Kombinasi A (Strict):
    // 1. Kunci SPK yang status produksinya sudah 'Selesai'
    const statusProduksi = (w.x_studio_status_produksi || '').trim().toLowerCase();
    if (statusProduksi === 'selesai') {
      console.log(`[WipSyncService] Skipping WIP #${w.id} (${w.x_name}): Status is 'Selesai' (Locked)`);
      continue;
    }

    // 2. Kunci SPK yang sudah memiliki harga (> 0), hanya isi yang harganya masih 0
    const currentPrice = parseFloat(w.x_studio_harga) || 0.0;
    if (currentPrice > 0) {
      console.log(`[WipSyncService] Skipping WIP #${w.id} (${w.x_name}): Existing price Rp ${currentPrice} preserved (Only 0 is filled)`);
      continue;
    }

    const sfpQty = parseFloat(w.x_studio_qty_masuk_sfp) || 0.0;
    const totalHarga = newPrice * sfpQty;

    // Update Odoo
    await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [
      [w.id],
      {
        x_studio_harga: newPrice,
        x_studio_total_harga: totalHarga
      }
    ], {
      context: { tracking_disable: true, no_automation: true }
    });

    // Update Supabase
    try {
      await wipRepo.updateWipPricingByOdooId(w.id, {
        harga_vendor: newPrice,
        total_harga: totalHarga
      });
    } catch (errDb) {
      console.warn(`[WipSyncService] Note on updating Supabase pricing for WIP #${w.id}: ${errDb.message}`);
    }

    updatedWips.push({
      wipId: w.id,
      moName: w.x_name,
      hargaVendor: newPrice,
      sfpQty,
      totalHarga
    });
  }

  console.log(`[WipSyncService] Successfully updated pricing for ${updatedWips.length} WIP orders.`);
  return {
    success: true,
    priceId: id,
    newPrice,
    updatedCount: updatedWips.length,
    updatedWips
  };
}
