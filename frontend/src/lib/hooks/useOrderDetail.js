import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi, getCurrentUser } from '@/lib/api';
import { useCuttingState } from './order-detail/useCuttingState';
import { useProductionState } from './order-detail/useProductionState';
import { useTransferState } from './order-detail/useTransferState';

export function useOrderDetail(orderId) {
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [order, setOrder] = useState(null);
  const [rollLines, setRollLines] = useState([]);
  const [rawMoves, setRawMoves] = useState([]);
  const [activeTab, setActiveTab] = useState('timbang'); // 'timbang', 'hasil', 'transfer'
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({ text: '', type: '' });

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

  const targetSpkQty = useMemo(() => {
    return Number(order?.qty_target || order?.qty_spk || 0);
  }, [order]);

  // Auth check
  useEffect(() => {
    const u = getCurrentUser();
    if (!u) {
      router.push('/login');
    } else {
      setUser(u);
    }
  }, [router]);

  // 1. Domain sub-hooks
  const cuttingState = useCuttingState({
    orderId,
    order,
    rollLines,
    targetSpkQty,
    setSafetyModal,
    setFeedback,
    setSaving,
    loadData: () => loadData()
  });

  const productionState = useProductionState({
    orderId,
    targetSpkQty,
    setSafetyModal,
    setFeedback,
    setSaving,
    loadData: () => loadData()
  });

  const transferState = useTransferState({
    orderId,
    setOrder,
    setRollLines,
    setRawMoves,
    setActualCutting: cuttingState.setActualCutting,
    setRollWeights: cuttingState.setRollWeights,
    setPenerimaanQtys: cuttingState.setPenerimaanQtys,
    setFeedback
  });

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
        transferState.setTransfers(res.transfers || res.order?.transfers || []);

        // Prepopulate cutting actual
        cuttingState.setActualCutting(
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
        cuttingState.setRollWeights(weights);
        cuttingState.setPenerimaanQtys(pQtys);

        // Prepopulate production results
        productionState.setGradeA(res.order.qty_grade_a !== null && res.order.qty_grade_a !== undefined ? String(res.order.qty_grade_a) : '');
        productionState.setGradeB(res.order.qty_grade_b !== null && res.order.qty_grade_b !== undefined ? String(res.order.qty_grade_b) : '');
        
        const spPanjang = res.order.sisa_potong_panjang !== null && res.order.sisa_potong_panjang !== undefined ? String(res.order.sisa_potong_panjang) : '';
        const spSedang = res.order.sisa_potong_sedang !== null && res.order.sisa_potong_sedang !== undefined ? String(res.order.sisa_potong_sedang) : '';
        const spPendek = res.order.sisa_potong_pendek !== null && res.order.sisa_potong_pendek !== undefined ? String(res.order.sisa_potong_pendek) : '';
        
        productionState.setSisaPanjang(spPanjang);
        productionState.setSisaSedang(spSedang);
        productionState.setSisaPendek(spPendek);
        
        // Fallback for legacy single sisa_makloon_kg if categories are not yet set
        if (!spPanjang && !spSedang && !spPendek && res.order.sisa_makloon_kg) {
          productionState.setSisaPanjang(String(res.order.sisa_makloon_kg));
        }
        
        productionState.setNoSuratJalan(res.order.no_surat_jalan || res.order.no_surat_jalan_sfp || '');
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
    syncingOdoo: transferState.syncingOdoo,
    feedback,
    activeTab,
    setActiveTab,
    copiedTransferId: transferState.copiedTransferId,
    transferFilter: transferState.transferFilter,
    setTransferFilter: transferState.setTransferFilter,
    actualCutting: cuttingState.actualCutting,
    setActualCutting: cuttingState.setActualCutting,
    rollWeights: cuttingState.rollWeights,
    penerimaanQtys: cuttingState.penerimaanQtys,
    gradeA: productionState.gradeA,
    setGradeA: productionState.setGradeA,
    gradeB: productionState.gradeB,
    setGradeB: productionState.setGradeB,
    sisaPanjang: productionState.sisaPanjang,
    setSisaPanjang: productionState.setSisaPanjang,
    sisaSedang: productionState.sisaSedang,
    setSisaSedang: productionState.setSisaSedang,
    sisaPendek: productionState.sisaPendek,
    setSisaPendek: productionState.setSisaPendek,
    totalSisaKg: productionState.totalSisaKg,
    sisaKg: productionState.totalSisaKg,
    setSisaKg: productionState.setSisaKg,
    noSuratJalan: productionState.noSuratJalan,
    setNoSuratJalan: productionState.setNoSuratJalan,
    safetyModal,
    setSafetyModal,
    loadData,
    handleForceSyncOdoo: transferState.handleForceSyncOdoo,
    handleCopyTransferName: transferState.handleCopyTransferName,
    handleShareToWa,
    handleAskWaKainKurang,
    handleWeightChange: cuttingState.handleWeightChange,
    handlePenerimaanChange: cuttingState.handlePenerimaanChange,
    handleFillCuttingFromPenerimaan: cuttingState.handleFillCuttingFromPenerimaan,
    handleFillAllFabricFromPenerimaan: cuttingState.handleFillAllFabricFromPenerimaan,
    handleFillAllAccessories: cuttingState.handleFillAllAccessories,
    handleFillCuttingWithTargetSpk: cuttingState.handleFillCuttingWithTargetSpk,
    setPresetGradeA: productionState.setPresetGradeA,
    handleRequestSubmitCutting: cuttingState.handleRequestSubmitCutting,
    executeSubmitCutting: cuttingState.executeSubmitCutting,
    handleRequestSubmitProduction: productionState.handleRequestSubmitProduction,
    executeSubmitProduction: productionState.executeSubmitProduction,
    fabricLines: cuttingState.fabricLines,
    accessoryLines: cuttingState.accessoryLines,
    rollLines,
    rawMoves,
    transfers: transferState.transfers,
    filteredTransfers: transferState.filteredTransfers,
    transferCounts: transferState.transferCounts,
    totalPhysicalFabric: cuttingState.totalPhysicalFabric,
    targetSpkQty,
    currentActualCutting: cuttingState.currentActualCutting,
    selisihCutting: cuttingState.selisihCutting,
    totalYieldPcs: productionState.totalYieldPcs,
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
