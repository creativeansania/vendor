import { supabaseServer } from '../../../supabaseServer.js';
import { isChildBackorder } from './orderLockCalculator.js';

function sanitizePostgrestSearchTerm(raw) {
  if (!raw) return '';
  // Strip PostgREST logic delimiters (commas, parentheses, wildcards, backslashes) to prevent filter injection / syntax errors
  return String(raw)
    .replace(/[,()*\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getNextMonthFirstDay(periodStr) {
  const [yearStr, monthStr] = periodStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (!year || !month || month < 1 || month > 12) return null;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
}

/**
 * Aggregate SPK metrics for dashboard using lightweight SQL COUNT(*) head queries
 * (Transfers 0 row payloads over HTTP and avoids PostgREST's 1,000-row truncation limit)
 */
export async function getMetrics(user, vendorId) {
  const buildCountBase = () => {
    let q = supabaseServer
      .from('wip_orders')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true);
    if (vendorId) {
      q = q.eq('vendor_id', Number(vendorId));
    }
    return q;
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [
    totalRes,
    resultLockedRes,
    cuttingPendingRes,
    cuttingSelesaiRes,
    backorderRes,
    kainKurangRes,
    overdueRes,
    deadlineWeekRes
  ] = await Promise.all([
    buildCountBase(),
    buildCountBase().not('result_locked_at', 'is', null),
    buildCountBase().is('result_locked_at', null).is('cutting_locked_at', null).is('parent_wip_order_id', null),
    buildCountBase().not('cutting_locked_at', 'is', null),
    buildCountBase().not('parent_wip_order_id', 'is', null),
    buildCountBase().ilike('status_kebutuhan_kain', '%kurang%'),
    buildCountBase().is('result_locked_at', null).lt('deadline_spk', todayStr),
    buildCountBase().is('result_locked_at', null).gte('deadline_spk', todayStr).lte('deadline_spk', sevenDaysLater)
  ]);

  const total = totalRes.count || 0;
  const result_locked = resultLockedRes.count || 0;
  const cutting_pending = cuttingPendingRes.count || 0;
  const cutting_selesai = cuttingSelesaiRes.count || 0;
  const backorder_count = backorderRes.count || 0;
  const kain_kurang = kainKurangRes.count || 0;
  const overdue = overdueRes.count || 0;
  const deadline_week = deadlineWeekRes.count || 0;
  const sewing_active = Math.max(0, total - result_locked - cutting_pending);

  return {
    total,
    cutting_pending,
    sewing_active,
    result_locked,
    kain_kurang,
    overdue,
    deadline_week,
    backorder_count,
    // backwards-compatible keys:
    total_spk: total,
    cutting_selesai,
    selesai_jahit: result_locked,
    terlambat: overdue
  };
}

/**
 * Get orders list with pagination, search, status filter, period filter, sorting, and metrics
 */
export async function getOrders({ user, search, status, vendorId, page = 1, limit = 20, sort = 'latest', period, backorder }) {
  const numLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const numPage = Math.max(1, Number(page) || 1);
  const offset = (numPage - 1) * numLimit;

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

  const isVendorRole = ['master_vendor', 'admin_vendor'].includes(user.role);
  const scopedVendorId = isVendorRole ? user.vendor_id : (vendorId ? Number(vendorId) : null);
  if (scopedVendorId) {
    query = query.eq('vendor_id', scopedVendorId);
  }

  const cleanSearch = sanitizePostgrestSearchTerm(search);
  if (cleanSearch) {
    const numOnly = cleanSearch.replace(/[^0-9]/g, '');
    if (numOnly) {
      query = query.or(
        `id.eq.${numOnly},mo_name.ilike.%${cleanSearch}%,mo_name.ilike.%${numOnly}%,product_name.ilike.%${cleanSearch}%,sales_order.ilike.%${cleanSearch}%`
      );
    } else {
      query = query.or(
        `mo_name.ilike.%${cleanSearch}%,product_name.ilike.%${cleanSearch}%,sales_order.ilike.%${cleanSearch}%`
      );
    }
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  if (status === 'cutting_pending') {
    query = query.is('cutting_locked_at', null).is('result_locked_at', null).is('parent_wip_order_id', null);
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

  if (backorder === 'backorder') {
    query = query.not('parent_wip_order_id', 'is', null);
  } else if (backorder === 'regular') {
    query = query.is('parent_wip_order_id', null);
  }

  if (period === 'this_month') {
    const firstDayOfMonth = todayStr.substring(0, 7) + '-01';
    query = query.gte('start_spk', firstDayOfMonth);
  } else if (period === 'last_month') {
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthStr = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-01`;
    const curMonthStr = todayStr.substring(0, 7) + '-01';
    query = query.gte('start_spk', prevMonthStr).lt('start_spk', curMonthStr);
  } else if (period && /^\d{4}-\d{2}$/.test(period)) {
    const nextMonthStr = getNextMonthFirstDay(period);
    if (nextMonthStr) {
      query = query.gte('start_spk', `${period}-01`).lt('start_spk', nextMonthStr);
    }
  }

  if (sort === 'deadline' || sort === 'deadline_asc') {
    query = query.order('deadline_spk', { ascending: true, nullsFirst: false });
  } else if (sort === 'deadline_desc') {
    query = query.order('deadline_spk', { ascending: false, nullsFirst: false });
  } else if (sort === 'so') {
    query = query.order('sales_order', { ascending: true, nullsFirst: false }).order('id', { ascending: false });
  } else if (sort === 'mo') {
    query = query.order('mo_name', { ascending: true });
  } else if (sort === 'qty_desc') {
    query = query.order('qty_spk', { ascending: false });
  } else if (sort === 'qty_asc') {
    query = query.order('qty_spk', { ascending: true });
  } else if (sort === 'oldest') {
    query = query.order('id', { ascending: true });
  } else if (sort === 'product') {
    query = query.order('product_name', { ascending: true });
  } else if (sort === 'status') {
    query = query.order('status_produksi', { ascending: true });
  } else {
    query = query.order('id', { ascending: false });
  }

  query = query.range(offset, offset + numLimit - 1);

  const [ordersRes, metrics] = await Promise.all([
    query,
    getMetrics(user, scopedVendorId)
  ]);

  const { data: rawOrders, count: totalCount, error } = ordersRes;
  if (error) {
    console.error('[WipQueryService] getOrders query error:', error.message);
    throw new Error(error.message);
  }

  const total = totalCount || 0;
  const showPrice = user.role !== 'admin_vendor';

  const orders = (rawOrders || []).map((o) => {
    const isBackorder = isChildBackorder(o);
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

