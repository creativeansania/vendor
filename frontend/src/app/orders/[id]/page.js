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
  Tag
} from 'lucide-react';

function OrderDetailContent() {
  const router = useRouter();
  const routeParams = useParams();
  const orderId = routeParams?.id;

  const [user, setUser] = useState(null);
  const [order, setOrder] = useState(null);
  const [rollLines, setRollLines] = useState([]);
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

  // Handle Roll Weight Change
  const handleWeightChange = (lineId, value) => {
    setRollWeights((prev) => ({
      ...prev,
      [lineId]: value
    }));
  };

  // Submit Cutting Stage
  const handleSubmitCutting = async () => {
    const inputActual = actualCutting !== '' ? parseFloat(actualCutting) : null;
    const rolls = Object.entries(rollWeights).map(([lineId, weight]) => ({
      id: Number(lineId),
      line_id: Number(lineId),
      qty_berat_kg: parseFloat(weight) || 0
    }));

    if (inputActual === null && rolls.length === 0) {
      alert('Harap isi hasil potong aktual atau rincian bahan fisik.');
      return;
    }

    if (!confirm('Apakah Anda yakin ingin MENGUNCI dan menyimpan hasil potong ini? Setelah dikunci, data tidak dapat diubah.')) {
      return;
    }

    setSaving(true);
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

  // Submit Production Results
  const handleSubmitProduction = async () => {
    if (!gradeA && !gradeB) {
      alert('Harap isi minimal jumlah Grade A atau Grade B.');
      return;
    }

    if (!confirm('Apakah Anda yakin ingin MENGUNCI hasil jahit ini? Status SPK akan menjadi Selesai.')) {
      return;
    }

    setSaving(true);
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
            <p style={{ margin: '1px 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              SO: <strong>{order.source_document || order.sales_order || '-'}</strong> • {order.vendor_name}
            </p>
          </div>
        </div>

        <button
          onClick={loadData}
          className="btn btn-secondary btn-icon"
          style={{ flexShrink: 0, borderRadius: '10px' }}
          title="Segarkan Data"
          disabled={loading}
        >
          <RefreshCw size={15} className={loading ? 'spinner' : ''} />
        </button>
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
            <span>3. Bahan BOM</span>
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

                      <div className="roll-input-row">
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px' }}>
                  <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    🏷️ Aksesoris & Bahan Pelengkap ({accessoryLines.length} item)
                  </span>
                  <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                    Verifikasi fisik & pemakaian
                  </span>
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

                      <div className="roll-input-row">
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
                  onClick={handleSubmitCutting}
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
                <div>
                  <label className="form-label">Grade A (Pcs)</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    disabled={!canEditResult || saving}
                    placeholder="0"
                    value={gradeA}
                    onChange={(e) => setGradeA(e.target.value)}
                    className="input-field mono-num"
                    style={{ fontSize: '1.15rem', fontWeight: 800, height: '44px', textAlign: 'right' }}
                  />
                </div>

                <div>
                  <label className="form-label">Grade B (Pcs)</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    disabled={!canEditResult || saving}
                    placeholder="0"
                    value={gradeB}
                    onChange={(e) => setGradeB(e.target.value)}
                    className="input-field mono-num"
                    style={{ fontSize: '1.15rem', fontWeight: 800, height: '44px', textAlign: 'right' }}
                  />
                </div>

                <div>
                  <label className="form-label">Sisa Makloon (Kg)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    disabled={!canEditResult || saving}
                    placeholder="0.00"
                    value={sisaKg}
                    onChange={(e) => setSisaKg(e.target.value)}
                    className="input-field mono-num"
                    style={{ fontSize: '1.15rem', fontWeight: 800, height: '44px', textAlign: 'right' }}
                  />
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
                    onClick={handleSubmitProduction}
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
        {activeTab === 'bahan' && (
          <div className="card" style={{ padding: '18px 20px', borderRadius: '16px' }}>
            <h3 style={{ fontSize: '1.02rem', marginBottom: '14px', fontWeight: 800, color: 'var(--text-primary)' }}>
              Daftar Komponen Material dari Odoo ERP
            </h3>
            {(!order.raw_moves || order.raw_moves.length === 0) ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                Tidak ada data pergerakan stok bahan baku yang terdaftar di Odoo.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {order.raw_moves.map((move, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '12px 16px',
                      background: 'var(--bg-card-subtle)',
                      borderRadius: '12px',
                      border: '1px solid var(--border-default)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {move.product_id ? (Array.isArray(move.product_id) ? move.product_id[1] : move.product_id) : 'Item Material'}
                      </div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                        Status Move: <span className="mono-num" style={{ fontWeight: 600 }}>{move.state || 'assigned'}</span>
                      </div>
                    </div>
                    <div className="mono-num" style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--brand-gold)', whiteSpace: 'nowrap' }}>
                      {move.product_uom_qty || 0} {move.product_uom ? (Array.isArray(move.product_uom) ? move.product_uom[1] : move.product_uom) : 'Unit'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
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
