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
  ShieldAlert
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

  // Cutting roll weights state { [lineId]: weight }
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

  // Submit Cutting Rolls
  const handleSubmitCutting = async () => {
    if (!confirm('Apakah Anda yakin ingin MENGUNCI dan mengirim timbangan hasil potong ini? Setelah dikunci, data tidak dapat diubah.')) {
      return;
    }

    setSaving(true);
    setFeedback({ text: '', type: '' });

    try {
      const rolls = Object.entries(rollWeights).map(([lineId, weight]) => ({
        line_id: Number(lineId),
        qty_berat_kg: parseFloat(weight) || 0
      }));

      const res = await fetchApi(`/pwa/orders/${orderId}/cutting-rolls`, {
        method: 'POST',
        body: JSON.stringify({ rolls })
      });

      if (res.success) {
        setFeedback({ text: 'Timbangan potong berhasil dikunci dan dikirim ke Odoo!', type: 'success' });
        loadData();
      } else {
        setFeedback({ text: res.message || 'Gagal menyimpan timbangan.', type: 'error' });
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

  // Calculations for Scale Summary
  const totalPhysicalWeight = useMemo(() => {
    return Object.values(rollWeights).reduce((sum, w) => sum + (parseFloat(w) || 0), 0);
  }, [rollWeights]);

  const totalYieldPcs = useMemo(() => {
    return (parseFloat(gradeA) || 0) + (parseFloat(gradeB) || 0);
  }, [gradeA, gradeB]);

  const yieldPercentage = useMemo(() => {
    if (!order || !order.qty_target || order.qty_target <= 0) return 0;
    return ((totalYieldPcs / order.qty_target) * 100).toFixed(1);
  }, [order, totalYieldPcs]);

  if (loading || !order) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto 16px' }}></div>
        <p style={{ color: 'var(--text-secondary)' }}>Memuat detail operasional SPK...</p>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
          <button
            onClick={() => router.push('/')}
            className="btn btn-secondary btn-icon"
            style={{ flexShrink: 0 }}
            title="Kembali ke Dashboard"
          >
            <ArrowLeft size={18} />
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span className="mono-num" style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                {order.mo_name}
              </span>
              {isBackorder && <span className="badge badge-purple" style={{ fontSize: '0.65rem' }}>Backorder</span>}
              {isResultLocked ? (
                <span className="badge badge-emerald" style={{ fontSize: '0.68rem' }}><CheckCircle2 size={12} /> Selesai</span>
              ) : isCuttingLocked ? (
                <span className="badge badge-sky" style={{ fontSize: '0.68rem' }}><Lock size={12} /> Sedang Jahit</span>
              ) : (
                <span className="badge badge-amber" style={{ fontSize: '0.68rem' }}><Scissors size={12} /> Belum Timbang</span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              SO: {order.source_document || '-'} • {order.vendor_name}
            </p>
          </div>
        </div>

        <button
          onClick={loadData}
          className="btn btn-secondary btn-icon"
          style={{ flexShrink: 0 }}
          title="Segarkan Data"
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'spinner' : ''} />
        </button>
      </header>

      {/* Main Content Area */}
      <main className="main-content">
        {/* Alerts / Feedback Message */}
        {feedback.text && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontSize: '0.85rem',
              background: feedback.type === 'success' ? 'var(--status-emerald-bg)' : 'var(--status-rose-bg)',
              border: `1px solid ${feedback.type === 'success' ? 'var(--status-emerald-border)' : 'var(--status-rose-border)'}`,
              color: feedback.type === 'success' ? 'var(--status-emerald)' : 'var(--status-rose)'
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
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              background: 'var(--status-purple-bg)',
              border: '1px solid var(--status-purple-border)',
              color: 'var(--status-purple)',
              fontSize: '0.82rem'
            }}
          >
            <Info size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong>Backorder Turunan:</strong> Data timbangan roll diwarisi otomatis dari MO induk. Anda bisa langsung menginput hasil jahit.
            </div>
          </div>
        )}

        {/* Master SPK Specification Card */}
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px' }}>
            <div>
              <span className="form-label">Nama Produk</span>
              <div style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {order.product_name}
              </div>
            </div>

            <div>
              <span className="form-label">Target SPK</span>
              <div className="mono-num" style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brand-gold)' }}>
                {Number(order.qty_target).toLocaleString('id-ID')} <span style={{ fontSize: '0.75rem', fontWeight: 400 }}>pcs</span>
              </div>
            </div>

            <div>
              <span className="form-label">Mitra CMT</span>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {order.vendor_name}
              </div>
            </div>

            <div>
              <span className="form-label">Kecukupan Kain</span>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: order.status_kebutuhan_kain === 'Cukup' ? 'var(--status-emerald)' : 'var(--status-amber)' }}>
                {order.status_kebutuhan_kain || 'Cukup'}
              </div>
            </div>
          </div>
        </div>

        {/* Operational Tabs (Fluid on Mobile with Zero Overflow) */}
        <div className="tabs-scroll">
          <button
            onClick={() => setActiveTab('timbang')}
            className={`tab-btn ${activeTab === 'timbang' ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Scissors size={14} />
            <span>Timbang Potong ({rollLines.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('hasil')}
            className={`tab-btn ${activeTab === 'hasil' ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Package size={14} />
            <span>Hasil Jahit</span>
          </button>

          <button
            onClick={() => setActiveTab('bahan')}
            className={`tab-btn ${activeTab === 'bahan' ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Layers size={14} />
            <span>Bahan BOM</span>
          </button>
        </div>

        {/* TAB 1: TIMBANGAN POTONG ROLL */}
        {activeTab === 'timbang' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Stage Status Card */}
            <div
              className="card"
              style={{
                padding: '14px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '10px',
                background: isCuttingLocked ? 'var(--status-emerald-bg)' : 'var(--status-amber-bg)',
                borderColor: isCuttingLocked ? 'var(--status-emerald-border)' : 'var(--status-amber-border)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                {isCuttingLocked ? (
                  <Lock size={20} color="var(--status-emerald)" style={{ flexShrink: 0 }} />
                ) : (
                  <Scale size={20} color="var(--status-amber)" style={{ flexShrink: 0 }} />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                    {isCuttingLocked ? 'Timbangan Potong Terkunci' : 'Timbang Fisik Roll Kain Potong'}
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                    {isCuttingLocked
                      ? `Terkunci: ${order.cutting_locked_at ? new Date(order.cutting_locked_at).toLocaleString('id-ID') : 'Otomatis'}`
                      : 'Input berat timbangan fisik per roll sebelum memulai proses jahit.'}
                  </div>
                </div>
              </div>

              {isMasterAdmin && isCuttingLocked && !isBackorder && (
                <button
                  type="button"
                  onClick={() => setUnlockModal({ open: true, type: 'cutting', reason: '' })}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '6px 12px', flexShrink: 0 }}
                >
                  <Unlock size={13} />
                  <span>Buka Kunci</span>
                </button>
              )}
            </div>

            {/* Scale Summary KPI Row */}
            <div className="card" style={{ padding: '14px 16px' }}>
              <div className="scale-summary-grid">
                <div>
                  <div className="metric-label" style={{ fontSize: '0.68rem' }}>Total Roll</div>
                  <div className="mono-num" style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {rollLines.length}
                  </div>
                </div>
                <div>
                  <div className="metric-label" style={{ fontSize: '0.68rem' }}>Total Berat</div>
                  <div className="mono-num" style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--brand-gold)' }}>
                    {totalPhysicalWeight.toFixed(2)} <span style={{ fontSize: '0.75rem' }}>kg</span>
                  </div>
                </div>
                <div>
                  <div className="metric-label" style={{ fontSize: '0.68rem' }}>Rata-rata/Roll</div>
                  <div className="mono-num" style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                    {rollLines.length > 0 ? (totalPhysicalWeight / rollLines.length).toFixed(2) : '0.00'} <span style={{ fontSize: '0.75rem' }}>kg</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Roll Lines List */}
            {rollLines.length === 0 ? (
              <div className="card" style={{ padding: '36px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Belum ada rincian baris roll kain untuk SPK ini.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {rollLines.map((line, idx) => (
                  <div key={line.id} className="card roll-card">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                        <span className="badge badge-muted mono-num" style={{ fontSize: '0.68rem' }}>#{idx + 1}</span>
                        <span className="mono-num" style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                          Lot: {line.kode_lot || 'N/A'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        {line.nama_item}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Estimasi Standar: <span className="mono-num">{line.qty || 0} {line.uom || 'kg'}</span>
                      </div>
                    </div>

                    <div className="roll-input-row">
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                        BERAT TIMBANG:
                      </label>
                      <div style={{ position: 'relative', width: '120px' }}>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          disabled={!canEditCutting || saving}
                          placeholder="0.00"
                          value={rollWeights[line.id] !== undefined ? rollWeights[line.id] : ''}
                          onChange={(e) => handleWeightChange(line.id, e.target.value)}
                          className="input-field mono-num"
                          style={{
                            height: '40px',
                            fontSize: '1rem',
                            fontWeight: 700,
                            paddingRight: '34px',
                            textAlign: 'right',
                            borderColor: rollWeights[line.id] ? 'var(--brand-gold)' : 'var(--border-default)'
                          }}
                        />
                        <span
                          style={{
                            position: 'absolute',
                            right: '10px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            color: 'var(--text-muted)'
                          }}
                        >
                          KG
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Submit Cutting Button */}
            {canEditCutting && rollLines.length > 0 && (
              <div style={{ marginTop: '6px' }}>
                <button
                  type="button"
                  disabled={saving || totalPhysicalWeight <= 0}
                  onClick={handleSubmitCutting}
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '13px', fontSize: '0.95rem' }}
                >
                  <Lock size={16} />
                  <span>{saving ? 'Mengunci...' : 'Kunci & Simpan Timbangan Potong'}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: INPUT HASIL JAHIT */}
        {activeTab === 'hasil' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Cutting Lock Warning */}
            {!isCuttingLocked && (
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  background: 'var(--status-amber-bg)',
                  border: '1px solid var(--status-amber-border)',
                  color: 'var(--status-amber)',
                  fontSize: '0.82rem'
                }}
              >
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>
                  <strong>Perhatian:</strong> Kunci tahap timbangan potong terlebih dahulu sebelum mengunci hasil jahit.
                </span>
              </div>
            )}

            {/* Stage Status Card */}
            <div
              className="card"
              style={{
                padding: '14px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '10px',
                background: isResultLocked ? 'var(--status-emerald-bg)' : 'var(--bg-card)',
                borderColor: isResultLocked ? 'var(--status-emerald-border)' : 'var(--border-default)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                {isResultLocked ? (
                  <CheckCircle2 size={20} color="var(--status-emerald)" style={{ flexShrink: 0 }} />
                ) : (
                  <Package size={20} color="var(--brand-gold)" style={{ flexShrink: 0 }} />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                    {isResultLocked ? 'Hasil Jahit Terkunci (Selesai)' : 'Input Hasil Produksi Jahit'}
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                    {isResultLocked
                      ? `Terkunci: ${order.result_locked_at ? new Date(order.result_locked_at).toLocaleString('id-ID') : '-'}`
                      : 'Input Grade A, Grade B, sisa kain (BSKL), serta nomor surat jalan.'}
                  </div>
                </div>
              </div>

              {isMasterAdmin && isResultLocked && (
                <button
                  type="button"
                  onClick={() => setUnlockModal({ open: true, type: 'result', reason: '' })}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '6px 12px', flexShrink: 0 }}
                >
                  <Unlock size={13} />
                  <span>Buka Kunci</span>
                </button>
              )}
            </div>

            {/* Yield Summary Calculator */}
            <div className="card" style={{ padding: '14px 16px' }}>
              <div className="scale-summary-grid">
                <div>
                  <div className="metric-label" style={{ fontSize: '0.68rem' }}>Target SPK</div>
                  <div className="mono-num" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {Number(order.qty_target).toLocaleString('id-ID')} <span style={{ fontSize: '0.75rem' }}>pcs</span>
                  </div>
                </div>
                <div>
                  <div className="metric-label" style={{ fontSize: '0.68rem' }}>Hasil Jahit</div>
                  <div className="mono-num" style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--brand-gold)' }}>
                    {totalYieldPcs.toLocaleString('id-ID')} <span style={{ fontSize: '0.75rem' }}>pcs</span>
                  </div>
                </div>
                <div>
                  <div className="metric-label" style={{ fontSize: '0.68rem' }}>Rasio Yield</div>
                  <div className="mono-num" style={{ fontSize: '1.25rem', fontWeight: 800, color: parseFloat(yieldPercentage) >= 95 ? 'var(--status-emerald)' : 'var(--status-amber)' }}>
                    {yieldPercentage}%
                  </div>
                </div>
              </div>
            </div>

            {/* Production Result Form */}
            <div className="card" style={{ padding: '18px 16px' }}>
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
                    style={{ fontSize: '1.05rem', fontWeight: 700, height: '42px' }}
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
                    style={{ fontSize: '1.05rem', fontWeight: 700, height: '42px' }}
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
                    style={{ fontSize: '1.05rem', fontWeight: 700, height: '42px' }}
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
                    style={{ fontSize: '0.9rem', height: '42px' }}
                  />
                </div>
              </div>

              {canEditResult && (
                <div style={{ marginTop: '18px' }}>
                  <button
                    type="button"
                    disabled={saving || totalYieldPcs <= 0}
                    onClick={handleSubmitProduction}
                    className="btn btn-primary"
                    style={{ width: '100%', padding: '13px', fontSize: '0.95rem' }}
                  >
                    <CheckCircle2 size={16} />
                    <span>{saving ? 'Menyimpan...' : 'Kunci & Selesaikan Hasil Jahit'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: KOMPONEN BAHAN BAKU */}
        {activeTab === 'bahan' && (
          <div className="card" style={{ padding: '16px' }}>
            <h3 style={{ fontSize: '0.98rem', marginBottom: '12px', fontWeight: 700 }}>
              Daftar Komponen Material dari Odoo ERP
            </h3>
            {(!order.raw_moves || order.raw_moves.length === 0) ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Tidak ada data pergerakan stok bahan baku yang terdaftar.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {order.raw_moves.map((move, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '10px 14px',
                      background: 'var(--bg-card-elevated)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '10px'
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {move.product_id ? (Array.isArray(move.product_id) ? move.product_id[1] : move.product_id) : 'Item Material'}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                        Status Move: <span className="mono-num">{move.state || 'assigned'}</span>
                      </div>
                    </div>
                    <div className="mono-num" style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--brand-gold)', whiteSpace: 'nowrap' }}>
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
              <ShieldAlert size={22} color="var(--status-rose)" />
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
                Konfirmasi Buka Kunci {unlockModal.type.toUpperCase()}
              </h3>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: 1.5 }}>
              Tindakan ini akan mengizinkan pengubahan ulang data. Alasan wajib diisi dan akan dicatat di <strong>Audit Trail</strong>.
            </p>

            <div style={{ marginBottom: '16px' }}>
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
                style={{ flex: 1 }}
              >
                Batal
              </button>
              <button
                type="button"
                disabled={saving || !unlockModal.reason.trim()}
                onClick={handleUnlock}
                className="btn btn-danger"
                style={{ flex: 1 }}
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
          <p style={{ color: 'var(--text-secondary)' }}>Memuat detail SPK...</p>
        </div>
      }
    >
      <OrderDetailContent />
    </Suspense>
  );
}
