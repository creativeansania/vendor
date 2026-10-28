import { supabaseServer } from '../../../supabaseServer.js';
import { invalidateMetricsCache } from '../wipCache.js';

/**
 * Master Admin Explicit Unlock: Buka Kunci agar user/vendor dapat mengedit kembali
 */
export async function adminUnlockOrder({ user, orderId, reason = '' }) {
  if (user.role !== 'master_admin') {
    throw new Error('Hanya Master Admin yang berhak membuka kunci (unlock).');
  }

  const updatePayload = {
    is_unlocked_by_admin: true,
    unlocked_at: new Date().toISOString(),
    unlocked_by: user.id,
    cutting_locked_at: null,
    cutting_locked_by: null,
    result_locked_at: null,
    result_locked_by: null,
    grade_b_submit_count: 0
  };

  const { error: updErr } = await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  if (updErr && updErr.message?.includes('is_unlocked_by_admin')) {
    delete updatePayload.is_unlocked_by_admin;
    delete updatePayload.unlocked_at;
    delete updatePayload.unlocked_by;
    delete updatePayload.grade_b_submit_count;
    await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  }

  await supabaseServer.from('audit_logs').insert({
    user_id: user.id,
    wip_order_id: orderId,
    action: 'admin_unlock_order',
    reason: (reason || 'Dibuka manual oleh Master Admin').trim()
  });

  invalidateMetricsCache();

  return {
    success: true,
    message: 'Kunci order berhasil dibuka oleh Master Admin. Seluruh user & vendor dapat mengedit kembali.'
  };
}

/**
 * Master Admin Explicit Relock: Kunci Kembali
 */
export async function adminRelockOrder({ user, orderId }) {
  if (user.role !== 'master_admin') {
    throw new Error('Hanya Master Admin yang berhak mengunci kembali (relock).');
  }

  const { data: currentOrder } = await supabaseServer
    .from('wip_orders')
    .select('id, actual_cutting, qty_grade_a, status_produksi, cutting_locked_at, result_locked_at')
    .eq('id', orderId)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  const updatePayload = {
    is_unlocked_by_admin: false,
    updated_at: nowIso
  };

  // Restore stage lock timestamps cleared by adminUnlockOrder if stage already has data
  if (currentOrder) {
    if (Number(currentOrder.actual_cutting || 0) > 0 && !currentOrder.cutting_locked_at) {
      updatePayload.cutting_locked_at = nowIso;
      updatePayload.cutting_locked_by = user.id;
    }
    const isFinished =
      Number(currentOrder.qty_grade_a || 0) > 0 ||
      String(currentOrder.status_produksi || '').trim().toLowerCase() === 'selesai';
    if (isFinished && !currentOrder.result_locked_at) {
      updatePayload.result_locked_at = nowIso;
      updatePayload.result_locked_by = user.id;
    }
  }

  const { error: updErr } = await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  if (updErr && updErr.message?.includes('is_unlocked_by_admin')) {
    delete updatePayload.is_unlocked_by_admin;
    await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  }

  await supabaseServer.from('audit_logs').insert({
    user_id: user.id,
    wip_order_id: orderId,
    action: 'admin_relock_order'
  });

  invalidateMetricsCache();

  return {
    success: true,
    message: 'Order berhasil dikunci kembali oleh Master Admin.'
  };
}

/**
 * Unlock Order stage (Backward compatibility)
 */
export async function unlockOrder({ user, orderId, reason }) {
  return adminUnlockOrder({ user, orderId, reason });
}

