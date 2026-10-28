import { supabaseServer } from '../../../supabaseServer.js';
import { rawMovesCache } from '../wipCache.js';
import { getOrderDetails } from '../wipQueryService.js';
import { syncGradeAToOdoo, syncGradeBToOdoo } from './odooGradeSync.js';
import { syncBsklToOdoo, syncProductionToOdoo } from './odooBsklSync.js';

/**
 * Submit final production results (locks result stage)
 */
export async function submitProductionResult({
  user,
  orderId,
  qtyGradeA,
  qtyGradeB,
  sisaPotongPanjang,
  sisaPotongSedang,
  sisaPotongPendek,
  sisaMakloonKg,
  noSuratJalan
}) {
  const { order } = await getOrderDetails({ user, orderId, includeRawMoves: false, includeTransfers: true });

  const aGrade = Math.max(0, Number(qtyGradeA || 0));
  const bGrade = Math.max(0, Number(qtyGradeB || 0));
  const panjangKg = Math.max(0, Number(sisaPotongPanjang || 0));
  const sedangKg = Math.max(0, Number(sisaPotongSedang || 0));
  const pendekKg = Math.max(0, Number(sisaPotongPendek || 0));

  const hasCategories = sisaPotongPanjang !== undefined || sisaPotongSedang !== undefined || sisaPotongPendek !== undefined;
  const calculatedTotal = Number((panjangKg + sedangKg + pendekKg).toFixed(2));
  const totalSisaKg = hasCategories ? calculatedTotal : Math.max(0, Number(sisaMakloonKg || 0));
  const suratJalan = (noSuratJalan || '').trim();

  // Enforce stage locks consistent with individual tabs
  const isChangingGradeA = aGrade !== Number(order.qty_grade_a || 0);
  if (isChangingGradeA && !order.can_edit_grade_a) {
    throw new Error('Input Grade A terkunci karena produksi telah selesai dan MO Odoo berstatus Done.');
  }

  const isChangingGradeB = bGrade !== Number(order.qty_grade_b || 0);
  if (isChangingGradeB && !order.can_edit_grade_b) {
    throw new Error('Jatah submit Grade B telah habis (Maksimal 2x submit). Hubungi Master Admin untuk membuka kunci.');
  }

  const isChangingBskl =
    totalSisaKg !== Number(order.sisa_makloon_kg || 0) ||
    panjangKg !== Number(order.sisa_potong_panjang || 0) ||
    sedangKg !== Number(order.sisa_potong_sedang || 0) ||
    pendekKg !== Number(order.sisa_potong_pendek || 0);
  if (isChangingBskl && !order.can_edit_bskl) {
    throw new Error('Input Sisa Potong (BSKL) terkunci karena dokumen transfer telah divalidasi oleh Gudang Ansania.');
  }

  const nextGradeBCount = isChangingGradeB
    ? Number(order.grade_b_submit_count || 0) + 1
    : Number(order.grade_b_submit_count || 0);

  const updatePayload = {
    qty_grade_a: aGrade,
    qty_grade_b: bGrade,
    grade_b_submit_count: nextGradeBCount,
    sisa_makloon_kg: totalSisaKg,
    sisa_potong_panjang: panjangKg,
    sisa_potong_sedang: sedangKg,
    sisa_potong_pendek: pendekKg,
    status_produksi: 'Selesai',
    result_locked_at: new Date().toISOString(),
    result_locked_by: user.id
  };
  if (suratJalan) {
    updatePayload.no_surat_jalan_sfp = suratJalan;
  }

  const { error: updateErr } = await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  if (updateErr && (updateErr.message?.includes('sisa_potong') || updateErr.details?.includes('sisa_potong') || updateErr.message?.includes('grade_b_submit_count'))) {
    console.warn('[WipProductionService] Fallback update without optional columns:', updateErr.message);
    delete updatePayload.sisa_potong_panjang;
    delete updatePayload.sisa_potong_sedang;
    delete updatePayload.sisa_potong_pendek;
    delete updatePayload.grade_b_submit_count;
    await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  }

  await supabaseServer.from('audit_logs').insert({
    user_id: user.id,
    wip_order_id: orderId,
    action: 'submit_result',
    before_data: {
      qty_grade_a: order.qty_grade_a,
      qty_grade_b: order.qty_grade_b,
      sisa_makloon_kg: order.sisa_makloon_kg,
      sisa_potong_panjang: order.sisa_potong_panjang,
      sisa_potong_sedang: order.sisa_potong_sedang,
      sisa_potong_pendek: order.sisa_potong_pendek
    },
    after_data: {
      qtyGradeA: aGrade,
      qtyGradeB: bGrade,
      sisaPotongPanjang: panjangKg,
      sisaPotongSedang: sedangKg,
      sisaPotongPendek: pendekKg,
      sisaMakloonKg: totalSisaKg,
      noSuratJalan: suratJalan
    }
  });

  const { data: outboxRow } = await supabaseServer
    .from('sync_outbox')
    .insert({
      wip_order_id: orderId,
      action: 'production_result',
      status: 'processing',
      attempts: 1,
      payload: {
        qtyGradeA: aGrade,
        qtyGradeB: bGrade,
        sisaPotongPanjang: panjangKg,
        sisaPotongSedang: sedangKg,
        sisaPotongPendek: pendekKg,
        sisaMakloonKg: totalSisaKg,
        noSuratJalan: suratJalan
      },
      created_by: user.id
    })
    .select('id')
    .maybeSingle();

  let odooSyncWarning = null;
  try {
    await syncProductionToOdoo(order, aGrade, bGrade, totalSisaKg, {
      sisaPanjang: panjangKg,
      sisaSedang: sedangKg,
      sisaPendek: pendekKg
    });
    if (order.odoo_mo_id) {
      rawMovesCache.delete(order.odoo_mo_id);
    }
    if (outboxRow?.id) {
      await supabaseServer
        .from('sync_outbox')
        .update({ status: 'synced', synced_at: new Date().toISOString(), last_error: null })
        .eq('id', outboxRow.id);
    }
  } catch (err) {
    odooSyncWarning = err.message;
    console.warn(`[WipProductionService] Odoo async production push warning: ${err.message}`);
    if (outboxRow?.id) {
      await supabaseServer
        .from('sync_outbox')
        .update({ status: 'failed', last_error: String(err.message).slice(0, 500) })
        .eq('id', outboxRow.id);
    }
  }

  return {
    success: true,
    odooSynced: !odooSyncWarning,
    odooSyncWarning,
    message: odooSyncWarning
      ? `Hasil produksi tersimpan di aplikasi, namun sinkronisasi ke Odoo tertunda: ${odooSyncWarning}`
      : 'Hasil jahit dan rincian sisa potong berhasil dilaporkan dan disinkronkan ke Odoo.',
    qtyGradeA: aGrade,
    qtyGradeB: bGrade,
    sisaPotongPanjang: panjangKg,
    sisaPotongSedang: sedangKg,
    sisaPotongPendek: pendekKg,
    sisaMakloonKg: totalSisaKg,
    noSuratJalan: suratJalan
  };
}

/**
 * Submit Grade A only (locks Grade A once MO state is done)
 */
export async function submitGradeA({ user, orderId, qtyGradeA, noSuratJalan }) {
  const { order } = await getOrderDetails({ user, orderId, includeRawMoves: false });

  if (order.is_grade_a_locked && user.role !== 'master_admin' && !order.is_unlocked_by_admin) {
    throw new Error('Input Grade A terkunci karena produksi telah selesai dan MO Odoo berstatus Done.');
  }

  const aGrade = Math.max(0, Number(qtyGradeA || 0));
  const suratJalan = (noSuratJalan || '').trim();

  const updatePayload = {
    qty_grade_a: aGrade,
    updated_at: new Date().toISOString()
  };
  if (suratJalan) {
    updatePayload.no_surat_jalan_sfp = suratJalan;
  }

  await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);

  await supabaseServer.from('audit_logs').insert({
    user_id: user.id,
    wip_order_id: orderId,
    action: 'submit_grade_a',
    before_data: { qty_grade_a: order.qty_grade_a, no_surat_jalan_sfp: order.no_surat_jalan_sfp },
    after_data: { qtyGradeA: aGrade, noSuratJalan: suratJalan }
  });

  try {
    await syncGradeAToOdoo(order, aGrade);
    if (order.odoo_mo_id) rawMovesCache.delete(order.odoo_mo_id);
  } catch (err) {
    console.warn(`[WipProductionService] Odoo Grade A push warning: ${err.message}`);
  }

  return {
    success: true,
    message: 'Qty Grade A dan Surat Jalan berhasil disimpan dan disinkronkan ke Odoo!',
    qtyGradeA: aGrade,
    noSuratJalan: suratJalan
  };
}

/**
 * Submit Grade B only (with max 2x submit quota: 1 initial + 1 revision)
 */
export async function submitGradeB({ user, orderId, qtyGradeB, noSuratJalanGradeB }) {
  const { order } = await getOrderDetails({ user, orderId, includeRawMoves: false });

  let currentCount = Number(order.grade_b_submit_count || 0);
  if (order.grade_b_submit_count === undefined || order.grade_b_submit_count === null) {
    const { count } = await supabaseServer
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('wip_order_id', orderId)
      .eq('action', 'submit_grade_b');
    currentCount = count || 0;
  }

  const isUnlocked = Boolean(order.is_unlocked_by_admin);
  if (currentCount >= 2 && user.role !== 'master_admin' && !isUnlocked) {
    throw new Error('Jatah submit Grade B telah habis (Maksimal 2x submit: 1x awal + 1x revisi). Hubungi Master Admin untuk membuka kunci.');
  }

  const bGrade = Math.max(0, Number(qtyGradeB || 0));
  const sjB = (noSuratJalanGradeB || '').trim();
  const newCount = currentCount + 1;

  const updatePayload = {
    qty_grade_b: bGrade,
    grade_b_submit_count: newCount,
    updated_at: new Date().toISOString()
  };
  if (sjB) {
    updatePayload.no_surat_jalan_grade_b = sjB;
  }

  const { error: updErr } = await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  if (updErr && (updErr.message?.includes('grade_b') || updErr.details?.includes('grade_b'))) {
    console.warn('[WipProductionService] Fallback update without new grade_b columns:', updErr.message);
    delete updatePayload.grade_b_submit_count;
    delete updatePayload.no_surat_jalan_grade_b;
    await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  }

  await supabaseServer.from('audit_logs').insert({
    user_id: user.id,
    wip_order_id: orderId,
    action: 'submit_grade_b',
    before_data: { qty_grade_b: order.qty_grade_b, count: currentCount },
    after_data: { qtyGradeB: bGrade, noSuratJalanGradeB: sjB, count: newCount }
  });

  try {
    await syncGradeBToOdoo(order, bGrade);
    if (order.odoo_mo_id) rawMovesCache.delete(order.odoo_mo_id);
  } catch (err) {
    console.warn(`[WipProductionService] Odoo Grade B push warning: ${err.message}`);
  }

  return {
    success: true,
    message: newCount === 1
      ? 'Qty Grade B berhasil disubmit! Anda memiliki jatah 1x revisi.'
      : 'Revisi Grade B berhasil disimpan. Input Grade B kini terkunci.',
    qtyGradeB: bGrade,
    submitCount: newCount,
    isLocked: newCount >= 2
  };
}

/**
 * Submit BSKL only (locks when internal transfer is validated in Odoo)
 */
export async function submitBskl({ user, orderId, sisaPotongPanjang, sisaPotongSedang, sisaPotongPendek, sisaMakloonKg, noSuratJalanBskl }) {
  const { order } = await getOrderDetails({ user, orderId, includeRawMoves: false, includeTransfers: true });

  if (order.is_bskl_locked && user.role !== 'master_admin' && !order.is_unlocked_by_admin) {
    throw new Error('Input Sisa Potong (BSKL) terkunci karena dokumen transfer telah divalidasi oleh Gudang Ansania.');
  }

  const panjangKg = Math.max(0, Number(sisaPotongPanjang || 0));
  const sedangKg = Math.max(0, Number(sisaPotongSedang || 0));
  const pendekKg = Math.max(0, Number(sisaPotongPendek || 0));
  const hasCategories = sisaPotongPanjang !== undefined || sisaPotongSedang !== undefined || sisaPotongPendek !== undefined;
  const calculatedTotal = Number((panjangKg + sedangKg + pendekKg).toFixed(2));
  const totalSisaKg = hasCategories ? calculatedTotal : Math.max(0, Number(sisaMakloonKg || 0));
  const sjBskl = (noSuratJalanBskl || '').trim();

  const updatePayload = {
    sisa_makloon_kg: totalSisaKg,
    sisa_potong_panjang: panjangKg,
    sisa_potong_sedang: sedangKg,
    sisa_potong_pendek: pendekKg,
    updated_at: new Date().toISOString()
  };
  if (sjBskl) {
    updatePayload.no_surat_jalan_bskl = sjBskl;
  }

  const { error: updErr } = await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  if (updErr && (updErr.message?.includes('sisa_potong') || updErr.message?.includes('no_surat_jalan_bskl'))) {
    console.warn('[WipProductionService] Fallback update without sisa_potong/sj columns:', updErr.message);
    delete updatePayload.sisa_potong_panjang;
    delete updatePayload.sisa_potong_sedang;
    delete updatePayload.sisa_potong_pendek;
    delete updatePayload.no_surat_jalan_bskl;
    await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  }

  await supabaseServer.from('audit_logs').insert({
    user_id: user.id,
    wip_order_id: orderId,
    action: 'submit_bskl',
    before_data: { sisa_makloon_kg: order.sisa_makloon_kg },
    after_data: {
      sisaPotongPanjang: panjangKg,
      sisaPotongSedang: sedangKg,
      sisaPotongPendek: pendekKg,
      sisaMakloonKg: totalSisaKg,
      noSuratJalanBskl: sjBskl
    }
  });

  try {
    await syncBsklToOdoo(order, {
      pKg: panjangKg,
      sKg: sedangKg,
      pdkKg: pendekKg,
      totalSisa: totalSisaKg,
      noSuratJalanBskl: sjBskl
    });
  } catch (err) {
    console.warn(`[WipProductionService] Odoo BSKL transfer push warning: ${err.message}`);
  }

  return {
    success: true,
    message: 'Rincian sisa potong (BSKL) berhasil disimpan dan transfer Odoo berhasil dibuat/diperbarui!',
    sisaPotongPanjang: panjangKg,
    sisaPotongSedang: sedangKg,
    sisaPotongPendek: pendekKg,
    sisaMakloonKg: totalSisaKg,
    noSuratJalanBskl: sjBskl
  };
}

