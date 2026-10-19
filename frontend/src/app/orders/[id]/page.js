'use client';

import { useState, useEffect, Suspense, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { fetchApi, getCurrentUser } from '@/lib/api';
import ThemeToggle from '@/components/ThemeToggle';
import {
  ArrowLeft,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Scissors,
  Package,
  Send,
  RefreshCw,
  Info,
  Building2,
  Scale,
  FileText,
  AlertCircle,
  Clock,
  ShieldAlert,
  TrendingUp,
  ChevronRight,
  Check,
  Tag,
  Zap,
  MessageCircle,
  Truck,
  Copy,
  Percent,
  ExternalLink,
  Save
} from 'lucide-react';

function OrderDetailContent() {
  const router = useRouter();
  const routeParams = useParams();
  const orderId = routeParams?.id;

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

  useEffect(() => {
    const u = getCurrentUser();
    if (!u) {
      router.push('/login');
    } else {
      setUser(u);
    }
  }, [router]);

  const loadData = async () => {
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
            pQtys[r.id] = r.qty; // Default dari Surat Jalan
          }
        });
        setRollWeights(weights);
        setPenerimaanQtys(pQtys);

        // Prepopulate production results
        setGradeA(res.order.qty_grade_a || '');
        setGradeB(res.order.qty_grade_b || '');
        setSisaKg(res.order.sisa_makloon_kg || '');
        setNoSuratJalan(res.order.no_surat_jalan || '');
      }
    } catch (err) {
      setFeedback({ text: 'Gagal memuat SPK: ' + err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && orderId) {
      loadData();
    }
  }, [user, orderId]);

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

        // Update actual cutting if fresh
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
          text: 'Data SPK, BOM material, dan dokumen transfer berhasil disinkronkan langsung dari Odoo ERP!',
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
    const kainInfo = `${order.status_kebutuhan_kain || 'Cukup'}${order.kain_dari_gudang !== null && order.kain_dari_gudang !== undefined ? ` (Terima: ${Number(order.kain_dari_gudang).toLocaleString('id-ID')} ${order.unit_kain || 'kg'} / Butuh: ${Number(order.qty_kebutuhan_kain || 0).toLocaleString('id-ID')} ${order.unit_kain || 'kg'})` : ''}`;

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
    handleShareToWa('Total kain yang kami terima di konveksi KURANG dari kebutuhan standar SPK. Mohon arahan apakah kain boleh dipotong atau menunggu kiriman tambahan? Terima kasih.');
  };

  // Handle Roll Weight Change
  const handleWeightChange = (lineId, value) => {
    setRollWeights((prev) => ({
      ...prev,
      [lineId]: value
    }));
  };

  // Handle Qty Penerimaan Change
  const handlePenerimaanChange = (lineId, value) => {
    setPenerimaanQtys((prev) => ({
      ...prev,
      [lineId]: value
    }));
  };

  // Quick-Fill single accessory or fabric line with SPK standard
  const handleFillStandard = (lineId, qty) => {
    if (qty === undefined || qty === null) return;
    setRollWeights((prev) => ({
      ...prev,
      [lineId]: qty
    }));
  };

  // Quick-Fill cutting from Qty Penerimaan
  const handleFillCuttingFromPenerimaan = (lineId) => {
    const pVal = penerimaanQtys[lineId] !== undefined ? penerimaanQtys[lineId] : '';
    if (pVal !== '') {
      setRollWeights((prev) => ({
        ...prev,
        [lineId]: pVal
      }));
    }
  };

  // Quick-Fill ALL fabric cutting with Penerimaan Qty
  const handleFillAllFabricFromPenerimaan = () => {
    setRollWeights((prev) => {
      const updated = { ...prev };
      fabricLines.forEach((line) => {
        const pVal = penerimaanQtys[line.id] !== undefined ? penerimaanQtys[line.id] : (line.qty_penerimaan || line.qty || 0);
        if (pVal !== undefined && pVal !== null && pVal !== '') {
          updated[line.id] = pVal;
        }
      });
      return updated;
    });
  };

  // Quick-Fill ALL accessories with SPK standard in one tap
  const handleFillAllAccessories = () => {
    setRollWeights((prev) => {
      const updated = { ...prev };
      accessoryLines.forEach((line) => {
        const pVal = penerimaanQtys[line.id] !== undefined ? penerimaanQtys[line.id] : (line.qty_penerimaan || line.qty || 0);
        if (pVal !== undefined && pVal !== null && pVal !== '') {
          updated[line.id] = pVal;
        }
      });
      return updated;
    });
  };

  // Quick-Fill Cutting Actual with Target SPK
  const handleFillCuttingWithTargetSpk = () => {
    if (targetSpkQty > 0) {
      setActualCutting(String(targetSpkQty));
    }
  };

  // Tactile adjustment for Grade A / Grade B
  const adjustQty = (setter, currentVal, delta, min = 0) => {
    const curr = parseFloat(currentVal) || 0;
    const next = Math.max(min, curr + delta);
    setter(String(next));
  };

  // 1-Tap preset for Grade A = 100% Target SPK
  const setPresetGradeA = (qty) => {
    setGradeA(String(qty));
    if (!gradeB) setGradeB('0');
  };

  // Execute Submit Cutting (Called after safety modal confirmation)
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

  // Request Submit Cutting (Safety Net Check for Typos & Extreme Deviations)
  const handleRequestSubmitCutting = () => {
    const inputActual = actualCutting !== '' ? parseFloat(actualCutting) : null;
    const allRollLineIds = new Set([
      ...Object.keys(rollWeights),
      ...Object.keys(penerimaanQtys),
      ...rollLines.map(r => String(r.id))
    ]);

    const rolls = Array.from(allRollLineIds).map((lineIdStr) => {
      const lineId = Number(lineIdStr);
      const match = rollLines.find(r => r.id === lineId);
      const defaultP = match ? (match.qty_penerimaan !== undefined && match.qty_penerimaan !== null ? match.qty_penerimaan : match.qty) : 0;
      return {
        id: lineId,
        lineId,
        line_id: lineId,
        qty_berat_kg: rollWeights[lineId] !== undefined && rollWeights[lineId] !== '' ? parseFloat(rollWeights[lineId]) : 0,
        qty_penerimaan: penerimaanQtys[lineId] !== undefined && penerimaanQtys[lineId] !== '' ? parseFloat(penerimaanQtys[lineId]) : defaultP
      };
    });

    if (inputActual === null && rolls.length === 0) {
      setFeedback({ text: 'Harap isi hasil potong aktual atau rincian bahan fisik terlebih dahulu.', type: 'error' });
      return;
    }

    const effectiveActual = inputActual !== null ? inputActual : totalPhysicalFabric;
    const targetRef = targetSpkQty > 0 ? targetSpkQty : 0;
    const targetLabel = 'Target SPK';
    let isExtreme = false;
    let devPct = 0;

    if (targetRef > 0) {
      devPct = Math.abs(effectiveActual - targetRef) / targetRef * 100;
      isExtreme = devPct > 20 || (effectiveActual === 0 && targetRef > 0) || effectiveActual > (targetRef * 1.5);
    }

    setSafetyModal({
      open: true,
      stage: 'cutting',
      isExtreme,
      deviationPct: devPct,
      title: isExtreme ? 'Peringatan: Selisih Hasil Potong Ekstrem' : 'Konfirmasi Simpan Hasil Potong',
      targetVal: targetRef > 0 ? `${targetRef.toLocaleString('id-ID')} pcs` : '-',
      actualVal: `${effectiveActual.toLocaleString('id-ID')} pcs`,
      diffVal: targetRef > 0
        ? `${effectiveActual - targetRef > 0 ? '+' : ''}${(effectiveActual - targetRef).toLocaleString('id-ID')} pcs`
        : '0',
      warningMessage: isExtreme
        ? `Angka hasil potong yang Anda masukkan (${effectiveActual.toLocaleString('id-ID')} pcs) berselisih ${devPct.toFixed(0)}% dari ${targetLabel} (${targetRef.toLocaleString('id-ID')} pcs). Mohon periksa kembali apakah ada kesalahan ketik.`
        : 'Data hasil potong akan disimpan dan disinkronkan langsung ke Odoo ERP.',
      onConfirm: () => executeSubmitCutting(effectiveActual, rolls)
    });
  };

  // Execute Submit Production Result (Called after safety modal confirmation)
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

  // Request Submit Production (Safety Net Check for Typos & Abnormal Ratios)
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
      devPct = Math.abs(totalYield - targetRef) / targetRef * 100;
      isExtreme = devPct > 20 || (valB > valA && valB > 0);
    }

    setSafetyModal({
      open: true,
      stage: 'production',
      isExtreme,
      deviationPct: devPct,
      title: isExtreme ? 'Peringatan: Selisih Hasil Jahit Ekstrem' : 'Konfirmasi Simpan Hasil Jahit',
      targetVal: `${targetRef.toLocaleString('id-ID')} pcs`,
      actualVal: `${totalYield.toLocaleString('id-ID')} pcs (Grade A: ${valA}, Grade B: ${valB})`,
      diffVal: `${totalYield - targetRef > 0 ? '+' : ''}${(totalYield - targetRef).toFixed(0)} pcs`,
      warningMessage: isExtreme
        ? (valB > valA
            ? `Perhatian: Jumlah Grade B / BS (${valB} pcs) lebih banyak dari Grade A (${valA} pcs). Mohon periksa apakah kolom tertukar sebelum menyimpan SPK.`
            : `Total hasil jahit (${totalYield} pcs) berselisih ${devPct.toFixed(0)}% dari target SPK (${targetRef} pcs). Pastikan bukan salah ketik sebelum data dikirim ke Odoo.`)
        : 'Pastikan seluruh jumlah fisik sudah sesuai dengan surat jalan. Data akan disimpan dan disinkronkan langsung ke Odoo ERP.',
      onConfirm: executeSubmitProduction
    });
  };

  // Material lines segmentation: Kain (Fabric) vs Aksesoris/Pelengkap
  const fabricLines = useMemo(() => {
    return rollLines.filter((l) => {
      const name = (l.nama_item || '').toLowerCase();
      const isAcc = l.line_type === 'aksesoris' || name.includes('acc') || name.includes('acces') || name.includes('aksesoris') || name.includes('kancing') || name.includes('benang') || name.includes('zipper') || name.includes('label');
      if (isAcc) return false;
      return l.line_type === 'kain' || name.includes('kain');
    });
  }, [rollLines]);

  const accessoryLines = useMemo(() => {
    return rollLines.filter((l) => !fabricLines.includes(l));
  }, [rollLines, fabricLines]);

  const getLineUom = (line) => (line.uom || order?.unit_kain || 'pcs').toUpperCase();

  const getLineLabel = (line) => {
    const uom = (line.uom || order?.unit_kain || '').toLowerCase();
    if (uom === 'kg') return 'BERAT TIMBANG';
    if (uom === 'yard' || uom === 'yd') return 'PANJANG FISIK';
    if (uom === 'meter' || uom === 'm') return 'PANJANG FISIK';
    return 'JUMLAH FISIK';
  };

  // Calculations for Fabric & Cutting
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

  // Filtered transfers for Tab 4 (Feature 3)
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

  const totalYieldPcs = useMemo(() => {
    return (parseFloat(gradeA) || 0) + (parseFloat(gradeB) || 0);
  }, [gradeA, gradeB]);

  // Product name & SKU parsing
  const { skuCode, cleanProductName } = useMemo(() => {
    if (!order?.product_name) return { skuCode: null, cleanProductName: 'Item Produksi' };
    const match = order.product_name.match(/^\[(.*?)\]\s*(.*)$/);
    if (match) {
      return { skuCode: match[1], cleanProductName: match[2] };
    }
    return { skuCode: null, cleanProductName: order.product_name };
  }, [order?.product_name]);

  if (loading || !order) {
    return (
      <div style={{ padding: '80px 20px', textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto 16px' }}></div>
        <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Memuat detail operasional SPK...</p>
      </div>
    );
  }

  const isBackorder = Boolean(order.is_backorder);
  const isCuttingLocked = Boolean(order.cutting_locked_at);
  const isResultLocked = Boolean(order.result_locked_at);
  const isMasterAdmin = user?.role === 'master_admin';
  const canEditCutting = ['master_admin', 'master_vendor', 'admin_vendor'].includes(user?.role);
  const canEditResult = ['master_admin', 'master_vendor', 'admin_vendor'].includes(user?.role);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', width: '100%', overflowX: 'hidden' }}>
      {/* Top Navbar */}
      <header className="navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
          <button
            onClick={() => router.push('/')}
            className="btn btn-secondary btn-icon"
            style={{ flexShrink: 0, borderRadius: '10px' }}
            title="Kembali ke Dashboard"
          >
            <ArrowLeft size={18} />
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span className="mono-num" style={{ fontSize: '1.02rem', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                {order.mo_name}
              </span>
              {isBackorder && <span className="badge badge-purple" style={{ fontSize: '0.68rem' }}>Backorder</span>}
              {order.status_produksi === 'Selesai' ? (
                <span className="badge badge-emerald" style={{ fontSize: '0.7rem' }}><CheckCircle2 size={13} /> Selesai</span>
              ) : (actualCutting !== '' || order.actual_cutting) ? (
                <span className="badge badge-sky" style={{ fontSize: '0.7rem' }}><Scissors size={13} /> Sedang Jahit</span>
              ) : (
                <span className="badge badge-amber" style={{ fontSize: '0.7rem' }}><Scissors size={13} /> Belum Potong</span>
              )}
            </div>
            <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span>SO:</span>
              {order.source_document || order.sales_order ? (
                <strong className="mono-num" style={{ color: 'var(--text-primary)' }}>{order.source_document || order.sales_order}</strong>
              ) : (
                <span
                  className="badge badge-slate"
                  style={{
                    fontSize: '0.65rem',
                    padding: '1px 6px',
                    fontWeight: 600,
                    background: '#f1f5f9',
                    color: '#475569',
                    border: '1px solid #cbd5e1'
                  }}
                  title="Make-to-Stock (Pemenuhan Stok Gudang)"
                >
                  Stok Gudang (Non-SO)
                </span>
              )}
              <span>•</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.vendor_name}</span>
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <button
            type="button"
            onClick={handleForceSyncOdoo}
            disabled={syncingOdoo || loading}
            className="btn"
            style={{
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              color: '#ffffff',
              border: '1px solid #334155',
              fontSize: '0.8rem',
              fontWeight: 700,
              padding: '7px 12px',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: 'var(--shadow-subtle)',
              cursor: syncingOdoo ? 'not-allowed' : 'pointer',
              opacity: syncingOdoo ? 0.75 : 1
            }}
            title="Tarik & sinkronkan data terbaru langsung dari Odoo ERP"
          >
            <RefreshCw size={14} className={syncingOdoo ? 'spinner' : ''} style={{ color: '#38bdf8' }} />
            <span className="hide-on-mobile">{syncingOdoo ? 'Menyinkronkan...' : 'Tarik Data Odoo'}</span>
          </button>

          <button
            type="button"
            onClick={() => handleShareToWa()}
            className="btn"
            style={{
              background: '#25D366',
              color: '#ffffff',
              border: 'none',
              fontSize: '0.8rem',
              fontWeight: 700,
              padding: '7px 12px',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 6px rgba(37, 211, 102, 0.35)',
              cursor: 'pointer'
            }}
            title="Kirim pertanyaan atau kendala SPK ini ke WhatsApp Group"
          >
            <MessageCircle size={15} />
            <span className="hide-on-mobile">Tanya di WA</span>
          </button>

          <ThemeToggle />

          <button
            onClick={loadData}
            className="btn btn-secondary btn-icon"
            style={{ width: '36px', height: '36px', borderRadius: '10px' }}
            title="Segarkan Data"
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? 'spinner' : ''} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="main-content">
        {/* Alerts / Feedback Message */}
        {feedback.text && (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              fontSize: '0.86rem',
              fontWeight: 600,
              background: feedback.type === 'success' ? 'var(--status-emerald-bg)' : 'var(--status-rose-bg)',
              border: `1.5px solid ${feedback.type === 'success' ? 'var(--status-emerald-border)' : 'var(--status-rose-border)'}`,
              color: feedback.type === 'success' ? 'var(--status-emerald)' : 'var(--status-rose)',
              boxShadow: 'var(--shadow-subtle)'
            }}
          >
            {feedback.type === 'success' ? <CheckCircle2 size={18} style={{ flexShrink: 0 }} /> : <AlertTriangle size={18} style={{ flexShrink: 0 }} />}
            <span>{feedback.text}</span>
          </div>
        )}

        {/* Backorder Information Banner */}
        {isBackorder && (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              background: 'var(--status-purple-bg)',
              border: '1px solid var(--status-purple-border)',
              color: 'var(--status-purple)',
              fontSize: '0.84rem'
            }}
          >
            <Info size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong>Backorder Turunan:</strong> Data hasil potong/bahan diwarisi otomatis dari MO induk. Anda dapat langsung menginput hasil jahit.
            </div>
          </div>
        )}

        {/* Master SPK Specification Card */}
        <div className="card" style={{ padding: '18px 20px', borderRadius: '16px' }}>
          {/* Header Row: SKU & Title */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
              {skuCode ? (
                <span className="badge badge-slate mono-num" style={{ fontSize: '0.76rem', fontWeight: 700, padding: '4px 10px' }}>
                  SKU: {skuCode}
                </span>
              ) : (
                <span className="badge badge-slate" style={{ fontSize: '0.76rem' }}>Produk WIP</span>
              )}
              <span className="badge badge-gold mono-num" style={{ fontSize: '0.74rem' }}>
                SPK #{order.id}
              </span>
            </div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.35, margin: 0 }}>
              {cleanProductName}
            </h2>
          </div>

          {/* 3 Executive Highlight Tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
            {/* Tile 1: Target SPK */}
            <div className="hero-tile" style={{ background: 'var(--brand-gold-light)', borderColor: 'var(--brand-gold-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.7rem', fontWeight: 700, color: 'var(--brand-gold)', textTransform: 'uppercase' }}>
                <span>🎯 Target SPK</span>
              </div>
              <div className="mono-num" style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--brand-gold)', lineHeight: 1.1 }}>
                {targetSpkQty.toLocaleString('id-ID')} <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>pcs</span>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                Target Pesanan SPK
              </div>
            </div>

            {/* Tile 2: Mitra CMT */}
            <div className="hero-tile">
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                <span>🏭 Mitra CMT</span>
              </div>
              <div style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.25, wordBreak: 'break-word' }}>
                {order.vendor_name || 'Vendor CMT'}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                Pelaksana Jahit
              </div>
            </div>

            {/* Tile 3: Status Produksi */}
            <div className="hero-tile" style={{
              background: order.status_produksi === 'Selesai' ? 'var(--status-emerald-bg)' : 'var(--status-sky-bg)',
              borderColor: order.status_produksi === 'Selesai' ? 'var(--status-emerald-border)' : 'var(--status-sky-border)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: order.status_produksi === 'Selesai' ? 'var(--status-emerald)' : 'var(--status-sky)' }}>
                <span
                  className="pulse-dot"
                  style={{ background: order.status_produksi === 'Selesai' ? '#059669' : '#0284c7' }}
                />
                <span>Status Produksi</span>
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: order.status_produksi === 'Selesai' ? 'var(--status-emerald)' : 'var(--status-sky)', lineHeight: 1.1 }}>
                {order.status_produksi || 'Proses'}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                Tahap Pengerjaan
              </div>
            </div>
          </div>
        </div>

        {/* Master Vendor & Admin: Biaya & Tarif Makloon Card */}
        {user?.role !== 'admin_vendor' && (
          <div
            className="card"
            style={{
              padding: '14px 18px',
              borderRadius: '16px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-default)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '10px',
                    background: 'var(--brand-gold-light)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  <Tag size={18} color="var(--brand-gold)" />
                </div>
                <div>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--brand-gold)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Tarif Jasa Makloon
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="mono-num" style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                      {Number(order.harga_vendor || 0) > 0
                        ? `Rp ${Number(order.harga_vendor).toLocaleString('id-ID')} / pcs`
                        : 'Rp 0.00'}
                    </span>
                    {Number(order.harga_vendor || 0) === 0 && (
                      <span className="badge badge-amber" style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
                        Belum Diinput di Odoo
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                {Number(order.total_harga || 0) > 0 && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Total Biaya SFP Masuk:</div>
                    <div className="mono-num" style={{ fontSize: '1.05rem', fontWeight: 800, color: '#059669' }}>
                      Rp {Number(order.total_harga).toLocaleString('id-ID')}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleForceSyncOdoo}
                  disabled={syncingOdoo}
                  className="btn btn-secondary"
                  style={{
                    fontSize: '0.74rem',
                    padding: '6px 12px',
                    borderRadius: '10px',
                    gap: '6px',
                    border: '1px solid #fde68a',
                    background: '#fffdf5',
                    color: 'var(--brand-gold)',
                    fontWeight: 700
                  }}
                  title="Periksa & sinkronkan tarif terbaru langsung dari tabel Vendor Production Odoo"
                >
                  <RefreshCw size={13} className={syncingOdoo ? 'spin-icon' : ''} />
                  <span>{syncingOdoo ? 'Mengecek...' : 'Sinkronkan Tarif Odoo'}</span>
                </button>
              </div>
            </div>
            {Number(order.harga_vendor || 0) === 0 && (
              <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', background: '#fffbeb', padding: '6px 10px', borderRadius: '8px', border: '1px dashed #fcd34d' }}>
                💡 <em>Tarif makloon belum terdaftar di Odoo. Jika admin baru saja menambahkan harga di menu <strong>Vendor Production</strong> Odoo, klik tombol <strong>&quot;Sinkronkan Tarif Odoo&quot;</strong> di atas.</em>
              </div>
            )}
          </div>
        )}

        {/* Operational Segmented Tabs (Apple / Linear Pill Style) */}
        <div className="segmented-tabs-wrapper">
          <button
            id="tab-btn-timbang"
            onClick={() => setActiveTab('timbang')}
            className={`segmented-tab-btn ${activeTab === 'timbang' ? 'active' : ''}`}
          >
            <Scissors size={15} className="tab-icon" />
            <span>1. Hasil Potong {rollLines.length > 0 ? `(${rollLines.length})` : ''}</span>
          </button>

          <button
            id="tab-btn-hasil"
            onClick={() => setActiveTab('hasil')}
            className={`segmented-tab-btn ${activeTab === 'hasil' ? 'active' : ''}`}
          >
            <Package size={15} className="tab-icon" />
            <span>2. Hasil Jahit</span>
          </button>

          <button
            id="tab-btn-transfer"
            onClick={() => setActiveTab('transfer')}
            className={`segmented-tab-btn ${activeTab === 'transfer' ? 'active' : ''}`}
          >
            <Truck size={15} className="tab-icon" />
            <span>
              3. Dokumen Transfer {transfers.length > 0 ? `(${transfers.length})` : ''}
            </span>
          </button>
        </div>

        {/* ==================================================================
            TAB 1: HASIL POTONG & RINCIAN BAHAN BAKU
            ================================================================== */}
        {activeTab === 'timbang' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

            {/* HERO CARD: HASIL CUTTING (POTONG) AKTUAL */}
            <div className="card" style={{ padding: '18px 20px', borderRadius: '16px' }}>
              {/* Header Bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: 'rgba(217, 119, 6, 0.12)',
                      color: 'var(--brand-gold)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <Scissors size={18} />
                  </div>
                  <div>
                    <span style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>
                      Hasil Cutting (Potong) Aktual
                    </span>
                  </div>
                </div>
                <span className="badge badge-gold mono-num" style={{ textTransform: 'uppercase', fontSize: '0.75rem', fontWeight: 700 }}>
                  Satuan: {order.unit_kain || 'PCS'}
                </span>
              </div>

              {/* 3 Human Metric Tiles Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
                {/* 1. Target SPK */}
                <div className="hero-tile">
                  <div className="metric-label" style={{ fontSize: '0.7rem' }}>🎯 Target SPK</div>
                  <div className="mono-num" style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                    {targetSpkQty.toLocaleString('id-ID')} <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>pcs</span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    Pesanan Produksi
                  </div>
                </div>

                {/* 2. Hasil Potong Fisik Input */}
                <div className="hero-tile" style={{ background: 'var(--brand-gold-light)', borderColor: 'var(--brand-gold-border)' }}>
                  <div className="metric-label" style={{ fontSize: '0.7rem', color: 'var(--brand-gold)' }}>✂️ Hasil Potong Fisik</div>
                  {canEditCutting ? (
                    <div>
                      <div className="input-addon-group" style={{ height: '42px', borderColor: actualCutting ? 'var(--brand-gold)' : 'var(--border-strong)' }}>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          disabled={saving}
                          placeholder={targetSpkQty > 0 ? String(targetSpkQty) : '0'}
                          value={actualCutting}
                          onChange={(e) => setActualCutting(e.target.value)}
                          className="input-addon-field"
                          style={{ fontSize: '1.25rem', fontWeight: 800 }}
                        />
                        <span className="input-addon-label">
                          PCS
                        </span>
                      </div>
                      {targetSpkQty > 0 && actualCutting === '' && (
                        <button
                          type="button"
                          onClick={handleFillCuttingWithTargetSpk}
                          className="quick-action-pill quick-action-pill-amber"
                          style={{ marginTop: '6px', width: '100%', fontSize: '0.7rem' }}
                          title="Isi otomatis dengan Target SPK"
                        >
                          <Zap size={11} />
                          <span>Sesuai Target SPK ({targetSpkQty})</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="mono-num" style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--brand-gold)', lineHeight: 1.2 }}>
                      {(parseFloat(order.actual_cutting) || currentActualCutting).toLocaleString('id-ID')}{' '}
                      <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>pcs</span>
                    </div>
                  )}
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Output riil meja potong
                  </div>
                </div>

                {/* 3. Selisih vs Target SPK */}
                <div className="hero-tile">
                  <div className="metric-label" style={{ fontSize: '0.7rem' }}>⚖️ Selisih vs Target SPK</div>
                  <div className="mono-num" style={{
                    fontSize: '1.35rem',
                    fontWeight: 800,
                    lineHeight: 1.2,
                    color: selisihCutting > 0 ? 'var(--status-emerald)' : selisihCutting < 0 ? 'var(--status-rose)' : 'var(--text-primary)'
                  }}>
                    {currentActualCutting > 0
                      ? (selisihCutting > 0 ? `+${selisihCutting.toLocaleString('id-ID')}` : selisihCutting.toLocaleString('id-ID'))
                      : '0'}{' '}
                    <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>pcs</span>
                  </div>
                  <div style={{ marginTop: '2px' }}>
                    {currentActualCutting === 0 ? (
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Belum input potong</span>
                    ) : selisihCutting === 0 ? (
                      <span className="badge badge-emerald" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>✓ Sesuai Target SPK</span>
                    ) : selisihCutting > 0 ? (
                      <span className="badge badge-emerald" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>▲ Hasil Potong Lebih</span>
                    ) : (
                      <span className="badge badge-amber" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>▼ Hasil Potong Kurang</span>
                    )}
                  </div>
                </div>
              </div>
            </div>



            {/* SECTION 1: BAHAN KAIN (FABRIC ROLLS) IF PRESENT */}
            {fabricLines.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px', flexWrap: 'wrap', gap: '8px' }}>
                  <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    🧵 Rincian Bahan Kain ({fabricLines.length} baris)
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {canEditCutting && (
                      <button
                        type="button"
                        onClick={handleFillAllFabricFromPenerimaan}
                        className="quick-action-pill quick-action-pill-amber"
                        style={{ fontSize: '0.72rem' }}
                        title="Isi semua hasil potong kain sesuai Qty Penerimaan"
                      >
                        <Zap size={11} />
                        <span>Sesuai Penerimaan Semua</span>
                      </button>
                    )}
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      Total Fisik Potong: <strong className="mono-num" style={{ color: 'var(--brand-gold)', fontWeight: 800 }}>{totalPhysicalFabric.toFixed(2)} {getLineUom(fabricLines[0])}</strong>
                    </span>
                  </div>
                </div>

                {fabricLines.map((line, idx) => {
                  const lineUom = getLineUom(line);
                  const lineLabel = getLineLabel(line);
                  const currentPenerimaan = penerimaanQtys[line.id] !== undefined 
                    ? penerimaanQtys[line.id] 
                    : (line.qty_penerimaan !== undefined && line.qty_penerimaan !== null ? line.qty_penerimaan : (line.qty || ''));

                  return (
                    <div
                      key={line.id}
                      className="card roll-card"
                      style={{ borderLeft: '4px solid var(--brand-gold)' }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
                          <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem' }}>#{idx + 1}</span>
                          <span className="mono-num" style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                            Lot: {line.kode_lot || 'N/A'}
                          </span>
                          <span className="badge badge-gold mono-num" style={{ fontSize: '0.68rem' }}>{lineUom}</span>
                        </div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '2px' }}>
                          {line.nama_item}
                        </div>
                        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                          Surat Jalan Transfer: <strong className="mono-num" style={{ color: 'var(--text-primary)' }}>{line.qty || 0} {lineUom}</strong>
                        </div>
                      </div>

                      <div className="roll-input-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {/* INPUT 1: QTY PENERIMAAN (FISIK MASUK) */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--status-sky, #38bdf8)', textTransform: 'uppercase' }}>
                              📦 Penerimaan:
                            </label>
                            {canEditCutting && line.qty > 0 && (
                              <button
                                type="button"
                                onClick={() => handlePenerimaanChange(line.id, line.qty)}
                                className={`quick-action-pill ${parseFloat(penerimaanQtys[line.id]) === parseFloat(line.qty) ? 'quick-action-pill-emerald' : ''}`}
                                style={{ fontSize: '0.65rem', padding: '1px 5px' }}
                                title="Default sesuai Surat Jalan / SPK"
                              >
                                {parseFloat(penerimaanQtys[line.id]) === parseFloat(line.qty) ? (
                                  <>
                                    <Check size={10} />
                                    <span>SJ</span>
                                  </>
                                ) : (
                                  <>
                                    <Zap size={10} />
                                    <span>SJ ({line.qty})</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                          <div style={{ width: '120px' }}>
                            <div className="input-addon-group" style={{ height: '38px', borderColor: 'var(--border-strong)' }}>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                disabled={!canEditCutting || saving}
                                placeholder={line.qty ? String(line.qty) : '0.00'}
                                value={currentPenerimaan}
                                onChange={(e) => handlePenerimaanChange(line.id, e.target.value)}
                                className="input-addon-field"
                                style={{ fontSize: '0.95rem', fontWeight: 700 }}
                              />
                              <span className="input-addon-label" style={{ fontSize: '0.68rem', padding: '0 6px' }}>
                                {lineUom}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* INPUT 2: QTY CUTTING / TERPAKAI */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--brand-gold)', textTransform: 'uppercase' }}>
                              ✂️ {lineLabel}:
                            </label>
                            {canEditCutting && (
                              <button
                                type="button"
                                onClick={() => handleFillCuttingFromPenerimaan(line.id)}
                                className={`quick-action-pill ${parseFloat(rollWeights[line.id]) === parseFloat(currentPenerimaan) ? 'quick-action-pill-emerald' : ''}`}
                                style={{ fontSize: '0.65rem', padding: '1px 5px' }}
                                title="Gunakan nilai Qty Penerimaan"
                              >
                                {parseFloat(rollWeights[line.id]) === parseFloat(currentPenerimaan) ? (
                                  <>
                                    <Check size={10} />
                                    <span>Pas</span>
                                  </>
                                ) : (
                                  <>
                                    <Zap size={10} />
                                    <span>Pakai Masuk</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                          <div style={{ width: '120px' }}>
                            <div className="input-addon-group" style={{ height: '38px', borderColor: rollWeights[line.id] ? 'var(--brand-gold)' : 'var(--border-strong)' }}>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                disabled={!canEditCutting || saving}
                                placeholder="0.00"
                                value={rollWeights[line.id] !== undefined ? rollWeights[line.id] : ''}
                                onChange={(e) => handleWeightChange(line.id, e.target.value)}
                                className="input-addon-field"
                                style={{ fontSize: '0.95rem', fontWeight: 800 }}
                              />
                              <span className="input-addon-label" style={{ fontSize: '0.68rem', padding: '0 6px' }}>
                                {lineUom}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* SECTION 2: AKSESORIS & PELENGKAP (ACCESSORIES) IF PRESENT */}
            {accessoryLines.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: fabricLines.length > 0 ? '6px' : '0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px', flexWrap: 'wrap', gap: '8px' }}>
                  <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    🏷️ Aksesoris & Bahan Pelengkap ({accessoryLines.length} item)
                  </span>
                  {canEditCutting && (
                    <button
                      type="button"
                      onClick={handleFillAllAccessories}
                      className="quick-action-pill quick-action-pill-amber"
                      style={{ fontSize: '0.74rem' }}
                      title="Isi semua baris aksesoris sekaligus sesuai Qty Penerimaan"
                    >
                      <Zap size={12} />
                      <span>Sesuai Penerimaan Semua</span>
                    </button>
                  )}
                </div>

                {accessoryLines.map((line, idx) => {
                  const lineUom = getLineUom(line);
                  const currentPenerimaan = penerimaanQtys[line.id] !== undefined 
                    ? penerimaanQtys[line.id] 
                    : (line.qty_penerimaan !== undefined && line.qty_penerimaan !== null ? line.qty_penerimaan : (line.qty || ''));

                  return (
                    <div
                      key={line.id}
                      className="card roll-card"
                      style={{ borderLeft: '4px solid var(--status-sky)' }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
                          <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem' }}>#{idx + 1}</span>
                          <span className="badge badge-sky mono-num" style={{ fontSize: '0.68rem' }}>{lineUom}</span>
                          {line.kode_lot && (
                            <span className="mono-num" style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                              Lot: {line.kode_lot}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '2px' }}>
                          {line.nama_item}
                        </div>
                        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                          Surat Jalan Transfer: <strong className="mono-num" style={{ color: 'var(--text-primary)' }}>{line.qty || 0} {lineUom}</strong>
                        </div>
                      </div>

                      <div className="roll-input-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {/* INPUT 1: QTY PENERIMAAN */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--status-sky, #38bdf8)', textTransform: 'uppercase' }}>
                              📦 Penerimaan:
                            </label>
                            {canEditCutting && line.qty !== undefined && line.qty !== null && (
                              <button
                                type="button"
                                onClick={() => handlePenerimaanChange(line.id, line.qty)}
                                className={`quick-action-pill ${parseFloat(penerimaanQtys[line.id]) === parseFloat(line.qty) ? 'quick-action-pill-emerald' : ''}`}
                                style={{ fontSize: '0.65rem', padding: '1px 5px' }}
                                title="Default sesuai Surat Jalan / SPK"
                              >
                                {parseFloat(penerimaanQtys[line.id]) === parseFloat(line.qty) ? (
                                  <>
                                    <Check size={10} />
                                    <span>SJ</span>
                                  </>
                                ) : (
                                  <>
                                    <Zap size={10} />
                                    <span>SJ ({line.qty || 0})</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                          <div style={{ width: '120px' }}>
                            <div className="input-addon-group" style={{ height: '38px', borderColor: 'var(--border-strong)' }}>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                disabled={!canEditCutting || saving}
                                placeholder={line.qty ? String(line.qty) : '0.00'}
                                value={currentPenerimaan}
                                onChange={(e) => handlePenerimaanChange(line.id, e.target.value)}
                                className="input-addon-field"
                                style={{ fontSize: '0.95rem', fontWeight: 700 }}
                              />
                              <span className="input-addon-label" style={{ fontSize: '0.68rem', padding: '0 6px' }}>
                                {lineUom}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* INPUT 2: QTY TERPAKAI */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                              JUMLAH FISIK:
                            </label>
                            {canEditCutting && (
                              <button
                                type="button"
                                onClick={() => handleFillCuttingFromPenerimaan(line.id)}
                                className={`quick-action-pill ${parseFloat(rollWeights[line.id]) === parseFloat(currentPenerimaan) ? 'quick-action-pill-emerald' : ''}`}
                                style={{ fontSize: '0.65rem', padding: '1px 5px' }}
                                title="Gunakan nilai Qty Penerimaan"
                              >
                                {parseFloat(rollWeights[line.id]) === parseFloat(currentPenerimaan) ? (
                                  <>
                                    <Check size={10} />
                                    <span>Pas</span>
                                  </>
                                ) : (
                                  <>
                                    <Zap size={10} />
                                    <span>Pakai Masuk</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                          <div style={{ width: '120px' }}>
                            <div className="input-addon-group" style={{ height: '38px', borderColor: rollWeights[line.id] ? 'var(--brand-gold)' : 'var(--border-strong)' }}>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                disabled={!canEditCutting || saving}
                                placeholder={line.qty ? String(line.qty) : '0'}
                                value={rollWeights[line.id] !== undefined ? rollWeights[line.id] : ''}
                                onChange={(e) => handleWeightChange(line.id, e.target.value)}
                                className="input-addon-field"
                                style={{ fontSize: '0.95rem', fontWeight: 800 }}
                              />
                              <span className="input-addon-label" style={{ fontSize: '0.68rem', padding: '0 6px' }}>
                                {lineUom}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* EMPTY STATE IF NO LINES AT ALL */}
            {fabricLines.length === 0 && accessoryLines.length === 0 && (
              <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                SPK ini tidak memiliki rincian bahan terpisah.
                <br />
                Silakan langsung isi <strong>Hasil Cutting (Potong) Aktual</strong> pada kartu di atas.
              </div>
            )}

            {/* Sticky Submit Cutting Button */}
            {canEditCutting && (
              <div className="sticky-bottom-action">
                <button
                  type="button"
                  disabled={saving || (actualCutting === '' && totalPhysicalFabric <= 0 && Object.keys(rollWeights).length === 0)}
                  onClick={handleRequestSubmitCutting}
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '14px 20px', fontSize: '1rem', borderRadius: '14px' }}
                >
                  <Save size={18} />
                  <span>{saving ? 'Menyimpan...' : 'Simpan Hasil Potong'}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* ==================================================================
            TAB 2: INPUT HASIL JAHIT
            ================================================================== */}
        {activeTab === 'hasil' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

            {/* Ringkasan Produksi Jahit */}
            <div className="card" style={{ padding: '16px 18px', borderRadius: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', textAlign: 'center' }}>
                <div className="hero-tile">
                  <div className="metric-label" style={{ fontSize: '0.7rem' }}>🎯 Target SPK</div>
                  <div className="mono-num" style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {targetSpkQty.toLocaleString('id-ID')} <span style={{ fontSize: '0.75rem', fontWeight: 400 }}>pcs</span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Target Pesanan</div>
                </div>
                <div className="hero-tile">
                  <div className="metric-label" style={{ fontSize: '0.7rem' }}>✂️ Hasil Potong</div>
                  <div className="mono-num" style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {(parseFloat(order.actual_cutting) || currentActualCutting || 0).toLocaleString('id-ID')} <span style={{ fontSize: '0.75rem', fontWeight: 400 }}>pcs</span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Potongan Meja</div>
                </div>
                <div className="hero-tile" style={{ background: 'var(--brand-gold-light)', borderColor: 'var(--brand-gold-border)' }}>
                  <div className="metric-label" style={{ fontSize: '0.7rem', color: 'var(--brand-gold)' }}>🧵 Total Hasil Jahit</div>
                  <div className="mono-num" style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--brand-gold)' }}>
                    {totalYieldPcs.toLocaleString('id-ID')} <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>pcs</span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Grade A + Grade B</div>
                </div>
              </div>
            </div>

            {/* Production Result Form */}
            <div className="card" style={{ padding: '20px 18px', borderRadius: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '14px' }}>
                {/* Grade A with Steppers */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '4px' }}>
                    <label className="form-label" style={{ margin: 0, fontWeight: 700 }}>Grade A (Pcs)</label>
                    {canEditResult && targetSpkQty > 0 && (
                      <button
                        type="button"
                        onClick={() => setPresetGradeA(targetSpkQty)}
                        className="quick-action-pill quick-action-pill-emerald"
                        style={{ fontSize: '0.68rem', padding: '2px 8px' }}
                        title="Set Grade A = 100% Target SPK"
                      >
                        <Zap size={11} />
                        <span>100% SPK ({targetSpkQty})</span>
                      </button>
                    )}
                  </div>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    disabled={!canEditResult || saving}
                    placeholder="0"
                    value={gradeA}
                    onChange={(e) => setGradeA(e.target.value)}
                    className="input-field mono-num"
                    style={{ fontSize: '1.25rem', fontWeight: 800, height: '46px', textAlign: 'right' }}
                  />
                  {canEditResult && (
                    <div style={{ display: 'flex', gap: '5px', marginTop: '6px', flexWrap: 'wrap' }}>
                      <button type="button" onClick={() => adjustQty(setGradeA, gradeA, -5)} className="stepper-btn" title="Kurangi 5">-5</button>
                      <button type="button" onClick={() => adjustQty(setGradeA, gradeA, -1)} className="stepper-btn" title="Kurangi 1">-1</button>
                      <button type="button" onClick={() => adjustQty(setGradeA, gradeA, +1)} className="stepper-btn" title="Tambah 1">+1</button>
                      <button type="button" onClick={() => adjustQty(setGradeA, gradeA, +5)} className="stepper-btn" title="Tambah 5">+5</button>
                      <button type="button" onClick={() => setGradeA('0')} className="stepper-btn" style={{ fontSize: '0.68rem' }} title="Reset ke 0">0</button>
                    </div>
                  )}
                </div>

                {/* Grade B with Steppers */}
                <div>
                  <label className="form-label" style={{ marginBottom: '6px', fontWeight: 700 }}>Grade B / BS (Pcs)</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    disabled={!canEditResult || saving}
                    placeholder="0"
                    value={gradeB}
                    onChange={(e) => setGradeB(e.target.value)}
                    className="input-field mono-num"
                    style={{ fontSize: '1.25rem', fontWeight: 800, height: '46px', textAlign: 'right' }}
                  />
                  {canEditResult && (
                    <div style={{ display: 'flex', gap: '5px', marginTop: '6px', flexWrap: 'wrap' }}>
                      <button type="button" onClick={() => setGradeB('0')} className="stepper-btn stepper-btn-primary" title="Nol Grade B">0</button>
                      <button type="button" onClick={() => adjustQty(setGradeB, gradeB, +1)} className="stepper-btn" title="Tambah 1">+1</button>
                      <button type="button" onClick={() => adjustQty(setGradeB, gradeB, +2)} className="stepper-btn" title="Tambah 2">+2</button>
                      <button type="button" onClick={() => adjustQty(setGradeB, gradeB, +5)} className="stepper-btn" title="Tambah 5">+5</button>
                      <button type="button" onClick={() => adjustQty(setGradeB, gradeB, -1)} className="stepper-btn" title="Kurangi 1">-1</button>
                    </div>
                  )}
                </div>

                {/* Sisa Kain (BSKL) with Steppers */}
                <div>
                  <label className="form-label" style={{ marginBottom: '6px', fontWeight: 700 }}>Sisa Kain (BSKL / Kg)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    disabled={!canEditResult || saving}
                    placeholder="0.00"
                    value={sisaKg}
                    onChange={(e) => setSisaKg(e.target.value)}
                    className="input-field mono-num"
                    style={{ fontSize: '1.25rem', fontWeight: 800, height: '46px', textAlign: 'right' }}
                  />
                  {canEditResult && (
                    <div style={{ display: 'flex', gap: '5px', marginTop: '6px', flexWrap: 'wrap' }}>
                      <button type="button" onClick={() => setSisaKg('0')} className="stepper-btn" style={{ fontSize: '0.68rem' }}>0.0</button>
                      <button type="button" onClick={() => adjustQty(setSisaKg, sisaKg, +0.5)} className="stepper-btn">+0.5</button>
                      <button type="button" onClick={() => adjustQty(setSisaKg, sisaKg, +1.0)} className="stepper-btn">+1.0</button>
                    </div>
                  )}
                </div>

                {/* Live Balance Summary Bar */}
                <div
                  style={{
                    gridColumn: '1 / -1',
                    padding: '10px 14px',
                    borderRadius: '12px',
                    background: 'var(--bg-card-subtle)',
                    border: '1px solid var(--border-default)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.84rem',
                    flexWrap: 'wrap',
                    gap: '8px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Total Input:</span>
                    <strong className="mono-num" style={{ fontSize: '1rem', color: 'var(--brand-gold)', fontWeight: 800 }}>
                      {totalYieldPcs} pcs
                    </strong>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>
                      (A: {parseFloat(gradeA) || 0} + B: {parseFloat(gradeB) || 0})
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Selisih vs Target: </span>
                    <strong className="mono-num" style={{
                      fontWeight: 800,
                      color: totalYieldPcs - targetSpkQty === 0
                        ? 'var(--status-emerald)'
                        : totalYieldPcs - targetSpkQty > 0
                        ? 'var(--status-emerald)'
                        : 'var(--status-rose)'
                    }}>
                      {totalYieldPcs - targetSpkQty > 0 ? `+${totalYieldPcs - targetSpkQty}` : totalYieldPcs - targetSpkQty} pcs
                    </strong>
                  </div>
                </div>

                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">Nomor Surat Jalan Vendor</label>
                  <input
                    type="text"
                    disabled={!canEditResult || saving}
                    placeholder="Contoh: SJ/VDKWS/2026/001"
                    value={noSuratJalan}
                    onChange={(e) => setNoSuratJalan(e.target.value)}
                    className="input-field"
                    style={{ fontSize: '0.92rem', height: '44px' }}
                  />
                </div>
              </div>

              {canEditResult && (
                <div className="sticky-bottom-action">
                  <button
                    type="button"
                    disabled={saving || totalYieldPcs <= 0}
                    onClick={handleRequestSubmitProduction}
                    className="btn btn-primary"
                    style={{ width: '100%', padding: '14px 20px', fontSize: '1rem', borderRadius: '14px' }}
                  >
                    <CheckCircle2 size={18} />
                    <span>{saving ? 'Menyimpan...' : 'Simpan Hasil Jahit'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================================================================
            TAB 3: DOKUMEN TRANSFER ODOO TERTAUT
            ================================================================== */}
        {activeTab === 'transfer' && (() => {
          const getCategoryBadge = (category) => {
            switch (category) {
              case 'komponen':
                return {
                  label: 'Pengiriman Kain & Bahan',
                  icon: <Package size={14} />,
                  bg: 'rgba(59, 130, 246, 0.1)',
                  border: 'rgba(59, 130, 246, 0.25)',
                  color: 'var(--status-sky)'
                };
              case 'produk_jadi':
                return {
                  label: 'Penerimaan Hasil Jahit',
                  icon: <Scissors size={14} />,
                  bg: 'rgba(34, 197, 94, 0.1)',
                  border: 'rgba(34, 197, 94, 0.25)',
                  color: 'var(--status-emerald)'
                };
              case 'retur':
                return {
                  label: 'Retur Bahan / Makloon',
                  icon: <RefreshCw size={14} />,
                  bg: 'rgba(245, 158, 11, 0.1)',
                  border: 'rgba(245, 158, 11, 0.25)',
                  color: 'var(--status-amber)'
                };
              default:
                return {
                  label: 'Transfer Internal',
                  icon: <FileText size={14} />,
                  bg: 'rgba(148, 163, 184, 0.1)',
                  border: 'rgba(148, 163, 184, 0.25)',
                  color: 'var(--text-muted)'
                };
            }
          };

          const getStateBadge = (state) => {
            switch (state) {
              case 'done':
                return { label: 'Selesai', bg: 'var(--status-emerald-bg)', border: 'var(--status-emerald-border)', color: 'var(--status-emerald)' };
              case 'assigned':
                return { label: 'Siap Kirim / Proses', bg: 'var(--status-sky-bg)', border: 'var(--status-sky-border)', color: 'var(--status-sky)' };
              case 'confirmed':
                return { label: 'Menunggu Bahan', bg: 'var(--status-amber-bg)', border: 'var(--status-amber-border)', color: 'var(--status-amber)' };
              case 'draft':
                return { label: 'Draft', bg: 'var(--bg-card-subtle)', border: 'var(--border-default)', color: 'var(--text-muted)' };
              default:
                return { label: state || 'Tercatat', bg: 'var(--bg-card-subtle)', border: 'var(--border-default)', color: 'var(--text-muted)' };
            }
          };

          const formatDateIndo = (dateStr) => {
            if (!dateStr) return '-';
            try {
              const d = new Date(dateStr);
              if (isNaN(d.getTime())) return String(dateStr);
              return d.toLocaleString('id-ID', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              }) + ' WIB';
            } catch (e) {
              return String(dateStr);
            }
          };

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="card" style={{ padding: '18px 20px', borderRadius: '16px' }}>
                {/* Header Bar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '10px',
                      background: 'rgba(59, 130, 246, 0.12)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--status-sky)',
                      flexShrink: 0
                    }}>
                      <Truck size={20} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '1.02rem', margin: 0, fontWeight: 800, color: 'var(--text-primary)' }}>
                        Dokumen Transfer Odoo ERP
                      </h3>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Daftar transfer resmi gudang & surat jalan tertaut MO #{order?.mo_name || order?.id}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={handleForceSyncOdoo}
                      disabled={syncingOdoo}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.76rem', padding: '6px 12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}
                      title="Perbarui status dokumen transfer langsung dari Odoo"
                    >
                      <RefreshCw size={13} className={syncingOdoo ? 'spinner' : ''} />
                      <span>{syncingOdoo ? 'Sinkron Odoo...' : 'Tarik Transfer Odoo'}</span>
                    </button>
                  </div>
                </div>

                {/* Filter Pills */}
                {transfers.length > 0 && (
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => setTransferFilter('all')}
                      className={`filter-pill ${transferFilter === 'all' ? 'active' : ''}`}
                      style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                    >
                      Semua ({transferCounts.all})
                    </button>
                    {transferCounts.komponen > 0 && (
                      <button
                        type="button"
                        onClick={() => setTransferFilter('komponen')}
                        className={`filter-pill ${transferFilter === 'komponen' ? 'active' : ''}`}
                        style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                      >
                        📦 Kain & Bahan ({transferCounts.komponen})
                      </button>
                    )}
                    {transferCounts.produkJadi > 0 && (
                      <button
                        type="button"
                        onClick={() => setTransferFilter('produk_jadi')}
                        className={`filter-pill ${transferFilter === 'produk_jadi' ? 'active' : ''}`}
                        style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                      >
                        👗 Penerimaan Jahit ({transferCounts.produkJadi})
                      </button>
                    )}
                    {transferCounts.retur > 0 && (
                      <button
                        type="button"
                        onClick={() => setTransferFilter('retur')}
                        className={`filter-pill ${transferFilter === 'retur' ? 'active' : ''}`}
                        style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                      >
                        🔁 Retur / Lainnya ({transferCounts.retur})
                      </button>
                    )}
                  </div>
                )}

                {/* Transfer Documents Cards List */}
                {filteredTransfers.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {filteredTransfers.map((t, idx) => {
                      const cat = getCategoryBadge(t.category);
                      const st = getStateBadge(t.state);
                      const isCopied = copiedTransferId === (t.id || t.name);

                      return (
                        <div
                          key={t.id || idx}
                          style={{
                            padding: '14px 16px',
                            background: 'var(--bg-card-subtle)',
                            borderRadius: '12px',
                            border: '1px solid var(--border-default)',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          {/* Row 1: Category badge, Transfer Number, Status Badge */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <span style={{
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                padding: '3px 8px',
                                borderRadius: '6px',
                                background: cat.bg,
                                border: `1px solid ${cat.border}`,
                                color: cat.color,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '5px'
                              }}>
                                {cat.icon}
                                <span>{cat.label}</span>
                              </span>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span className="mono-num" style={{ fontSize: '0.96rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                                  {t.name}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleCopyTransferName(t.name, t.id || t.name)}
                                  className="btn btn-secondary btn-icon"
                                  style={{ width: '26px', height: '26px', borderRadius: '6px', padding: 0 }}
                                  title="Salin nomor transfer"
                                >
                                  {isCopied ? <Check size={12} color="var(--status-emerald)" /> : <Copy size={12} />}
                                </button>
                                {isCopied && (
                                  <span style={{ fontSize: '0.68rem', color: 'var(--status-emerald)', fontWeight: 700 }}>
                                    Tersalin!
                                  </span>
                                )}
                              </div>
                            </div>

                            <span style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              padding: '3px 8px',
                              borderRadius: '6px',
                              background: st.bg,
                              border: `1px solid ${st.border}`,
                              color: st.color
                            }}>
                              {st.label}
                            </span>
                          </div>

                          {/* Row 2: Origin, Picking Type, Date */}
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                            gap: '8px',
                            fontSize: '0.78rem',
                            marginTop: '8px',
                            paddingTop: '8px',
                            borderTop: '1px dashed var(--border-default)'
                          }}>
                            <div>
                              <span style={{ color: 'var(--text-muted)' }}>Dokumen Rujukan:</span>{' '}
                              <strong className="mono-num" style={{ color: 'var(--text-primary)' }}>
                                {t.origin || '-'}
                              </strong>
                            </div>

                            <div>
                              <span style={{ color: 'var(--text-muted)' }}>Tipe Operasi:</span>{' '}
                              <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                                {t.pickingType || '-'}
                              </span>
                            </div>

                            <div>
                              <span style={{ color: 'var(--text-muted)' }}>
                                {t.state === 'done' ? 'Tanggal Selesai:' : 'Jadwal Transfer:'}
                              </span>{' '}
                              <strong style={{ color: 'var(--text-primary)' }}>
                                {formatDateIndo(t.dateDone || t.scheduledDate)}
                              </strong>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Empty state for transfers */
                  <div style={{
                    padding: '32px 20px',
                    textAlign: 'center',
                    background: 'var(--bg-card-subtle)',
                    borderRadius: '12px',
                    border: '1px dashed var(--border-default)'
                  }}>
                    <div style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '12px',
                      background: 'rgba(59, 130, 246, 0.1)',
                      color: 'var(--status-sky)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 12px'
                    }}>
                      <Truck size={24} />
                    </div>
                    <div style={{ fontSize: '0.94rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                      Tidak Ada Dokumen Transfer Odoo
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '420px', margin: '0 auto 14px', lineHeight: 1.5 }}>
                      SPK ini belum memiliki catatan transfer resmi stock.picking di Odoo ERP, atau dokumen transfer belum selesai dibuat di Gudang Pusat.
                    </p>
                    <button
                      type="button"
                      onClick={handleForceSyncOdoo}
                      disabled={syncingOdoo}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.8rem', padding: '8px 16px', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      <RefreshCw size={14} className={syncingOdoo ? 'spinner' : ''} />
                      <span>{syncingOdoo ? 'Memeriksa Odoo...' : 'Tarik Ulang dari Odoo'}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </main>



      {/* SAFETY CONFIRMATION & EXTREME DEVIATION MODAL */}
      {safetyModal.open && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '460px', padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '14px' }}>
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '12px',
                  background: safetyModal.isExtreme ? 'var(--status-rose-bg)' : 'var(--brand-gold-light)',
                  border: `1.5px solid ${safetyModal.isExtreme ? 'var(--status-rose-border)' : 'var(--brand-gold-border)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: safetyModal.isExtreme ? 'var(--status-rose)' : 'var(--brand-gold)',
                  flexShrink: 0
                }}
              >
                {safetyModal.isExtreme ? <ShieldAlert size={24} /> : <Lock size={22} />}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                  {safetyModal.title}
                </h3>
                <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  SPK #{order.id} • {order.mo_name}
                </p>
              </div>
            </div>

            {/* Comparison Metrics Grid */}
            <div className="comparison-card">
              <div className="comparison-box">
                <span className="comparison-box-label">Target SPK</span>
                <span className="comparison-box-value" style={{ fontSize: '1.05rem' }}>{safetyModal.targetVal}</span>
              </div>
              <div className="comparison-box" style={{ background: 'var(--bg-card)', borderRadius: '8px', padding: '4px' }}>
                <span className="comparison-box-label" style={{ color: safetyModal.isExtreme ? 'var(--status-rose)' : 'var(--brand-gold)' }}>
                  Input Anda
                </span>
                <span className="comparison-box-value" style={{ fontSize: '1.05rem', color: safetyModal.isExtreme ? 'var(--status-rose)' : 'var(--brand-gold)' }}>
                  {safetyModal.actualVal}
                </span>
              </div>
              <div className="comparison-box">
                <span className="comparison-box-label">Selisih</span>
                <span className="comparison-box-value" style={{
                  fontSize: '1.05rem',
                  color: safetyModal.isExtreme ? 'var(--status-rose)' : 'var(--text-primary)'
                }}>
                  {safetyModal.diffVal}
                </span>
              </div>
            </div>

            {/* Warning Message Box */}
            <div
              style={{
                padding: '12px 14px',
                borderRadius: '12px',
                background: safetyModal.isExtreme ? 'var(--status-rose-bg)' : 'var(--bg-card-subtle)',
                border: `1px solid ${safetyModal.isExtreme ? 'var(--status-rose-border)' : 'var(--border-default)'}`,
                fontSize: '0.82rem',
                lineHeight: 1.5,
                color: safetyModal.isExtreme ? 'var(--status-rose)' : 'var(--text-secondary)',
                marginBottom: '18px'
              }}
            >
              {safetyModal.isExtreme && (
                <div style={{ fontWeight: 800, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <AlertTriangle size={15} />
                  <span>PERINGATAN SELISIH EKSTREM</span>
                </div>
              )}
              <p style={{ margin: 0 }}>{safetyModal.warningMessage}</p>
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setSafetyModal((prev) => ({ ...prev, open: false }))}
                className="btn btn-secondary"
                style={{ flex: 1, height: '44px', borderRadius: '12px', fontWeight: 700 }}
              >
                Periksa Lagi
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  if (safetyModal.onConfirm) safetyModal.onConfirm();
                }}
                className={`btn ${safetyModal.isExtreme ? 'btn-danger' : 'btn-primary'}`}
                style={{ flex: 1.2, height: '44px', borderRadius: '12px', fontWeight: 800, fontSize: '0.88rem' }}
              >
                {saving ? 'Menyimpan...' : (safetyModal.isExtreme ? 'Ya, Simpan Data Ini' : 'Ya, Simpan Perubahan')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrderDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px', margin: '40px auto', maxWidth: '400px' }}>
          <div className="spinner" style={{ margin: '0 auto 16px' }}></div>
          <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Memuat detail SPK...</p>
        </div>
      }
    >
      <OrderDetailContent />
    </Suspense>
  );
}
