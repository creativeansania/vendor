import { supabaseServer } from '../../../supabaseServer.js';
import { isChildBackorder, applyLifecycleLocksAndPermissions } from './orderLockCalculator.js';
import { runCoalescedLazyMetadataSync, fetchOrderRawMoves, fetchOrderTransfers } from './odooOrderAttachments.js';

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
    } catch {
      order.parent = null;
    }
  }

  if (includeRawMoves) {
    await runCoalescedLazyMetadataSync(order, showPrice);
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
    } catch {
      order.grade_b_submit_count = 0;
    }
  }

  applyLifecycleLocksAndPermissions(order, user, isBackorder);

  return {
    order,
    rollLines: order.roll_lines || [],
    rawMoves,
    transfers
  };
}

