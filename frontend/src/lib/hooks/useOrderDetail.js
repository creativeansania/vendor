import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi, getCurrentUser } from '@/lib/api';

export function useOrderDetail(orderId) {
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [order, setOrder] = useState(null);
  const [rollLines, setRollLines] = useState([]);
  const [rawMoves, setRawMoves] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [activeTab, setActiveTab] = useState('timbang'); // 'timbang', 'hasil', 'transfer'
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncingOdoo, setSyncingOdoo] = useState(false);
  const [copiedTransferId, setCopiedTransferId] = useState(null);
  const [transferFilter, setTransferFilter] = useState('all');
  const [feedback, setFeedback] = useState({ text: '', type: '' });

  // Cutting stage state: actual cutting output & roll/material weights & penerimaan
  const [actualCutting, setActualCutting] = useState('');
  const [rollWeights, setRollWeights] = useState({});
  const [penerimaanQtys, setPenerimaanQtys] = useState({});

  // Production results form state
  const [gradeA, setGradeA] = useState('');
  const [gradeB, setGradeB] = useState('');
  const [sisaKg, setSisaKg] = useState('');
  const [noSuratJalan, setNoSuratJalan] = useState('');

  // Safety Confirmation & Extreme Deviation Modal State
  const [safetyModal, setSafetyModal] = useState({
    open: false,
    stage: '', // 'cutting' | 'production'
    isExtreme: false,
    deviationPct: 0,
    title: '',
    targetVal: '',
    actualVal: '',
    diffVal: '',
    warningMessage: '',
    onConfirm: null
  });

  // Auth check
  useEffect(() => {
    const u = getCurrentUser();
    if (!u) {
      router.push('/login');
    } else {
      setUser(u);
    }
  }, [router]);

  // Load Order Data
  const loadData = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    setFeedback({ text: '', type: '' });
    try {
      const res = await fetchApi(`/pwa/orders/${orderId}`);
      if (res.success && res.order) {
        setOrder(res.order);
        const fetchedRolls = res.rollLines || res.order?.roll_lines || [];
        setRollLines(fetchedRolls);
        setRawMoves(res.rawMoves || res.order?.raw_moves || []);
        setTransfers(res.transfers || res.order?.transfers || []);

        // Prepopulate cutting actual
        setActualCutting(
          res.order.actual_cutting !== null && res.order.actual_cutting !== undefined
            ? res.order.actual_cutting
            : ''
        );

        // Prepopulate cutting roll weights & penerimaan quantities
        const weights = {};
        const pQtys = {};
        fetchedRolls.forEach((r) => {
          if (r.qty_berat_kg !== null && r.qty_berat_kg !== undefined) {
            weights[r.id] = r.qty_berat_kg;
          }
          if (r.qty_penerimaan !== null && r.qty_penerimaan !== undefined) {
            pQtys[r.id] = r.qty_penerimaan;
          } else if (r.qty !== undefined && r.qty !== null) {
            pQtys[r.id] = r.qty; // Default from Surat Jalan
          }
        });
        setRollWeights(weights);
        setPenerimaanQtys(pQtys);

        // Prepopulate production results
        setGradeA(res.order.qty_grade_a !== null && res.order.qty_grade_a !== undefined ? String(res.order.qty_grade_a) : '');
        setGradeB(res.order.qty_grade_b !== null && res.order.qty_grade_b !== undefined ? String(res.order.qty_grade_b) : '');
        setSisaKg(res.order.sisa_makloon_kg !== null && res.order.sisa_makloon_kg !== undefined ? String(res.order.sisa_makloon_kg) : '');
        setNoSuratJalan(res.order.no_surat_jalan || '');
      }
    } catch (err) {
      setFeedback({ text: 'Gagal memuat SPK: ' + err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (user && orderId) {
      loadData();
    }
  }, [user, orderId, loadData]);

  // Live Force-Sync directly from Odoo ERP
  const handleForceSyncOdoo = async () => {
    if (syncingOdoo) return;
    setSyncingOdoo(true);
    setFeedback({ text: '', type: '' });
    try {
      const res = await fetchApi(`/pwa/orders/${orderId}/sync-odoo`, {
        method: 'POST'
      });
      if (res.success && res.order) {
        setOrder(res.order);
        const fetchedRolls = res.rollLines || res.order?.roll_lines || [];
        setRollLines(fetchedRolls);
        setRawMoves(res.rawMoves || res.order?.raw_moves || []);
        setTransfers(res.transfers || res.order?.transfers || []);

        if (res.order.actual_cutting !== null && res.order.actual_cutting !== undefined) {
          setActualCutting(res.order.actual_cutting);
        }

        const weights = {};
        const pQtys = {};
        fetchedRolls.forEach((r) => {
          if (r.qty_berat_kg !== null && r.qty_berat_kg !== undefined) {
            weights[r.id] = r.qty_berat_kg;
          }
          if (r.qty_penerimaan !== null && r.qty_penerimaan !== undefined) {
            pQtys[r.id] = r.qty_penerimaan;
          } else if (r.qty !== undefined && r.qty !== null) {
            pQtys[r.id] = r.qty;
          }
        });
        setRollWeights(weights);
        setPenerimaanQtys(pQtys);

        setFeedback({
          text: 'Data SPK, BOM material, dan dokumen transfer berhasil disinkronkan langsung dari Odoo!',
          type: 'success'
        });
      } else {
        throw new Error(res.message || 'Gagal menyinkronkan data dari Odoo');
      }
    } catch (err) {
      setFeedback({
        text: 'Gagal sinkronisasi Odoo: ' + err.message,
        type: 'error'
      });
    } finally {
      setSyncingOdoo(false);
    }
  };

  // Copy transfer document number to clipboard
  const handleCopyTransferName = (transferName, transferId) => {
    if (!transferName) return;
    navigator.clipboard?.writeText(transferName);
    setCopiedTransferId(transferId);
    setTimeout(() => {
      setCopiedTransferId(null);
    }, 2000);
  };

  // Share SPK context to WhatsApp Group / Chat
  const handleShareToWa = (customIssue = '') => {
    if (!order) return;
    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
    const spkNo = order.mo_name || `SPK #${order.id}`;
    const product = order.product_name || '-';
    const target = `${Number(order.qty_spk || order.qty_target || 0).toLocaleString('id-ID')} pcs`;
    const kainInfo = `${order.status_kebutuhan_kain || 'Cukup'}${
      order.kain_dari_gudang !== null && order.kain_dari_gudang !== undefined
        ? ` (Terima: ${Number(order.kain_dari_gudang).toLocaleString('id-ID')} ${order.unit_kain || 'kg'} / Butuh: ${Number(order.qty_kebutuhan_kain || 0).toLocaleString('id-ID')} ${order.unit_kain || 'kg'})`
        : ''
    }`;

    let msg = `Halo Tim Kantiss, mau tanya / ada kendala terkait SPK ini:\n\n`;
    msg += `📋 *No SPK*: ${spkNo}\n`;
    msg += `👗 *Produk*: ${product}\n`;
    msg += `🎯 *Target SPK*: ${target}\n`;
    msg += `📦 *Status Kain*: ${kainInfo}\n`;
    msg += `🔗 *Link SPK*: ${currentUrl}\n\n`;

    if (customIssue) {
      msg += `⚠️ *Kendala*: ${customIssue}\n`;
    } else {
      msg += `💬 *Pertanyaan / Kendala*: `;
    }

    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, '_blank');
  };

  const handleAskWaKainKurang = () => {
    handleShareToWa(
      'Total kain yang kami terima di konveksi KURANG dari kebutuhan standar SPK. Mohon arahan apakah kain boleh dipotong atau menunggu kiriman tambahan? Terima kasih.'
    );
  };

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
      const isAcc =
        l.line_type === 'aksesoris' ||
        name.includes('acc') ||
        name.includes('acces') ||
        name.includes('aksesoris') ||
        name.includes('kancing') ||
        name.includes('benang') ||
        name.includes('zipper') ||
        name.includes('label');
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

  const targetSpkQty = useMemo(() => {
    return Number(order?.qty_target || order?.qty_spk || 0);
  }, [order]);

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

  const totalYieldPcs = useMemo(() => {
    return (parseFloat(gradeA) || 0) + (parseFloat(gradeB) || 0);
  }, [gradeA, gradeB]);

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

  const setPresetGradeA = (qty) => {
    setGradeA(String(qty));
    if (!gradeB) setGradeB('0');
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

  // Filtered transfers
  const filteredTransfers = useMemo(() => {
    if (!transfers || transfers.length === 0) return [];
    if (transferFilter === 'all') return transfers;
    if (transferFilter === 'retur') return transfers.filter((t) => t.category === 'retur' || t.category === 'lainnya');
    return transfers.filter((t) => t.category === transferFilter);
  }, [transfers, transferFilter]);

  const transferCounts = useMemo(() => {
    const all = transfers.length;
    const komponen = transfers.filter((t) => t.category === 'komponen').length;
    const produkJadi = transfers.filter((t) => t.category === 'produk_jadi').length;
    const retur = transfers.filter((t) => t.category === 'retur' || t.category === 'lainnya').length;
    return { all, komponen, produkJadi, retur };
  }, [transfers]);

  // Product name & SKU parsing
  const { skuCode, cleanProductName } = useMemo(() => {
    if (!order?.product_name) return { skuCode: null, cleanProductName: 'Item Produksi' };
    const match = order.product_name.match(/^\[(.*?)\]\s*(.*)$/);
    if (match) {
      return { skuCode: match[1], cleanProductName: match[2] };
    }
    return { skuCode: null, cleanProductName: order.product_name };
  }, [order?.product_name]);

  // Permissions & lock states
  const isBackorder = Boolean(order?.is_backorder);
  const isCuttingLocked = Boolean(order?.cutting_locked_at);
  const isResultLocked = Boolean(order?.result_locked_at);
  const isMasterAdmin = user?.role === 'master_admin';
  const canEditCutting = !isCuttingLocked || isMasterAdmin;
  const canEditResult = !isResultLocked || isMasterAdmin;

  return {
    orderId,
    order,
    user,
    loading,
    saving,
    syncingOdoo,
    feedback,
    activeTab,
    setActiveTab,
    copiedTransferId,
    transferFilter,
    setTransferFilter,
    actualCutting,
    setActualCutting,
    rollWeights,
    penerimaanQtys,
    gradeA,
    setGradeA,
    gradeB,
    setGradeB,
    sisaKg,
    setSisaKg,
    noSuratJalan,
    setNoSuratJalan,
    safetyModal,
    setSafetyModal,
    loadData,
    handleForceSyncOdoo,
    handleCopyTransferName,
    handleShareToWa,
    handleAskWaKainKurang,
    handleWeightChange,
    handlePenerimaanChange,
    handleFillCuttingFromPenerimaan,
    handleFillAllFabricFromPenerimaan,
    handleFillAllAccessories,
    handleFillCuttingWithTargetSpk,
    setPresetGradeA,
    handleRequestSubmitCutting,
    executeSubmitCutting,
    handleRequestSubmitProduction,
    executeSubmitProduction,
    fabricLines,
    accessoryLines,
    rollLines,
    rawMoves,
    transfers,
    filteredTransfers,
    transferCounts,
    totalPhysicalFabric,
    targetSpkQty,
    currentActualCutting,
    selisihCutting,
    totalYieldPcs,
    skuCode,
    cleanProductName,
    isBackorder,
    isCuttingLocked,
    isResultLocked,
    isMasterAdmin,
    canEditCutting,
    canEditResult
  };
}
