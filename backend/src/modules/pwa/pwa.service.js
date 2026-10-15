import { db } from '../../core/database/mysql.js';
import { outboxWorker } from './outbox.worker.js';
import { adminOdooClient } from '../../core/odoo/odooClient.js';
import { wipMysqlRepo } from '../wip-vendor/wip.mysql.repo.js';

// In-memory caches for Odoo BOM stock moves and transfers to minimize XML-RPC calls
const rawMovesCache = new Map();
const transfersCache = new Map();
const RAW_MOVES_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export class PwaService {
  /**
   * Get orders list with pagination, search, advanced filters, sorting, and server-wide metrics
   */
  async getOrders({ user, search, status, vendorId, page =   1, limit = 20, sort = 'latest', period, backorder }) {
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
      conditions.push('(w.cutting_locked_at IS NOT NULL OR w.parent_wip_order_id IS NOT NULL) AND w.result_locked_at IS NULL');
    } else if (status === 'result_pending') {
      conditions.push('w.result_locked_at IS NULL');
    } else if (status === 'result_locked') {
      conditions.push('w.result_locked_at IS NOT NULL');
    } else if (status === 'kain_kurang') {
      conditions.push("(w.status_kebutuhan_kain = 'Kurang' OR w.status_kebutuhan_kain LIKE '%Kurang%')");
    } else if (status === 'overdue') {
      conditions.push('w.result_locked_at IS NULL AND w.deadline_spk IS NOT NULL AND w.deadline_spk < CURDATE()');
    } else if (status === 'deadline_week') {
      conditions.push('w.result_locked_at IS NULL AND w.deadline_spk IS NOT NULL AND w.deadline_spk >= CURDATE() AND w.deadline_spk <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)');
    } else if (status === 'backorder') {
      conditions.push('w.parent_wip_order_id IS NOT NULL');
    }

    // 4. Backorder specific filter
    if (backorder === 'backorder') {
      conditions.push('w.parent_wip_order_id IS NOT NULL');
    } else if (backorder === 'regular') {
      conditions.push('w.parent_wip_order_id IS NULL');
    }

    // 5. Period / Date filter
    if (period === 'this_month') {
      conditions.push('w.start_spk >= DATE_FORMAT(CURDATE(), "%Y-%m-01")');
    } else if (period === 'last_month') {
      conditions.push('w.start_spk >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), "%Y-%m-01") AND w.start_spk < DATE_FORMAT(CURDATE(), "%Y-%m-01")');
    } else if (period && /^\d{4}-\d{2}$/.test(period)) {
      conditions.push('DATE_FORMAT(w.start_spk, "%Y-%m") = ?');
      params.push(period);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Price visibility: strip prices completely if admin_vendor
    const showPrice = user.role !== 'admin_vendor';
    const priceFields = showPrice
      ? 'w.harga_vendor, w.total_harga,'
      : '0.00 AS harga_vendor, 0.00 AS total_harga,';

    // Count query for current filter
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM wip_orders w ${whereClause}`,
      params
    );
    const total = countRows[0].total;

    // Server-wide live metrics for current vendor scope (unfiltered by search/status for KPI cards)
    const baseVendorConditions = ['w.is_active = 1'];
    const baseVendorParams = [];
    if (isVendorRole) {
      baseVendorConditions.push('w.vendor_id = ?');
      baseVendorParams.push(user.vendor_id);
    } else if (vendorId) {
      baseVendorConditions.push('w.vendor_id = ?');
      baseVendorParams.push(Number(vendorId));
    }

    const [metricsRows] = await db.query(
      `SELECT
        COUNT(*) AS total,
        CAST(COALESCE(SUM(CASE WHEN w.cutting_locked_at IS NULL AND w.parent_wip_order_id IS NULL THEN 1 ELSE 0 END), 0) AS UNSIGNED) AS cutting_pending,
        CAST(COALESCE(SUM(CASE WHEN (w.cutting_locked_at IS NOT NULL OR w.parent_wip_order_id IS NOT NULL) AND w.result_locked_at IS NULL THEN 1 ELSE 0 END), 0) AS UNSIGNED) AS sewing_active,
        CAST(COALESCE(SUM(CASE WHEN w.result_locked_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS UNSIGNED) AS result_locked,
        CAST(COALESCE(SUM(CASE WHEN w.status_kebutuhan_kain = 'Kurang' OR w.status_kebutuhan_kain LIKE '%Kurang%' THEN 1 ELSE 0 END), 0) AS UNSIGNED) AS kain_kurang,
        CAST(COALESCE(SUM(CASE WHEN w.result_locked_at IS NULL AND w.deadline_spk IS NOT NULL AND w.deadline_spk < CURDATE() THEN 1 ELSE 0 END), 0) AS UNSIGNED) AS overdue,
        CAST(COALESCE(SUM(CASE WHEN w.result_locked_at IS NULL AND w.deadline_spk IS NOT NULL AND w.deadline_spk >= CURDATE() AND w.deadline_spk <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN 1 ELSE 0 END), 0) AS UNSIGNED) AS deadline_week,
        CAST(COALESCE(SUM(CASE WHEN w.parent_wip_order_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS UNSIGNED) AS backorder_count
       FROM wip_orders w
       ${baseVendorConditions.length > 0 ? `WHERE ${baseVendorConditions.join(' AND ')}` : ''}`,
      baseVendorParams
    );
    const metrics = metricsRows[0] || {
      total: 0,
      cutting_pending: 0,
      sewing_active: 0,
      result_locked: 0,
      kain_kurang: 0,
      overdue: 0,
      deadline_week: 0,
      backorder_count: 0
    };

    // Sorting Clause
    let orderClause = 'ORDER BY w.id DESC';
    if (sort === 'deadline_asc') {
      orderClause = 'ORDER BY (w.deadline_spk IS NULL) ASC, w.deadline_spk ASC, w.id DESC';
    } else if (sort === 'deadline_desc') {
      orderClause = 'ORDER BY (w.deadline_spk IS NULL) ASC, w.deadline_spk DESC, w.id DESC';
    } else if (sort === 'qty_desc') {
      orderClause = 'ORDER BY w.qty_spk DESC, w.id DESC';
    } else if (sort === 'qty_asc') {
      orderClause = 'ORDER BY w.qty_spk ASC, w.id DESC';
    } else if (sort === 'oldest') {
      orderClause = 'ORDER BY w.id ASC';
    }

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
      ${orderClause}
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
        kainKurangCount: metrics.kain_kurang
      },
      metrics
    };
  }

  /**
   * Get single order details, roll lines, and Odoo raw moves (BOM)
   */
  async getOrderDetails({ user, orderId, includeRawMoves = true }) {
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
        w.consumption_per_pcs, w.consumption_uom,
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

    // Lazy-fetch pattern consumption per pcs from Odoo if null in MySQL
    if (order.consumption_per_pcs == null && order.odoo_wip_id) {
      try {
        await adminOdooClient.authenticate();
        const wipData = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[order.odoo_wip_id]], {
          fields: ['x_studio_consumption_per_pcs_1', 'x_studio_unit_consumption_per_pcs']
        });
        if (wipData && wipData[0]) {
          const w = wipData[0];
          const cVal = w.x_studio_consumption_per_pcs_1 !== undefined && w.x_studio_consumption_per_pcs_1 !== false
            ? Number(w.x_studio_consumption_per_pcs_1)
            : null;
          const cUom = w.x_studio_unit_consumption_per_pcs
            ? (Array.isArray(w.x_studio_unit_consumption_per_pcs) ? w.x_studio_unit_consumption_per_pcs[1] : String(w.x_studio_unit_consumption_per_pcs))
            : null;
          if (cVal !== null || cUom !== null) {
            order.consumption_per_pcs = cVal;
            order.consumption_uom = cUom;
            await db.query(
              'UPDATE wip_orders SET consumption_per_pcs = ?, consumption_uom = ? WHERE id = ?',
              [cVal, cUom, order.id]
            ).catch(() => {});
          }
        }
      } catch (err) {
        console.warn(`[PWA] Could not lazy-fetch consumption for WIP #${order.odoo_wip_id}:`, err.message);
      }
    }

    // Fetch roll lines
    const [rollLines] = await db.query(
      `SELECT id, odoo_line_id, line_type, nama_item, kode_lot, qty, uom, qty_berat_kg, updated_at
       FROM wip_roll_lines
       WHERE wip_order_id = ?
       ORDER BY line_type ASC, id ASC`,
      [orderId]
    );

    // Fetch raw material moves (BOM components) from Odoo ERP
    let rawMoves = [];
    if (includeRawMoves && order.odoo_mo_id) {
      const cached = rawMovesCache.get(order.odoo_mo_id);
      if (cached && Date.now() - cached.time < RAW_MOVES_CACHE_TTL) {
        rawMoves = cached.data;
      } else {
        try {
          await adminOdooClient.authenticate();
          rawMoves = await adminOdooClient._callObject('stock.move', 'search_read', [
            [['raw_material_production_id', '=', order.odoo_mo_id]]
          ], {
            fields: ['id', 'product_id', 'product_uom_qty', 'quantity', 'product_uom', 'state'],
            order: 'id asc'
          });
          rawMovesCache.set(order.odoo_mo_id, { time: Date.now(), data: rawMoves });
        } catch (err) {
          console.warn(`[PWA] Failed to fetch raw moves from Odoo for MO #${order.odoo_mo_id}:`, err.message);
        }
      }
    }
    order.raw_moves = rawMoves;

    // Fetch linked transfer documents (stock.picking) from Odoo ERP
    const transfers = await this._fetchOrderTransfers(order);
    order.transfers = transfers;

    return {
      order,
      rollLines,
      rawMoves,
      transfers
    };
  }

  /**
   * Submit physical cutting results and/or roll weights (locks cutting stage)
   */
  async submitCuttingRolls({ user, orderId, rollUpdates = [], actualCutting }) {
    const { order, rollLines } = await this.getOrderDetails({ user, orderId, includeRawMoves: false });

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
    const { order } = await this.getOrderDetails({ user, orderId, includeRawMoves: false });

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

    const { order } = await this.getOrderDetails({ user, orderId, includeRawMoves: false });

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
   * Fetch linked stock.picking transfer documents for an order from Odoo
   */
  async _fetchOrderTransfers(order) {
    if (!order.odoo_mo_id && !order.odoo_wip_id) return [];

    const cached = transfersCache.get(order.odoo_mo_id);
    if (cached && Date.now() - cached.time < RAW_MOVES_CACHE_TTL) {
      return cached.data;
    }

    try {
      await adminOdooClient.authenticate();
      let pickingIds = [];

      // 1. Get pickings from mrp.production if available
      if (order.odoo_mo_id) {
        try {
          const mo = await adminOdooClient._callObject('mrp.production', 'read', [[order.odoo_mo_id]], {
            fields: ['picking_ids']
          });
          if (mo && mo[0]?.picking_ids?.length) {
            pickingIds.push(...mo[0].picking_ids);
          }
        } catch (e) {
          console.warn(`[PWA] Could not read picking_ids from MO #${order.odoo_mo_id}:`, e.message);
        }
      }

      // 2. Get pickings from x_monitoring_wip_vendo if available
      if (order.odoo_wip_id) {
        try {
          const wip = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[order.odoo_wip_id]], {
            fields: ['x_studio_daftar_transfer']
          });
          if (wip && wip[0]?.x_studio_daftar_transfer?.length) {
            pickingIds.push(...wip[0].x_studio_daftar_transfer);
          }
        } catch (e) {
          console.warn(`[PWA] Could not read x_studio_daftar_transfer from WIP #${order.odoo_wip_id}:`, e.message);
        }
      }

      pickingIds = Array.from(new Set(pickingIds.filter(Boolean)));
      if (pickingIds.length === 0) {
        transfersCache.set(order.odoo_mo_id, { time: Date.now(), data: [] });
        return [];
      }

      const pickings = await adminOdooClient._callObject('stock.picking', 'read', [pickingIds], {
        fields: ['id', 'name', 'origin', 'picking_type_id', 'state', 'date_done', 'scheduled_date']
      });

      const stateMap = {
        done: 'Selesai',
        assigned: 'Siap Kirim / Diproses',
        confirmed: 'Menunggu Bahan',
        waiting: 'Menunggu Operasi Lain',
        draft: 'Draft',
        cancel: 'Dibatalkan'
      };

      const mapped = (pickings || []).map(p => {
        const typeName = Array.isArray(p.picking_type_id) ? p.picking_type_id[1] : (p.picking_type_id || '');
        const pName = p.name || '';
        let category = 'lainnya';
        if (pName.includes('/PC/') || typeName.toLowerCase().includes('komponen') || typeName.toLowerCase().includes('pilih')) {
          category = 'komponen';
        } else if (pName.includes('/SFP/') || typeName.toLowerCase().includes('simpan') || typeName.toLowerCase().includes('produk jadi')) {
          category = 'produk_jadi';
        } else if (pName.includes('BSKL') || (p.origin && p.origin.toLowerCase().includes('retur'))) {
          category = 'retur';
        }

        return {
          id: p.id,
          name: p.name,
          origin: p.origin || '-',
          pickingType: typeName,
          category,
          state: p.state,
          stateDisplay: stateMap[p.state] || p.state,
          dateDone: p.date_done || null,
          scheduledDate: p.scheduled_date || null
        };
      });

      // Sort: done first, then id desc
      mapped.sort((a, b) => b.id - a.id);

      transfersCache.set(order.odoo_mo_id, { time: Date.now(), data: mapped });
      return mapped;
    } catch (err) {
      console.warn(`[PWA] Failed to fetch transfers for order #${order.id}:`, err.message);
      return [];
    }
  }

  /**
   * Force sync single WIP order directly from Odoo ERP live
   */
  async syncOrderFromOdoo({ user, orderId }) {
    // 1. Fetch current order
    const [rows] = await db.query(
      `SELECT w.*, v.odoo_warehouse_id, v.name AS vendor_name
       FROM wip_orders w
       JOIN vendors v ON v.id = w.vendor_id
       WHERE w.id = ?`,
      [orderId]
    );

    if (rows.length === 0) {
      throw new Error(`Order #${orderId} tidak ditemukan`);
    }

    const order = rows[0];

    // Enforce vendor access control
    const isVendorRole = ['master_vendor', 'admin_vendor'].includes(user.role);
    if (isVendorRole && order.vendor_id !== user.vendor_id) {
      throw new Error('Anda tidak memiliki izin untuk menyinkronkan order ini');
    }

    // 2. Clear in-memory caches for this order
    if (order.odoo_mo_id) {
      rawMovesCache.delete(order.odoo_mo_id);
      transfersCache.delete(order.odoo_mo_id);
    }

    // 3. Connect to Odoo and fetch latest data
    await adminOdooClient.authenticate();

    // 3a. Read WIP record
    const wipFields = [
      'id', 'x_name', 'write_date',
      'x_studio_manufacturing_order', 'x_studio_warehouse', 'x_studio_sales_order',
      'x_studio_product', 'x_studio_status_spk', 'x_studio_qty_spk',
      'x_studio_start_spk', 'x_studio_deadline_spk', 'x_studio_qty_kebutuhan_kain',
      'x_studio_kain_dari_gudang_qty', 'x_studio_unit_kain_dari_gudang',
      'x_studio_consumption_per_pcs_1', 'x_studio_unit_consumption_per_pcs',
      'x_studio_accessories_dari_gudang', 'x_studio_estimasi_dari_spb',
      'x_studio_status_kebutuhan_kain', 'x_studio_actual_cutting',
      'x_studio_selisih_hasil_cutting', 'x_studio_qty_kirim_a_grade',
      'x_studio_qty_kirim_b_grade', 'x_studio_sisa_makloon_kg',
      'x_studio_no_surat_jalan_sfp', 'x_studio_tanggal_sfp', 'x_studio_qty_masuk_sfp',
      'x_studio_harga', 'x_studio_total_harga', 'x_studio_status_produksi',
      'x_studio_detail_roll_kain', 'x_studio_daftar_transfer'
    ];

    const wips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[order.odoo_wip_id]], {
      fields: wipFields
    });

    if (!wips || wips.length === 0) {
      throw new Error(`Data WIP #${order.odoo_wip_id} tidak ditemukan di Odoo`);
    }

    const w = wips[0];
    const moName = w.x_name || (w.x_studio_manufacturing_order ? w.x_studio_manufacturing_order[1] : order.mo_name);
    const whId = w.x_studio_warehouse ? w.x_studio_warehouse[0] : order.odoo_warehouse_id;
    const whName = w.x_studio_warehouse ? w.x_studio_warehouse[1] : order.vendor_name;

    const consumptionVal = w.x_studio_consumption_per_pcs_1 !== undefined && w.x_studio_consumption_per_pcs_1 !== false
      ? Number(w.x_studio_consumption_per_pcs_1)
      : null;
    const consumptionUom = w.x_studio_unit_consumption_per_pcs
      ? (Array.isArray(w.x_studio_unit_consumption_per_pcs) ? w.x_studio_unit_consumption_per_pcs[1] : String(w.x_studio_unit_consumption_per_pcs))
      : null;

    // Check parent MO if backorder
    let parentMoName = null;
    if (moName && moName.includes('-')) {
      const parts = moName.split('-');
      if (/^\d+$/.test(parts[parts.length - 1])) {
        parentMoName = moName.substring(0, moName.lastIndexOf('-'));
      }
    }

    // Upsert into MySQL
    await wipMysqlRepo.upsertWipOrder({
      odoo_wip_id: w.id,
      odoo_mo_id: w.x_studio_manufacturing_order ? w.x_studio_manufacturing_order[0] : order.odoo_mo_id,
      odoo_warehouse_id: whId,
      vendor_name: whName,
      parent_mo_name: parentMoName,
      mo_name: moName,
      mo_state: w.x_studio_status_spk || order.mo_state,
      sales_order: w.x_studio_sales_order ? w.x_studio_sales_order[1] : order.sales_order,
      product_name: w.x_studio_product ? w.x_studio_product[1] : order.product_name,
      qty_spk: w.x_studio_qty_spk || 0,
      start_spk: w.x_studio_start_spk || null,
      deadline_spk: w.x_studio_deadline_spk || null,
      qty_kebutuhan_kain: w.x_studio_qty_kebutuhan_kain || 0,
      kain_dari_gudang: w.x_studio_kain_dari_gudang_qty || 0,
      unit_kain: w.x_studio_unit_kain_dari_gudang ? w.x_studio_unit_kain_dari_gudang[1] : order.unit_kain,
      consumption_per_pcs: consumptionVal,
      consumption_uom: consumptionUom,
      accessories_dari_gudang: w.x_studio_accessories_dari_gudang || 0,
      estimasi_dari_spb: w.x_studio_estimasi_dari_spb || 0,
      status_kebutuhan_kain: w.x_studio_status_kebutuhan_kain || null,
      actual_cutting: w.x_studio_actual_cutting !== undefined && w.x_studio_actual_cutting !== null ? w.x_studio_actual_cutting : order.actual_cutting,
      selisih_hasil_cutting: w.x_studio_selisih_hasil_cutting || 0,
      qty_grade_a: w.x_studio_qty_kirim_a_grade || 0,
      qty_grade_b: w.x_studio_qty_kirim_b_grade || 0,
      sisa_makloon_kg: w.x_studio_sisa_makloon_kg || 0,
      no_surat_jalan_sfp: w.x_studio_no_surat_jalan_sfp || null,
      tanggal_sfp: w.x_studio_tanggal_sfp || null,
      qty_masuk_sfp: w.x_studio_qty_masuk_sfp || 0,
      harga_vendor: w.x_studio_harga || 0,
      total_harga: w.x_studio_total_harga || 0,
      status_produksi: w.x_studio_status_produksi || order.status_produksi,
      odoo_write_date: w.write_date || null
    });

    // 3b. Read roll lines if any
    if (Array.isArray(w.x_studio_detail_roll_kain) && w.x_studio_detail_roll_kain.length > 0) {
      try {
        const rollLines = await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'read', [
          w.x_studio_detail_roll_kain,
          ['id', 'x_name', 'x_studio_kode_warna_roll', 'x_studio_yards', 'x_studio_uom', 'x_studio_qty_berat_kg']
        ]);
        if (rollLines && rollLines.length > 0) {
          await wipMysqlRepo.upsertRollLines(order.id, rollLines);
        }
      } catch (errRoll) {
        console.warn(`[PWA] Error syncing roll lines for WIP #${order.odoo_wip_id}:`, errRoll.message);
      }
    }

    // 4. Return fresh details
    const freshDetails = await this.getOrderDetails({ user, orderId, includeRawMoves: true });
    return {
      success: true,
      message: 'Data berhasil disinkronkan langsung dari Odoo ERP secara real-time',
      syncedAt: new Date().toISOString(),
      ...freshDetails
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
