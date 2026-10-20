import { supabaseServer } from '../../supabaseServer.js';
import { adminOdooClient } from '../../odoo/odooClient.js';
import { wipRepo } from '../wipRepository.js';
import { rawMovesCache, transfersCache } from './wipCache.js';
import { withWipLock } from './wipLock.js';
import { getOrderDetails } from './wipQueryService.js';

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
 * Pull single order live from Odoo into Supabase
 */
export async function syncOrderFromOdoo({ user, orderId }) {
  const { order } = await getOrderDetails({ user, orderId, includeRawMoves: false });
  if (!order.odoo_wip_id) {
    throw new Error('Order tidak memiliki link Odoo WIP ID.');
  }

  await adminOdooClient.authenticate();
  const wips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[order.odoo_wip_id]], {
    fields: [
      'id', 'x_name', 'x_studio_manufacturing_order', 'x_studio_warehouse',
      'x_studio_product', 'x_studio_consumption_per_pcs_1', 'x_studio_unit_consumption_per_pcs',
      'x_studio_qty_kebutuhan_kain', 'x_studio_kain_dari_gudang_qty', 'x_studio_unit_kain_dari_gudang',
      'x_studio_accessories_dari_gudang', 'x_studio_estimasi_dari_spb', 'x_studio_status_kebutuhan_kain',
      'x_studio_qty_kirim_a_grade', 'x_studio_qty_kirim_b_grade', 'x_studio_sisa_makloon_kg',
      'x_studio_sisa_potong_panjang', 'x_studio_sisa_potong_sedang', 'x_studio_sisa_potong_pendek',
      'x_studio_no_surat_jalan_sfp', 'x_studio_tanggal_sfp', 'x_studio_qty_masuk_sfp',
      'x_studio_qty_spk', 'x_studio_start_spk', 'x_studio_deadline_spk', 'x_studio_sales_order',
      'x_studio_harga', 'x_studio_total_harga', 'x_studio_status_produksi', 'x_studio_detail_roll_kain',
      'write_date'
    ]
  });

  if (!wips || wips.length === 0) {
    throw new Error(`Data WIP #${order.odoo_wip_id} tidak ditemukan di Odoo.`);
  }

  const w = wips[0];
  const moId = w.x_studio_manufacturing_order ? w.x_studio_manufacturing_order[0] : order.odoo_mo_id;

  // Read MO details
  let moState = order.mo_state;
  let deadlineSpk = w.x_studio_deadline_spk || order.deadline_spk;
  let startSpk = w.x_studio_start_spk || order.start_spk;
  let qtySpk = Number(w.x_studio_qty_spk || order.qty_spk || 0);
  let salesOrder = w.x_studio_sales_order ? (Array.isArray(w.x_studio_sales_order) ? w.x_studio_sales_order[1] : String(w.x_studio_sales_order)) : order.sales_order;

  if (moId && (!deadlineSpk || !qtySpk)) {
    try {
      const mos = await adminOdooClient._callObject('mrp.production', 'read', [[moId]], {
        fields: ['id', 'name', 'state', 'date_planned_start', 'date_deadline', 'product_qty', 'sale_id']
      });
      if (mos && mos[0]) {
        const m = mos[0];
        moState = m.state || moState;
        if (!startSpk && m.date_planned_start) startSpk = m.date_planned_start.split(' ')[0];
        if (!deadlineSpk && m.date_deadline) deadlineSpk = m.date_deadline.split(' ')[0];
        if (!qtySpk && m.product_qty) qtySpk = Number(m.product_qty);
        if (!salesOrder && m.sale_id) salesOrder = Array.isArray(m.sale_id) ? m.sale_id[1] : String(m.sale_id);
      }
    } catch (e) {}
  }

  const cVal = w.x_studio_consumption_per_pcs_1 !== undefined && w.x_studio_consumption_per_pcs_1 !== false
    ? Number(w.x_studio_consumption_per_pcs_1)
    : null;
  const cUom = w.x_studio_unit_consumption_per_pcs
    ? (Array.isArray(w.x_studio_unit_consumption_per_pcs) ? w.x_studio_unit_consumption_per_pcs[1] : String(w.x_studio_unit_consumption_per_pcs))
    : null;

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

  await wipRepo.upsertWipOrder({
    odoo_wip_id: w.id,
    odoo_mo_id: moId,
    odoo_warehouse_id: whId,
    vendor_name: whName,
    mo_name: w.x_name,
    mo_state: moState,
    sales_order: salesOrder,
    product_name: w.x_studio_product ? w.x_studio_product[1] : order.product_name,
    qty_spk: qtySpk,
    start_spk: startSpk,
    deadline_spk: deadlineSpk,
    qty_kebutuhan_kain: Number(w.x_studio_qty_kebutuhan_kain || 0),
    kain_dari_gudang: Number(w.x_studio_kain_dari_gudang_qty || 0),
    unit_kain: w.x_studio_unit_kain_dari_gudang ? (Array.isArray(w.x_studio_unit_kain_dari_gudang) ? w.x_studio_unit_kain_dari_gudang[1] : w.x_studio_unit_kain_dari_gudang) : 'yard',
    consumption_per_pcs: cVal,
    consumption_uom: cUom,
    accessories_dari_gudang: Number(w.x_studio_accessories_dari_gudang || 0),
    estimasi_dari_spb: Number(w.x_studio_estimasi_dari_spb || 0),
    status_kebutuhan_kain: w.x_studio_status_kebutuhan_kain || 'Belum Terpenuhi',
    actual_cutting: Number(w.x_studio_actual_cutting || 0),
    selisih_hasil_cutting: Number(w.x_studio_selisih_hasil_cutting || 0),
    qty_grade_a: Number(w.x_studio_qty_kirim_a_grade || 0),
    qty_grade_b: Number(w.x_studio_qty_kirim_b_grade || 0),
    sisa_makloon_kg: Number(w.x_studio_sisa_makloon_kg || 0),
    sisa_potong_panjang: Number(w.x_studio_sisa_potong_panjang || 0),
    sisa_potong_sedang: Number(w.x_studio_sisa_potong_sedang || 0),
    sisa_potong_pendek: Number(w.x_studio_sisa_potong_pendek || 0),
    no_surat_jalan_sfp: w.x_studio_no_surat_jalan_sfp || null,
    tanggal_sfp: w.x_studio_tanggal_sfp || null,
    qty_masuk_sfp: qtyMasukSfp,
    harga_vendor: hargaVendor,
    total_harga: totalHarga,
    status_produksi: w.x_studio_status_produksi || 'Proses',
    odoo_write_date: w.write_date
  });

  // Sync roll lines if any
  if (w.x_studio_detail_roll_kain && w.x_studio_detail_roll_kain.length > 0) {
    const rolls = await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'read', [
      w.x_studio_detail_roll_kain,
      ['id', 'x_name', 'x_studio_kode_warna_roll', 'x_studio_yards', 'x_studio_uom', 'x_studio_qty_penerimaan', 'x_studio_qty_berat_kg']
    ]);
    await wipRepo.upsertRollLines(order.id, rolls);
  }

  // Invalidate caches
  rawMovesCache.delete(order.odoo_mo_id);
  transfersCache.delete(order.odoo_mo_id);

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
      [
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
        'write_date'
      ]
    ]);

    for (const w of wips) {
      try {
        const moId = w.x_studio_manufacturing_order ? w.x_studio_manufacturing_order[0] : 0;
        const whId = w.x_studio_warehouse ? w.x_studio_warehouse[0] : 0;
        const whName = w.x_studio_warehouse ? w.x_studio_warehouse[1] : 'Unknown';

        const cVal = w.x_studio_consumption_per_pcs_1 !== undefined && w.x_studio_consumption_per_pcs_1 !== false
          ? Number(w.x_studio_consumption_per_pcs_1)
          : null;
        const cUom = w.x_studio_unit_consumption_per_pcs
          ? (Array.isArray(w.x_studio_unit_consumption_per_pcs) ? w.x_studio_unit_consumption_per_pcs[1] : String(w.x_studio_unit_consumption_per_pcs))
          : null;

        const savedId = await wipRepo.upsertWipOrder({
          odoo_wip_id: w.id,
          odoo_mo_id: moId,
          odoo_warehouse_id: whId,
          vendor_name: whName,
          mo_name: w.x_name || `WIP#${w.id}`,
          mo_state: 'confirmed',
          sales_order: w.x_studio_sales_order ? (Array.isArray(w.x_studio_sales_order) ? w.x_studio_sales_order[1] : String(w.x_studio_sales_order)) : null,
          product_name: w.x_studio_product ? w.x_studio_product[1] : '-',
          qty_spk: Number(w.x_studio_qty_spk || 0),
          start_spk: w.x_studio_start_spk || null,
          deadline_spk: w.x_studio_deadline_spk || null,
          qty_kebutuhan_kain: Number(w.x_studio_qty_kebutuhan_kain || 0),
          kain_dari_gudang: Number(w.x_studio_kain_dari_gudang_qty || 0),
          unit_kain: w.x_studio_unit_kain_dari_gudang ? (Array.isArray(w.x_studio_unit_kain_dari_gudang) ? w.x_studio_unit_kain_dari_gudang[1] : w.x_studio_unit_kain_dari_gudang) : 'yard',
          consumption_per_pcs: cVal,
          consumption_uom: cUom,
          accessories_dari_gudang: Number(w.x_studio_accessories_dari_gudang || 0),
          estimasi_dari_spb: Number(w.x_studio_estimasi_dari_spb || 0),
          status_kebutuhan_kain: w.x_studio_status_kebutuhan_kain || 'Belum Terpenuhi',
          actual_cutting: Number(w.x_studio_actual_cutting || 0),
          selisih_hasil_cutting: Number(w.x_studio_selisih_hasil_cutting || 0),
          qty_grade_a: Number(w.x_studio_qty_kirim_a_grade || 0),
          qty_grade_b: Number(w.x_studio_qty_kirim_b_grade || 0),
          sisa_makloon_kg: Number(w.x_studio_sisa_makloon_kg || 0),
          sisa_potong_panjang: Number(w.x_studio_sisa_potong_panjang || 0),
          sisa_potong_sedang: Number(w.x_studio_sisa_potong_sedang || 0),
          sisa_potong_pendek: Number(w.x_studio_sisa_potong_pendek || 0),
          no_surat_jalan_sfp: w.x_studio_no_surat_jalan_sfp || null,
          tanggal_sfp: w.x_studio_tanggal_sfp || null,
          qty_masuk_sfp: Number(w.x_studio_qty_masuk_sfp || 0),
          harga_vendor: Number(w.x_studio_harga || 0),
          total_harga: Number(w.x_studio_total_harga || 0),
          status_produksi: w.x_studio_status_produksi || 'Proses',
          odoo_write_date: w.write_date
        });

        // Roll lines
        if (w.x_studio_detail_roll_kain && w.x_studio_detail_roll_kain.length > 0) {
          const rolls = await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'read', [
            w.x_studio_detail_roll_kain,
            ['id', 'x_name', 'x_studio_kode_warna_roll', 'x_studio_yards', 'x_studio_uom', 'x_studio_qty_penerimaan', 'x_studio_qty_berat_kg']
          ]);
          await wipRepo.upsertRollLines(savedId, rolls);
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
    console.log(`[WipSyncService] Checking WIP record for MO ID #${id}...`);

    const existingWips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search_read', [
      [['x_studio_manufacturing_order', '=', id]]
    ], { fields: ['id', 'x_name'] });

    if (existingWips && existingWips.length > 0) {
      console.log(`[WipSyncService] WIP record already exists for MO #${id} (WIP ID: ${existingWips[0].id}, Name: ${existingWips[0].x_name}). Skipping creation.`);
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
    const mos = await adminOdooClient._callObject('mrp.production', 'search_read', [
      [['name', '=', picking.origin.trim()]]
    ], { fields: ['id', 'name'], limit: 1 });
    if (mos && mos.length > 0) {
      moIds.push(mos[0].id);
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
        'x_studio_status_produksi', 'x_studio_qty_spk', 'x_studio_start_spk', 'x_studio_deadline_spk'
      ]
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
        if (name.includes('/SFP/') && p.origin === moName) return true;
        return false;
      })
      .map(p => p.id);

    const donePickings = allPickings.filter(p => p.state === 'done');
    const donePcSpb = donePickings.filter(p => (p.name || '').includes('/PC/') || (p.name || '').includes('/SPB/'));
    const doneSfp = donePickings.filter(p => (p.name || '').includes('/SFP/') && p.origin === moName).sort((a, b) => new Date(a.date_done || 0) - new Date(b.date_done || 0));

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
        const prodName = (l.product_id && l.product_id[1] ? l.product_id[1] : '').toUpperCase();
        if (prodName.includes('KAIN')) {
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
          ['quantity']
        ]);
        sfpLineQty = sfpLines.reduce((sum, l) => sum + (parseFloat(l.quantity) || 0.0), 0.0);
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
