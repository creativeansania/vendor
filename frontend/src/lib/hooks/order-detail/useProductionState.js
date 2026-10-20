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
  const [sisaPanjang, setSisaPanjang] = useState('');
  const [sisaSedang, setSisaSedang] = useState('');
  const [sisaPendek, setSisaPendek] = useState('');
  const [noSuratJalan, setNoSuratJalan] = useState('');

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
    if (!gradeB) setGradeB('0');
  };

  // Submit Production Result
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
      const sjVal = noSuratJalan.trim();

      const res = await fetchApi(`/pwa/orders/${orderId}/production-result`, {
        method: 'POST',
        body: JSON.stringify({
          qty_grade_a: aVal,
          qtyGradeA: aVal,
          qty_grade_b: bVal,
          qtyGradeB: bVal,
          sisa_potong_panjang: pVal,
          sisaPotongPanjang: pVal,
          sisa_potong_sedang: sVal,
          sisaPotongSedang: sVal,
          sisa_potong_pendek: pdkVal,
          sisaPotongPendek: pdkVal,
          sisa_makloon_kg: sumSisa,
          sisaMakloonKg: sumSisa,
          no_surat_jalan: sjVal,
          noSuratJalan: sjVal,
          no_surat_jalan_sfp: sjVal
        })
      });

      if (res.success) {
        setFeedback({ text: 'Hasil jahit dan rincian sisa potong berhasil dikunci dan disinkronkan ke Odoo!', type: 'success' });
        loadData();
      } else {
        setFeedback({ text: res.message || 'Gagal menyimpan hasil jahit.', type: 'error' });
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

    const valA = parseFloat(gradeA) || 0;
    const valB = parseFloat(gradeB) || 0;
    const totalYield = valA + valB;
    const targetRef = targetSpkQty;
    let isExtreme = false;
    let devPct = 0;

    if (targetRef > 0) {
      devPct = (Math.abs(totalYield - targetRef) / targetRef) * 100;
      isExtreme = devPct > 20 || (valB > valA && valB > 0);
    }

    const pKg = parseFloat(sisaPanjang) || 0;
    const sKg = parseFloat(sisaSedang) || 0;
    const pdkKg = parseFloat(sisaPendek) || 0;

    setSafetyModal({
      open: true,
      stage: 'production',
      isExtreme,
      deviationPct: devPct,
      title: isExtreme ? 'Perhatian: Cek Jumlah Hasil Jahit' : 'Konfirmasi Simpan Hasil Jahit & Sisa Kain',
      targetVal: `${targetRef.toLocaleString('id-ID')} pcs`,
      actualVal: `${totalYield.toLocaleString('id-ID')} pcs (Grade A: ${valA}, Grade B: ${valB}) | Sisa: ${totalSisaKg} kg (P: ${pKg}, S: ${sKg}, Pdk: ${pdkKg})`,
      diffVal: `${totalYield - targetRef > 0 ? '+' : ''}${(totalYield - targetRef).toFixed(0)} pcs`,
      warningMessage: isExtreme
        ? valB > valA
          ? `Perhatian: Jumlah Grade B / Reject (${valB} pcs) lebih banyak dari Grade A (${valA} pcs). Cek apakah angkanya tertukar sebelum disimpan.`
          : `Total hasil jahit (${totalYield} pcs) selisih ${devPct.toFixed(0)}% dari target SPK (${targetRef} pcs). Cek lagi apakah ada salah ketik sebelum data dikirim ke Odoo.`
        : 'Pastikan jumlah fisik baju dan sisa potongan (BSKL) sudah sesuai dengan surat jalan. Data akan disimpan dan transfer BSKL dibuatkan langsung di Odoo.',
      onConfirm: executeSubmitProduction
    });
  };

  return {
    gradeA,
    setGradeA,
    gradeB,
    setGradeB,
    sisaPanjang,
    setSisaPanjang,
    sisaSedang,
    setSisaSedang,
    sisaPendek,
    setSisaPendek,
    totalSisaKg,
    sisaKg: totalSisaKg,
    setSisaKg: setSisaPanjang,
    noSuratJalan,
    setNoSuratJalan,
    totalYieldPcs,
    setPresetGradeA,
    handleRequestSubmitProduction,
    executeSubmitProduction
  };
}
