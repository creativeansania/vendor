import { useState, useMemo } from 'react';
import { fetchApi } from '@/lib/api';

export function useProductionState({
  orderId,
  targetSpkQty,
  setSafetyModal,
  setFeedback,
  setSaving,
  loadData
}) {
  const [gradeA, setGradeA] = useState('');
  const [gradeB, setGradeB] = useState('');
  const [noSuratJalanGradeA, setNoSuratJalanGradeA] = useState('');
  const [noSuratJalanGradeB, setNoSuratJalanGradeB] = useState('');
  const [sisaPanjang, setSisaPanjang] = useState('');
  const [sisaSedang, setSisaSedang] = useState('');
  const [sisaPendek, setSisaPendek] = useState('');
  const [noSuratJalanBskl, setNoSuratJalanBskl] = useState('');

  const totalYieldPcs = useMemo(() => {
    return (parseFloat(gradeA) || 0) + (parseFloat(gradeB) || 0);
  }, [gradeA, gradeB]);

  const totalSisaKg = useMemo(() => {
    const p = parseFloat(sisaPanjang) || 0;
    const s = parseFloat(sisaSedang) || 0;
    const pdk = parseFloat(sisaPendek) || 0;
    const sum = p + s + pdk;
    return sum > 0 ? Number(sum.toFixed(2)) : 0;
  }, [sisaPanjang, sisaSedang, sisaPendek]);

  const setPresetGradeA = (qty) => {
    setGradeA(String(qty));
  };

  // --- 1. SUBMIT GRADE A ONLY ---
  const executeSubmitGradeA = async () => {
    setSaving(true);
    setSafetyModal((prev) => ({ ...prev, open: false }));
    setFeedback({ text: '', type: '' });

    try {
      const aVal = parseFloat(gradeA) || 0;
      const sjVal = noSuratJalanGradeA.trim();

      const res = await fetchApi(`/pwa/orders/${orderId}/grade-a`, {
        method: 'POST',
        body: JSON.stringify({
          qtyGradeA: aVal,
          noSuratJalan: sjVal
        })
      });

      if (res.success) {
        setFeedback({ text: res.message || 'Qty Grade A dan Surat Jalan berhasil dikirim ke Odoo!', type: 'success' });
        loadData();
      } else {
        setFeedback({ text: res.message || 'Gagal menyimpan Grade A.', type: 'error' });
      }
    } catch (err) {
      setFeedback({ text: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleRequestSubmitGradeA = () => {
    const valA = parseFloat(gradeA) || 0;
    if (valA <= 0) {
      setFeedback({ text: 'Harap isi jumlah Grade A (lebih dari 0).', type: 'error' });
      return;
    }

    setSafetyModal({
      open: true,
      stage: 'production',
      title: 'Konfirmasi Pengiriman Grade A',
      targetVal: `${targetSpkQty} pcs`,
      actualVal: `${valA} pcs (Surat Jalan: ${noSuratJalanGradeA.trim() || 'Tanpa SJ'})`,
      diffVal: `${valA - targetSpkQty > 0 ? '+' : ''}${valA - targetSpkQty} pcs`,
      warningMessage: 'Data Grade A akan disinkronkan langsung ke MO Induk di Odoo. Setelah MO berstatus Done, input Grade A akan terkunci.',
      onConfirm: executeSubmitGradeA
    });
  };

  // --- 2. SUBMIT / REVISI GRADE B ONLY ---
  const executeSubmitGradeB = async () => {
    setSaving(true);
    setSafetyModal((prev) => ({ ...prev, open: false }));
    setFeedback({ text: '', type: '' });

    try {
      const bVal = parseFloat(gradeB) || 0;
      const sjVal = noSuratJalanGradeB.trim();

      const res = await fetchApi(`/pwa/orders/${orderId}/grade-b`, {
        method: 'POST',
        body: JSON.stringify({
          qtyGradeB: bVal,
          noSuratJalanGradeB: sjVal
        })
      });

      if (res.success) {
        setFeedback({ text: res.message || 'Qty Grade B berhasil disubmit ke Odoo!', type: 'success' });
        loadData();
      } else {
        setFeedback({ text: res.message || 'Gagal menyimpan Grade B.', type: 'error' });
      }
    } catch (err) {
      setFeedback({ text: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleRequestSubmitGradeB = (currentCount = 0) => {
    const valB = parseFloat(gradeB) || 0;

    const isRevision = currentCount > 0;
    setSafetyModal({
      open: true,
      stage: 'production',
      title: isRevision ? 'Konfirmasi Revisi Grade B (Sisa 1x Revisi)' : 'Konfirmasi Submit Awal Grade B',
      targetVal: 'Reject / BS',
      actualVal: `${valB} pcs (Surat Jalan: ${noSuratJalanGradeB.trim() || 'Tanpa SJ'})`,
      warningMessage: isRevision
        ? 'Perhatian: Ini adalah jatah revisi terakhir (ke-2). Setelah ini, input Grade B akan terkunci rapat.'
        : 'Jumlah Grade B akan membuat/memperbarui MO Turunan Grade B di Odoo. Anda memiliki jatah 1x revisi lagi setelah ini.',
      onConfirm: executeSubmitGradeB
    });
  };

  // --- 3. SUBMIT SISA POTONG (BSKL) ONLY ---
  const executeSubmitBskl = async () => {
    setSaving(true);
    setSafetyModal((prev) => ({ ...prev, open: false }));
    setFeedback({ text: '', type: '' });

    try {
      const pVal = parseFloat(sisaPanjang) || 0;
      const sVal = parseFloat(sisaSedang) || 0;
      const pdkVal = parseFloat(sisaPendek) || 0;
      const sumSisa = Number((pVal + sVal + pdkVal).toFixed(2));
      const sjBskl = noSuratJalanBskl.trim();

      const res = await fetchApi(`/pwa/orders/${orderId}/bskl`, {
        method: 'POST',
        body: JSON.stringify({
          sisaPotongPanjang: pVal,
          sisaPotongSedang: sVal,
          sisaPotongPendek: pdkVal,
          sisaMakloonKg: sumSisa,
          noSuratJalanBskl: sjBskl
        })
      });

      if (res.success) {
        setFeedback({ text: res.message || 'Rincian Sisa Potong (BSKL) berhasil disimpan dan transfer Odoo dibuat!', type: 'success' });
        loadData();
      } else {
        setFeedback({ text: res.message || 'Gagal menyimpan BSKL.', type: 'error' });
      }
    } catch (err) {
      setFeedback({ text: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleRequestSubmitBskl = () => {
    const pVal = parseFloat(sisaPanjang) || 0;
    const sVal = parseFloat(sisaSedang) || 0;
    const pdkVal = parseFloat(sisaPendek) || 0;
    const sumSisa = Number((pVal + sVal + pdkVal).toFixed(2));

    setSafetyModal({
      open: true,
      stage: 'production',
      title: 'Konfirmasi Simpan & Kirim Sisa Potong (BSKL)',
      targetVal: 'Sisa Potong Kain',
      actualVal: `Total: ${sumSisa} kg (Panjang: ${pVal}kg, Sedang: ${sVal}kg, Pendek: ${pdkVal}kg) | SJ: ${noSuratJalanBskl.trim() || 'Otomatis'}`,
      warningMessage: 'Dokumen Internal Transfer ke WHGB akan dibuat/diperbarui di Odoo dengan nomor delivery slip pabrik. Data akan terkunci setelah gudang Ansania memvalidasi transfer.',
      onConfirm: executeSubmitBskl
    });
  };

  // --- 4. MASTER ADMIN UNLOCK / RELOCK ---
  const handleAdminToggleUnlock = async (isCurrentlyUnlocked) => {
    setSaving(true);
    setFeedback({ text: '', type: '' });

    try {
      const res = await fetchApi(`/pwa/orders/${orderId}/unlock`, {
        method: 'POST',
        body: JSON.stringify({
          action: isCurrentlyUnlocked ? 'relock' : 'unlock',
          reason: isCurrentlyUnlocked ? 'Dikunci kembali oleh Master Admin' : 'Dibuka manual oleh Master Admin'
        })
      });

      if (res.success) {
        setFeedback({ text: res.message, type: 'success' });
        loadData();
      } else {
        setFeedback({ text: res.message || 'Gagal mengubah status kunci.', type: 'error' });
      }
    } catch (err) {
      setFeedback({ text: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // Legacy full submit handler
  const executeSubmitProduction = async () => {
    setSaving(true);
    setSafetyModal((prev) => ({ ...prev, open: false }));
    setFeedback({ text: '', type: '' });

    try {
      const aVal = parseFloat(gradeA) || 0;
      const bVal = parseFloat(gradeB) || 0;
      const pVal = parseFloat(sisaPanjang) || 0;
      const sVal = parseFloat(sisaSedang) || 0;
      const pdkVal = parseFloat(sisaPendek) || 0;
      const sumSisa = Number((pVal + sVal + pdkVal).toFixed(2));
      const sjVal = noSuratJalanGradeA.trim();

      const res = await fetchApi(`/pwa/orders/${orderId}/production-result`, {
        method: 'POST',
        body: JSON.stringify({
          qtyGradeA: aVal,
          qtyGradeB: bVal,
          sisaPotongPanjang: pVal,
          sisaPotongSedang: sVal,
          sisaPotongPendek: pdkVal,
          sisaMakloonKg: sumSisa,
          noSuratJalan: sjVal
        })
      });

      if (res.success) {
        setFeedback({ text: 'Data hasil jahit dan sisa potong berhasil disimpan ke Odoo!', type: 'success' });
        loadData();
      } else {
        setFeedback({ text: res.message || 'Gagal menyimpan.', type: 'error' });
      }
    } catch (err) {
      setFeedback({ text: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleRequestSubmitProduction = () => {
    if (!gradeA && !gradeB) {
      setFeedback({ text: 'Harap isi minimal jumlah Grade A atau Grade B.', type: 'error' });
      return;
    }
    executeSubmitProduction();
  };

  return {
    gradeA,
    setGradeA,
    gradeB,
    setGradeB,
    noSuratJalanGradeA,
    setNoSuratJalanGradeA,
    noSuratJalanGradeB,
    setNoSuratJalanGradeB,
    sisaPanjang,
    setSisaPanjang,
    sisaSedang,
    setSisaSedang,
    sisaPendek,
    setSisaPendek,
    noSuratJalanBskl,
    setNoSuratJalanBskl,
    totalSisaKg,
    sisaKg: totalSisaKg,
    setSisaKg: setSisaPanjang,
    noSuratJalan: noSuratJalanGradeA,
    setNoSuratJalan: setNoSuratJalanGradeA,
    totalYieldPcs,
    setPresetGradeA,
    handleRequestSubmitGradeA,
    handleRequestSubmitGradeB,
    handleRequestSubmitBskl,
    handleAdminToggleUnlock,
    handleRequestSubmitProduction,
    executeSubmitProduction
  };
}

