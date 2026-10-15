import { db } from '../../core/database/mysql.js';
import { logger } from '../../utils/logger.js';

export class WipMysqlRepo {
  constructor() {
    this.vendorCache = new Map(); // odoo_warehouse_id -> mysql vendor id
  }

  /**
   * Ensure vendor exists in MySQL vendors table and return its MySQL ID
   */
  async ensureVendor(odooWarehouseId, warehouseName = 'UNKNOWN VENDOR') {
    if (!odooWarehouseId) return null;
    const whId = Number(odooWarehouseId);

    if (this.vendorCache.has(whId)) {
      return this.vendorCache.get(whId);
    }

    // Try finding existing vendor
    const [rows] = await db.query(
      'SELECT id, name FROM vendors WHERE odoo_warehouse_id = ?',
      [whId]
    );

    if (rows.length > 0) {
      this.vendorCache.set(whId, rows[0].id);
      return rows[0].id;
    }

    // Insert new vendor
    const [res] = await db.query(
      'INSERT INTO vendors (odoo_warehouse_id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)',
      [whId, warehouseName]
    );
    const newId = res.insertId || (await this.ensureVendor(whId, warehouseName));
    this.vendorCache.set(whId, newId);
    return newId;
  }

  /**
   * Seed all Odoo vendor warehouses into MySQL
   */
  async seedVendors(odooVendors) {
    for (const v of odooVendors) {
      await this.ensureVendor(v.id, v.name);
    }
  }

  /**
   * Upsert a WIP Order into MySQL.
   * If a record already exists with odoo_wip_id, it updates fields conditionally.
   */
  async upsertWipOrder(data) {
    if (!data.odoo_wip_id) {
      throw new Error('odoo_wip_id is required for upsertWipOrder');
    }

    const vendorId = data.vendor_id || (await this.ensureVendor(data.odoo_warehouse_id, data.vendor_name));
    if (!vendorId) {
      throw new Error(`Cannot determine vendor_id for WIP #${data.odoo_wip_id} (Warehouse: ${data.odoo_warehouse_id})`);
    }

    // Find parent WIP Order ID if this is a backorder
    let parentWipOrderId = data.parent_wip_order_id || null;
    if (!parentWipOrderId && data.parent_mo_name) {
      const [parentRows] = await db.query(
        'SELECT id FROM wip_orders WHERE mo_name = ? LIMIT 1',
        [data.parent_mo_name]
      );
      if (parentRows.length > 0) {
        parentWipOrderId = parentRows[0].id;
      }
    }

    const sql = `
      INSERT INTO wip_orders (
        odoo_wip_id, odoo_mo_id, vendor_id, parent_wip_order_id,
        mo_name, mo_state, sales_order, product_name,
        qty_spk, start_spk, deadline_spk,
        qty_kebutuhan_kain, kain_dari_gudang, unit_kain,
        consumption_per_pcs, consumption_uom,
        accessories_dari_gudang, estimasi_dari_spb, status_kebutuhan_kain,
        actual_cutting, selisih_hasil_cutting,
        qty_grade_a, qty_grade_b, sisa_makloon_kg,
        no_surat_jalan_sfp, tanggal_sfp, qty_masuk_sfp,
        harga_vendor, total_harga, status_produksi,
        is_active, odoo_write_date
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?
      )
      ON DUPLICATE KEY UPDATE
        odoo_mo_id = VALUES(odoo_mo_id),
        vendor_id = VALUES(vendor_id),
        parent_wip_order_id = COALESCE(VALUES(parent_wip_order_id), parent_wip_order_id),
        mo_name = VALUES(mo_name),
        mo_state = VALUES(mo_state),
        sales_order = VALUES(sales_order),
        product_name = VALUES(product_name),
        qty_spk = VALUES(qty_spk),
        start_spk = VALUES(start_spk),
        deadline_spk = VALUES(deadline_spk),
        qty_kebutuhan_kain = VALUES(qty_kebutuhan_kain),
        kain_dari_gudang = VALUES(kain_dari_gudang),
        unit_kain = VALUES(unit_kain),
        consumption_per_pcs = COALESCE(VALUES(consumption_per_pcs), consumption_per_pcs),
        consumption_uom = COALESCE(VALUES(consumption_uom), consumption_uom),
        accessories_dari_gudang = VALUES(accessories_dari_gudang),
        estimasi_dari_spb = VALUES(estimasi_dari_spb),
        status_kebutuhan_kain = VALUES(status_kebutuhan_kain),
        actual_cutting = VALUES(actual_cutting),
        selisih_hasil_cutting = VALUES(selisih_hasil_cutting),
        qty_grade_a = VALUES(qty_grade_a),
        qty_grade_b = VALUES(qty_grade_b),
        sisa_makloon_kg = VALUES(sisa_makloon_kg),
        no_surat_jalan_sfp = VALUES(no_surat_jalan_sfp),
        tanggal_sfp = VALUES(tanggal_sfp),
        qty_masuk_sfp = VALUES(qty_masuk_sfp),
        harga_vendor = VALUES(harga_vendor),
        total_harga = VALUES(total_harga),
        status_produksi = VALUES(status_produksi),
        is_active = VALUES(is_active),
        odoo_write_date = VALUES(odoo_write_date)
    `;

    const params = [
      data.odoo_wip_id,
      data.odoo_mo_id,
      vendorId,
      parentWipOrderId,
      data.mo_name,
      data.mo_state || 'confirmed',
      data.sales_order || null,
      data.product_name || null,
      Number(data.qty_spk || 0),
      data.start_spk || null,
      data.deadline_spk || null,
      Number(data.qty_kebutuhan_kain || 0),
      Number(data.kain_dari_gudang || 0),
      data.unit_kain || null,
      data.consumption_per_pcs !== undefined && data.consumption_per_pcs !== null ? Number(data.consumption_per_pcs) : null,
      data.consumption_uom || null,
      Number(data.accessories_dari_gudang || 0),
      Number(data.estimasi_dari_spb || 0),
      data.status_kebutuhan_kain || null,
      Number(data.actual_cutting || 0),
      Number(data.selisih_hasil_cutting || 0),
      Number(data.qty_grade_a || 0),
      Number(data.qty_grade_b || 0),
      Number(data.sisa_makloon_kg || 0),
      data.no_surat_jalan_sfp || null,
      data.tanggal_sfp || null,
      Number(data.qty_masuk_sfp || 0),
      Number(data.harga_vendor || 0),
      Number(data.total_harga || 0),
      data.status_produksi || 'Proses',
      data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1,
      data.odoo_write_date || null
    ];

    await db.query(sql, params);

    // Get the internal ID
    const [rows] = await db.query(
      'SELECT id FROM wip_orders WHERE odoo_wip_id = ?',
      [data.odoo_wip_id]
    );

    return rows[0].id;
  }

  /**
   * Upsert roll lines for a given wip_orders.id
   */
  async upsertRollLines(wipOrderId, lines) {
    if (!wipOrderId || !Array.isArray(lines) || lines.length === 0) {
      return;
    }

    const sql = `
      INSERT INTO wip_roll_lines (
        wip_order_id, odoo_line_id, line_type,
        nama_item, kode_lot, qty, uom, qty_berat_kg
      ) VALUES ?
      ON DUPLICATE KEY UPDATE
        odoo_line_id = COALESCE(VALUES(odoo_line_id), odoo_line_id),
        line_type = VALUES(line_type),
        qty = VALUES(qty),
        uom = VALUES(uom),
        qty_berat_kg = COALESCE(VALUES(qty_berat_kg), qty_berat_kg)
    `;

    const values = lines.map(l => {
      const isKain = (l.nama_item || l.x_name || '').toUpperCase().includes('KAIN');
      const lineType = isKain ? 'kain' : 'aksesoris';
      const kodeLot = l.kode_lot || l.x_studio_kode_warna_roll || 'Tanpa Lot';
      const namaItem = l.nama_item || l.x_name || 'Item';
      const qty = Number(l.qty !== undefined ? l.qty : (l.yards !== undefined ? l.yards : l.x_studio_yards)) || 0;
      const uom = l.uom || l.x_studio_uom || '';
      const berat = l.qty_berat_kg !== undefined ? Number(l.qty_berat_kg) : (l.x_studio_qty_berat_kg !== undefined ? Number(l.x_studio_qty_berat_kg) : null);

      return [
        wipOrderId,
        l.odoo_line_id || l.id || null,
        lineType,
        namaItem,
        kodeLot,
        qty,
        uom,
        berat
      ];
    });

    await db.query(sql, [values]);
  }

  /**
   * Propagate roll weights from parent WIP to its backorder children
   */
  async propagateRollWeightsToBackorders(parentWipOrderId) {
    if (!parentWipOrderId) return;

    // Fetch parent roll lines with weights
    const [parentRolls] = await db.query(
      'SELECT nama_item, kode_lot, qty_berat_kg FROM wip_roll_lines WHERE wip_order_id = ? AND qty_berat_kg IS NOT NULL',
      [parentWipOrderId]
    );

    if (parentRolls.length === 0) return;

    // Find all child backorders
    const [children] = await db.query(
      'SELECT id, odoo_wip_id FROM wip_orders WHERE parent_wip_order_id = ?',
      [parentWipOrderId]
    );

    for (const child of children) {
      for (const roll of parentRolls) {
        await db.query(
          'UPDATE wip_roll_lines SET qty_berat_kg = ? WHERE wip_order_id = ? AND nama_item = ? AND kode_lot = ?',
          [roll.qty_berat_kg, child.id, roll.nama_item, roll.kode_lot]
        );
      }
    }
  }
}

export const wipMysqlRepo = new WipMysqlRepo();
