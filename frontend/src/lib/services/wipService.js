import { supabaseServer } from '../supabaseServer.js';
import { adminOdooClient } from '../odoo/odooClient.js';
import { wipRepo } from './wipRepository.js';

// In-memory caches for Odoo BOM stock moves and transfers to minimize XML-RPC calls
const rawMovesCache = new Map();
const transfersCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export class WipService {
  constructor() {
    this._locks = new Map();
  }

  async _withLock(key, fn) {
    const prev = this._locks.get(key) || Promise.resolve();
    let release;
    const next = new Promise(resolve => { release = resolve; });
    this._locks.set(key, prev.then(() => next, () => next));

    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this._locks.get(key) === next) {
        this._locks.delete(key);
      }
    }
  }

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
        vendors ( id, name )
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
        vendors ( id, name )
      `)
      .eq('id', Number(orderId))
      .single();

    if (error || !order) {
      throw new Error(`Order #${orderId} tidak ditemukan.`);
    }

    if (order.parent_wip_order_id) {
      try {
        const { data: parent } = await supabaseServer
          .from('wip_orders')
          .select('id, sales_order')
          .eq('id', order.parent_wip_order_id)
          .single();
        order.parent = parent || null;
      } catch (parentErr) {
        order.parent = null;
      }
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

    // Lazy fetch vendor price from Odoo if missing or 0 and status is not 'Selesai' (Kombinasi A)
    const orderStatus = (order.status_produksi || '').trim().toLowerCase();
    if (showPrice && Number(order.harga_vendor || 0) === 0 && orderStatus !== 'selesai' && order.odoo_wip_id) {
      try {
        await adminOdooClient.authenticate();
        const wipData = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[order.odoo_wip_id]], {
          fields: ['x_studio_product', 'x_studio_warehouse', 'x_studio_qty_masuk_sfp', 'x_studio_many2many_field_869_1k3jdrdl1']
        });
        if (wipData && wipData[0] && wipData[0].x_studio_product) {
          const w = wipData[0];
          const prodId = w.x_studio_product[0];
          const whId = w.x_studio_warehouse ? w.x_studio_warehouse[0] : order.odoo_warehouse_id;
          const sfpQty = parseFloat(w.x_studio_qty_masuk_sfp) || Number(order.qty_masuk_sfp || 0);
          const wcIds = w.x_studio_many2many_field_869_1k3jdrdl1 || [];

          const freshPrice = await this.fetchVendorPriceFromOdoo(whId, prodId, wcIds);
          if (freshPrice > 0) {
            const freshTotal = freshPrice * sfpQty;
            order.harga_vendor = freshPrice;
            order.total_harga = freshTotal;

            // Update Odoo
            await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [
              [order.odoo_wip_id],
              { x_studio_harga: freshPrice, x_studio_total_harga: freshTotal }
            ], { context: { tracking_disable: true, no_automation: true } });

            // Update Supabase
            await wipRepo.updateWipPricingById(order.id, {
              harga_vendor: freshPrice,
              total_harga: freshTotal
            });
            console.log(`[WipService] Lazy auto-resolved price for order #${order.id}: Rp ${freshPrice} (Total: Rp ${freshTotal})`);
          }
        }
      } catch (errPrice) {
        console.warn(`[WipService] Lazy price fetch warning: ${errPrice.message}`);
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
      rollLines: order.roll_lines || [],
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
        ['id', 'product_id', 'product_uom_qty', 'quantity', 'product_uom', 'state']
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
        quantityDone: Number(m.quantity || 0),
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

    // 1. Process roll updates
    let sumRollWeights = 0;
    const formattedRollUpdates = [];

    for (const update of rollUpdates) {
      const lineId = Number(update.lineId || update.id);
      const rawVal = update.qtyBeratKg !== undefined ? update.qtyBeratKg : update.qty_berat_kg;
      const weight = (rawVal !== undefined && rawVal !== null && rawVal !== '') ? Math.max(0, parseFloat(rawVal) || 0) : null;

      const rawPenerimaan = update.qtyPenerimaan !== undefined ? update.qtyPenerimaan : update.qty_penerimaan;
      const penerimaan = (rawPenerimaan !== undefined && rawPenerimaan !== null && rawPenerimaan !== '') ? Math.max(0, parseFloat(rawPenerimaan) || 0) : null;

      if (lineId) {
        const updateData = { updated_at: new Date().toISOString() };
        if (weight !== null) updateData.qty_berat_kg = weight;
        if (penerimaan !== null) updateData.qty_penerimaan = penerimaan;

        const { error: lineErr } = await supabaseServer
          .from('wip_roll_lines')
          .update(updateData)
          .eq('id', lineId);

        if (lineErr && lineErr.message && lineErr.message.includes('qty_penerimaan')) {
          delete updateData.qty_penerimaan;
          await supabaseServer
            .from('wip_roll_lines')
            .update(updateData)
            .eq('id', lineId);
        }
      }

      if (weight !== null) {
        sumRollWeights += weight;
      }
      formattedRollUpdates.push({ lineId, qtyBeratKg: weight, qtyPenerimaan: penerimaan });
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

    // Synchronously push to Odoo so Vercel Serverless Function waits for completion
    try {
      await this._syncCuttingToOdoo(order, formattedRollUpdates, finalActualCutting);
      if (order.odoo_mo_id) {
        rawMovesCache.delete(order.odoo_mo_id);
      }
    } catch (err) {
      console.warn(`[WipService] Odoo cutting push warning: ${err.message}`);
    }

    return {
      success: true,
      message: 'Hasil potong berhasil disimpan dan disinkronkan ke Odoo.',
      actualCutting: finalActualCutting,
      selisihCutting
    };
  }

  async _syncCuttingToOdoo(orderOrWipId, rollUpdates, actualCutting) {
    const odooWipId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_wip_id : orderOrWipId;
    const odooMoId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_mo_id : null;
    if (!odooWipId && !odooMoId) return;
    await adminOdooClient.authenticate();

    // 1. Sync to Monitoring WIP Vendor lines
    if (odooWipId) {
      for (const update of rollUpdates) {
        if (update.lineId) {
          // Read Odoo line ID
          const { data: rl } = await supabaseServer.from('wip_roll_lines').select('odoo_line_id').eq('id', update.lineId).single();
          if (rl && rl.odoo_line_id) {
            const odooPayload = {};
            if (update.qtyBeratKg !== null && update.qtyBeratKg !== undefined) {
              odooPayload.x_studio_qty_berat_kg = update.qtyBeratKg;
            }
            if (update.qtyPenerimaan !== null && update.qtyPenerimaan !== undefined) {
              odooPayload.x_studio_qty_penerimaan = update.qtyPenerimaan;
            }

            if (Object.keys(odooPayload).length > 0) {
              await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'write', [
                [rl.odoo_line_id],
                odooPayload
              ]);
            }
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

    // 2. Sync to Manufacturing Order (mrp.production raw moves / components)
    if (odooMoId) {
      try {
        const mos = await adminOdooClient._callObject('mrp.production', 'read', [[odooMoId]], {
          fields: ['id', 'move_raw_ids', 'state']
        });
        if (mos && mos[0] && mos[0].move_raw_ids && mos[0].move_raw_ids.length > 0 && !['done', 'cancel'].includes(mos[0].state)) {
          const rawMoves = await adminOdooClient._callObject('stock.move', 'read', [
            mos[0].move_raw_ids,
            ['id', 'product_id', 'product_uom_qty', 'quantity', 'state']
          ]);

          const lineIds = rollUpdates.map(u => u.lineId).filter(Boolean);
          if (lineIds.length > 0) {
            const { data: dbLines } = await supabaseServer
              .from('wip_roll_lines')
              .select('id, nama_item, qty_berat_kg')
              .in('id', lineIds);

            // Group cutting quantity by product name
            const qtyByProduct = {};
            for (const update of rollUpdates) {
              const matchedLine = dbLines?.find(l => l.id === update.lineId);
              if (!matchedLine || !matchedLine.nama_item) continue;
              const weight = update.qtyBeratKg !== null && update.qtyBeratKg !== undefined
                ? update.qtyBeratKg
                : (matchedLine.qty_berat_kg || 0);

              const key = matchedLine.nama_item.trim().toLowerCase();
              qtyByProduct[key] = (qtyByProduct[key] || 0) + weight;
            }

            // Write quantity consumed to each matching stock.move
            for (const move of rawMoves) {
              const moveProdName = (Array.isArray(move.product_id) ? move.product_id[1] : (move.product_id || '')).trim().toLowerCase();
              let targetQty = null;
              for (const [prodKey, qtyVal] of Object.entries(qtyByProduct)) {
                if (moveProdName === prodKey || moveProdName.includes(prodKey) || prodKey.includes(moveProdName)) {
                  targetQty = qtyVal;
                  break;
                }
              }

              if (targetQty !== null) {
                await adminOdooClient._callObject('stock.move', 'write', [
                  [move.id],
                  { quantity: targetQty, picked: true }
                ]);
              }
            }
          }
        }
      } catch (moErr) {
        console.warn(`[WipService] Sync cutting to MO #${odooMoId} warning:`, moErr.message);
      }
    }
  }

  /**
   * Submit final production results (locks result stage)
   */
  async submitProductionResult({ user, orderId, qtyGradeA, qtyGradeB, sisaMakloonKg, noSuratJalan }) {
    const { order } = await this.getOrderDetails({ user, orderId, includeRawMoves: false });

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

    // 4. Push to Odoo
    try {
      await this._syncProductionToOdoo(order, aGrade, bGrade, sisaKg);
      if (order.odoo_mo_id) {
        rawMovesCache.delete(order.odoo_mo_id);
      }
    } catch (err) {
      console.warn(`[WipService] Odoo async production push warning: ${err.message}`);
    }

    return {
      success: true,
      message: 'Hasil jahit berhasil dilaporkan dan disinkronkan ke Odoo.',
      qtyGradeA: aGrade,
      qtyGradeB: bGrade,
      sisaMakloonKg: sisaKg,
      noSuratJalan: suratJalan
    };
  }

  async _syncProductionToOdoo(orderOrWipId, aGrade, bGrade, sisaKg) {
    const odooWipId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_wip_id : orderOrWipId;
    const odooMoId = typeof orderOrWipId === 'object' ? orderOrWipId.odoo_mo_id : null;
    if (!odooWipId && !odooMoId) return;

    await adminOdooClient.authenticate();

    const wipUpdateVals = {
      x_studio_qty_kirim_a_grade: aGrade,
      x_studio_qty_kirim_b_grade: bGrade,
      x_studio_sisa_makloon_kg: sisaKg
    };

    let parentMo = null;
    if (odooMoId) {
      try {
        const mos = await adminOdooClient._callObject('mrp.production', 'read', [[odooMoId]], {
          fields: ['id', 'name', 'state', 'qty_producing', 'product_id', 'product_uom_id', 'company_id', 'picking_type_id', 'production_group_id', 'bom_id', 'x_studio_sales_order', 'product_qty']
        });
        if (mos && mos[0]) {
          parentMo = mos[0];
        }
      } catch (moErr) {
        console.warn(`[WipService] Read parent MO #${odooMoId} error:`, moErr.message);
      }
    }

    // 1. Sync to Parent Manufacturing Order (qty_producing for Grade A)
    if (parentMo && aGrade !== undefined && aGrade !== null) {
      try {
        if (!['done', 'cancel'].includes(parentMo.state)) {
          await adminOdooClient._callObject('mrp.production', 'write', [[parentMo.id], {
            qty_producing: aGrade
          }]);
        }
      } catch (moErr) {
        console.warn(`[WipService] Sync qty_producing to MO #${odooMoId} warning:`, moErr.message);
      }
    }

    // 2. MO Grade B creation / update if bGrade > 0
    if (parentMo && bGrade > 0) {
      try {
        const originB = `Turunan Grade B - ${parentMo.name}`;
        // Find if MO Grade B already exists
        const existingMoBs = await adminOdooClient._callObject('mrp.production', 'search_read', [
          [[ 'origin', '=', originB ]]
        ], { fields: ['id', 'name', 'state', 'product_qty', 'x_studio_sales_order'], limit: 1 });

        if (existingMoBs && existingMoBs.length > 0) {
          const moB = existingMoBs[0];
          const moBUpdates = {};
          if (!['done', 'cancel'].includes(moB.state) && parseFloat(moB.product_qty) !== bGrade) {
            moBUpdates.product_qty = bGrade;
          }
          if (parentMo.x_studio_sales_order && !moB.x_studio_sales_order) {
            moBUpdates.x_studio_sales_order = parentMo.x_studio_sales_order[0];
          }
          if (Object.keys(moBUpdates).length > 0) {
            await adminOdooClient._callObject('mrp.production', 'write', [[moB.id], moBUpdates]);
          }
          wipUpdateVals.x_studio_nama_mo_grade_b = moB.name;
        } else {
          // Search for a Grade B product variant, or fallback to the parent product
          let targetProdBId = parentMo.product_id[0];
          try {
            const prods = await adminOdooClient._callObject('product.product', 'read', [[parentMo.product_id[0]]], {
              fields: ['product_tmpl_id']
            });
            const tmplId = prods && prods[0] && prods[0].product_tmpl_id ? prods[0].product_tmpl_id[0] : null;
            if (tmplId) {
              const prodBs = await adminOdooClient._callObject('product.product', 'search_read', [
                [
                  ['product_tmpl_id', '=', tmplId],
                  ['name', 'ilike', 'GRADE B']
                ]
              ], { fields: ['id', 'name', 'uom_id'], limit: 1 });
              if (prodBs && prodBs.length > 0) {
                targetProdBId = prodBs[0].id;
              }
            }
          } catch (e) {}

          const moPayload = {
            product_id: targetProdBId,
            product_qty: bGrade,
            product_uom_id: parentMo.product_uom_id ? parentMo.product_uom_id[0] : 1,
            origin: originB,
            company_id: parentMo.company_id ? parentMo.company_id[0] : 1,
            picking_type_id: parentMo.picking_type_id ? parentMo.picking_type_id[0] : false
          };
          if (parentMo.production_group_id) {
            moPayload.production_group_id = parentMo.production_group_id[0];
          }
          if (parentMo.bom_id) {
            moPayload.bom_id = parentMo.bom_id[0];
          }
          if (parentMo.x_studio_sales_order) {
            moPayload.x_studio_sales_order = parentMo.x_studio_sales_order[0];
          }

          const newMoBId = await adminOdooClient._callObject('mrp.production', 'create', [moPayload]);
          const readMoB = await adminOdooClient._callObject('mrp.production', 'read', [[newMoBId]], { fields: ['name'] });
          const moBName = readMoB && readMoB[0] ? readMoB[0].name : `MO#${newMoBId}`;
          wipUpdateVals.x_studio_nama_mo_grade_b = moBName;
        }
      } catch (moBErr) {
        console.warn(`[WipService] MO Grade B creation error:`, moBErr.message);
      }
    }

    // 3. Sisa Makloon (kg) -> Create / update Internal Transfer for BSKL
    if (odooWipId && parentMo) {
      try {
        const wips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[odooWipId]], {
          fields: ['x_name', 'x_studio_warehouse', 'x_studio_sales_order']
        });
        const currentWip = wips && wips[0] ? wips[0] : null;
        const whId = currentWip?.x_studio_warehouse ? currentWip.x_studio_warehouse[0] : null;

        if (whId) {
          const warehouses = await adminOdooClient._callObject('stock.warehouse', 'read', [[whId]], {
            fields: ['id', 'name', 'lot_stock_id']
          });
          const wh = warehouses && warehouses[0] ? warehouses[0] : null;

          if (wh && wh.lot_stock_id) {
            const soName = currentWip.x_studio_sales_order ? (Array.isArray(currentWip.x_studio_sales_order) ? currentWip.x_studio_sales_order[1] : currentWip.x_studio_sales_order) : '';
            const prefix = `Sisa Makloon - ${currentWip.x_name || parentMo.name} |`;
            const originM = soName ? `${prefix} SO ${soName}` : `${prefix} MO ${parentMo.name}`;
            const soId = parentMo.x_studio_sales_order ? parentMo.x_studio_sales_order[0] : (currentWip?.x_studio_sales_order ? currentWip.x_studio_sales_order[0] : false);

            const existingPicks = await adminOdooClient._callObject('stock.picking', 'search_read', [
              [['origin', '=like', `${prefix}%`]]
            ], { fields: ['id', 'name', 'state', 'move_ids', 'x_studio_sales_order'], limit: 1 });

            const pick = existingPicks && existingPicks.length > 0 ? existingPicks[0] : null;

            if (sisaKg > 0) {
              const bsklProds = await adminOdooClient._callObject('product.product', 'search_read', [
                [['name', '=', 'BSKL']]
              ], { fields: ['id', 'name', 'uom_id'], limit: 1 });

              const destLocs = await adminOdooClient._callObject('stock.location', 'search_read', [
                [
                  ['complete_name', 'ilike', 'WHGB/Stock'],
                  ['usage', '=', 'internal'],
                  ['company_id', 'in', [parentMo.company_id[0], false]]
                ]
              ], { fields: ['id'], limit: 1 });

              if (bsklProds && bsklProds.length > 0 && destLocs && destLocs.length > 0) {
                const bskl = bsklProds[0];
                const destId = destLocs[0].id;
                const srcId = wh.lot_stock_id[0];

                if (pick) {
                  if (!['done', 'cancel'].includes(pick.state)) {
                    if (pick.move_ids && pick.move_ids.length > 0) {
                      const moves = await adminOdooClient._callObject('stock.move', 'read', [
                        pick.move_ids,
                        ['id', 'product_id', 'product_uom_qty']
                      ]);
                      const bsklMove = moves.find(m => m.product_id && m.product_id[0] === bskl.id);
                      if (bsklMove && parseFloat(bsklMove.product_uom_qty) !== sisaKg) {
                        await adminOdooClient._callObject('stock.move', 'write', [[bsklMove.id], { product_uom_qty: sisaKg }]);
                      }
                    }
                    if (soId && !pick.x_studio_sales_order) {
                      await adminOdooClient._callObject('stock.picking', 'write', [[pick.id], { x_studio_sales_order: soId }]);
                    }
                  }
                  wipUpdateVals.x_studio_nama_transfer_makloon = pick.name;
                } else {
                  const ptypes = await adminOdooClient._callObject('stock.picking.type', 'search_read', [
                    [
                      ['code', '=', 'internal'],
                      '|',
                      ['warehouse_id', '=', wh.id],
                      ['company_id', '=', parentMo.company_id[0]]
                    ]
                  ], { fields: ['id', 'warehouse_id'], limit: 5 });

                  if (ptypes && ptypes.length > 0) {
                    const chosenPtype = ptypes.find(p => p.warehouse_id && p.warehouse_id[0] === wh.id) || ptypes[0];
                    const pickPayload = {
                      picking_type_id: chosenPtype.id,
                      location_id: srcId,
                      location_dest_id: destId,
                      origin: originM,
                      company_id: parentMo.company_id[0],
                      note: `Sisa bahan makloon dari MO ${parentMo.name}`
                    };
                    if (soId) {
                      pickPayload.x_studio_sales_order = soId;
                    }
                    if (parentMo.product_id) {
                      pickPayload.x_studio_product_mo = parentMo.product_id[0];
                    }
                    if (parentMo.product_qty) {
                      pickPayload.x_studio_quantity_mo = parentMo.product_qty;
                    }

                    const newPickId = await adminOdooClient._callObject('stock.picking', 'create', [pickPayload]);

                    await adminOdooClient._callObject('stock.move', 'create', [{
                      product_id: bskl.id,
                      product_uom_qty: sisaKg,
                      product_uom: bskl.uom_id ? bskl.uom_id[0] : 12,
                      picking_id: newPickId,
                      location_id: srcId,
                      location_dest_id: destId,
                      company_id: parentMo.company_id[0]
                    }]);

                    const readPick = await adminOdooClient._callObject('stock.picking', 'read', [[newPickId]], { fields: ['name'] });
                    const pickName = readPick && readPick[0] ? readPick[0].name : `PICK#${newPickId}`;
                    wipUpdateVals.x_studio_nama_transfer_makloon = pickName;
                  }
                }
              }
            } else if (pick && !['done', 'cancel'].includes(pick.state)) {
              await adminOdooClient._callObject('stock.picking', 'action_cancel', [[pick.id]]);
              wipUpdateVals.x_studio_nama_transfer_makloon = false;
            }
          }
        }
      } catch (sisaErr) {
        console.warn(`[WipService] Transfer Makloon creation error:`, sisaErr.message);
      }
    }

    // 4. Write all values to Monitoring WIP Vendor
    if (odooWipId) {
      await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [[odooWipId], wipUpdateVals], {
        context: { tracking_disable: true, no_automation: true }
      });
    }
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
    const prodId = w.x_studio_product ? w.x_studio_product[0] : null;

    let hargaVendor = Number(w.x_studio_harga || 0);
    let totalHarga = Number(w.x_studio_total_harga || 0);
    const qtyMasukSfp = Number(w.x_studio_qty_masuk_sfp || 0);

    // Auto-check pricing from Odoo if currently 0 and status is not 'Selesai' (Kombinasi A)
    const statusProduksi = (w.x_studio_status_produksi || '').trim().toLowerCase();
    if (hargaVendor === 0 && statusProduksi !== 'selesai' && whId && prodId) {
      try {
        const freshPrice = await this.fetchVendorPriceFromOdoo(whId, prodId);
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
          console.log(`[WIP Sync] Auto-resolved vendor price for WIP #${w.id}: Rp ${hargaVendor} (Total: Rp ${totalHarga})`);
        }
      } catch (errPrice) {
        console.warn(`[WIP Sync] Note on auto-fetching vendor price: ${errPrice.message}`);
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
              ['id', 'x_name', 'x_studio_kode_warna_roll', 'x_studio_yards', 'x_studio_uom', 'x_studio_qty_penerimaan', 'x_studio_qty_berat_kg']
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

  /**
   * 1. Triggered when Manufacturing Order is Confirmed
   * Replaces Odoo Automation: [Custom] Buat WIP dari MO
   */
  async onMoConfirmed(moId, { autoSync = true } = {}) {
    await adminOdooClient.authenticate();
    const id = Number(moId);
    if (!id || isNaN(id)) {
      throw new Error(`Invalid MO ID: ${moId}`);
    }

    return this._withLock(`mo_${id}`, async () => {
      console.log(`[WIP Service] Checking WIP record for MO ID #${id}...`);

      const existingWips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search_read', [
        [['x_studio_manufacturing_order', '=', id]]
      ], { fields: ['id', 'x_name'] });

      if (existingWips && existingWips.length > 0) {
        console.log(`[WIP Service] WIP record already exists for MO #${id} (WIP ID: ${existingWips[0].id}, Name: ${existingWips[0].x_name}). Skipping creation.`);
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
        console.log(`[WIP Service] MO "${moName}" (#${id}) Operation Type "${ptName}" / Warehouse "${whName}" is not Vendor. Skipping Monitoring WIP Vendor creation.`);
        return { success: true, skipped: true, reason: `Non-vendor operation type: ${ptName}` };
      }

      console.log(`[WIP Service] Creating new WIP record for MO "${moName}" (ID: ${id}, Operation Type: "${ptName}")...`);

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
          console.warn(`[WIP Service] Could not fetch BoM lines for BoM #${mo.bom_id[0]}: ${errBom.message}`);
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
          console.warn(`[WIP Service] Could not fetch workcenters for MO #${id}: ${errWo.message}`);
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
      console.log(`[WIP Service] Created WIP record #${newWipId} for MO "${moName}".`);

      if (autoSync && mo.picking_ids && mo.picking_ids.length > 0) {
        try {
          await this._syncWipFromPickings(newWipId, id);
        } catch (syncErr) {
          console.warn(`[WIP Service] Post-creation sync warning for WIP #${newWipId}: ${syncErr.message}`);
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
          console.warn(`[WIP Service] Initial Supabase sync warning for WIP #${newWipId}: ${mErr.message}`);
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
  async onTransferDone(pickingId) {
    await adminOdooClient.authenticate();
    const id = Number(pickingId);
    if (!id || isNaN(id)) {
      throw new Error(`Invalid Picking ID: ${pickingId}`);
    }

    console.log(`[WIP Service] Handling Transfer Done for Picking ID #${id}...`);

    const pickings = await adminOdooClient._callObject('stock.picking', 'read', [[id]], {
      fields: ['id', 'name', 'origin', 'state', 'x_studio_manufacturing_order', 'reference_ids', 'company_id', 'picking_type_id']
    });

    if (!pickings || pickings.length === 0) {
      console.warn(`[WIP Service] Picking #${id} not found in Odoo.`);
      return { success: false, notFound: true };
    }

    const picking = pickings[0];
    const pickingName = picking.name || '';
    const ptName = (picking.picking_type_id && picking.picking_type_id[1]) ? picking.picking_type_id[1].toUpperCase() : '';

    const isRelevantCode = ['/PC/', '/SPB/', '/SFP/'].some(code => pickingName.includes(code));
    const isVendorTransfer = ptName.includes('VENDOR') || pickingName.startsWith('VD');

    if (!isRelevantCode || !isVendorTransfer) {
      console.log(`[WIP Service] Picking ${pickingName} (#${id}) is not a vendor PC/SPB/SFP transfer. Skipping WIP sync.`);
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
      console.log(`[WIP Service] No MO associated with transfer ${pickingName} (#${id}). Skipping WIP sync.`);
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
      console.log(`[WIP Service] Transfer ${pickingName} (#${id}) has no vendor MOs associated.`);
      return { success: true, skipped: true, reason: 'No vendor MO found' };
    }

    const syncedWips = [];
    for (const moId of vendorMoIds) {
      let wips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search_read', [
        [['x_studio_manufacturing_order', '=', moId]]
      ], { fields: ['id', 'x_name'] });

      let wipId = wips && wips.length > 0 ? wips[0].id : null;
      if (!wipId) {
        const created = await this.onMoConfirmed(moId, { autoSync: false });
        if (created && created.wipId) {
          wipId = created.wipId;
        }
      }

      if (wipId) {
        const syncRes = await this._syncWipFromPickings(wipId, moId);
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
  async _syncWipFromPickings(wipId, moId) {
    return this._withLock(`wip_${wipId}`, async () => {
      console.log(`[WIP Service] Executing Single-Pass Compute for WIP #${wipId} (MO #${moId})...`);

      const wips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[wipId]], {
        fields: [
          'id', 'x_name', 'x_studio_manufacturing_order', 'x_studio_detail_roll_kain',
          'x_studio_warehouse', 'x_studio_product', 'x_studio_consumption_per_pcs_1',
          'x_studio_qty_kebutuhan_kain', 'x_studio_unit_kain_dari_gudang',
          'x_studio_unit_consumption_per_pcs', 'x_studio_actual_cutting',
          'x_studio_harga', 'x_studio_total_harga', 'x_studio_daftar_transfer',
          'x_studio_many2many_field_869_1k3jdrdl1', 'x_studio_sales_order',
          'x_studio_qty_kirim_a_grade', 'x_studio_qty_kirim_b_grade', 'x_studio_sisa_makloon_kg',
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
        console.log(`[WIP Service] MO ${moName} has no pickings linked yet.`);
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
            console.warn(`[WipService] Failed to set default Qty Penerimaan for line #${line.id}: ${writeErr.message}`);
          }
        }

        existingRollLines.push(line);
      }

      if (duplicateLineIdsToDelete.length > 0) {
        try {
          await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'unlink', [duplicateLineIdsToDelete]);
        } catch (delErr) {
          console.warn(`[WIP Service] Failed to unlink duplicate lines: ${delErr.message}`);
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
          console.warn(`[WIP Service] Backorder copy warning: ${errFamily.message}`);
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
          console.warn(`[WIP Service] Workcenter fetch error: ${errWo.message}`);
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
          console.warn(`[WIP Service] Could not fetch vendor pricing: ${errPrice.message}`);
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

      console.log(`[WIP Service] Writing Single-Pass computed values to WIP #${wipId}:`, vals);
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
              console.warn(`[WipService] Failed to read fresh lines after write: ${refErr.message}`);
            }
          }
          await wipRepo.upsertRollLines(savedId, linesToSave);
        }
      } catch (sbErr) {
        console.warn(`[WIP Service] Supabase sync warning for WIP #${wipId}: ${sbErr.message}`);
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
   * Helper: Fetch current pricing from x_vendor_production in Odoo
   */
  async fetchVendorPriceFromOdoo(warehouseId, productId, workcenterIds = []) {
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
      console.warn(`[WIP Service] fetchVendorPriceFromOdoo error: ${err.message}`);
      return 0.0;
    }
  }

  /**
   * 4. Triggered when Vendor Pricing (x_vendor_production) is created or updated in Odoo
   */
  async onVendorPriceUpdated(vendorPriceId) {
    await adminOdooClient.authenticate();
    const id = Number(vendorPriceId);
    if (!id || isNaN(id)) {
      throw new Error(`Invalid Vendor Price ID: ${vendorPriceId}`);
    }

    console.log(`[WIP Service] Handling Vendor Price Updated for ID #${id}...`);

    const records = await adminOdooClient._callObject('x_vendor_production', 'read', [[id]], {
      fields: ['id', 'x_studio_warehouse', 'x_studio_product', 'x_studio_value', 'x_studio_many2many_field_7h1_1k3jdkeub']
    });

    if (!records || records.length === 0) {
      console.warn(`[WIP Service] Vendor Price record #${id} not found in Odoo.`);
      return { success: false, notFound: true };
    }

    const vp = records[0];
    const warehouseId = vp.x_studio_warehouse ? vp.x_studio_warehouse[0] : null;
    const productId = vp.x_studio_product ? vp.x_studio_product[0] : null;
    const newPrice = parseFloat(vp.x_studio_value) || 0.0;
    const vpWorkcenterIds = vp.x_studio_many2many_field_7h1_1k3jdkeub || [];

    if (!warehouseId || !productId) {
      console.warn(`[WIP Service] Vendor Price #${id} missing warehouse or product.`);
      return { success: false, reason: 'Missing warehouse or product' };
    }

    console.log(`[WIP Service] Price record #${id}: Warehouse: ${warehouseId}, Product: ${productId}, Price: Rp ${newPrice}`);

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

    console.log(`[WIP Service] Found ${wips.length} WIP record(s) matching Warehouse ${warehouseId} & Product ${productId}`);

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
        console.log(`[WIP Service] Skipping WIP #${w.id} (${w.x_name}): Status is 'Selesai' (Locked)`);
        continue;
      }

      // 2. Kunci SPK yang sudah memiliki harga (> 0), hanya isi yang harganya masih 0
      const currentPrice = parseFloat(w.x_studio_harga) || 0.0;
      if (currentPrice > 0) {
        console.log(`[WIP Service] Skipping WIP #${w.id} (${w.x_name}): Existing price Rp ${currentPrice} preserved (Only 0 is filled)`);
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
        console.warn(`[WIP Service] Note on updating Supabase pricing for WIP #${w.id}: ${errDb.message}`);
      }

      updatedWips.push({
        wipId: w.id,
        moName: w.x_name,
        hargaVendor: newPrice,
        sfpQty,
        totalHarga
      });
    }

    console.log(`[WIP Service] Successfully updated pricing for ${updatedWips.length} WIP orders.`);
    return {
      success: true,
      priceId: id,
      newPrice,
      updatedCount: updatedWips.length,
      updatedWips
    };
  }
}

export const wipService = new WipService();
