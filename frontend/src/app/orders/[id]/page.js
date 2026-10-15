'use client';

import { useState, useEffect, Suspense, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { fetchApi, getCurrentUser } from '@/lib/api';
import {
  ArrowLeft,
  Lock,
  Unlock,
  CheckCircle2,
  AlertTriangle,
  Scissors,
  Package,
  Layers,
  Send,
  RefreshCw,
  Info,
  Building2,
  Scale,
  FileText,
  AlertCircle,
  Clock,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  ChevronRight,
  Check,
  Tag,
  Zap,
  MessageCircle
} from 'lucide-react';

function OrderDetailContent() {
  const router = useRouter();
  const routeParams = useParams();
  const orderId = routeParams?.id;

  const [user, setUser] = useState(null);
  const [order, setOrder] = useState(null);
  const [rollLines, setRollLines] = useState([]);
  const [rawMoves, setRawMoves] = useState([]);
  const [activeTab, setActiveTab] = useState('timbang'); // 'timbang', 'hasil', 'bahan'
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({ text: '', type: '' });

  // Cutting stage state: actual cutting output & roll/material weights
  const [actualCutting, setActualCutting] = useState('');
  const [rollWeights, setRollWeights] = useState({});

  // Production results form state
  const [gradeA, setGradeA] = useState('');
  const [gradeB, setGradeB] = useState('');
  const [sisaKg, setSisaKg] = useState('');
  const [noSuratJalan, setNoSuratJalan] = useState('');

  // Unlock modal state (Master Admin)
  const [unlockModal, setUnlockModal] = useState({ open: false, type: '', reason: '' });

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
        setRollLines(res.rollLines || []);
        setRawMoves(res.rawMoves || res.order?.raw_moves || []);

        // Prepopulate cutting actual
        setActualCutting(
          res.order.actual_cutting !== null && res.order.actual_cutting !== undefined
            ? res.order.actual_cutting
            : ''
        );

        // Prepopulate cutting roll weights
        const weights = {};
        (res.rollLines || []).forEach((r) => {
          if (r.qty_berat_kg !== null && r.qty_berat_kg !== undefined) {
            weights[r.id] = r.qty_berat_kg;
          }
        });
        setRollWeights(weights);

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

  // Quick-Fill single accessory or fabric line with SPK standard
  const handleFillStandard = (lineId, qty) => {
    if (qty === undefined || qty === null) return;
    setRollWeights((prev) => ({
      ...prev,
      [lineId]: qty
    }));
  };

  // Quick-Fill ALL accessories with SPK standard in one tap
  const handleFillAllAccessories = () => {
    setRollWeights((prev) => {
      const updated = { ...prev };
      accessoryLines.forEach((line) => {
        if (line.qty !== undefined && line.qty !== null) {
          updated[line.id] = line.qty;
        }
      });
      return updated;
    });
  };

  // Quick-Fill Cutting Actual with Estimasi SPB
  const handleFillCuttingWithSpb = () => {
    if (estimasiSpb > 0) {
      setActualCutting(String(estimasiSpb));
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
        setFeedback({ text: 'Tahap hasil potong berhasil dikunci dan disinkronkan ke Odoo!', type: 'success' });
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
    const rolls = Object.entries(rollWeights).map(([lineId, weight]) => ({
      id: Number(lineId),
      line_id: Number(lineId),
      qty_berat_kg: parseFloat(weight) || 0
    }));

    if (inputActual === null && rolls.length === 0) {
      setFeedback({ text: 'Harap isi hasil potong aktual atau rincian bahan fisik terlebih dahulu.', type: 'error' });
      return;
    }

    const effectiveActual = inputActual !== null ? inputActual : totalPhysicalFabric;
    const targetRef = estimasiSpb > 0 ? estimasiSpb : targetSpkQty;
    const targetLabel = estimasiSpb > 0 ? 'target SPB' : 'target SPK';
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
      title: isExtreme ? 'Peringatan: Selisih Hasil Potong Ekstrem' : 'Konfirmasi Kunci Hasil Potong',
      targetVal: targetRef > 0 ? `${targetRef.toLocaleString('id-ID')} ${order?.unit_kain || 'pcs'}` : '-',
      actualVal: `${effectiveActual.toLocaleString('id-ID')} ${order?.unit_kain || 'pcs'}`,
      diffVal: targetRef > 0
        ? `${effectiveActual - targetRef > 0 ? '+' : ''}${(effectiveActual - targetRef).toFixed(2)} ${order?.unit_kain || 'pcs'}`
        : '0',
      warningMessage: isExtreme
        ? `Angka hasil potong yang Anda masukkan (${effectiveActual.toLocaleString('id-ID')}) berselisih ${devPct.toFixed(0)}% dari ${targetLabel} (${targetRef.toLocaleString('id-ID')}). Mohon periksa kembali apakah ada kesalahan ketik (contoh: kelebihan angka 0 atau salah kolom). Setelah dikunci, data ini langsung terkirim ke Odoo dan tidak dapat diubah oleh vendor.`
        : 'Pastikan seluruh input fisik sudah dicek. Setelah dikunci, data hasil potong akan tersimpan permanen di Odoo dan tahap jahit dapat dimulai.',
      onConfirm: () => executeSubmitCutting(inputActual, rolls)
    });
  };

  // Execute Submit Production Result (Called after safety modal confirmation)
  const executeSubmitProduction = async () => {
    setSaving(true);
    setSafetyModal((prev) => ({ ...prev, open: false }));
    setFeedback({ text: '', type: '' });

    try {
      const res = await fetchApi(`/pwa/orders/${orderId}/production-result`, {
        method: 'POST',
        body: JSON.stringify({
          qty_grade_a: parseFloat(gradeA) || 0,
          qty_grade_b: parseFloat(gradeB) || 0,
          sisa_makloon_kg: parseFloat(sisaKg) || 0,
          no_surat_jalan: noSuratJalan.trim()
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
      title: isExtreme ? 'Peringatan: Selisih Hasil Jahit Ekstrem' : 'Konfirmasi Kunci Hasil Jahit',
      targetVal: `${targetRef.toLocaleString('id-ID')} pcs`,
      actualVal: `${totalYield.toLocaleString('id-ID')} pcs (Grade A: ${valA}, Grade B: ${valB})`,
      diffVal: `${totalYield - targetRef > 0 ? '+' : ''}${(totalYield - targetRef).toFixed(0)} pcs`,
      warningMessage: isExtreme
        ? (valB > valA
            ? `Perhatian: Jumlah Grade B / BS (${valB} pcs) lebih banyak dari Grade A (${valA} pcs). Mohon periksa apakah kolom tertukar sebelum mengunci SPK menjadi Selesai.`
            : `Total hasil jahit (${totalYield} pcs) berselisih ${devPct.toFixed(0)}% dari target SPK (${targetRef} pcs). Pastikan bukan salah ketik sebelum data dikunci permanen ke Odoo.`)
        : 'Pastikan seluruh jumlah fisik sudah sesuai dengan surat jalan. Setelah dikunci, status SPK akan menjadi Selesai dan tidak dapat diubah sendiri.',
      onConfirm: executeSubmitProduction
    });
  };

  // Master Admin Unlock Handler
  const handleUnlock = async () => {
    if (!unlockModal.reason.trim()) {
      alert('Alasan buka kunci wajib diisi untuk catatan audit trail.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetchApi(`/pwa/orders/${orderId}/unlock`, {
        method: 'POST',
        body: JSON.stringify({
          stage: unlockModal.type,
          reason: unlockModal.reason.trim()
        })
      });

      if (res.success) {
        setFeedback({ text: `Kunci tahap ${unlockModal.type} berhasil dibuka oleh Master Admin.`, type: 'success' });
        setUnlockModal({ open: false, type: '', reason: '' });
        loadData();
      } else {
        alert(res.message || 'Gagal membuka kunci.');
      }
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Material lines segmentation: Kain (Fabric) vs Aksesoris/Pelengkap
  const fabricLines = useMemo(() => {
    return rollLines.filter((l) => l.line_type === 'kain' || (!l.line_type && (l.nama_item || '').toLowerCase().includes('kain')));
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

  const estimasiSpb = parseFloat(order?.estimasi_dari_spb || 0);

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
    return currentActualCutting - estimasiSpb;
  }, [currentActualCutting, estimasiSpb]);

  const cuttingRatio = useMemo(() => {
    if (!estimasiSpb || estimasiSpb <= 0) return null;
    return Math.round((currentActualCutting / estimasiSpb) * 100);
  }, [currentActualCutting, estimasiSpb]);

  const totalYieldPcs = useMemo(() => {
    return (parseFloat(gradeA) || 0) + (parseFloat(gradeB) || 0);
  }, [gradeA, gradeB]);

  const targetSpkQty = useMemo(() => {
    return Number(order?.qty_target || order?.qty_spk || 0);
  }, [order]);

  const yieldPercentage = useMemo(() => {
    if (!targetSpkQty || targetSpkQty <= 0) return '0.0';
    return ((totalYieldPcs / targetSpkQty) * 100).toFixed(1);
  }, [targetSpkQty, totalYieldPcs]);

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
  const isCuttingLocked = Boolean(order.cutting_locked_at) || isBackorder;
  const isResultLocked = Boolean(order.result_locked_at);
  const isMasterAdmin = user?.role === 'master_admin';
  const canEditCutting = !isCuttingLocked && ['master_admin', 'master_vendor', 'admin_vendor'].includes(user?.role);
  const canEditResult = isCuttingLocked && !isResultLocked && ['master_admin', 'master_vendor', 'admin_vendor'].includes(user?.role);

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
              {isResultLocked ? (
                <span className="badge badge-emerald" style={{ fontSize: '0.7rem' }}><CheckCircle2 size={13} /> Selesai</span>
              ) : isCuttingLocked ? (
                <span className="badge badge-sky" style={{ fontSize: '0.7rem' }}><Lock size={13} /> Sedang Jahit</span>
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
            <div className="hero-tile" style={{ background: '#fffdf7', borderColor: '#fde68a' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.7rem', fontWeight: 700, color: 'var(--brand-gold)', textTransform: 'uppercase' }}>
                <span>🎯 Target SPK</span>
              </div>
              <div className="mono-num" style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--brand-gold)', lineHeight: 1.1 }}>
                {targetSpkQty.toLocaleString('id-ID')} <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>pcs</span>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                Target output garmen
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

            {/* Tile 3: Kecukupan Kain */}
            <div className="hero-tile" style={{
              background: order.status_kebutuhan_kain === 'Cukup' ? 'var(--status-emerald-bg)' : 'var(--status-amber-bg)',
              borderColor: order.status_kebutuhan_kain === 'Cukup' ? 'var(--status-emerald-border)' : 'var(--status-amber-border)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: order.status_kebutuhan_kain === 'Cukup' ? 'var(--status-emerald)' : 'var(--status-amber)' }}>
                <span
                  className="pulse-dot"
                  style={{ background: order.status_kebutuhan_kain === 'Cukup' ? '#059669' : '#d97706' }}
                />
                <span>Kecukupan Kain</span>
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: order.status_kebutuhan_kain === 'Cukup' ? 'var(--status-emerald)' : 'var(--status-amber)', lineHeight: 1.1 }}>
                {order.status_kebutuhan_kain || 'Cukup'}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                {order.status_kebutuhan_kain === 'Cukup' ? 'Stok kain aman' : 'Periksa fisik bahan'}
              </div>
            </div>
          </div>
        </div>

        {/* Operational Segmented Tabs (Apple / Linear Pill Style) */}
        <div className="segmented-tabs-wrapper">
          <button
            onClick={() => setActiveTab('timbang')}
            className={`segmented-tab-btn ${activeTab === 'timbang' ? 'active' : ''}`}
          >
            <Scissors size={15} className="tab-icon" />
            <span>1. Hasil Potong {rollLines.length > 0 ? `(${rollLines.length})` : ''}</span>
          </button>

          <button
            onClick={() => setActiveTab('hasil')}
            className={`segmented-tab-btn ${activeTab === 'hasil' ? 'active' : ''}`}
          >
            <Package size={15} className="tab-icon" />
            <span>2. Hasil Jahit</span>
          </button>

          <button
            onClick={() => setActiveTab('bahan')}
            className={`segmented-tab-btn ${activeTab === 'bahan' ? 'active' : ''}`}
          >
            <Layers size={15} className="tab-icon" />
            <span>
              3. Bahan BOM {(rawMoves.length > 0 || (order?.raw_moves && order.raw_moves.length > 0)) ? `(${rawMoves.length || order?.raw_moves?.length})` : ''}
            </span>
          </button>
        </div>

        {/* ==================================================================
            TAB 1: HASIL POTONG & RINCIAN BAHAN BAKU
            ================================================================== */}
        {activeTab === 'timbang' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Stage Status Card */}
            <div
              className="card"
              style={{
                padding: '14px 18px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
                background: isCuttingLocked
                  ? 'linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%)'
                  : 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
                borderColor: isCuttingLocked ? 'var(--status-emerald-border)' : 'var(--status-amber-border)',
                borderRadius: '14px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '10px',
                    background: isCuttingLocked ? 'var(--status-emerald)' : 'var(--brand-gold)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                    flexShrink: 0,
                    boxShadow: 'var(--shadow-subtle)'
                  }}
                >
                  {isCuttingLocked ? <Lock size={18} /> : <Scissors size={18} />}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: '0.94rem', color: 'var(--text-primary)' }}>
                    {isCuttingLocked ? 'Tahap Hasil Potong Terkunci' : 'Tahap 1: Verifikasi Hasil Potong & Bahan'}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    {isCuttingLocked
                      ? `Tersinkron ke Odoo: ${order.cutting_locked_at ? new Date(order.cutting_locked_at).toLocaleString('id-ID') : 'Otomatis'}`
                      : 'Input fisik hasil potong dan verifikasi bahan baku sebelum masuk proses jahit.'}
                  </div>
                </div>
              </div>

              {isMasterAdmin && isCuttingLocked && !isBackorder && (
                <button
                  type="button"
                  onClick={() => setUnlockModal({ open: true, type: 'cutting', reason: '' })}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.78rem', padding: '6px 12px', flexShrink: 0, borderRadius: '8px' }}
                >
                  <Unlock size={14} />
                  <span>Buka Kunci</span>
                </button>
              )}
            </div>

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

              {/* Alert Banner if Status Kebutuhan Kain Kurang */}
              {order.status_kebutuhan_kain === 'Kurang' && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 16px',
                    marginBottom: '16px',
                    background: '#fef2f2',
                    border: '1.5px solid #fca5a5',
                    borderRadius: '12px',
                    color: '#991b1b'
                  }}
                >
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: '#fee2e2',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      color: '#dc2626'
                    }}
                  >
                    <AlertCircle size={20} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0, fontSize: '0.86rem', lineHeight: 1.4 }}>
                    <strong>Perhatian: Total Kain Diterima Kurang!</strong>
                    <div style={{ fontSize: '0.8rem', color: '#b91c1c', marginTop: '2px' }}>
                      Kain diterima: <strong>{Number(order.kain_dari_gudang || 0).toLocaleString('id-ID')} {order.unit_kain || 'kg'}</strong> (Kebutuhan standar SPK: <strong>{Number(order.qty_kebutuhan_kain || 0).toLocaleString('id-ID')} {order.unit_kain || 'kg'}</strong>). Harap periksa fisik kain sebelum memotong.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleAskWaKainKurang}
                    className="btn"
                    style={{
                      background: '#25D366',
                      color: '#ffffff',
                      border: 'none',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      padding: '8px 12px',
                      borderRadius: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      flexShrink: 0,
                      boxShadow: '0 2px 6px rgba(37, 211, 102, 0.35)',
                      cursor: 'pointer'
                    }}
                    title="Laporkan kendala kain kurang ke WhatsApp Group"
                  >
                    <MessageCircle size={15} />
                    <span>Tanya di WA</span>
                  </button>
                </div>
              )}

              {/* 3 Metric Tiles Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
                {/* 1. Estimasi SPB */}
                <div className="hero-tile">
                  <div className="metric-label" style={{ fontSize: '0.7rem' }}>🎯 Estimasi dari SPB</div>
                  <div className="mono-num" style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                    {estimasiSpb.toLocaleString('id-ID')} <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>{order.unit_kain || 'pcs'}</span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    Target rujukan SPB
                  </div>
                </div>

                {/* 2. Hasil Cutting Aktual Input */}
                <div className="hero-tile" style={{ background: '#fffdf7', borderColor: '#fde68a' }}>
                  <div className="metric-label" style={{ fontSize: '0.7rem', color: 'var(--brand-gold)' }}>✂️ Hasil Potong Fisik</div>
                  {canEditCutting ? (
                    <div>
                      <div className="input-addon-group" style={{ height: '42px', borderColor: actualCutting ? 'var(--brand-gold)' : 'var(--border-strong)' }}>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          disabled={saving}
                          placeholder={estimasiSpb > 0 ? String(estimasiSpb) : '0'}
                          value={actualCutting}
                          onChange={(e) => setActualCutting(e.target.value)}
                          className="input-addon-field"
                          style={{ fontSize: '1.25rem', fontWeight: 800 }}
                        />
                        <span className="input-addon-label">
                          {order.unit_kain || 'PCS'}
                        </span>
                      </div>
                      {estimasiSpb > 0 && actualCutting === '' && (
                        <button
                          type="button"
                          onClick={handleFillCuttingWithSpb}
                          className="quick-action-pill quick-action-pill-amber"
                          style={{ marginTop: '6px', width: '100%', fontSize: '0.7rem' }}
                          title="Isi otomatis dengan target SPB"
                        >
                          <Zap size={11} />
                          <span>Pakai Target SPB ({estimasiSpb})</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="mono-num" style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--brand-gold)', lineHeight: 1.2 }}>
                      {(parseFloat(order.actual_cutting) || currentActualCutting).toLocaleString('id-ID')}{' '}
                      <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>{order.unit_kain || 'pcs'}</span>
                    </div>
                  )}
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Output riil meja potong
                  </div>
                </div>

                {/* 3. Selisih Hasil Potong */}
                <div className="hero-tile">
                  <div className="metric-label" style={{ fontSize: '0.7rem' }}>⚖️ Selisih Output</div>
                  <div className="mono-num" style={{
                    fontSize: '1.35rem',
                    fontWeight: 800,
                    lineHeight: 1.2,
                    color: selisihCutting > 0 ? 'var(--status-emerald)' : selisihCutting < 0 ? 'var(--status-rose)' : 'var(--text-primary)'
                  }}>
                    {selisihCutting > 0 ? `+${selisihCutting.toFixed(2)}` : selisihCutting.toFixed(2)}{' '}
                    <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>{order.unit_kain || 'pcs'}</span>
                  </div>
                  <div style={{ marginTop: '2px' }}>
                    {selisihCutting === 0 ? (
                      <span className="badge badge-emerald" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>✓ Sesuai Target SPB</span>
                    ) : selisihCutting > 0 ? (
                      <span className="badge badge-emerald" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>▲ Hasil Potong Lebih</span>
                    ) : (
                      <span className="badge badge-amber" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>▼ Hasil Potong Kurang</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Visual Progress Bar (Ratio vs Target SPB) */}
              {cuttingRatio !== null && (
                <div style={{ marginTop: '14px', padding: '10px 14px', background: 'var(--bg-card-subtle)', borderRadius: '12px', border: '1px solid var(--border-default)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontSize: '0.78rem' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Rasio Pemenuhan Potong vs Target:</span>
                    <strong className="mono-num" style={{ color: cuttingRatio >= 100 ? 'var(--status-emerald)' : 'var(--brand-gold)', fontSize: '0.85rem' }}>
                      {cuttingRatio}%
                    </strong>
                  </div>
                  <div style={{ width: '100%', height: '8px', background: '#e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min(100, Math.max(0, cuttingRatio))}%`,
                        height: '100%',
                        background: cuttingRatio >= 100 ? 'linear-gradient(90deg, #10b981, #059669)' : 'linear-gradient(90deg, #f59e0b, #d97706)',
                        borderRadius: '10px',
                        transition: 'width 0.4s ease'
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* SECTION 1: BAHAN KAIN (FABRIC ROLLS) IF PRESENT */}
            {fabricLines.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px' }}>
                  <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    🧵 Rincian Bahan Kain ({fabricLines.length} baris)
                  </span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    Total Fisik: <strong className="mono-num" style={{ color: 'var(--brand-gold)', fontWeight: 800 }}>{totalPhysicalFabric.toFixed(2)} {getLineUom(fabricLines[0])}</strong>
                  </span>
                </div>

                {fabricLines.map((line, idx) => {
                  const lineUom = getLineUom(line);
                  const lineLabel = getLineLabel(line);

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
                          Estimasi Standar: <strong className="mono-num" style={{ color: 'var(--text-primary)' }}>{line.qty || 0} {lineUom}</strong>
                        </div>
                      </div>

                      <div className="roll-input-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {canEditCutting && line.qty > 0 && (
                          <button
                            type="button"
                            onClick={() => handleFillStandard(line.id, line.qty)}
                            className={`quick-action-pill ${parseFloat(rollWeights[line.id]) === parseFloat(line.qty) ? 'quick-action-pill-emerald' : ''}`}
                            style={{ fontSize: '0.68rem', padding: '2px 8px' }}
                            title="Gunakan estimasi standar SPK"
                          >
                            {parseFloat(rollWeights[line.id]) === parseFloat(line.qty) ? (
                              <>
                                <Check size={11} />
                                <span>Sesuai SPK</span>
                              </>
                            ) : (
                              <>
                                <Zap size={11} />
                                <span>Pakai SPK ({line.qty})</span>
                              </>
                            )}
                          </button>
                        )}
                        <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                          {lineLabel}:
                        </label>
                        <div style={{ width: '140px' }}>
                          <div className="input-addon-group" style={{ height: '40px', borderColor: rollWeights[line.id] ? 'var(--brand-gold)' : 'var(--border-strong)' }}>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              disabled={!canEditCutting || saving}
                              placeholder="0.00"
                              value={rollWeights[line.id] !== undefined ? rollWeights[line.id] : ''}
                              onChange={(e) => handleWeightChange(line.id, e.target.value)}
                              className="input-addon-field"
                              style={{ fontSize: '1rem', fontWeight: 800 }}
                            />
                            <span className="input-addon-label" style={{ fontSize: '0.7rem', padding: '0 8px' }}>
                              {lineUom}
                            </span>
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
                      title="Isi semua baris aksesoris sekaligus sesuai standar SPK"
                    >
                      <Zap size={12} />
                      <span>Isi Semua Standar SPK</span>
                    </button>
                  )}
                </div>

                {accessoryLines.map((line, idx) => {
                  const lineUom = getLineUom(line);

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
                          Estimasi SPK: <strong className="mono-num" style={{ color: 'var(--text-primary)' }}>{line.qty || 0} {lineUom}</strong>
                        </div>
                      </div>

                      <div className="roll-input-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {canEditCutting && line.qty !== undefined && line.qty !== null && (
                          <button
                            type="button"
                            onClick={() => handleFillStandard(line.id, line.qty)}
                            className={`quick-action-pill ${parseFloat(rollWeights[line.id]) === parseFloat(line.qty) ? 'quick-action-pill-emerald' : ''}`}
                            style={{ fontSize: '0.68rem', padding: '2px 8px' }}
                            title="Gunakan estimasi standar SPK"
                          >
                            {parseFloat(rollWeights[line.id]) === parseFloat(line.qty) ? (
                              <>
                                <Check size={11} />
                                <span>Sesuai SPK</span>
                              </>
                            ) : (
                              <>
                                <Zap size={11} />
                                <span>Pakai SPK ({line.qty || 0})</span>
                              </>
                            )}
                          </button>
                        )}
                        <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                          JUMLAH FISIK:
                        </label>
                        <div style={{ width: '140px' }}>
                          <div className="input-addon-group" style={{ height: '40px', borderColor: rollWeights[line.id] ? 'var(--brand-gold)' : 'var(--border-strong)' }}>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              disabled={!canEditCutting || saving}
                              placeholder={line.qty ? String(line.qty) : '0'}
                              value={rollWeights[line.id] !== undefined ? rollWeights[line.id] : ''}
                              onChange={(e) => handleWeightChange(line.id, e.target.value)}
                              className="input-addon-field"
                              style={{ fontSize: '1rem', fontWeight: 800 }}
                            />
                            <span className="input-addon-label" style={{ fontSize: '0.7rem', padding: '0 8px' }}>
                              {lineUom}
                            </span>
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
                  <Lock size={18} />
                  <span>{saving ? 'Mengunci...' : 'Kunci & Simpan Hasil Potong'}</span>
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
            {/* Cutting Lock Warning */}
            {!isCuttingLocked && (
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  background: 'var(--status-amber-bg)',
                  border: '1.5px solid var(--status-amber-border)',
                  color: 'var(--status-amber)',
                  fontSize: '0.84rem'
                }}
              >
                <AlertCircle size={20} style={{ flexShrink: 0 }} />
                <span>
                  <strong>Perhatian:</strong> Kunci tahap hasil potong terlebih dahulu sebelum mengunci hasil jahit.
                </span>
              </div>
            )}

            {/* Stage Status Card */}
            <div
              className="card"
              style={{
                padding: '14px 18px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
                background: isResultLocked
                  ? 'linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%)'
                  : 'var(--bg-card)',
                borderColor: isResultLocked ? 'var(--status-emerald-border)' : 'var(--border-default)',
                borderRadius: '14px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '10px',
                    background: isResultLocked ? 'var(--status-emerald)' : 'var(--brand-gold)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                    flexShrink: 0,
                    boxShadow: 'var(--shadow-subtle)'
                  }}
                >
                  {isResultLocked ? <CheckCircle2 size={20} /> : <Package size={20} />}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: '0.94rem', color: 'var(--text-primary)' }}>
                    {isResultLocked ? 'Hasil Jahit Terkunci (Selesai)' : 'Tahap 2: Input Hasil Produksi Jahit'}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    {isResultLocked
                      ? `Tersinkron ke Odoo: ${order.result_locked_at ? new Date(order.result_locked_at).toLocaleString('id-ID') : '-'}`
                      : 'Input Grade A, Grade B, sisa kain (BSKL), serta nomor surat jalan.'}
                  </div>
                </div>
              </div>

              {isMasterAdmin && isResultLocked && (
                <button
                  type="button"
                  onClick={() => setUnlockModal({ open: true, type: 'result', reason: '' })}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.78rem', padding: '6px 12px', flexShrink: 0, borderRadius: '8px' }}
                >
                  <Unlock size={14} />
                  <span>Buka Kunci</span>
                </button>
              )}
            </div>

            {/* Yield Summary Calculator */}
            <div className="card" style={{ padding: '16px 18px', borderRadius: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', textAlign: 'center' }}>
                <div className="hero-tile">
                  <div className="metric-label" style={{ fontSize: '0.68rem' }}>Target SPK</div>
                  <div className="mono-num" style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {targetSpkQty.toLocaleString('id-ID')} <span style={{ fontSize: '0.75rem', fontWeight: 400 }}>pcs</span>
                  </div>
                </div>
                <div className="hero-tile" style={{ background: '#fffdf7', borderColor: '#fde68a' }}>
                  <div className="metric-label" style={{ fontSize: '0.68rem', color: 'var(--brand-gold)' }}>Total Hasil Jahit</div>
                  <div className="mono-num" style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--brand-gold)' }}>
                    {totalYieldPcs.toLocaleString('id-ID')} <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>pcs</span>
                  </div>
                </div>
                <div className="hero-tile">
                  <div className="metric-label" style={{ fontSize: '0.68rem' }}>Rasio Yield</div>
                  <div className="mono-num" style={{
                    fontSize: '1.35rem',
                    fontWeight: 800,
                    color: parseFloat(yieldPercentage) >= 95 ? 'var(--status-emerald)' : 'var(--brand-gold)'
                  }}>
                    {yieldPercentage}%
                  </div>
                </div>
              </div>

              {/* Yield Progress Bar */}
              <div style={{ marginTop: '14px', padding: '10px 14px', background: 'var(--bg-card-subtle)', borderRadius: '12px', border: '1px solid var(--border-default)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontSize: '0.78rem' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Status Efisiensi Jahit:</span>
                  <span className={`badge ${parseFloat(yieldPercentage) >= 95 ? 'badge-emerald' : 'badge-amber'}`}>
                    {parseFloat(yieldPercentage) >= 95 ? '✓ Target Tercapai' : 'Perlu Dioptimalkan'}
                  </span>
                </div>
                <div style={{ width: '100%', height: '8px', background: '#e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(0, parseFloat(yieldPercentage)))}%`,
                      height: '100%',
                      background: parseFloat(yieldPercentage) >= 95 ? 'linear-gradient(90deg, #10b981, #059669)' : 'linear-gradient(90deg, #f59e0b, #d97706)',
                      borderRadius: '10px',
                      transition: 'width 0.4s ease'
                    }}
                  />
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

                {/* Sisa Makloon with Steppers */}
                <div>
                  <label className="form-label" style={{ marginBottom: '6px', fontWeight: 700 }}>Sisa Makloon (Kg)</label>
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
                    <span>{saving ? 'Menyimpan...' : 'Kunci & Selesaikan Hasil Jahit'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================================================================
            TAB 3: KOMPONEN BAHAN BAKU BOM
            ================================================================== */}
        {activeTab === 'bahan' && (() => {
          const movesList = (rawMoves && rawMoves.length > 0) ? rawMoves : (order?.raw_moves || []);
          const hasMoves = movesList.length > 0;
          const hasRollLines = rollLines && rollLines.length > 0;

          const getMoveStateBadge = (state) => {
            switch (state) {
              case 'assigned':
                return { label: 'Tersedia / Siap', bg: 'rgba(34, 197, 94, 0.12)', border: 'rgba(34, 197, 94, 0.25)', color: 'var(--status-emerald)' };
              case 'partially_available':
                return { label: 'Tersedia Sebagian', bg: 'rgba(234, 179, 8, 0.12)', border: 'rgba(234, 179, 8, 0.25)', color: 'var(--status-amber)' };
              case 'confirmed':
                return { label: 'Menunggu Ketersediaan', bg: 'rgba(59, 130, 246, 0.12)', border: 'rgba(59, 130, 246, 0.25)', color: 'var(--status-sky)' };
              case 'done':
                return { label: 'Selesai', bg: 'rgba(168, 85, 247, 0.12)', border: 'rgba(168, 85, 247, 0.25)', color: '#a855f7' };
              case 'draft':
                return { label: 'Draft', bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.25)', color: 'var(--text-muted)' };
              default:
                return { label: state || 'Tercatat', bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.25)', color: 'var(--text-muted)' };
            }
          };

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="card" style={{ padding: '18px 20px', borderRadius: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: 'rgba(217, 119, 6, 0.12)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--brand-gold)'
                    }}>
                      <Layers size={18} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '1.02rem', margin: 0, fontWeight: 800, color: 'var(--text-primary)' }}>
                        Daftar Komponen Material dari Odoo ERP
                      </h3>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Bill of Materials (BOM) & Pergerakan Stok Bahan Baku MO #{order?.mo_name || order?.id}
                      </div>
                    </div>
                  </div>
                  {hasMoves && (
                    <span style={{
                      fontSize: '0.76rem',
                      fontWeight: 700,
                      padding: '4px 10px',
                      borderRadius: '20px',
                      background: 'rgba(34, 197, 94, 0.12)',
                      border: '1px solid rgba(34, 197, 94, 0.25)',
                      color: 'var(--status-emerald)'
                    }}>
                      {movesList.length} Material Terdaftar
                    </span>
                  )}
                </div>

                {/* LAYER 1: Odoo stock.move available */}
                {hasMoves ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {movesList.map((move, i) => {
                      const st = getMoveStateBadge(move.state);
                      const productName = move.product_id
                        ? (Array.isArray(move.product_id) ? move.product_id[1] : move.product_id)
                        : 'Item Material';
                      const uomName = move.product_uom
                        ? (Array.isArray(move.product_uom) ? move.product_uom[1] : move.product_uom)
                        : 'Unit';

                      return (
                        <div
                          key={move.id || i}
                          style={{
                            padding: '14px 16px',
                            background: 'var(--bg-card-subtle)',
                            borderRadius: '12px',
                            border: '1px solid var(--border-default)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '14px',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{
                              fontWeight: 700,
                              fontSize: '0.9rem',
                              color: 'var(--text-primary)',
                              lineHeight: 1.35,
                              marginBottom: '6px'
                            }}>
                              {productName}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <span style={{
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                padding: '2px 8px',
                                borderRadius: '6px',
                                background: st.bg,
                                border: `1px solid ${st.border}`,
                                color: st.color
                              }}>
                                {st.label}
                              </span>
                              {move.quantity !== undefined && move.quantity !== null && Number(move.quantity) > 0 && Number(move.quantity) !== Number(move.product_uom_qty) && (
                                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                                  Alokasi fisik: <strong style={{ color: 'var(--text-primary)' }}>{move.quantity} {uomName}</strong>
                                </span>
                              )}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div className="mono-num" style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--brand-gold)' }}>
                              {move.product_uom_qty || 0}
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                              {uomName}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : hasRollLines ? (
                  /* LAYER 2: Fallback to assigned roll lines */
                  <div>
                    <div style={{
                      padding: '10px 14px',
                      background: 'rgba(59, 130, 246, 0.08)',
                      borderRadius: '10px',
                      border: '1px solid rgba(59, 130, 246, 0.2)',
                      fontSize: '0.82rem',
                      color: 'var(--status-sky)',
                      marginBottom: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <Info size={16} />
                      <span>Data BOM Odoo umum. Komponen kain dialokasikan melalui rincian roll berikut:</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {rollLines.map((r, i) => (
                        <div
                          key={r.id || i}
                          style={{
                            padding: '12px 14px',
                            background: 'var(--bg-card-subtle)',
                            borderRadius: '10px',
                            border: '1px solid var(--border-default)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '12px'
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                              {r.nama_item || 'Kain Roll'}
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                              Lot: <span className="mono-num" style={{ fontWeight: 600 }}>{r.kode_lot || '-'}</span>
                            </div>
                          </div>
                          <div className="mono-num" style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--brand-gold)' }}>
                            {r.qty || 0} {r.uom || 'Meter'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* LAYER 3: Global SPK Material Summary Card */
                  <div style={{
                    padding: '16px',
                    background: 'var(--bg-card-subtle)',
                    borderRadius: '12px',
                    border: '1px dashed var(--border-default)'
                  }}>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', margin: '0 0 14px 0', lineHeight: 1.5 }}>
                      SPK ini menggunakan alokasi material global tanpa pergerakan stock move individual di Odoo.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                      <div style={{ padding: '10px 12px', background: 'var(--bg-page)', borderRadius: '8px', border: '1px solid var(--border-default)' }}>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Kebutuhan Kain</div>
                        <div className="mono-num" style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
                          {order?.qty_kebutuhan_kain || 0} {order?.unit_kain || 'Meter'}
                        </div>
                      </div>
                      <div style={{ padding: '10px 12px', background: 'var(--bg-page)', borderRadius: '8px', border: '1px solid var(--border-default)' }}>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Kain dari Gudang</div>
                        <div className="mono-num" style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--brand-gold)', marginTop: '2px' }}>
                          {order?.kain_dari_gudang || 0} {order?.unit_kain || 'Meter'}
                        </div>
                      </div>
                      <div style={{ padding: '10px 12px', background: 'var(--bg-page)', borderRadius: '8px', border: '1px solid var(--border-default)' }}>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Status Kebutuhan</div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: (order?.status_kebutuhan_kain || '').includes('Kurang') ? 'var(--status-rose)' : 'var(--status-emerald)', marginTop: '2px' }}>
                          {order?.status_kebutuhan_kain || 'Normal'}
                        </div>
                      </div>
                      <div style={{ padding: '10px 12px', background: 'var(--bg-page)', borderRadius: '8px', border: '1px solid var(--border-default)' }}>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Aksesoris Gudang</div>
                        <div className="mono-num" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px' }}>
                          {order?.accessories_dari_gudang || '-'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </main>

      {/* UNLOCK MODAL (MASTER ADMIN ONLY) */}
      {unlockModal.open && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <ShieldAlert size={24} color="var(--status-rose)" />
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>
                Konfirmasi Buka Kunci {unlockModal.type.toUpperCase()}
              </h3>
            </div>

            <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
              Tindakan ini akan mengizinkan pengubahan ulang data. Alasan wajib diisi dan akan dicatat di <strong>Audit Trail</strong>.
            </p>

            <div style={{ marginBottom: '18px' }}>
              <label className="form-label">Alasan Buka Kunci (Wajib)</label>
              <textarea
                rows={3}
                required
                placeholder="Contoh: Koreksi berat fisik timbangan roll..."
                className="input-field"
                value={unlockModal.reason}
                onChange={(e) => setUnlockModal((m) => ({ ...m, reason: e.target.value }))}
                style={{ resize: 'none' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setUnlockModal({ open: false, type: '', reason: '' })}
                className="btn btn-secondary"
                style={{ flex: 1, borderRadius: '10px' }}
              >
                Batal
              </button>
              <button
                type="button"
                disabled={saving || !unlockModal.reason.trim()}
                onClick={handleUnlock}
                className="btn btn-danger"
                style={{ flex: 1, borderRadius: '10px' }}
              >
                {saving ? 'Membuka...' : 'Buka Kunci'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                <span className="comparison-box-label">Target Rujukan</span>
                <span className="comparison-box-value" style={{ fontSize: '1.05rem' }}>{safetyModal.targetVal}</span>
              </div>
              <div className="comparison-box" style={{ background: '#ffffff', borderRadius: '8px', padding: '4px' }}>
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
                background: safetyModal.isExtreme ? '#fff1f2' : '#f8fafc',
                border: `1px solid ${safetyModal.isExtreme ? '#fecdd3' : '#e2e8f0'}`,
                fontSize: '0.82rem',
                lineHeight: 1.5,
                color: safetyModal.isExtreme ? '#9f1239' : 'var(--text-secondary)',
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
                {saving ? 'Mengunci...' : safetyModal.isExtreme ? 'Ya, Kunci Data Ini' : 'Ya, Kunci Sekarang'}
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
