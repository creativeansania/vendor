import { supabaseServer } from '../../../supabaseServer.js';
import { invalidateOrderCache } from '../wipCache.js';
import { getOrderDetails } from '../wipQueryService.js';
import { syncGradeAToOdoo, syncGradeBToOdoo } from './odooGradeSync.js';
import { syncBsklToOdoo, syncProductionToOdoo } from './odooBsklSync.js';
import { enqueueOutboxTask, scheduleOutboxExecution } from '../outboxService.js';

/**
 * Submit final production results (locks result stage, pushes to Odoo in background via sync_outbox)
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
    delete updatePayload.sisa_potong_panjang;
    delete updatePayload.sisa_potong_sedang;
    delete updatePayload.sisa_potong_pendek;
    delete updatePayload.grade_b_submit_count;
    await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  }

  const outboxPayload = {
    qtyGradeA: aGrade,
    qtyGradeB: bGrade,
    sisaPotongPanjang: panjangKg,
    sisaPotongSedang: sedangKg,
    sisaPotongPendek: pendekKg,
    sisaMakloonKg: totalSisaKg,
    noSuratJalan: suratJalan
  };

  const [, outboxId] = await Promise.all([
    supabaseServer.from('audit_logs').insert({
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
      after_data: outboxPayload
    }),
    enqueueOutboxTask({
      wipOrderId: orderId,
      action: 'production_result',
      payload: outboxPayload,
      createdBy: user.id
    })
  ]);

  invalidateOrderCache(order.odoo_mo_id, order.id);

  scheduleOutboxExecution({
    outboxId,
    order,
    taskFn: () =>
      syncProductionToOdoo(order, aGrade, bGrade, totalSisaKg, {
        sisaPanjang: panjangKg,
        sisaSedang: sedangKg,
        sisaPendek: pendekKg
      })
  });

  return {
    success: true,
    odooSynced: true,
    queuedInBackground: true,
    message: 'Hasil jahit dan rincian sisa potong berhasil disimpan dan sedang disinkronkan ke Odoo.',
    ...outboxPayload
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

  const [, outboxId] = await Promise.all([
    supabaseServer.from('audit_logs').insert({
      user_id: user.id,
      wip_order_id: orderId,
      action: 'submit_grade_a',
      before_data: { qty_grade_a: order.qty_grade_a, no_surat_jalan_sfp: order.no_surat_jalan_sfp },
      after_data: { qtyGradeA: aGrade, noSuratJalan: suratJalan }
    }),
    enqueueOutboxTask({
      wipOrderId: orderId,
      action: 'grade_a',
      payload: { qtyGradeA: aGrade, noSuratJalan: suratJalan },
      createdBy: user.id
    })
  ]);

  invalidateOrderCache(order.odoo_mo_id, order.id);

  scheduleOutboxExecution({
    outboxId,
    order,
    taskFn: () => syncGradeAToOdoo(order, aGrade)
  });

  return {
    success: true,
    queuedInBackground: true,
    message: 'Qty Grade A dan Surat Jalan berhasil disimpan dan sedang disinkronkan ke Odoo!',
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
    delete updatePayload.grade_b_submit_count;
    delete updatePayload.no_surat_jalan_grade_b;
    await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  }

  const [, outboxId] = await Promise.all([
    supabaseServer.from('audit_logs').insert({
      user_id: user.id,
      wip_order_id: orderId,
      action: 'submit_grade_b',
      before_data: { qty_grade_b: order.qty_grade_b, count: currentCount },
      after_data: { qtyGradeB: bGrade, noSuratJalanGradeB: sjB, count: newCount }
    }),
    enqueueOutboxTask({
      wipOrderId: orderId,
      action: 'grade_b',
      payload: { qtyGradeB: bGrade, noSuratJalanGradeB: sjB },
      createdBy: user.id
    })
  ]);

  invalidateOrderCache(order.odoo_mo_id, order.id);

  scheduleOutboxExecution({
    outboxId,
    order,
    taskFn: () => syncGradeBToOdoo(order, bGrade)
  });

  return {
    success: true,
    queuedInBackground: true,
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
export async function submitBskl({
  user,
  orderId,
  sisaPotongPanjang,
  sisaPotongSedang,
  sisaPotongPendek,
  sisaMakloonKg,
  noSuratJalanBskl
}) {
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
    delete updatePayload.sisa_potong_panjang;
    delete updatePayload.sisa_potong_sedang;
    delete updatePayload.sisa_potong_pendek;
    delete updatePayload.no_surat_jalan_bskl;
    await supabaseServer.from('wip_orders').update(updatePayload).eq('id', orderId);
  }

  const outboxPayload = {
    sisaPotongPanjang: panjangKg,
    sisaPotongSedang: sedangKg,
    sisaPotongPendek: pendekKg,
    sisaMakloonKg: totalSisaKg,
    noSuratJalanBskl: sjBskl
  };

  const [, outboxId] = await Promise.all([
    supabaseServer.from('audit_logs').insert({
      user_id: user.id,
      wip_order_id: orderId,
      action: 'submit_bskl',
      before_data: { sisa_makloon_kg: order.sisa_makloon_kg },
      after_data: outboxPayload
    }),
    enqueueOutboxTask({
      wipOrderId: orderId,
      action: 'bskl',
      payload: outboxPayload,
      createdBy: user.id
    })
  ]);

  invalidateOrderCache(order.odoo_mo_id, order.id);

  scheduleOutboxExecution({
    outboxId,
    order,
    taskFn: () =>
      syncBsklToOdoo(order, {
        pKg: panjangKg,
        sKg: sedangKg,
        pdkKg: pendekKg,
        totalSisa: totalSisaKg,
        noSuratJalanBskl: sjBskl
      })
  });

  return {
    success: true,
    queuedInBackground: true,
    message: 'Rincian Sisa Potong (BSKL) berhasil disimpan dan sedang dibuatkan dokumen transfer ke WHGB di Odoo!',
    ...outboxPayload
  };
}
