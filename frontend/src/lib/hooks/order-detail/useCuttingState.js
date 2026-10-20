import { useState, useMemo } from 'react';
import { fetchApi } from '@/lib/api';

export function useCuttingState({
  orderId,
  order,
  rollLines,
  targetSpkQty,
  setSafetyModal,
  setFeedback,
  setSaving,
  loadData
}) {
  const [actualCutting, setActualCutting] = useState('');
  const [rollWeights, setRollWeights] = useState({});
  const [penerimaanQtys, setPenerimaanQtys] = useState({});

  // Roll weight & Penerimaan changes
  const handleWeightChange = (lineId, value) => {
    setRollWeights((prev) => ({ ...prev, [lineId]: value }));
  };

  const handlePenerimaanChange = (lineId, value) => {
    setPenerimaanQtys((prev) => ({ ...prev, [lineId]: value }));
  };

  // Material lines segmentation: Kain (Fabric) vs Aksesoris/Pelengkap
  const fabricLines = useMemo(() => {
    return rollLines.filter((l) => {
      const name = (l.nama_item || '').toLowerCase();
      const uom = (l.uom || '').toLowerCase();

      // Explicit accessories & packaging items
      const isAcc =
        l.line_type === 'aksesoris' ||
        name.includes('acc') ||
        name.includes('acces') ||
        name.includes('aksesoris') ||
        name.includes('hangtag') ||
        name.includes('hang tag') ||
        name.includes('pouch') ||
        name.includes('barcode') ||
        name.includes('kertas') ||
        name.includes('kancing') ||
        name.includes('benang') ||
        name.includes('zipper') ||
        name.includes('resleting') ||
        name.includes('sleting') ||
        name.includes('label') ||
        name.includes('plastik') ||
        name.includes('polybag') ||
        name.includes('opp') ||
        name.includes('pita') ||
        name.includes('renda') ||
        name.includes('kardus') ||
        name.includes('box') ||
        name.includes('tag pin') ||
        name.includes('tali') ||
        name.includes('stiker') ||
        name.includes('sticker') ||
        (!name.includes('kain') && ['pcs', 'lembar', 'buah', 'biji', 'pack', 'roll'].includes(uom));

      if (isAcc) return false;
      return l.line_type === 'kain' || name.includes('kain');
    });
  }, [rollLines]);

  const accessoryLines = useMemo(() => {
    return rollLines.filter((l) => !fabricLines.includes(l));
  }, [rollLines, fabricLines]);

  const totalPhysicalFabric = useMemo(() => {
    return fabricLines.reduce((sum, l) => {
      const val = rollWeights[l.id] !== undefined ? rollWeights[l.id] : (l.qty_berat_kg || 0);
      return sum + (parseFloat(val) || 0);
    }, 0);
  }, [fabricLines, rollWeights]);

  const currentActualCutting = useMemo(() => {
    if (actualCutting !== '' && actualCutting !== null && actualCutting !== undefined) {
      return parseFloat(actualCutting) || 0;
    }
    if (order?.actual_cutting !== null && order?.actual_cutting !== undefined && order.actual_cutting > 0) {
      return parseFloat(order.actual_cutting);
    }
    if (totalPhysicalFabric > 0) {
      return totalPhysicalFabric;
    }
    return 0;
  }, [actualCutting, order, totalPhysicalFabric]);

  const selisihCutting = useMemo(() => {
    return currentActualCutting - targetSpkQty;
  }, [currentActualCutting, targetSpkQty]);

  // Quick fill handlers
  const handleFillCuttingFromPenerimaan = (lineId) => {
    const pVal = penerimaanQtys[lineId] !== undefined ? penerimaanQtys[lineId] : '';
    if (pVal !== '') {
      setRollWeights((prev) => ({ ...prev, [lineId]: pVal }));
    }
  };

  const handleFillAllFabricFromPenerimaan = () => {
    setRollWeights((prev) => {
      const updated = { ...prev };
      fabricLines.forEach((line) => {
        const pVal =
          penerimaanQtys[line.id] !== undefined
            ? penerimaanQtys[line.id]
            : (line.qty_penerimaan || line.qty || 0);
        if (pVal !== undefined && pVal !== null && pVal !== '') {
          updated[line.id] = pVal;
        }
      });
      return updated;
    });
  };

  const handleFillAllAccessories = () => {
    setRollWeights((prev) => {
      const updated = { ...prev };
      accessoryLines.forEach((line) => {
        const pVal =
          penerimaanQtys[line.id] !== undefined
            ? penerimaanQtys[line.id]
            : (line.qty_penerimaan || line.qty || 0);
        if (pVal !== undefined && pVal !== null && pVal !== '') {
          updated[line.id] = pVal;
        }
      });
      return updated;
    });
  };

  const handleFillCuttingWithTargetSpk = () => {
    if (targetSpkQty > 0) {
      setActualCutting(String(targetSpkQty));
    }
  };

  // Submit Cutting
  const executeSubmitCutting = async (inputActual, rolls) => {
    setSaving(true);
    setSafetyModal((prev) => ({ ...prev, open: false }));
    setFeedback({ text: '', type: '' });

    try {
      const res = await fetchApi(`/pwa/orders/${orderId}/cutting-rolls`, {
        method: 'POST',
        body: JSON.stringify({
          actual_cutting: inputActual,
          rollUpdates: rolls
        })
      });

      if (res.success) {
        setFeedback({ text: 'Hasil potong berhasil disimpan dan disinkronkan ke Odoo!', type: 'success' });
        loadData();
      } else {
        setFeedback({ text: res.message || 'Gagal menyimpan hasil potong.', type: 'error' });
      }
    } catch (err) {
      setFeedback({ text: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleRequestSubmitCutting = () => {
    const inputActual = actualCutting !== '' ? parseFloat(actualCutting) : null;
    const allRollLineIds = new Set([
      ...Object.keys(rollWeights),
      ...Object.keys(penerimaanQtys),
      ...rollLines.map((r) => String(r.id))
    ]);

    const rolls = Array.from(allRollLineIds).map((lineIdStr) => {
      const lineId = Number(lineIdStr);
      const match = rollLines.find((r) => r.id === lineId);
      const defaultP = match
        ? match.qty_penerimaan !== undefined && match.qty_penerimaan !== null
          ? match.qty_penerimaan
          : match.qty
        : 0;
      return {
        id: lineId,
        lineId,
        line_id: lineId,
        qty_berat_kg:
          rollWeights[lineId] !== undefined && rollWeights[lineId] !== ''
            ? parseFloat(rollWeights[lineId])
            : 0,
        qty_penerimaan:
          penerimaanQtys[lineId] !== undefined && penerimaanQtys[lineId] !== ''
            ? parseFloat(penerimaanQtys[lineId])
            : defaultP
      };
    });

    if (inputActual === null && rolls.length === 0) {
      setFeedback({ text: 'Harap isi hasil potong atau rincian bahan kain terlebih dahulu.', type: 'error' });
      return;
    }

    const effectiveActual = inputActual !== null ? inputActual : totalPhysicalFabric;
    const targetRef = targetSpkQty > 0 ? targetSpkQty : 0;
    let isExtreme = false;
    let devPct = 0;

    if (targetRef > 0) {
      devPct = (Math.abs(effectiveActual - targetRef) / targetRef) * 100;
      isExtreme = devPct > 20 || (effectiveActual === 0 && targetRef > 0) || effectiveActual > targetRef * 1.5;
    }

    setSafetyModal({
      open: true,
      stage: 'cutting',
      isExtreme,
      deviationPct: devPct,
      title: isExtreme ? 'Perhatian: Cek Jumlah Hasil Potong' : 'Konfirmasi Simpan Hasil Potong',
      targetVal: targetRef > 0 ? `${targetRef.toLocaleString('id-ID')} pcs` : '-',
      actualVal: `${effectiveActual.toLocaleString('id-ID')} pcs`,
      diffVal:
        targetRef > 0
          ? `${effectiveActual - targetRef > 0 ? '+' : ''}${(effectiveActual - targetRef).toLocaleString('id-ID')} pcs`
          : '0',
      warningMessage: isExtreme
        ? `Jumlah hasil potong (${effectiveActual.toLocaleString('id-ID')} pcs) selisih ${devPct.toFixed(0)}% dari target SPK (${targetRef.toLocaleString('id-ID')} pcs). Cek lagi apakah ada salah ketik sebelum disimpan.`
        : 'Data hasil potong akan disimpan dan disinkronkan langsung ke Odoo.',
      onConfirm: () => executeSubmitCutting(effectiveActual, rolls)
    });
  };

  return {
    actualCutting,
    setActualCutting,
    rollWeights,
    setRollWeights,
    penerimaanQtys,
    setPenerimaanQtys,
    handleWeightChange,
    handlePenerimaanChange,
    fabricLines,
    accessoryLines,
    totalPhysicalFabric,
    currentActualCutting,
    selisihCutting,
    handleFillCuttingFromPenerimaan,
    handleFillAllFabricFromPenerimaan,
    handleFillAllAccessories,
    handleFillCuttingWithTargetSpk,
    handleRequestSubmitCutting,
    executeSubmitCutting
  };
}
