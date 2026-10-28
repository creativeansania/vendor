import { adminOdooClient } from '../../../odoo/odooClient.js';
import { wipRepo } from '../../wipRepository.js';
import { withWipLock } from '../wipLock.js';
import { classifyMaterialLine } from '../../../utils/materialClassifier.js';
import { resolveFinishing } from './syncMapper.js';

async function reconcileAndBuildRollLines(wipId, wip, moName, pcMoveLines) {
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
      existingRollLines.map((l) => `${l.x_name || ''}:::${l.x_studio_kode_warna_roll || 'Tanpa Lot'}`)
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
          x_studio_qty_penerimaan: l.quantity,
          x_studio_qty_berat_kg: 0.0
        }]);
      }
    }
  }

  return { existingRollLines, newRollLines };
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
      return { wipId, updated: false };
    }

    const allPickings = await adminOdooClient._callObject('stock.picking', 'read', [
      pickingIds,
      ['id', 'name', 'state', 'origin', 'date_done', 'move_line_ids', 'picking_type_id']
    ]);

    const validDaftarTransferIds = allPickings
      .filter((p) => {
        const name = p.name || '';
        if (name.includes('/PC/') || name.includes('/SPB/')) return true;
        if (name.includes('/SFP/')) {
          const origins = (p.origin || '').split(',').map((s) => s.trim());
          if (origins.includes(moName)) return true;
        }
        return false;
      })
      .map((p) => p.id);

    const donePickings = allPickings.filter((p) => p.state === 'done');
    const donePcSpb = donePickings.filter((p) => (p.name || '').includes('/PC/') || (p.name || '').includes('/SPB/'));
    const doneSfp = donePickings.filter((p) => {
      if (!(p.name || '').includes('/SFP/')) return false;
      const origins = (p.origin || '').split(',').map((s) => s.trim());
      return origins.includes(moName);
    }).sort((a, b) => new Date(a.date_done || 0) - new Date(b.date_done || 0));

    const pcMoveLineIds = [...new Set(donePcSpb.flatMap((p) => p.move_line_ids || []))];
    let kainQty = 0.0;
    let totalMaterialQty = 0.0;
    let pcMoveLines = [];

    if (pcMoveLineIds.length > 0) {
      pcMoveLines = await adminOdooClient._callObject('stock.move.line', 'read', [
        pcMoveLineIds,
        ['id', 'product_id', 'lot_id', 'quantity', 'product_uom_id']
      ]);

      const activeMoveLines = pcMoveLines.filter((l) => (parseFloat(l.quantity) || 0) > 0);
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
    const { existingRollLines, newRollLines } = await reconcileAndBuildRollLines(wipId, wip, moName, pcMoveLines);

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
          ? sfpLines.filter((l) => l.product_id && l.product_id[0] === moProdId)
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
      ...newRollLines.map((r) => r[2])
    ];
    // Preserve actual_cutting (in pcs) stored on WIP rather than overwriting with kg sum if already filled
    const existingActualCuttingPcs = parseFloat(wip.x_studio_actual_cutting) || 0.0;
    const actualCutting = existingActualCuttingPcs > 0
      ? existingActualCuttingPcs
      : allLinesToSum
          .filter((l) => (l.x_name || '').toUpperCase().includes('KAIN'))
          .reduce((sum, l) => sum + (parseFloat(l.x_studio_qty_berat_kg) || 0.0), 0.0);

    const selisihCutting = actualCutting - estimasiDariSpb;

    let workcenterIds = [];
    if (mo.workorder_ids && mo.workorder_ids.length > 0) {
      try {
        const wos = await adminOdooClient._callObject('mrp.workorder', 'read', [
          mo.workorder_ids,
          ['workcenter_id']
        ]);
        workcenterIds = [...new Set(wos.filter((w) => w.workcenter_id).map((w) => w.workcenter_id[0]))];
      } catch (errWo) {
        console.warn(`[WipSyncService] Workcenter fetch error: ${errWo.message}`);
      }
    }

    let hargaVendor = parseFloat(wip.x_studio_harga) || 0.0;
    const warehouseId = mo.warehouse_id ? mo.warehouse_id[0] : (wip.x_studio_warehouse ? wip.x_studio_warehouse[0] : null);
    const productId = mo.product_id ? mo.product_id[0] : (wip.x_studio_product ? wip.x_studio_product[0] : null);

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
          const matched = vendorPrices.find((vp) => {
            const vpWcIds = vp.x_studio_many2many_field_7h1_1k3jdkeub || [];
            if (vpWcIds.length !== targetWcSet.size) return false;
            return vpWcIds.every((id) => targetWcSet.has(id));
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

    await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [[wipId], vals], {
      context: { tracking_disable: true, no_automation: true }
    });

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
        sales_order: mo.x_studio_sales_order
          ? (Array.isArray(mo.x_studio_sales_order) ? mo.x_studio_sales_order[1] : String(mo.x_studio_sales_order))
          : (wip.x_studio_sales_order ? (Array.isArray(wip.x_studio_sales_order) ? wip.x_studio_sales_order[1] : String(wip.x_studio_sales_order)) : null),
        product_name: mo.product_id
          ? (Array.isArray(mo.product_id) ? mo.product_id[1] : String(mo.product_id))
          : (wip.x_studio_product ? (Array.isArray(wip.x_studio_product) ? wip.x_studio_product[1] : String(wip.x_studio_product)) : null),
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

