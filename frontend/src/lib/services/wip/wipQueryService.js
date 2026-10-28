import { supabaseServer } from '../../supabaseServer.js';
import { adminOdooClient } from '../../odoo/odooClient.js';
import { wipRepo } from '../wipRepository.js';
import { rawMovesCache, transfersCache, lazyFieldsCache, setBoundedCache, CACHE_TTL } from './wipCache.js';
import { fetchVendorPriceFromOdoo, resolveFinishing } from './wipSyncService.js';

export function isChildBackorder(orderOrMoName, parentWipOrderId) {
  const name = typeof orderOrMoName === 'string' ? orderOrMoName : (orderOrMoName?.mo_name || '');
  const parentId = typeof orderOrMoName === 'object' ? orderOrMoName?.parent_wip_order_id : parentWipOrderId;
  const trimmed = name.trim();

  // If ends with -001, -01, or -1: it is the parent MO! NOT a child backorder!
  if (/-(?:0*1)$/.test(trimmed)) {
    return false;
  }

  // If ends with -002, -003, -004, -005, etc. (-00X where X > 1)
  const match = trimmed.match(/-(\d+)$/);
  if (match) {
    const num = parseInt(match[1], 10);
    if (num > 1) return true;
  }

  // If parent_wip_order_id exists and not -001
  if (parentId) {
    return true;
  }

  return false;
}

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
 * Get orders list with pagination, search, status filter, period filter, sorting, and metrics
 */
export async function getOrders({ user, search, status, vendorId, page = 1, limit = 20, sort = 'latest', period, backorder }) {
  const numLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const numPage = Math.max(1, Number(page) || 1);
  const offset = (numPage - 1) * numLimit;

  // 1. Base Query with joined vendor
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
  const scopedVendorId = isVendorRole ? user.vendor_id : (vendorId ? Number(vendorId) : null);
  if (scopedVendorId) {
    query = query.eq('vendor_id', scopedVendorId);
  }

  // 3. Sanitized Search Filter (ID, MO name, product name, sales order)
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

  // 4. Status Filter
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

  // 5. Backorder explicit filter
  if (backorder === 'backorder') {
    query = query.not('parent_wip_order_id', 'is', null);
  } else if (backorder === 'regular') {
    query = query.is('parent_wip_order_id', null);
  }

  // 6. Period Filter (using exact calendar boundaries so 28/29/30-day months never crash PostgreSQL)
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

  // 7. Sorting
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

  // Apply pagination range and execute orders + metrics in parallel
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
 * Get single order details with roll lines, BOM raw moves, and transfers
 */
export async function getOrderDetails({ user, orderId, includeRawMoves = true, includeTransfers = includeRawMoves }) {
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

  const isVendorRole = ['master_vendor', 'admin_vendor'].includes(user.role);
  if (isVendorRole && order.vendor_id !== user.vendor_id) {
    throw new Error('Anda tidak memiliki izin untuk melihat order ini.');
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

  // Coalesced & cooldown-guarded lazy metadata sync (only runs on interactive detail view, max once per 10 mins per order)
  const orderStatus = (order.status_produksi || '').trim().toLowerCase();
  const needsConsumption = order.consumption_per_pcs == null;
  const needsSpec = order.finishing == null && order.packing == null;
  const needsPrice = showPrice && Number(order.harga_vendor || 0) === 0 && orderStatus !== 'selesai';
  const lastLazyCheck = lazyFieldsCache.get(order.id) || 0;

  if (includeRawMoves && order.odoo_wip_id && (needsConsumption || needsSpec || needsPrice) && Date.now() - lastLazyCheck > CACHE_TTL) {
    setBoundedCache(lazyFieldsCache, order.id, Date.now());
    try {
      await adminOdooClient.authenticate();
      const wipData = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[order.odoo_wip_id]], {
        fields: [
          'x_studio_consumption_per_pcs_1',
          'x_studio_unit_consumption_per_pcs',
          'x_studio_related_field_77l_1k5rj70p4',
          'x_studio_related_field_52c_1k5rj7ik0',
          'x_studio_qc_pass_1',
          'x_studio_qty_qc_pass_1',
          'x_studio_qc_status',
          'x_studio_keterangan_qms',
          'x_studio_gambar_qc',
          'x_studio_product',
          'x_studio_warehouse',
          'x_studio_qty_masuk_sfp',
          'x_studio_many2many_field_869_1k3jdrdl1'
        ],
        // bin_size: true avoids downloading multi-MB base64 QC images while preserving boolean presence check
        context: { bin_size: true }
      });

      if (wipData && wipData[0]) {
        const w = wipData[0];
        const dbPatch = {};

        if (needsConsumption) {
          const cVal = w.x_studio_consumption_per_pcs_1 !== undefined && w.x_studio_consumption_per_pcs_1 !== false
            ? Number(w.x_studio_consumption_per_pcs_1)
            : null;
          const cUom = w.x_studio_unit_consumption_per_pcs
            ? (Array.isArray(w.x_studio_unit_consumption_per_pcs) ? w.x_studio_unit_consumption_per_pcs[1] : String(w.x_studio_unit_consumption_per_pcs))
            : null;
          if (cVal !== null || cUom !== null) {
            order.consumption_per_pcs = cVal;
            order.consumption_uom = cUom;
            dbPatch.consumption_per_pcs = cVal;
            dbPatch.consumption_uom = cUom;
          }
        }

        const fin = resolveFinishing(w.x_studio_related_field_77l_1k5rj70p4);
        const pack = w.x_studio_related_field_52c_1k5rj7ik0 || null;
        const qpId = w.x_studio_qc_pass_1 ? (Array.isArray(w.x_studio_qc_pass_1) ? w.x_studio_qc_pass_1[0] : w.x_studio_qc_pass_1) : null;
        const qpName = w.x_studio_qc_pass_1 && Array.isArray(w.x_studio_qc_pass_1) ? w.x_studio_qc_pass_1[1] : null;
        const qQty = Number(w.x_studio_qty_qc_pass_1 || 0);
        const qStatus = w.x_studio_qc_status || null;
        const qKeterangan = w.x_studio_keterangan_qms || null;
        const hasGambar = Boolean(w.x_studio_gambar_qc);

        if (fin !== null) {
          order.finishing = fin;
          dbPatch.finishing = fin;
        }
        if (pack !== null) {
          order.packing = pack;
          dbPatch.packing = pack;
        }
        if (order.qc_pass_id == null && qpId !== null) {
          order.qc_pass_id = qpId;
          dbPatch.qc_pass_id = qpId;
        }
        if (order.qc_pass_name == null && qpName !== null) {
          order.qc_pass_name = qpName;
          dbPatch.qc_pass_name = qpName;
        }
        if ((order.qty_qc_pass == null || order.qty_qc_pass === 0) && qQty > 0) {
          order.qty_qc_pass = qQty;
          dbPatch.qty_qc_pass = qQty;
        }
        if (order.qc_status == null && qStatus !== null) {
          order.qc_status = qStatus;
          dbPatch.qc_status = qStatus;
        }
        if (order.keterangan_qms == null && qKeterangan !== null) {
          order.keterangan_qms = qKeterangan;
          dbPatch.keterangan_qms = qKeterangan;
        }
        if (hasGambar && !order.has_gambar_qc) {
          order.has_gambar_qc = true;
          dbPatch.has_gambar_qc = true;
        }

        if (needsPrice && w.x_studio_product) {
          const prodId = w.x_studio_product[0];
          const whId = w.x_studio_warehouse ? w.x_studio_warehouse[0] : order.odoo_warehouse_id;
          const sfpQty = parseFloat(w.x_studio_qty_masuk_sfp) || Number(order.qty_masuk_sfp || 0);
          const wcIds = w.x_studio_many2many_field_869_1k3jdrdl1 || [];

          const freshPrice = await fetchVendorPriceFromOdoo(whId, prodId, wcIds);
          if (freshPrice > 0) {
            const freshTotal = freshPrice * sfpQty;
            order.harga_vendor = freshPrice;
            order.total_harga = freshTotal;
            dbPatch.harga_vendor = freshPrice;
            dbPatch.total_harga = freshTotal;

            await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [
              [order.odoo_wip_id],
              { x_studio_harga: freshPrice, x_studio_total_harga: freshTotal }
            ], { context: { tracking_disable: true, no_automation: true } });
          }
        }

        if (Object.keys(dbPatch).length > 0) {
          await supabaseServer
            .from('wip_orders')
            .update(dbPatch)
            .eq('id', order.id);
        }
      }
    } catch (lazyErr) {
      console.warn(`[WipQueryService] Coalesced lazy sync warning for order #${order.id}: ${lazyErr.message}`);
    }
  }

  // Fetch roll lines, BOM moves, and Transfers in parallel
  const [rollLinesRes, rawMoves, transfers] = await Promise.all([
    supabaseServer
      .from('wip_roll_lines')
      .select('*')
      .eq('wip_order_id', order.id)
      .order('id', { ascending: true }),
    includeRawMoves ? fetchOrderRawMoves(order).catch(() => []) : Promise.resolve([]),
    includeTransfers ? fetchOrderTransfers(order).catch(() => []) : Promise.resolve([])
  ]);

  const rollLines = rollLinesRes.data || [];
  order.roll_lines = rollLines;
  const isBackorder = isChildBackorder(order);
  order.is_backorder = isBackorder;
  order.sales_order = order.sales_order || (order.parent ? order.parent.sales_order : '-') || '-';
  order.vendor_name = order.vendors ? order.vendors.name : 'Unknown';
  if (!showPrice) {
    order.harga_vendor = 0;
    order.total_harga = 0;
  }

  // Check if BSKL transfer is validated
  const bsklTransfer = (transfers || []).find((t) =>
    (t.origin && t.origin.includes('Sisa Makloon')) ||
    (t.name && t.name.includes('BSKL')) ||
    t.category === 'bskl'
  );
  if (bsklTransfer) {
    order.bskl_transfer = bsklTransfer;
    if (bsklTransfer.state === 'done' || bsklTransfer.stateDisplay === 'Selesai') {
      order.is_bskl_validated = true;
    }
  }

  // Resolve Grade B submit count
  if (order.grade_b_submit_count === undefined || order.grade_b_submit_count === null) {
    try {
      const { count } = await supabaseServer
        .from('audit_logs')
        .select('*', { count: 'exact', head: true })
        .eq('wip_order_id', order.id)
        .eq('action', 'submit_grade_b');
      order.grade_b_submit_count = count || 0;
    } catch (e) {
      order.grade_b_submit_count = 0;
    }
  }

  // Lifecycle-based Locking & Permissions
  const isUnlockedByAdmin = Boolean(order.is_unlocked_by_admin);
  const hasGradeASent = Number(order.qty_grade_a || 0) > 0;
  const isMoDone = order.mo_state === 'done';

  // 1. Penerimaan, potong, kain, & aksesoris: terkunci setelah Grade A dikirim & MO state done.
  // Bisa dibuka jika backorder ATAU dibuka master admin
  const isCuttingLocked = (hasGradeASent && isMoDone) && !isUnlockedByAdmin && !isBackorder;

  // 2. Qty Grade A: terkunci setelah Grade A dikirim & MO state done
  const isGradeALocked = (hasGradeASent && isMoDone) && !isUnlockedByAdmin;

  // 3. Qty Grade B: terkunci setelah submit 2x (1x initial + 1x revisi)
  const isGradeBLocked = (Number(order.grade_b_submit_count || 0) >= 2) && !isUnlockedByAdmin;

  // 4. Sisa Potong (BSKL): terkunci setelah dokumen transfer divalidasi di Odoo
  const isBsklLocked = Boolean(order.is_bskl_validated) && !isUnlockedByAdmin;

  order.is_cutting_locked = isCuttingLocked;
  order.is_grade_a_locked = isGradeALocked;
  order.is_grade_b_locked = isGradeBLocked;
  order.is_bskl_locked = isBsklLocked;

  const isMasterAdmin = user.role === 'master_admin';
  order.can_edit_cutting = !isCuttingLocked || isUnlockedByAdmin || isMasterAdmin;
  order.can_edit_grade_a = !isGradeALocked || isUnlockedByAdmin || isMasterAdmin;
  order.can_edit_grade_b = !isGradeBLocked || isUnlockedByAdmin || isMasterAdmin;
  order.can_edit_bskl = !isBsklLocked || isUnlockedByAdmin || isMasterAdmin;

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
      fields: ['id', 'name', 'state', 'move_raw_ids']
    });

    if (mo && mo[0]) {
      const moPatch = {};
      if (mo[0].name && mo[0].name !== order.mo_name) {
        order.mo_name = mo[0].name;
        moPatch.mo_name = mo[0].name;
      }
      if (mo[0].state && mo[0].state !== order.mo_state) {
        order.mo_state = mo[0].state;
        moPatch.mo_state = mo[0].state;
      }
      if (Object.keys(moPatch).length > 0) {
        await supabaseServer.from('wip_orders').update(moPatch).eq('id', order.id);
      }
    }

    if (!mo || !mo[0] || !mo[0].move_raw_ids || mo[0].move_raw_ids.length === 0) {
      setBoundedCache(rawMovesCache, order.odoo_mo_id, { time: Date.now(), data: [] });
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

    const mapped = (moves || []).map((m) => ({
      id: m.id,
      productName: Array.isArray(m.product_id) ? m.product_id[1] : (m.product_id || '-'),
      demandQty: Number(m.product_uom_qty || 0),
      quantityDone: Number(m.quantity || 0),
      uom: Array.isArray(m.product_uom) ? m.product_uom[1] : (m.product_uom || 'yard'),
      state: m.state,
      stateDisplay: stateMap[m.state] || m.state
    }));

    setBoundedCache(rawMovesCache, order.odoo_mo_id, { time: Date.now(), data: mapped });
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
  const cacheKey = order.odoo_mo_id || `wip_${order.odoo_wip_id}`;
  if (!order.odoo_mo_id && !order.odoo_wip_id) return [];
  const cached = transfersCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }

  try {
    await adminOdooClient.authenticate();
    const [moRes, wipRes] = await Promise.all([
      order.odoo_mo_id
        ? adminOdooClient._callObject('mrp.production', 'read', [[order.odoo_mo_id]], {
            fields: ['picking_ids']
          }).catch(() => [])
        : Promise.resolve([]),
      order.odoo_wip_id
        ? adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[order.odoo_wip_id]], {
            fields: ['x_studio_daftar_transfer']
          }).catch(() => [])
        : Promise.resolve([])
    ]);

    let pickingIds = [];
    if (moRes && moRes[0]?.picking_ids?.length) {
      pickingIds.push(...moRes[0].picking_ids);
    }
    if (wipRes && wipRes[0]?.x_studio_daftar_transfer?.length) {
      pickingIds.push(...wipRes[0].x_studio_daftar_transfer);
    }

    pickingIds = Array.from(new Set(pickingIds.filter(Boolean)));
    if (pickingIds.length === 0) {
      setBoundedCache(transfersCache, cacheKey, { time: Date.now(), data: [] });
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

    const mapped = (pickings || []).map((p) => {
      const typeName = Array.isArray(p.picking_type_id) ? p.picking_type_id[1] : (p.picking_type_id || '');
      const pName = p.name || '';
      let category = 'lainnya';
      if (pName.includes('/PC/') || typeName.toLowerCase().includes('komponen') || typeName.toLowerCase().includes('pilih')) {
        category = 'komponen';
      } else if (pName.includes('/SFP/') || typeName.toLowerCase().includes('simpan') || typeName.toLowerCase().includes('produk jadi')) {
        category = 'produk_jadi';
      } else if (pName.includes('BSKL') || (p.origin && (p.origin.toLowerCase().includes('retur') || p.origin.toLowerCase().includes('sisa makloon')))) {
        category = 'bskl';
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

    setBoundedCache(transfersCache, cacheKey, { time: Date.now(), data: mapped });
    return mapped;
  } catch (err) {
    console.warn(`[WipQueryService] Transfers fetch error for MO #${order.odoo_mo_id}:`, err.message);
    return [];
  }
}
