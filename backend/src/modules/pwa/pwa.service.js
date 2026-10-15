import { db } from '../../core/database/mysql.js';
import { outboxWorker } from './outbox.worker.js';

export class PwaService {
  /**
   * Get orders list with pagination, search, and strict role security
   */
  async getOrders({ user, search, status, vendorId, page = 1, limit = 20 }) {
    const offset = (Math.max(1, Number(page)) - 1) * Number(limit);
    const conditions = ['w.is_active = 1'];
    const params = [];

    // 1. Role-based Vendor Filter
    const isVendorRole = ['master_vendor', 'admin_vendor'].includes(user.role);
    if (isVendorRole) {
      conditions.push('w.vendor_id = ?');
      params.push(user.vendor_id);
    } else if (vendorId) {
      conditions.push('w.vendor_id = ?');
      params.push(Number(vendorId));
    }

    // 2. Search (Forgiving 3-4 digit search, ID with #, MO, product name, SO)
    if (search && search.trim()) {
      const rawTerm = search.trim();
      const q = `%${rawTerm}%`;
      const numOnly = rawTerm.replace(/[^0-9]/g, '');

      if (numOnly) {
        const qNum = `%${numOnly}%`;
        conditions.push('(w.id = ? OR w.mo_name LIKE ? OR w.mo_name LIKE ? OR w.product_name LIKE ? OR w.sales_order LIKE ?)');
        params.push(Number(numOnly), q, qNum, q, q);
      } else {
        conditions.push('(w.mo_name LIKE ? OR w.product_name LIKE ? OR w.sales_order LIKE ?)');
        params.push(q, q, q);
      }
    }

    // 3. Status filter
    if (status === 'cutting_pending') {
      conditions.push('w.cutting_locked_at IS NULL AND w.parent_wip_order_id IS NULL');
    } else if (status === 'cutting_locked') {
      conditions.push('(w.cutting_locked_at IS NOT NULL OR w.parent_wip_order_id IS NOT NULL)');
    } else if (status === 'result_pending') {
      conditions.push('w.result_locked_at IS NULL');
    } else if (status === 'result_locked') {
      conditions.push('w.result_locked_at IS NOT NULL');
    } else if (status === 'kain_kurang') {
      conditions.push("(w.status_kebutuhan_kain = 'Kurang' OR w.status_kebutuhan_kain LIKE '%Kurang%')");
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Price visibility: strip prices completely if admin_vendor
    const showPrice = user.role !== 'admin_vendor';
    const priceFields = showPrice
      ? 'w.harga_vendor, w.total_harga,'
      : '0.00 AS harga_vendor, 0.00 AS total_harga,';

    // Count query
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM wip_orders w ${whereClause}`,
      params
    );
    const total = countRows[0].total;

    // Count total active orders with kain kurang for current vendor scope
    const baseVendorConditions = ['w.is_active = 1'];
    const baseVendorParams = [];
    if (isVendorRole) {
      baseVendorConditions.push('w.vendor_id = ?');
      baseVendorParams.push(user.vendor_id);
    } else if (vendorId) {
      baseVendorConditions.push('w.vendor_id = ?');
      baseVendorParams.push(Number(vendorId));
    }
    const [kainKurangRows] = await db.query(
      `SELECT COUNT(*) AS total FROM wip_orders w WHERE ${baseVendorConditions.join(' AND ')} AND (w.status_kebutuhan_kain = 'Kurang' OR w.status_kebutuhan_kain LIKE '%Kurang%')`,
      baseVendorParams
    );
    const kainKurangCount = kainKurangRows[0]?.total || 0;

    // Data query
    const selectSql = `
      SELECT
        w.id, w.odoo_wip_id, w.odoo_mo_id, w.vendor_id, v.name AS vendor_name,
        w.parent_wip_order_id, (w.parent_wip_order_id IS NOT NULL) AS is_backorder,
        w.mo_name, w.mo_state,
        COALESCE(NULLIF(w.sales_order, ''), parent.sales_order) AS sales_order,
        w.product_name,
        w.qty_spk, w.start_spk, w.deadline_spk,
        w.qty_kebutuhan_kain, w.kain_dari_gudang, w.unit_kain,
        w.accessories_dari_gudang, w.estimasi_dari_spb, w.status_kebutuhan_kain,
        w.actual_cutting, w.selisih_hasil_cutting,
        w.qty_grade_a, w.qty_grade_b, w.sisa_makloon_kg,
        w.no_surat_jalan_sfp, w.tanggal_sfp, w.qty_masuk_sfp,
        ${priceFields}
        w.status_produksi,
        w.cutting_locked_at, w.result_locked_at,
        w.updated_at
      FROM wip_orders w
      JOIN vendors v ON v.id = w.vendor_id
      LEFT JOIN wip_orders parent ON parent.id = w.parent_wip_order_id
      ${whereClause}
      ORDER BY w.id DESC
      LIMIT ? OFFSET ?
    `;

    const [orders] = await db.query(selectSql, [...params, Number(limit), Number(offset)]);

    return {
      orders,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
        kainKurangCount
      }
    };
  }

  /**
   * Get single order details and its roll lines
   */
  async getOrderDetails({ user, orderId }) {
    const showPrice = user.role !== 'admin_vendor';
    const priceFields = showPrice
      ? 'w.harga_vendor, w.total_harga,'
      : '0.00 AS harga_vendor, 0.00 AS total_harga,';

    const [rows] = await db.query(
      `SELECT
        w.id, w.odoo_wip_id, w.odoo_mo_id, w.vendor_id, v.name AS vendor_name,
        w.parent_wip_order_id, (w.parent_wip_order_id IS NOT NULL) AS is_backorder,
        w.mo_name, w.mo_state,
        COALESCE(NULLIF(w.sales_order, ''), parent.sales_order) AS sales_order,
        w.product_name,
        w.qty_spk, w.start_spk, w.deadline_spk,
        w.qty_kebutuhan_kain, w.kain_dari_gudang, w.unit_kain,
        w.accessories_dari_gudang, w.estimasi_dari_spb, w.status_kebutuhan_kain,
        w.actual_cutting, w.selisih_hasil_cutting,
        w.qty_grade_a, w.qty_grade_b, w.sisa_makloon_kg,
        w.no_surat_jalan_sfp, w.tanggal_sfp, w.qty_masuk_sfp,
        ${priceFields}
        w.status_produksi,
        w.cutting_locked_at, w.result_locked_at,
        w.updated_at
       FROM wip_orders w
       JOIN vendors v ON v.id = w.vendor_id
       LEFT JOIN wip_orders parent ON parent.id = w.parent_wip_order_id
       WHERE w.id = ?`,
      [orderId]
    );

    if (rows.length === 0) {
      throw new Error(`Order #${orderId} not found`);
    }

    const order = rows[0];

    // Enforce vendor access control
    const isVendorRole = ['master_vendor', 'admin_vendor'].includes(user.role);
    if (isVendorRole && order.vendor_id !== user.vendor_id) {
      throw new Error('Anda tidak memiliki izin untuk melihat order ini');
    }

    // Fetch roll lines
    const [rollLines] = await db.query(
      `SELECT id, odoo_line_id, line_type, nama_item, kode_lot, qty, uom, qty_berat_kg, updated_at
       FROM wip_roll_lines
       WHERE wip_order_id = ?
       ORDER BY line_type ASC, id ASC`,
      [orderId]
    );

    return {
      order,
      rollLines
    };
  }

  /**
   * Submit physical cutting results and/or roll weights (locks cutting stage)
   */
  async submitCuttingRolls({ user, orderId, rollUpdates = [], actualCutting }) {
    const { order, rollLines } = await this.getOrderDetails({ user, orderId });

    if (order.is_backorder) {
      throw new Error('MO Backorder tidak perlu diinput ulang (mengikuti MO induk)');
    }

    if (order.cutting_locked_at) {
      throw new Error('Tahap hasil potong sudah terkunci. Hubungi Master Admin untuk unlock.');
    }

    const beforeData = {
      actual_cutting: order.actual_cutting,
      lines: rollLines.map(r => ({ id: r.id, kode_lot: r.kode_lot, qty_berat_kg: r.qty_berat_kg }))
    };

    // 1. Update physical quantities in MySQL roll lines if provided
    if (Array.isArray(rollUpdates) && rollUpdates.length > 0) {
      for (const u of rollUpdates) {
        const lineId = Number(u.id || u.line_id);
        const berat = Math.max(0, parseFloat(u.qty_berat_kg || 0));
        await db.query(
          'UPDATE wip_roll_lines SET qty_berat_kg = ? WHERE id = ? AND wip_order_id = ?',
          [berat, lineId, orderId]
        );
      }
    }

    // 2. Determine actual cutting output
    let finalActualCutting = 0.0;
    if (actualCutting !== undefined && actualCutting !== null && actualCutting !== '') {
      finalActualCutting = Math.max(0, parseFloat(actualCutting) || 0);
    } else {
      // If not explicitly provided, calculate sum of fabric lines ('kain')
      const [updatedLines] = await db.query(
        'SELECT qty_berat_kg FROM wip_roll_lines WHERE wip_order_id = ? AND line_type = "kain"',
        [orderId]
      );
      const sumKain = updatedLines.reduce((sum, l) => sum + (parseFloat(l.qty_berat_kg) || 0), 0);
      if (sumKain > 0) {
        finalActualCutting = sumKain;
      } else {
        finalActualCutting = parseFloat(order.actual_cutting) || 0.0;
      }
    }

    const selisihCutting = finalActualCutting - Number(order.estimasi_dari_spb || 0);

    // 3. Lock cutting stage in wip_orders
    await db.query(
      `UPDATE wip_orders 
       SET actual_cutting = ?, selisih_hasil_cutting = ?, 
           cutting_locked_at = NOW(), cutting_locked_by = ? 
       WHERE id = ?`,
      [finalActualCutting, selisihCutting, user.id, orderId]
    );

    // 4. Enqueue to sync_outbox with both actualCutting and rollUpdates
    const formattedRollUpdates = (rollUpdates || []).map(u => ({
      id: u.odoo_line_id || u.id || u.line_id,
      qty_berat_kg: u.qty_berat_kg
    }));

    await db.query(
      `INSERT INTO sync_outbox (wip_order_id, action, payload, created_by)
       VALUES (?, 'cutting_rolls', ?, ?)`,
      [
        orderId,
        JSON.stringify({
          actualCutting: finalActualCutting,
          rollUpdates: formattedRollUpdates
        }),
        user.id
      ]
    );

    // 5. Record audit log
    await db.query(
      `INSERT INTO audit_logs (user_id, wip_order_id, action, before_data, after_data)
       VALUES (?, ?, 'submit_cutting', ?, ?)`,
      [user.id, orderId, JSON.stringify(beforeData), JSON.stringify({ actualCutting: finalActualCutting, rollUpdates })]
    );

    // 6. Trigger outbox worker asynchronously
    outboxWorker.processOutbox().catch(() => {});

    return {
      success: true,
      message: 'Hasil potong berhasil disimpan dan terkunci.',
      actualCutting: finalActualCutting,
      selisihCutting
    };
  }

  /**
   * Submit final production results (locks result stage)
   */
  async submitProductionResult({ user, orderId, qtyGradeA, qtyGradeB, sisaMakloonKg, noSuratJalan }) {
    const { order } = await this.getOrderDetails({ user, orderId });

    if (order.result_locked_at) {
      throw new Error('Laporan hasil jahit sudah terkunci. Hubungi Master Admin untuk unlock.');
    }

    const aGrade = Math.max(0, Number(qtyGradeA || 0));
    const bGrade = Math.max(0, Number(qtyGradeB || 0));
    const sisaKg = Math.max(0, Number(sisaMakloonKg || 0));

    const beforeData = {
      qty_grade_a: order.qty_grade_a,
      qty_grade_b: order.qty_grade_b,
      sisa_makloon_kg: order.sisa_makloon_kg
    };

    // 1. Update in MySQL
    await db.query(
      `UPDATE wip_orders 
       SET qty_grade_a = ?, qty_grade_b = ?, sisa_makloon_kg = ?,
           result_locked_at = NOW(), result_locked_by = ?
       WHERE id = ?`,
      [aGrade, bGrade, sisaKg, user.id, orderId]
    );

    // 2. Enqueue to sync_outbox
    await db.query(
      `INSERT INTO sync_outbox (wip_order_id, action, payload, created_by)
       VALUES (?, 'production_result', ?, ?)`,
      [
        orderId,
        JSON.stringify({
          qtyGradeA: aGrade,
          qtyGradeB: bGrade,
          sisaMakloonKg: sisaKg,
          noSuratJalan: noSuratJalan || ''
        }),
        user.id
      ]
    );

    // 3. Record audit log
    await db.query(
      `INSERT INTO audit_logs (user_id, wip_order_id, action, before_data, after_data)
       VALUES (?, ?, 'submit_result', ?, ?)`,
      [
        user.id,
        orderId,
        JSON.stringify(beforeData),
        JSON.stringify({ qtyGradeA: aGrade, qtyGradeB: bGrade, sisaMakloonKg: sisaKg, noSuratJalan })
      ]
    );

    // 4. Trigger outbox worker asynchronously
    outboxWorker.processOutbox().catch(() => {});

    return {
      success: true,
      message: 'Hasil jahit berhasil dilaporkan dan terkunci.',
      qtyGradeA: aGrade,
      qtyGradeB: bGrade,
      sisaMakloonKg: sisaKg
    };
  }

  /**
   * Unlock Order (Master Admin only!)
   */
  async unlockOrder({ user, orderId, unlockType, reason }) {
    if (user.role !== 'master_admin') {
      throw new Error('Hanya Master Admin yang berhak membuka kunci (unlock)');
    }

    if (!reason || !reason.trim()) {
      throw new Error('Alasan unlock wajib diisi untuk catatan audit');
    }

    const { order } = await this.getOrderDetails({ user, orderId });

    if (unlockType === 'cutting') {
      await db.query(
        'UPDATE wip_orders SET cutting_locked_at = NULL, cutting_locked_by = NULL WHERE id = ?',
        [orderId]
      );
    } else if (unlockType === 'result') {
      await db.query(
        'UPDATE wip_orders SET result_locked_at = NULL, result_locked_by = NULL WHERE id = ?',
        [orderId]
      );
    } else {
      throw new Error('Tipe unlock tidak valid (pilih "cutting" atau "result")');
    }

    // Record audit log
    await db.query(
      `INSERT INTO audit_logs (user_id, wip_order_id, action, reason)
       VALUES (?, ?, ?, ?)`,
      [user.id, orderId, `unlock_${unlockType}`, reason.trim()]
    );

    return {
      success: true,
      message: `Kunci tahap ${unlockType} berhasil dibuka kembali.`
    };
  }

  /**
   * Get active vendors list for dropdowns (internal/admin)
   */
  async getVendors() {
    const [rows] = await db.query(
      'SELECT id, odoo_warehouse_id, name FROM vendors WHERE is_active = 1 ORDER BY name ASC'
    );
    return rows;
  }
}

export const pwaService = new PwaService();
