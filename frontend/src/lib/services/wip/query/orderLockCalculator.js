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

export function applyLifecycleLocksAndPermissions(order, user, isBackorder) {
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
}

