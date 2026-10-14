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
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', paddingBottom: '60px' }}>
      {/* Top Navbar */}
      <header className="navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => router.push('/')}
            className="btn btn-secondary btn-icon"
            title="Kembali ke Dashboard SPK"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span className="mono-num" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {order.mo_name}
              </span>
              {isBackorder && <span className="badge badge-purple">Backorder</span>}
              {isResultLocked ? (
                <span className="badge badge-emerald"><CheckCircle2 size={13} /> Selesai</span>
              ) : isCuttingLocked ? (
                <span className="badge badge-sky"><Lock size={13} /> Sedang Jahit</span>
              ) : (
                <span className="badge badge-amber"><Scissors size={13} /> Perlu Timbang</span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              SO: <span className="mono-num">{order.source_document || '-'}</span> • {order.vendor_name}
            </p>
          </div>
        </div>

        <button
          onClick={loadData}
          className="btn btn-secondary btn-icon"
          title="Segarkan Data"
          disabled={loading}
        >
          <RefreshCw size={15} className={loading ? 'spinner' : ''} />
        </button>
      </header>

      {/* Main Content Area */}
      <main style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {/* Alerts / Feedback Message */}
        {feedback.text && (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontSize: '0.88rem',
              background: feedback.type === 'success' ? 'var(--status-emerald-bg)' : 'var(--status-rose-bg)',
              border: `1px solid ${feedback.type === 'success' ? 'var(--status-emerald-border)' : 'var(--status-rose-border)'}`,
              color: feedback.type === 'success' ? 'var(--status-emerald)' : 'var(--status-rose)'
            }}
          >
            {feedback.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            <span>{feedback.text}</span>
          </div>
        )}

        {/* Backorder Information Banner */}
        {isBackorder && (
          <div
            style={{
              padding: '14px 18px',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              background: 'var(--status-purple-bg)',
              border: '1px solid var(--status-purple-border)',
              color: 'var(--status-purple)'
            }}
          >
            <Info size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '0.85rem' }}>
              <strong>SPK Backorder Turunan:</strong> Roll kain otomatis disalin dari MO induk dan tidak perlu ditimbang ulang di workshop. Anda dapat langsung melanjutkan penginputan hasil jahit.
            </div>
          </div>
        )}

        {/* Master SPK Specification Card */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <div>
              <span className="form-label">Nama Produk Garment</span>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {order.product_name}
              </div>
            </div>

            <div>
              <span className="form-label">Target Produksi (SPK)</span>
              <div className="mono-num" style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--brand-gold)' }}>
                {Number(order.qty_target).toLocaleString('id-ID')} <span style={{ fontSize: '0.85rem', fontWeight: 400 }}>pcs</span>
              </div>
            </div>

            <div>
              <span className="form-label">Mitra Vendor CMT</span>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {order.vendor_name}
              </div>
            </div>

            <div>
              <span className="form-label">Kecukupan Bahan Baku</span>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: order.status_kebutuhan_kain === 'Cukup' ? 'var(--status-emerald)' : 'var(--status-amber)' }}>
                {order.status_kebutuhan_kain || 'Cukup'}
              </div>
            </div>
          </div>
        </div>

        {/* Operational Tabs */}
        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-default)', paddingBottom: '8px' }}>
          <button
            onClick={() => setActiveTab('timbang')}
            className={`btn ${activeTab === 'timbang' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.85rem', padding: '10px 18px' }}
          >
            <Scissors size={15} />
            <span>1. Timbang Potong Roll ({rollLines.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('hasil')}
            className={`btn ${activeTab === 'hasil' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.85rem', padding: '10px 18px' }}
          >
            <Package size={15} />
            <span>2. Hasil Jahit & Surat Jalan</span>
          </button>

          <button
            onClick={() => setActiveTab('bahan')}
            className={`btn ${activeTab === 'bahan' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.85rem', padding: '10px 18px' }}
          >
            <Layers size={15} />
            <span>3. Komponen Bahan Baku</span>
          </button>
        </div>

        {/* TAB 1: TIMBANGAN POTONG ROLL */}
        {activeTab === 'timbang' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Stage Status Card */}
            <div
              className="card"
              style={{
                padding: '16px 20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
                background: isCuttingLocked ? 'var(--status-emerald-bg)' : 'var(--status-amber-bg)',
                borderColor: isCuttingLocked ? 'var(--status-emerald-border)' : 'var(--status-amber-border)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {isCuttingLocked ? (
                  <Lock size={22} color="var(--status-emerald)" />
                ) : (
                  <Scale size={22} color="var(--status-amber)" />
                )}
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--text-primary)' }}>
                    {isCuttingLocked ? 'Timbangan Potong Telah Terkunci' : 'Timbangan Fisik Roll Kain Diperlukan'}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {isCuttingLocked
                      ? `Terkunci pada: ${order.cutting_locked_at ? new Date(order.cutting_locked_at).toLocaleString('id-ID') : 'Otomatis'}`
                      : 'Masukkan berat fisik timbangan per roll kain hasil potong sebelum melanjutkan ke proses jahit.'}
                  </div>
                </div>
              </div>

              {isMasterAdmin && isCuttingLocked && !isBackorder && (
                <button
                  type="button"
                  onClick={() => setUnlockModal({ open: true, type: 'cutting', reason: '' })}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.78rem', padding: '6px 14px' }}
                >
                  <Unlock size={14} />
                  <span>Buka Kunci (Master Admin)</span>
                </button>
              )}
            </div>

            {/* Scale Summary KPI Row */}
            <div className="card" style={{ padding: '16px 20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', textAlign: 'center' }}>
                <div>
                  <div className="metric-label">Total Roll Kain</div>
                  <div className="mono-num" style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {rollLines.length}
                  </div>
                </div>
                <div>
                  <div className="metric-label">Total Berat Fisik</div>
                  <div className="mono-num" style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--brand-gold)' }}>
                    {totalPhysicalWeight.toFixed(2)} <span style={{ fontSize: '0.85rem' }}>kg</span>
                  </div>
                </div>
                <div>
                  <div className="metric-label">Rata-rata / Roll</div>
                  <div className="mono-num" style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                    {rollLines.length > 0 ? (totalPhysicalWeight / rollLines.length).toFixed(2) : '0.00'} <span style={{ fontSize: '0.85rem' }}>kg</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Roll Lines List */}
            {rollLines.length === 0 ? (
              <div className="card" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Belum ada rincian baris roll kain untuk SPK ini.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {rollLines.map((line, idx) => (
                  <div
                    key={line.id}
                    className="card"
                    style={{
                      padding: '16px 20px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '16px',
                      flexWrap: 'wrap'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span className="badge badge-muted mono-num">Roll #{idx + 1}</span>
                        <span className="mono-num" style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                          Lot: {line.kode_lot || 'N/A'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        {line.nama_item}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        Estimasi Standar: <span className="mono-num">{line.qty || 0} {line.uom || 'kg'}</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                        BERAT TIMBANG:
                      </label>
                      <div style={{ position: 'relative', width: '130px' }}>
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
                            height: '42px',
                            fontSize: '1.05rem',
                            fontWeight: 700,
                            paddingRight: '36px',
                            textAlign: 'right',
                            borderColor: rollWeights[line.id] ? 'var(--brand-gold)' : 'var(--border-default)'
                          }}
                        />
                        <span
                          style={{
                            position: 'absolute',
                            right: '12px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            fontSize: '0.78rem',
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
              <div style={{ marginTop: '10px' }}>
                <button
                  type="button"
                  disabled={saving || totalPhysicalWeight <= 0}
                  onClick={handleSubmitCutting}
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '14px', fontSize: '1rem' }}
                >
                  <Lock size={18} />
                  <span>{saving ? 'Mengunci & Menyimpan...' : 'Kunci & Simpan Data Timbangan Potong'}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: INPUT HASIL JAHIT */}
        {activeTab === 'hasil' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Cutting Lock Prerequisite Warning */}
            {!isCuttingLocked && (
              <div
                style={{
                  padding: '14px 18px',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  background: 'var(--status-amber-bg)',
                  border: '1px solid var(--status-amber-border)',
                  color: 'var(--status-amber)'
                }}
              >
                <AlertCircle size={20} />
                <span style={{ fontSize: '0.85rem' }}>
                  <strong>Perhatian:</strong> Timbangan roll potong belum dikunci. Anda wajib menyelesaikan dan mengunci tahap timbang potong sebelum hasil jahit dapat dikunci.
                </span>
              </div>
            )}

            {/* Stage Status Card */}
            <div
              className="card"
              style={{
                padding: '16px 20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
                background: isResultLocked ? 'var(--status-emerald-bg)' : 'var(--bg-card)',
                borderColor: isResultLocked ? 'var(--status-emerald-border)' : 'var(--border-default)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {isResultLocked ? (
                  <CheckCircle2 size={22} color="var(--status-emerald)" />
                ) : (
                  <Package size={22} color="var(--brand-gold)" />
                )}
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--text-primary)' }}>
                    {isResultLocked ? 'Hasil Jahit Telah Dikunci (SPK Selesai)' : 'Input Hasil Produksi Jahit'}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {isResultLocked
                      ? `Terkunci pada: ${order.result_locked_at ? new Date(order.result_locked_at).toLocaleString('id-ID') : '-'}`
                      : 'Masukkan jumlah Grade A, Grade B, sisa kain makloon (BSKL), serta nomor surat jalan vendor.'}
                  </div>
                </div>
              </div>

              {isMasterAdmin && isResultLocked && (
                <button
                  type="button"
                  onClick={() => setUnlockModal({ open: true, type: 'result', reason: '' })}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.78rem', padding: '6px 14px' }}
                >
                  <Unlock size={14} />
                  <span>Buka Kunci (Master Admin)</span>
                </button>
              )}
            </div>

            {/* Yield Summary Calculator */}
            <div className="card" style={{ padding: '18px 20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', textAlign: 'center' }}>
                <div>
                  <div className="metric-label">Target SPK</div>
                  <div className="mono-num" style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {Number(order.qty_target).toLocaleString('id-ID')} <span style={{ fontSize: '0.8rem' }}>pcs</span>
                  </div>
                </div>
                <div>
                  <div className="metric-label">Total Hasil Jahit</div>
                  <div className="mono-num" style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--brand-gold)' }}>
                    {totalYieldPcs.toLocaleString('id-ID')} <span style={{ fontSize: '0.8rem' }}>pcs</span>
                  </div>
                </div>
                <div>
                  <div className="metric-label">Rasio Pemenuhan</div>
                  <div className="mono-num" style={{ fontSize: '1.3rem', fontWeight: 800, color: parseFloat(yieldPercentage) >= 95 ? 'var(--status-emerald)' : 'var(--status-amber)' }}>
                    {yieldPercentage}%
                  </div>
                </div>
              </div>
            </div>

            {/* Production Result Form */}
            <div className="card" style={{ padding: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px' }}>
                <div>
                  <label className="form-label">Hasil Grade A (Bagus / Lolos QC)</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      disabled={!canEditResult || saving}
                      placeholder="0"
                      value={gradeA}
                      onChange={(e) => setGradeA(e.target.value)}
                      className="input-field mono-num"
                      style={{ fontSize: '1.1rem', fontWeight: 700, height: '46px', paddingRight: '45px' }}
                    />
                    <span style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      PCS
                    </span>
                  </div>
                </div>

                <div>
                  <label className="form-label">Hasil Grade B (Reject / Perbaikan)</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      disabled={!canEditResult || saving}
                      placeholder="0"
                      value={gradeB}
                      onChange={(e) => setGradeB(e.target.value)}
                      className="input-field mono-num"
                      style={{ fontSize: '1.1rem', fontWeight: 700, height: '46px', paddingRight: '45px' }}
                    />
                    <span style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      PCS
                    </span>
                  </div>
                </div>

                <div>
                  <label className="form-label">Sisa Makloon / BSKL (Kg)</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      disabled={!canEditResult || saving}
                      placeholder="0.00"
                      value={sisaKg}
                      onChange={(e) => setSisaKg(e.target.value)}
                      className="input-field mono-num"
                      style={{ fontSize: '1.1rem', fontWeight: 700, height: '46px', paddingRight: '45px' }}
                    />
                    <span style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      KG
                    </span>
                  </div>
                </div>

                <div>
                  <label className="form-label">Nomor Surat Jalan Pengiriman</label>
                  <input
                    type="text"
                    disabled={!canEditResult || saving}
                    placeholder="Contoh: SJ/VDKWS/2026/001"
                    value={noSuratJalan}
                    onChange={(e) => setNoSuratJalan(e.target.value)}
                    className="input-field"
                    style={{ fontSize: '0.95rem', height: '46px' }}
                  />
                </div>
              </div>

              {canEditResult && (
                <div style={{ marginTop: '24px' }}>
                  <button
                    type="button"
                    disabled={saving || totalYieldPcs <= 0}
                    onClick={handleSubmitProduction}
                    className="btn btn-primary"
                    style={{ width: '100%', padding: '14px', fontSize: '1rem' }}
                  >
                    <CheckCircle2 size={18} />
                    <span>{saving ? 'Menyimpan...' : 'Kunci & Selesaikan Hasil Jahit'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: KOMPONEN BAHAN BAKU */}
        {activeTab === 'bahan' && (
          <div className="card" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '1.05rem', marginBottom: '14px', fontWeight: 700 }}>
              Daftar Komponen Material dari Odoo ERP
            </h3>
            {(!order.raw_moves || order.raw_moves.length === 0) ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                Tidak ada data pergerakan stok bahan baku yang terdaftar.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {order.raw_moves.map((move, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '12px 16px',
                      background: 'var(--bg-card-elevated)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                        {move.product_id ? (Array.isArray(move.product_id) ? move.product_id[1] : move.product_id) : 'Item Material'}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        Status Stock Move: <span className="mono-num">{move.state || 'assigned'}</span>
                      </div>
                    </div>
                    <div className="mono-num" style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--brand-gold)' }}>
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
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>
                Konfirmasi Buka Kunci Tahap {unlockModal.type.toUpperCase()}
              </h3>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
              Tindakan ini akan mengizinkan pengubahan ulang data timbangan atau hasil jahit. Catatan alasan wajib diisi dan akan dicatat secara permanen di <strong>Audit Trail</strong>.
            </p>

            <div style={{ marginBottom: '18px' }}>
              <label className="form-label">Alasan Pembukaan Kunci (Wajib)</label>
              <textarea
                rows={3}
                required
                placeholder="Contoh: Koreksi berat timbangan fisik roll #2 atas instruksi QC..."
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
