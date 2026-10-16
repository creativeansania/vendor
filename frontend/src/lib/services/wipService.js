import { supabaseServer } from '../supabaseServer.js';
import { adminOdooClient } from '../odoo/odooClient.js';
import { wipRepo } from './wipRepository.js';

// In-memory caches for Odoo BOM stock moves and transfers to minimize XML-RPC calls
const rawMovesCache = new Map();
const transfersCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export class WipService {
  /**
   * Get orders list with pagination, search, status filter, period filter, sorting, and metrics
   */
  async getOrders({ user, search, status, vendorId, page = 1, limit = 20, sort = 'latest', period, backorder }) {
    const numLimit = Math.max(1, Number(limit));
    const numPage = Math.max(1, Number(page));
    const offset = (numPage - 1) * numLimit;

    // 1. Base Query with joined vendor and parent
    let query = supabaseServer
      .from('wip_orders')
      .select(`
        id, odoo_wip_id, odoo_mo_id, vendor_id,
        mo_name, mo_state, sales_order, product_name,
        qty_spk, start_spk, deadline_spk,
        qty_kebutuhan_kain, kain_dari_gudang, unit_kain,
        consumption_per_pcs, consumption_uom,
        accessories_dari_gudang, estimasi_dari_spb, status_kebutuhan_kain,
        actual_cutting, selisih_hasil_cutting,
        qty_grade_a, qty_grade_b, sisa_makloon_kg,
        no_surat_jalan_sfp, tanggal_sfp, qty_masuk_sfp,
        harga_vendor, total_harga, status_produksi,
        cutting_locked_at, cutting_locked_by, result_locked_at, result_locked_by,
        is_active, parent_wip_order_id, updated_at,
        vendors ( id, name ),
        parent:wip_orders!wip_orders_parent_wip_order_id_fkey ( id, sales_order )
      `, { count: 'exact' })
      .eq('is_active', true);

    // 2. Role-based vendor filtering
    const isVendorRole = ['master_vendor', 'admin_vendor'].includes(user.role);
    if (isVendorRole) {
      query = query.eq('vendor_id', user.vendor_id);
    } else if (vendorId) {
      query = query.eq('vendor_id', Number(vendorId));
    }

    // 3. Search Filter (forgiving search: ID, MO name, product name, sales order)
    if (search && search.trim()) {
      const term = search.trim();
      const numOnly = term.replace(/[^0-9]/g, '');
      if (numOnly) {
        query = query.or(`id.eq.${numOnly},mo_name.ilike.%${term}%,mo_name.ilike.%${numOnly}%,product_name.ilike.%${term}%,sales_order.ilike.%${term}%`);
      } else {
        query = query.or(`mo_name.ilike.%${term}%,product_name.ilike.%${term}%,sales_order.ilike.%${term}%`);
      }
    }

    // 4. Status Filter
    const todayStr = new Date().toISOString().split('T')[0];
    const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    if (status === 'cutting_pending') {
      query = query.is('cutting_locked_at', null).is('parent_wip_order_id', null);
    } else if (status === 'cutting_locked') {
      query = query.not('cutting_locked_at', 'is', null).is('result_locked_at', null);
    } else if (status === 'result_pending') {
      query = query.is('result_locked_at', null);
    } else if (status === 'result_locked') {
      query = query.not('result_locked_at', 'is', null);
    } else if (status === 'kain_kurang') {
      query = query.ilike('status_kebutuhan_kain', '%Kurang%');
    } else if (status === 'overdue') {
      query = query.is('result_locked_at', null).lt('deadline_spk', todayStr);
    } else if (status === 'deadline_week') {
      query = query.is('result_locked_at', null).gte('deadline_spk', todayStr).lte('deadline_spk', sevenDaysLater);
    } else if (status === 'backorder') {
      query = query.not('parent_wip_order_id', 'is', null);
    }

    // 5. Backorder explicit filter
    if (backorder === 'backorder') {
      query = query.not('parent_wip_order_id', 'is', null);
    } else if (backorder === 'regular') {
      query = query.is('parent_wip_order_id', null);
    }

    // 6. Period Filter
    if (period === 'this_month') {
      const firstDayOfMonth = todayStr.substring(0, 7) + '-01';
      query = query.gte('start_spk', firstDayOfMonth);
    } else if (period === 'last_month') {
      const now = new Date();
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonthStr = prevMonth.toISOString().substring(0, 7) + '-01';
      const curMonthStr = todayStr.substring(0, 7) + '-01';
      query = query.gte('start_spk', prevMonthStr).lt('start_spk', curMonthStr);
    } else if (period && /^\d{4}-\d{2}$/.test(period)) {
      query = query.gte('start_spk', `${period}-01`).lt('start_spk', `${period}-31`);
    }

    // 7. Sorting
    if (sort === 'deadline') {
      query = query.order('deadline_spk', { ascending: true, nullsFirst: false });
    } else if (sort === 'mo') {
      query = query.order('mo_name', { ascending: true });
    } else if (sort === 'product') {
      query = query.order('product_name', { ascending: true });
    } else if (sort === 'status') {
      query = query.order('status_produksi', { ascending: true });
    } else {
      query = query.order('id', { ascending: false });
    }

    // Apply pagination range
    query = query.range(offset, offset + numLimit - 1);

    const { data: rawOrders, count: totalCount, error } = await query;
    if (error) {
      console.error('[WipService] getOrders query error:', error.message);
      throw new Error(error.message);
    }

    const total = totalCount || 0;
    const showPrice = user.role !== 'admin_vendor';

    const orders = (rawOrders || []).map(o => {
      const isBackorder = Boolean(o.parent_wip_order_id);
      const salesOrder = o.sales_order || (o.parent && o.parent.sales_order) || '-';
      const vendorName = o.vendors ? o.vendors.name : 'Unknown';

      return {
        ...o,
        vendor_name: vendorName,
        is_backorder: isBackorder,
        sales_order: salesOrder,
        harga_vendor: showPrice ? Number(o.harga_vendor || 0) : 0,
        total_harga: showPrice ? Number(o.total_harga || 0) : 0
      };
    });

    // 8. Fetch Metrics for vendor scope
    const metrics = await this._getMetrics(user, isVendorRole ? user.vendor_id : vendorId);

    return {
      orders,
      pagination: {
        total,
        page: numPage,
        limit: numLimit,
        totalPages: Math.ceil(total / numLimit),
        kainKurangCount: metrics.kain_kurang
      },
      metrics
    };
  }

  async _getMetrics(user, vendorId) {
    let base = supabaseServer.from('wip_orders').select('id, cutting_locked_at, result_locked_at, status_kebutuhan_kain, deadline_spk').eq('is_active', true);
    if (vendorId) {
      base = base.eq('vendor_id', Number(vendorId));
    }

    const { data: rows } = await base;
    if (!rows) {
      return { total_spk: 0, cutting_selesai: 0, selesai_jahit: 0, kain_kurang: 0, terlambat: 0 };
    }

    const todayStr = new Date().toISOString().split('T')[0];
    let total_spk = rows.length;
    let cutting_selesai = 0;
    let selesai_jahit = 0;
    let kain_kurang = 0;
    let terlambat = 0;

    for (const r of rows) {
      if (r.cutting_locked_at) cutting_selesai++;
      if (r.result_locked_at) selesai_jahit++;
      if (r.status_kebutuhan_kain && r.status_kebutuhan_kain.toLowerCase().includes('kurang')) kain_kurang++;
      if (!r.result_locked_at && r.deadline_spk && r.deadline_spk < todayStr) terlambat++;
    }

    return {
      total_spk,
      cutting_selesai,
      selesai_jahit,
      kain_kurang,
      terlambat
    };
  }

  /**
   * Get single order details with roll lines, BOM raw moves, and transfers
   */
  async getOrderDetails({ user, orderId, includeRawMoves = true }) {
    const showPrice = user.role !== 'admin_vendor';

    const { data: order, error } = await supabaseServer
      .from('wip_orders')
      .select(`
        *,
        vendors ( id, name ),
        parent:wip_orders!wip_orders_parent_wip_order_id_fkey ( id, sales_order )
      `)
      .eq('id', Number(orderId))
      .single();

    if (error || !order) {
      throw new Error(`Order #${orderId} tidak ditemukan.`);
    }

    const isVendorRole = ['master_vendor', 'admin_vendor'].includes(user.role);
    if (isVendorRole && order.vendor_id !== user.vendor_id) {
      throw new Error('Anda tidak memiliki izin untuk melihat order ini.');
    }

    // Lazy fetch consumption per pcs from Odoo if missing
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
            await supabaseServer
              .from('wip_orders')
              .update({ consumption_per_pcs: cVal, consumption_uom: cUom })
              .eq('id', order.id);
          }
        }
      } catch (e) {
        // Non-fatal
      }
    }

    // Fetch roll lines
    const { data: rollLines } = await supabaseServer
      .from('wip_roll_lines')
      .select('*')
      .eq('wip_order_id', order.id)
      .order('id', { ascending: true });

    order.roll_lines = rollLines || [];
    order.is_backorder = Boolean(order.parent_wip_order_id);
    order.sales_order = order.sales_order || (order.parent ? order.parent.sales_order : '-') || '-';
    order.vendor_name = order.vendors ? order.vendors.name : 'Unknown';
    if (!showPrice) {
      order.harga_vendor = 0;
      order.total_harga = 0;
    }

    // Fetch BOM moves and Transfers from Odoo
    let rawMoves = [];
    let transfers = [];
    if (includeRawMoves) {
      [rawMoves, transfers] = await Promise.all([
        this._fetchOrderRawMoves(order).catch(() => []),
        this._fetchOrderTransfers(order).catch(() => [])
      ]);
    }

    return {
      order,
      rawMoves,
      transfers
    };
  }

  async _fetchOrderRawMoves(order) {
    if (!order.odoo_mo_id) return [];
    const cached = rawMovesCache.get(order.odoo_mo_id);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return cached.data;
    }

    try {
      await adminOdooClient.authenticate();
      const mo = await adminOdooClient._callObject('mrp.production', 'read', [[order.odoo_mo_id]], {
        fields: ['move_raw_ids']
      });

      if (!mo || !mo[0] || !mo[0].move_raw_ids || mo[0].move_raw_ids.length === 0) {
        rawMovesCache.set(order.odoo_mo_id, { time: Date.now(), data: [] });
        return [];
      }

      const moveIds = mo[0].move_raw_ids;
      const moves = await adminOdooClient._callObject('stock.move', 'read', [
        moveIds,
        ['id', 'product_id', 'product_uom_qty', 'quantity_done', 'product_uom', 'state']
      ]);

      const stateMap = {
        done: 'Selesai Terpenuhi',
        assigned: 'Tersedia / Siap',
        confirmed: 'Menunggu Bahan Masuk',
        waiting: 'Menunggu Operasi Lain',
        draft: 'Draft',
        cancel: 'Dibatalkan'
      };

      const mapped = (moves || []).map(m => ({
        id: m.id,
        productName: Array.isArray(m.product_id) ? m.product_id[1] : (m.product_id || '-'),
        demandQty: Number(m.product_uom_qty || 0),
        quantityDone: Number(m.quantity_done || 0),
        uom: Array.isArray(m.product_uom) ? m.product_uom[1] : (m.product_uom || 'yard'),
        state: m.state,
        stateDisplay: stateMap[m.state] || m.state
      }));

      rawMovesCache.set(order.odoo_mo_id, { time: Date.now(), data: mapped });
      return mapped;
    } catch (err) {
      console.warn(`[WipService] BOM fetch error for MO #${order.odoo_mo_id}:`, err.message);
      return [];
    }
  }

  async _fetchOrderTransfers(order) {
    if (!order.odoo_mo_id && !order.odoo_wip_id) return [];
    const cached = transfersCache.get(order.odoo_mo_id);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return cached.data;
    }

    try {
      await adminOdooClient.authenticate();
      let pickingIds = [];

      if (order.odoo_mo_id) {
        try {
          const mo = await adminOdooClient._callObject('mrp.production', 'read', [[order.odoo_mo_id]], {
            fields: ['picking_ids']
          });
          if (mo && mo[0]?.picking_ids?.length) {
            pickingIds.push(...mo[0].picking_ids);
          }
        } catch (e) {}
      }

      if (order.odoo_wip_id) {
        try {
          const wip = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[order.odoo_wip_id]], {
            fields: ['x_studio_daftar_transfer']
          });
          if (wip && wip[0]?.x_studio_daftar_transfer?.length) {
            pickingIds.push(...wip[0].x_studio_daftar_transfer);
          }
        } catch (e) {}
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

      transfersCache.set(order.odoo_mo_id, { time: Date.now(), data: mapped });
      return mapped;
    } catch (err) {
      console.warn(`[WipService] Transfers fetch error for MO #${order.odoo_mo_id}:`, err.message);
      return [];
    }
  }

  /**
   * Submit physical roll weights & actual cutting
   */
  async submitCuttingRolls({ user, orderId, rollUpdates = [], actualCutting }) {
    const { order } = await this.getOrderDetails({ user, orderId, includeRawMoves: false });

    if (order.cutting_locked_at) {
      throw new Error('Tahap potong kain sudah dikunci. Hubungi Master Admin untuk unlock.');
    }

    // 1. Process roll updates
    let sumRollWeights = 0;
    const formattedRollUpdates = [];

    for (const update of rollUpdates) {
      const lineId = Number(update.lineId || update.id);
      const rawVal = update.qtyBeratKg !== undefined ? update.qtyBeratKg : update.qty_berat_kg;
      const weight = (rawVal !== undefined && rawVal !== null && rawVal !== '') ? Math.max(0, parseFloat(rawVal) || 0) : null;

      if (lineId) {
        await supabaseServer
          .from('wip_roll_lines')
          .update({ qty_berat_kg: weight, updated_at: new Date().toISOString() })
          .eq('id', lineId);
      }

      if (weight !== null) {
        sumRollWeights += weight;
        formattedRollUpdates.push({ lineId, qtyBeratKg: weight });
      }
    }

    // If vendor didn't input explicit actualCutting, fallback to sum of roll weights
    let finalActualCutting = (actualCutting !== undefined && actualCutting !== null && actualCutting !== '')
      ? Math.max(0, parseFloat(actualCutting) || 0)
      : (sumRollWeights > 0 ? sumRollWeights : (order.actual_cutting || 0));

    const estimasiSpb = parseFloat(order.estimasi_dari_spb || 0);
    const selisihCutting = finalActualCutting - estimasiSpb;

    // 2. Update WIP Order in Supabase
    await supabaseServer
      .from('wip_orders')
      .update({
        actual_cutting: finalActualCutting,
        selisih_hasil_cutting: selisihCutting,
        cutting_locked_at: new Date().toISOString(),
        cutting_locked_by: user.id
      })
      .eq('id', orderId);

    // 3. Propagate to child backorders
    await wipRepo.propagateRollWeightsToBackorders(orderId);

    // 4. Record audit log
    await supabaseServer.from('audit_logs').insert({
      user_id: user.id,
      wip_order_id: orderId,
      action: 'submit_cutting',
      before_data: { actual_cutting: order.actual_cutting, selisih_hasil_cutting: order.selisih_hasil_cutting },
      after_data: { actualCutting: finalActualCutting, selisihCutting, rollUpdates: formattedRollUpdates }
    });

    // 5. Enqueue outbox & trigger background push to Odoo
    await supabaseServer.from('sync_outbox').insert({
      wip_order_id: orderId,
      action: 'cutting_rolls',
      payload: { actualCutting: finalActualCutting, rollUpdates: formattedRollUpdates },
      created_by: user.id
    });

    // Asynchronously push to Odoo without blocking the response
    this._syncCuttingToOdoo(order.odoo_wip_id, formattedRollUpdates, finalActualCutting).catch(err => {
      console.warn(`[WipService] Odoo async cutting push warning: ${err.message}`);
    });

    return {
      success: true,
      message: 'Hasil potong berhasil disimpan dan dikunci.',
      actualCutting: finalActualCutting,
      selisihCutting
    };
  }

  async _syncCuttingToOdoo(odooWipId, rollUpdates, actualCutting) {
    if (!odooWipId) return;
    await adminOdooClient.authenticate();

    for (const update of rollUpdates) {
      if (update.lineId) {
        // Read Odoo line ID
        const { data: rl } = await supabaseServer.from('wip_roll_lines').select('odoo_line_id').eq('id', update.lineId).single();
        if (rl && rl.odoo_line_id) {
          await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'write', [
            [rl.odoo_line_id],
            { x_studio_qty_berat_kg: update.qtyBeratKg }
          ]);
        }
      }
    }

    if (actualCutting !== undefined && actualCutting !== null) {
      const wips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[odooWipId]], {
        fields: ['x_studio_estimasi_dari_spb']
      });
      const estimasi = wips && wips[0] ? (parseFloat(wips[0].x_studio_estimasi_dari_spb) || 0) : 0;
      await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [[odooWipId], {
        x_studio_actual_cutting: actualCutting,
        x_studio_selisih_hasil_cutting: actualCutting - estimasi
      }]);
    }
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
    const suratJalan = (noSuratJalan || '').trim();

    // 1. Update in Supabase
    const updatePayload = {
      qty_grade_a: aGrade,
      qty_grade_b: bGrade,
      sisa_makloon_kg: sisaKg,
      status_produksi: 'Selesai',
      result_locked_at: new Date().toISOString(),
      result_locked_by: user.id
    };
    if (suratJalan) {
      updatePayload.no_surat_jalan_sfp = suratJalan;
    }

    await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);

    // 2. Audit log
    await supabaseServer.from('audit_logs').insert({
      user_id: user.id,
      wip_order_id: orderId,
      action: 'submit_result',
      before_data: { qty_grade_a: order.qty_grade_a, qty_grade_b: order.qty_grade_b, sisa_makloon_kg: order.sisa_makloon_kg },
      after_data: { qtyGradeA: aGrade, qtyGradeB: bGrade, sisaMakloonKg: sisaKg, noSuratJalan: suratJalan }
    });

    // 3. Enqueue to sync_outbox
    await supabaseServer.from('sync_outbox').insert({
      wip_order_id: orderId,
      action: 'production_result',
      payload: { qtyGradeA: aGrade, qtyGradeB: bGrade, sisaMakloonKg: sisaKg, noSuratJalan: suratJalan },
      created_by: user.id
    });

    // 4. Push to Odoo asynchronously
    this._syncProductionToOdoo(order.odoo_wip_id, aGrade, bGrade, sisaKg).catch(err => {
      console.warn(`[WipService] Odoo async production push warning: ${err.message}`);
    });

    return {
      success: true,
      message: 'Hasil jahit berhasil dilaporkan dan terkunci.',
      qtyGradeA: aGrade,
      qtyGradeB: bGrade,
      sisaMakloonKg: sisaKg,
      noSuratJalan: suratJalan
    };
  }

  async _syncProductionToOdoo(odooWipId, aGrade, bGrade, sisaKg) {
    if (!odooWipId) return;
    await adminOdooClient.authenticate();
    await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [[odooWipId], {
      x_studio_qty_kirim_a_grade: aGrade,
      x_studio_qty_kirim_b_grade: bGrade,
      x_studio_sisa_makloon_kg: sisaKg
    }], { context: { tracking_disable: true, no_automation: true } });
  }

  /**
   * Unlock Order stage (Master Admin only)
   */
  async unlockOrder({ user, orderId, unlockType, reason }) {
    if (user.role !== 'master_admin') {
      throw new Error('Hanya Master Admin yang berhak membuka kunci (unlock).');
    }
    if (!reason || !reason.trim()) {
      throw new Error('Alasan unlock wajib diisi untuk catatan audit.');
    }

    if (unlockType === 'cutting') {
      await supabaseServer.from('wip_orders').update({
        cutting_locked_at: null,
        cutting_locked_by: null
      }).eq('id', orderId);
    } else if (unlockType === 'result') {
      await supabaseServer.from('wip_orders').update({
        result_locked_at: null,
        result_locked_by: null
      }).eq('id', orderId);
    } else {
      throw new Error('Tipe unlock tidak valid (pilih "cutting" atau "result").');
    }

    await supabaseServer.from('audit_logs').insert({
      user_id: user.id,
      wip_order_id: orderId,
      action: `unlock_${unlockType}`,
      reason: reason.trim()
    });

    return {
      success: true,
      message: `Kunci tahap ${unlockType} berhasil dibuka kembali.`
    };
  }

  /**
   * Pull single order live from Odoo into Supabase
   */
  async syncOrderFromOdoo({ user, orderId }) {
    const { order } = await this.getOrderDetails({ user, orderId, includeRawMoves: false });
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
        'x_studio_actual_cutting', 'x_studio_selisih_hasil_cutting',
        'x_studio_qty_kirim_a_grade', 'x_studio_qty_kirim_b_grade', 'x_studio_sisa_makloon_kg',
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
      no_surat_jalan_sfp: w.x_studio_no_surat_jalan_sfp || null,
      tanggal_sfp: w.x_studio_tanggal_sfp || null,
      qty_masuk_sfp: Number(w.x_studio_qty_masuk_sfp || 0),
      harga_vendor: Number(w.x_studio_harga || 0),
      total_harga: Number(w.x_studio_total_harga || 0),
      status_produksi: w.x_studio_status_produksi || 'Proses',
      odoo_write_date: w.write_date
    });

    // Sync roll lines if any
    if (w.x_studio_detail_roll_kain && w.x_studio_detail_roll_kain.length > 0) {
      const rolls = await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'read', [
        w.x_studio_detail_roll_kain,
        ['id', 'x_name', 'x_studio_kode_warna_roll', 'x_studio_yards', 'x_studio_uom', 'x_studio_qty_berat_kg']
      ]);
      await wipRepo.upsertRollLines(order.id, rolls);
    }

    // Invalidate caches
    rawMovesCache.delete(order.odoo_mo_id);
    transfersCache.delete(order.odoo_mo_id);

    return this.getOrderDetails({ user, orderId, includeRawMoves: true });
  }

  /**
   * Pull all active WIPs from Odoo (Initial Sync)
   */
  async syncAllFromOdoo() {
    await adminOdooClient.authenticate();
    console.log('[WipService] Pulling active WIP records from Odoo...');

    const wipIds = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search', [
      [['x_name', '!=', false]]
    ], { limit: 100, order: 'id desc' });

    console.log(`[WipService] Found ${wipIds.length} WIP records in Odoo. Processing...`);

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
              ['id', 'x_name', 'x_studio_kode_warna_roll', 'x_studio_yards', 'x_studio_uom', 'x_studio_qty_berat_kg']
            ]);
            await wipRepo.upsertRollLines(savedId, rolls);
          }

          syncedCount++;
        } catch (itemErr) {
          console.warn(`[WipService] Skip WIP #${w.id}: ${itemErr.message}`);
        }
      }
    }

    return {
      success: true,
      totalSynced: syncedCount
    };
  }
}

export const wipService = new WipService();
