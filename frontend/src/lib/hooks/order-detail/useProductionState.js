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
  const [sisaKg, setSisaKg] = useState('');
  const [noSuratJalan, setNoSuratJalan] = useState('');

  const totalYieldPcs = useMemo(() => {
    return (parseFloat(gradeA) || 0) + (parseFloat(gradeB) || 0);
  }, [gradeA, gradeB]);

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
      const sisaVal = parseFloat(sisaKg) || 0;
      const sjVal = noSuratJalan.trim();

      const res = await fetchApi(`/pwa/orders/${orderId}/production-result`, {
        method: 'POST',
        body: JSON.stringify({
          qty_grade_a: aVal,
          qtyGradeA: aVal,
          qty_grade_b: bVal,
          qtyGradeB: bVal,
          sisa_makloon_kg: sisaVal,
          sisaMakloonKg: sisaVal,
          no_surat_jalan: sjVal,
          noSuratJalan: sjVal,
          no_surat_jalan_sfp: sjVal
        })
      });

      if (res.success) {
        setFeedback({ text: 'Hasil jahit berhasil dikunci dan disinkronkan ke Odoo!', type: 'success' });
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

    setSafetyModal({
      open: true,
      stage: 'production',
      isExtreme,
      deviationPct: devPct,
      title: isExtreme ? 'Perhatian: Cek Jumlah Hasil Jahit' : 'Konfirmasi Simpan Hasil Jahit',
      targetVal: `${targetRef.toLocaleString('id-ID')} pcs`,
      actualVal: `${totalYield.toLocaleString('id-ID')} pcs (Grade A: ${valA}, Grade B: ${valB})`,
      diffVal: `${totalYield - targetRef > 0 ? '+' : ''}${(totalYield - targetRef).toFixed(0)} pcs`,
      warningMessage: isExtreme
        ? valB > valA
          ? `Perhatian: Jumlah Grade B / Reject (${valB} pcs) lebih banyak dari Grade A (${valA} pcs). Cek apakah angkanya tertukar sebelum disimpan.`
          : `Total hasil jahit (${totalYield} pcs) selisih ${devPct.toFixed(0)}% dari target SPK (${targetRef} pcs). Cek lagi apakah ada salah ketik sebelum data dikirim ke Odoo.`
        : 'Pastikan jumlah fisik sudah sesuai dengan surat jalan. Data akan disimpan dan disinkronkan langsung ke Odoo.',
      onConfirm: executeSubmitProduction
    });
  };

  return {
    gradeA,
    setGradeA,
    gradeB,
    setGradeB,
    sisaKg,
    setSisaKg,
    noSuratJalan,
    setNoSuratJalan,
    totalYieldPcs,
    setPresetGradeA,
    handleRequestSubmitProduction,
    executeSubmitProduction
  };
}
