import { supabaseServer } from '../supabaseServer.js';

class WipRepository {
  constructor() {
    this.vendorCache = new Map();
  }

  async ensureVendor(odooWarehouseId, warehouseName = 'UNKNOWN VENDOR') {
    if (!odooWarehouseId) return null;
    const whId = Number(odooWarehouseId);

    if (this.vendorCache.has(whId)) {
      return this.vendorCache.get(whId);
    }

    const { data: existing } = await supabaseServer
      .from('vendors')
      .select('id, name')
      .eq('odoo_warehouse_id', whId)
      .maybeSingle();

    if (existing) {
      this.vendorCache.set(whId, existing.id);
      return existing.id;
    }

    const { data: inserted, error } = await supabaseServer
      .from('vendors')
      .insert({
        odoo_warehouse_id: whId,
        name: warehouseName,
        is_active: true
      })
      .select('id')
      .single();

    if (error) {
      // Could be duplicate key race
      const { data: fallback } = await supabaseServer
        .from('vendors')
        .select('id')
        .eq('odoo_warehouse_id', whId)
        .single();
      if (fallback) {
        this.vendorCache.set(whId, fallback.id);
        return fallback.id;
      }
      throw error;
    }

    this.vendorCache.set(whId, inserted.id);
    return inserted.id;
  }

  async upsertWipOrder(data) {
    if (!data.odoo_wip_id) {
      throw new Error('odoo_wip_id is required');
    }

    const vendorId = data.vendor_id || (await this.ensureVendor(data.odoo_warehouse_id, data.vendor_name));
    if (!vendorId) {
      throw new Error(`Cannot determine vendor_id for WIP #${data.odoo_wip_id}`);
    }

    let parentWipOrderId = data.parent_wip_order_id || null;
    if (!parentWipOrderId && data.parent_mo_name) {
      const { data: parent } = await supabaseServer
        .from('wip_orders')
        .select('id')
        .eq('mo_name', data.parent_mo_name)
        .maybeSingle();
      if (parent) {
        parentWipOrderId = parent.id;
      }
    }

    // Auto-detect parent if MO name has backorder suffix like -002, -005, etc.
    if (!parentWipOrderId && data.mo_name) {
      const match = data.mo_name.match(/-(\d+)$/);
      if (match && parseInt(match[1], 10) > 1) {
        const basePrefix = data.mo_name.replace(/-\d+$/, '');
        const { data: parent } = await supabaseServer
          .from('wip_orders')
          .select('id')
          .or(`mo_name.eq.${basePrefix}-001,mo_name.eq.${basePrefix}`)
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (parent) {
          parentWipOrderId = parent.id;
        }
      }
    }

    let salesOrder = (data.sales_order && data.sales_order !== '-') ? data.sales_order : null;

    // Inherit sales_order from parent WIP order if missing
    if (!salesOrder && parentWipOrderId) {
      const { data: parent } = await supabaseServer
        .from('wip_orders')
        .select('sales_order')
        .eq('id', parentWipOrderId)
        .maybeSingle();
      if (parent && parent.sales_order && parent.sales_order !== '-') {
        salesOrder = parent.sales_order;
      }
    }

    // Inherit sales_order from sibling MO with same base prefix
    if (!salesOrder && data.mo_name) {
      const basePrefix = data.mo_name.replace(/-\d+$/, '');
      const { data: sibling } = await supabaseServer
        .from('wip_orders')
        .select('sales_order')
        .or(`mo_name.eq.${basePrefix},mo_name.eq.${basePrefix}-001,mo_name.ilike.${basePrefix}%`)
        .not('sales_order', 'is', null)
        .not('sales_order', 'eq', '-')
        .limit(1)
        .maybeSingle();
      if (sibling && sibling.sales_order) {
        salesOrder = sibling.sales_order;
      }
    }

    const payload = {
      odoo_wip_id: Number(data.odoo_wip_id),
      odoo_mo_id: Number(data.odoo_mo_id),
      vendor_id: vendorId,
      parent_wip_order_id: parentWipOrderId,
      mo_name: data.mo_name,
      mo_state: data.mo_state || 'draft',
      sales_order: salesOrder,
      product_name: data.product_name || null,
      qty_spk: Number(data.qty_spk || 0),
      start_spk: data.start_spk || null,
      deadline_spk: data.deadline_spk || null,
      qty_kebutuhan_kain: Number(data.qty_kebutuhan_kain || 0),
      kain_dari_gudang: Number(data.kain_dari_gudang || 0),
      unit_kain: data.unit_kain || 'yard',
      consumption_per_pcs: data.consumption_per_pcs ? Number(data.consumption_per_pcs) : null,
      consumption_uom: data.consumption_uom || null,
      accessories_dari_gudang: Number(data.accessories_dari_gudang || 0),
      estimasi_dari_spb: Number(data.estimasi_dari_spb || 0),
      status_kebutuhan_kain: data.status_kebutuhan_kain || 'Belum Terpenuhi',
      actual_cutting: Number(data.actual_cutting || 0),
      selisih_hasil_cutting: Number(data.selisih_hasil_cutting || 0),
      qty_grade_a: Number(data.qty_grade_a || 0),
      qty_grade_b: Number(data.qty_grade_b || 0),
      sisa_makloon_kg: Number(data.sisa_makloon_kg || 0),
      sisa_potong_panjang: data.sisa_potong_panjang !== undefined ? Number(data.sisa_potong_panjang || 0) : undefined,
      sisa_potong_sedang: data.sisa_potong_sedang !== undefined ? Number(data.sisa_potong_sedang || 0) : undefined,
      sisa_potong_pendek: data.sisa_potong_pendek !== undefined ? Number(data.sisa_potong_pendek || 0) : undefined,
      finishing: data.finishing !== undefined ? data.finishing : undefined,
      packing: data.packing !== undefined ? data.packing : undefined,
      qc_pass_id: data.qc_pass_id !== undefined ? (data.qc_pass_id ? Number(data.qc_pass_id) : null) : undefined,
      qc_pass_name: data.qc_pass_name !== undefined ? data.qc_pass_name : undefined,
      qty_qc_pass: data.qty_qc_pass !== undefined ? Number(data.qty_qc_pass || 0) : undefined,
      qc_status: data.qc_status !== undefined ? data.qc_status : undefined,
      keterangan_qms: data.keterangan_qms !== undefined ? data.keterangan_qms : undefined,
      gambar_qc: data.gambar_qc !== undefined ? data.gambar_qc : undefined,
      qc_checked_at: data.qc_checked_at !== undefined ? data.qc_checked_at : undefined,
      qc_checked_by: data.qc_checked_by !== undefined ? data.qc_checked_by : undefined,
      no_surat_jalan_sfp: data.no_surat_jalan_sfp || null,
      tanggal_sfp: data.tanggal_sfp || null,
      qty_masuk_sfp: Number(data.qty_masuk_sfp || 0),
      harga_vendor: Number(data.harga_vendor || 0),
      total_harga: Number(data.total_harga || 0),
      status_produksi: data.status_produksi || 'Proses',
      is_active: data.is_active !== undefined ? Boolean(data.is_active) : true,
      odoo_write_date: data.odoo_write_date || new Date().toISOString()
    };

    Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);

    let { data: upserted, error } = await supabaseServer
      .from('wip_orders')
      .upsert(payload, { onConflict: 'odoo_wip_id' })
      .select('id')
      .single();

    if (error && (error.code === '42703' || error.message?.includes('does not exist') || error.message?.includes('sisa_potong') || error.message?.includes('qc_') || error.message?.includes('finishing') || error.message?.includes('packing'))) {
      const fallbackPayload = { ...payload };
      delete fallbackPayload.sisa_potong_panjang;
      delete fallbackPayload.sisa_potong_sedang;
      delete fallbackPayload.sisa_potong_pendek;
      delete fallbackPayload.finishing;
      delete fallbackPayload.packing;
      delete fallbackPayload.qc_pass_id;
      delete fallbackPayload.qc_pass_name;
      delete fallbackPayload.qty_qc_pass;
      delete fallbackPayload.qc_status;
      delete fallbackPayload.keterangan_qms;
      delete fallbackPayload.gambar_qc;
      delete fallbackPayload.qc_checked_at;
      delete fallbackPayload.qc_checked_by;
      const resFallback = await supabaseServer
        .from('wip_orders')
        .upsert(fallbackPayload, { onConflict: 'odoo_wip_id' })
        .select('id')
        .single();
      upserted = resFallback.data;
      error = resFallback.error;
    }

    if (error) {
      console.error('[WipRepo] upsertWipOrder error:', error.message);
      throw error;
    }

    return upserted.id;
  }

  async upsertRollLines(wipOrderId, lines) {
    if (!wipOrderId || !Array.isArray(lines) || lines.length === 0) return;

    for (const line of lines) {
      const namaItem = line.nama_item || line.x_name || line.product_name;
      if (!namaItem) continue;

      const kodeLot = line.kode_lot || line.x_studio_kode_warna_roll || 'Tanpa Lot';
      const lowerName = (namaItem || '').toLowerCase();
      const uomVal = (line.uom || line.x_studio_uom || 'yard').toLowerCase();
      const isAcc =
        lowerName.includes('hangtag') ||
        lowerName.includes('hang tag') ||
        lowerName.includes('pouch') ||
        lowerName.includes('barcode') ||
        lowerName.includes('kertas') ||
        lowerName.includes('label') ||
        lowerName.includes('plastik') ||
        lowerName.includes('polybag') ||
        lowerName.includes('opp') ||
        lowerName.includes('kancing') ||
        lowerName.includes('benang') ||
        lowerName.includes('zipper') ||
        lowerName.includes('resleting') ||
        lowerName.includes('sleting') ||
        lowerName.includes('acc') ||
        lowerName.includes('acces') ||
        lowerName.includes('aksesoris') ||
        lowerName.includes('pita') ||
        lowerName.includes('renda') ||
        lowerName.includes('kardus') ||
        lowerName.includes('box') ||
        lowerName.includes('tag pin') ||
        lowerName.includes('tali') ||
        lowerName.includes('stiker') ||
        lowerName.includes('sticker') ||
        (!lowerName.includes('kain') && ['pcs', 'lembar', 'buah', 'biji', 'pack', 'roll'].includes(uomVal));

      const lineType = line.line_type || (isAcc ? 'aksesoris' : (lowerName.includes('kain') ? 'kain' : 'aksesoris'));
      const qty = Number(line.qty || line.x_studio_yards || 0);
      const uom = line.uom || line.x_studio_uom || (isAcc ? 'pcs' : 'yard');
      const rawBerat = line.qty_berat_kg !== undefined ? line.qty_berat_kg : line.x_studio_qty_berat_kg;
      const qtyBeratKg = rawBerat !== null && rawBerat !== undefined && rawBerat !== '' ? Number(rawBerat) : null;
      const rawPenerimaan = line.qty_penerimaan !== undefined ? line.qty_penerimaan : line.x_studio_qty_penerimaan;
      const qtyPenerimaan = rawPenerimaan !== null && rawPenerimaan !== undefined && rawPenerimaan !== '' ? Number(rawPenerimaan) : qty;
      const odooLineId = line.odoo_line_id || line.id || null;

      const row = {
        wip_order_id: wipOrderId,
        line_type: lineType,
        nama_item: namaItem,
        kode_lot: kodeLot,
        qty,
        uom,
        updated_at: new Date().toISOString()
      };

      if (odooLineId) row.odoo_line_id = Number(odooLineId);
      if (qtyBeratKg !== null) row.qty_berat_kg = qtyBeratKg;
      if (qtyPenerimaan !== null) row.qty_penerimaan = qtyPenerimaan;

      const { error: upsertErr } = await supabaseServer
        .from('wip_roll_lines')
        .upsert(row, { onConflict: 'wip_order_id,nama_item,kode_lot' });

      if (upsertErr) {
        // Graceful fallback if qty_penerimaan column not yet migrated in Supabase
        if (upsertErr.message && upsertErr.message.includes('qty_penerimaan')) {
          delete row.qty_penerimaan;
          await supabaseServer
            .from('wip_roll_lines')
            .upsert(row, { onConflict: 'wip_order_id,nama_item,kode_lot' });
        } else {
          console.warn('[WipRepo] upsertRollLines error:', upsertErr.message);
        }
      }
    }
  }

  async propagateRollWeightsToBackorders(parentWipOrderId) {
    // Check if there are backorders linked to this parent
    const { data: children } = await supabaseServer
      .from('wip_orders')
      .select('id')
      .eq('parent_wip_order_id', parentWipOrderId);

    if (!children || children.length === 0) return;

    // Get parent roll lines
    const { data: parentRolls } = await supabaseServer
      .from('wip_roll_lines')
      .select('*')
      .eq('wip_order_id', parentWipOrderId);

    if (!parentRolls || parentRolls.length === 0) return;

    for (const child of children) {
      for (const pr of parentRolls) {
        const childRow = {
          wip_order_id: child.id,
          line_type: pr.line_type,
          nama_item: pr.nama_item,
          kode_lot: pr.kode_lot,
          qty: pr.qty,
          uom: pr.uom,
          qty_berat_kg: pr.qty_berat_kg,
          updated_at: new Date().toISOString()
        };
        if (pr.qty_penerimaan !== undefined) {
          childRow.qty_penerimaan = pr.qty_penerimaan;
        }

        const { error: childErr } = await supabaseServer
          .from('wip_roll_lines')
          .upsert(childRow, { onConflict: 'wip_order_id,nama_item,kode_lot' });

        if (childErr && childErr.message && childErr.message.includes('qty_penerimaan')) {
          delete childRow.qty_penerimaan;
          await supabaseServer
            .from('wip_roll_lines')
            .upsert(childRow, { onConflict: 'wip_order_id,nama_item,kode_lot' });
        }
      }
    }
  }

  async updateWipPricingByOdooId(odooWipId, { harga_vendor, total_harga }) {
    if (!odooWipId) return;
    const { error } = await supabaseServer
      .from('wip_orders')
      .update({
        harga_vendor: Number(harga_vendor || 0),
        total_harga: Number(total_harga || 0),
        updated_at: new Date().toISOString()
      })
      .eq('odoo_wip_id', odooWipId);

    if (error) {
      console.warn(`[WipRepo] updateWipPricingByOdooId error: ${error.message}`);
    }
  }

  async updateWipPricingById(orderId, { harga_vendor, total_harga }) {
    if (!orderId) return;
    const { error } = await supabaseServer
      .from('wip_orders')
      .update({
        harga_vendor: Number(harga_vendor || 0),
        total_harga: Number(total_harga || 0),
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (error) {
      console.warn(`[WipRepo] updateWipPricingById error: ${error.message}`);
    }
  }
}

export const wipRepo = new WipRepository();
