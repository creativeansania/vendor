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

    const payload = {
      odoo_wip_id: Number(data.odoo_wip_id),
      odoo_mo_id: Number(data.odoo_mo_id),
      vendor_id: vendorId,
      parent_wip_order_id: parentWipOrderId,
      mo_name: data.mo_name,
      mo_state: data.mo_state || 'draft',
      sales_order: data.sales_order || null,
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
      no_surat_jalan_sfp: data.no_surat_jalan_sfp || null,
      tanggal_sfp: data.tanggal_sfp || null,
      qty_masuk_sfp: Number(data.qty_masuk_sfp || 0),
      harga_vendor: Number(data.harga_vendor || 0),
      total_harga: Number(data.total_harga || 0),
      status_produksi: data.status_produksi || 'Proses',
      is_active: data.is_active !== undefined ? Boolean(data.is_active) : true,
      odoo_write_date: data.odoo_write_date || new Date().toISOString()
    };

    const { data: upserted, error } = await supabaseServer
      .from('wip_orders')
      .upsert(payload, { onConflict: 'odoo_wip_id' })
      .select('id')
      .single();

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
      const lineType = line.line_type || 'kain';
      const qty = Number(line.qty || line.x_studio_yards || 0);
      const uom = line.uom || line.x_studio_uom || 'yard';
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
}

export const wipRepo = new WipRepository();
