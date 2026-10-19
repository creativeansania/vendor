import { supabaseServer } from '../../supabaseServer.js';
import { adminOdooClient } from '../../odoo/odooClient.js';
import { wipRepo } from '../wipRepository.js';
import { rawMovesCache, transfersCache, CACHE_TTL } from './wipCache.js';
import { fetchVendorPriceFromOdoo } from './wipSyncService.js';

/**
 * Get orders list with pagination, search, status filter, period filter, sorting, and metrics
 */
export async function getOrders({ user, search, status, vendorId, page = 1, limit = 20, sort = 'latest', period, backorder }) {
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
    console.error('[WipQueryService] getOrders query error:', error.message);
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
  const metrics = await getMetrics(user, isVendorRole ? user.vendor_id : vendorId);

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

/**
 * Aggregate SPK metrics for dashboard
 */
export async function getMetrics(user, vendorId) {
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
export async function getOrderDetails({ user, orderId, includeRawMoves = true }) {
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

        const freshPrice = await fetchVendorPriceFromOdoo(whId, prodId, wcIds);
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
          console.log(`[WipQueryService] Lazy auto-resolved price for order #${order.id}: Rp ${freshPrice} (Total: Rp ${freshTotal})`);
        }
      }
    } catch (errPrice) {
      console.warn(`[WipQueryService] Lazy price fetch warning: ${errPrice.message}`);
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
      fetchOrderRawMoves(order).catch(() => []),
      fetchOrderTransfers(order).catch(() => [])
    ]);
  }

  return {
    order,
    rollLines: order.roll_lines || [],
    rawMoves,
    transfers
  };
}

/**
 * Fetch raw moves (BOM lines) for a given manufacturing order
 */
export async function fetchOrderRawMoves(order) {
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
    console.warn(`[WipQueryService] BOM fetch error for MO #${order.odoo_mo_id}:`, err.message);
    return [];
  }
}

/**
 * Fetch stock transfers associated with this order
 */
export async function fetchOrderTransfers(order) {
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
    console.warn(`[WipQueryService] Transfers fetch error for MO #${order.odoo_mo_id}:`, err.message);
    return [];
  }
}
