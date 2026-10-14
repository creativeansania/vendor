'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { fetchApi, getCurrentUser } from '@/lib/api';
import {
  ArrowLeft,
  Lock,
  Unlock,
  CheckCircle,
  AlertTriangle,
  Scissors,
  Package,
  Layers,
  Send,
  RefreshCw,
  Info
} from 'lucide-react';

function OrderDetailContent() {
  const router = useRouter();
  const routeParams = useParams();
  const orderId = routeParams?.id;

  const [user, setUser] = useState(null);
  const [order, setOrder] = useState(null);
  const [rollLines, setRollLines] = useState([]);
  const [activeTab, setActiveTab] = useState('timbang'); // 'bahan', 'timbang', 'hasil'
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

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
      }
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
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
    if (!confirm('Apakah Anda yakin ingin MENGUNCI dan mengirim timbangan hasil potong ini ke sistem?')) {
      return;
    }

    setSaving(true);
    setMessage({ text: '', type: '' });

    try {
      const rollUpdates = Object.entries(rollWeights).map(([id, weight]) => {
        const line = rollLines.find((r) => String(r.id) === String(id));
        return {
          id: Number(id),
          odoo_line_id: line?.odoo_line_id || null,
          qty_berat_kg: parseFloat(weight) || 0
        };
      });

      const res = await fetchApi(`/pwa/orders/${orderId}/cutting-rolls`, {
        method: 'POST',
        body: JSON.stringify({ rollUpdates })
      });

      if (res.success) {
        setMessage({ text: 'Timbangan potong berhasil dikunci dan disimpan!', type: 'success' });
        await loadData();
      }
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // Submit Production Result
  const handleSubmitResult = async (e) => {
    e.preventDefault();
    if (!confirm('Apakah Anda yakin ingin MENGUNCI dan mengirim laporan hasil jahit ini?')) {
      return;
    }

    setSaving(true);
    setMessage({ text: '', type: '' });

    try {
      const res = await fetchApi(`/pwa/orders/${orderId}/production-result`, {
        method: 'POST',
        body: JSON.stringify({
          qtyGradeA: Number(gradeA || 0),
          qtyGradeB: Number(gradeB || 0),
          sisaMakloonKg: Number(sisaKg || 0),
          noSuratJalan: noSuratJalan.trim()
        })
      });

      if (res.success) {
        setMessage({ text: 'Laporan hasil jahit berhasil dikunci dan dilaporkan!', type: 'success' });
        await loadData();
      }
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // Unlock Stage (Master Admin)
  const handleUnlock = async () => {
    if (!unlockModal.reason.trim()) {
      alert('Alasan unlock wajib diisi!');
      return;
    }

    setSaving(true);
    try {
      const res = await fetchApi(`/pwa/orders/${orderId}/unlock`, {
        method: 'POST',
        body: JSON.stringify({
          unlockType: unlockModal.type,
          reason: unlockModal.reason.trim()
        })
      });

      if (res.success) {
        setUnlockModal({ open: false, type: '', reason: '' });
        setMessage({ text: res.message, type: 'success' });
        await loadData();
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!user || loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
        <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto 12px auto' }} />
        <p>Memuat detail SPK...</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <p>SPK tidak ditemukan.</p>
        <button onClick={() => router.push('/')} className="btn btn-secondary" style={{ marginTop: '14px' }}>
          Kembali ke Dashboard
        </button>
      </div>
    );
  }

  const isCuttingLocked = Boolean(order.cutting_locked_at) || Boolean(order.is_backorder);
  const isResultLocked = Boolean(order.result_locked_at);
  const kainLines = rollLines.filter((r) => r.line_type === 'kain');
  const accsLines = rollLines.filter((r) => r.line_type === 'aksesoris');

  // Sum calculated weights live
  const liveTotalCutting = kainLines.reduce((sum, r) => {
    const val = rollWeights[r.id] !== undefined ? rollWeights[r.id] : r.qty_berat_kg;
    return sum + (parseFloat(val) || 0);
  }, 0);
  const liveSelisih = liveTotalCutting - Number(order.estimasi_dari_spb || 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', paddingBottom: '40px' }}>
      {/* Header */}
      <header className="app-header">
        <button
          onClick={() => router.push('/')}
          className="btn btn-secondary"
          style={{ padding: '6px 10px', minHeight: '34px' }}
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.05rem', color: '#ffffff' }}>{order.mo_name}</h2>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{order.vendor_name}</p>
        </div>
        <div style={{ width: '38px' }} />
      </header>

      {/* Banner / Message */}
      {message.text && (
        <div style={{
          margin: '12px 16px 0 16px',
          padding: '10px 14px',
          borderRadius: 'var(--radius-md)',
          background: message.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
          border: message.type === 'success' ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(244, 63, 94, 0.3)',
          color: message.type === 'success' ? '#34d399' : '#fb7185',
          fontSize: '0.85rem'
        }}>
          {message.text}
        </div>
      )}

      {/* Order Summary Card */}
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div className="glass-card" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
            <span className={`badge ${order.status_kebutuhan_kain === 'Cukup' ? 'badge-emerald' : 'badge-amber'}`}>
              Bahan {order.status_kebutuhan_kain || 'Cek'}
            </span>
            {user.role !== 'admin_vendor' && Number(order.harga_vendor) > 0 && (
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#38bdf8' }}>
                Tarif: Rp {Number(order.harga_vendor).toLocaleString('id-ID')} / pcs
              </span>
            )}
          </div>

          <h3 style={{ fontSize: '0.95rem', color: '#ffffff', lineHeight: 1.35, marginBottom: '8px' }}>
            {order.product_name || 'Produk tanpa nama'}
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Target:</span>
              <p style={{ fontWeight: 700, color: '#ffffff' }}>{Number(order.qty_spk).toLocaleString('id-ID')} pcs</p>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Kain SPB:</span>
              <p style={{ fontWeight: 700, color: '#ffffff' }}>{Number(order.kain_dari_gudang).toLocaleString('id-ID')} {order.unit_kain || 'yd'}</p>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>SO:</span>
              <p style={{ fontWeight: 700, color: '#ffffff' }}>{order.sales_order || '-'}</p>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', background: 'rgba(0,0,0,0.3)', padding: '4px', borderRadius: 'var(--radius-md)' }}>
          <button
            onClick={() => setActiveTab('timbang')}
            style={{
              padding: '8px 4px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              background: activeTab === 'timbang' ? 'var(--gradient-brand)' : 'transparent',
              color: activeTab === 'timbang' ? '#ffffff' : 'var(--text-secondary)'
            }}
          >
            ✂️ Timbang
          </button>
          <button
            onClick={() => setActiveTab('hasil')}
            style={{
              padding: '8px 4px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              background: activeTab === 'hasil' ? 'var(--gradient-brand)' : 'transparent',
              color: activeTab === 'hasil' ? '#ffffff' : 'var(--text-secondary)'
            }}
          >
            📦 Hasil Jahit
          </button>
          <button
            onClick={() => setActiveTab('bahan')}
            style={{
              padding: '8px 4px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              background: activeTab === 'bahan' ? 'var(--gradient-brand)' : 'transparent',
              color: activeTab === 'bahan' ? '#ffffff' : 'var(--text-secondary)'
            }}
          >
            📋 Bahan Gudang
          </button>
        </div>

        {/* ================= TAB 1: TIMBANG ROLL POTONG ================= */}
        {activeTab === 'timbang' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Status Alert */}
            {order.is_backorder ? (
              <div className="glass-card" style={{ background: 'rgba(99, 102, 241, 0.12)', borderColor: 'rgba(99, 102, 241, 0.3)', padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#a5b4fc', fontSize: '0.85rem' }}>
                  <Info size={18} />
                  <strong>MO Backorder (Turunan)</strong>
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Roll kain disalin otomatis dari MO induk dan tidak perlu ditimbang ulang.
                </p>
              </div>
            ) : isCuttingLocked ? (
              <div className="glass-card" style={{ background: 'rgba(16, 185, 129, 0.12)', borderColor: 'rgba(16, 185, 129, 0.3)', padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#34d399', fontSize: '0.85rem' }}>
                    <Lock size={16} />
                    <strong>Tahap Potong Terkunci</strong>
                  </div>
                  {user.role === 'master_admin' && (
                    <button
                      onClick={() => setUnlockModal({ open: true, type: 'cutting', reason: '' })}
                      className="btn btn-secondary"
                      style={{ padding: '4px 8px', minHeight: '28px', fontSize: '0.75rem' }}
                    >
                      <Unlock size={12} /> Buka Kunci
                    </button>
                  )}
                </div>
              </div>
            ) : null}

            {/* Metrics Live Preview */}
            <div className="glass-card" style={{ padding: '12px 14px', background: 'rgba(0,0,0,0.3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Estimasi SPB</span>
                  <p style={{ fontSize: '0.95rem', fontWeight: 700 }}>{Number(order.estimasi_dari_spb).toFixed(1)} pcs</p>
                </div>
                <div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Total Timbang (Kg)</span>
                  <p style={{ fontSize: '1.05rem', fontWeight: 800, color: '#34d399' }}>{liveTotalCutting.toFixed(2)} kg</p>
                </div>
                <div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Selisih Output</span>
                  <p style={{ fontSize: '0.95rem', fontWeight: 700, color: liveSelisih >= 0 ? '#38bdf8' : '#fb7185' }}>
                    {liveSelisih >= 0 ? `+${liveSelisih.toFixed(1)}` : liveSelisih.toFixed(1)} pcs
                  </p>
                </div>
              </div>
            </div>

            {/* List Roll Kain */}
            <h4 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Daftar Roll Kain ({kainLines.length} Roll)
            </h4>

            {kainLines.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '20px' }}>
                Belum ada roll kain dari transfer gudang.
              </p>
            ) : (
              kainLines.map((r, idx) => {
                const currentVal = rollWeights[r.id] !== undefined ? rollWeights[r.id] : (r.qty_berat_kg || '');

                return (
                  <div key={r.id} className="glass-card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>#{idx + 1}</span>
                        <strong style={{ fontSize: '0.9rem' }}>Lot: {r.kode_lot}</strong>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Panjang: {r.qty} {r.uom}
                      </p>
                    </div>

                    <div style={{ width: '120px' }}>
                      <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px', textAlign: 'right' }}>
                        Berat (Kg)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        disabled={isCuttingLocked || saving}
                        className="input-field input-number-large"
                        style={{ height: '40px', minHeight: '40px', padding: '0 8px', width: '100%' }}
                        value={currentVal}
                        onChange={(e) => handleWeightChange(r.id, e.target.value)}
                      />
                    </div>
                  </div>
                );
              })
            )}

            {/* Submit Button */}
            {!isCuttingLocked && kainLines.length > 0 && (
              <button
                onClick={handleSubmitCutting}
                disabled={saving}
                className="btn btn-primary btn-block"
                style={{ marginTop: '10px' }}
              >
                <Lock size={16} />
                <span>Kunci & Kirim Timbangan Potong</span>
              </button>
            )}
          </div>
        )}

        {/* ================= TAB 2: LAPOR HASIL JAHIT ================= */}
        {activeTab === 'hasil' && (
          <form onSubmit={handleSubmitResult} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {isResultLocked && (
              <div className="glass-card" style={{ background: 'rgba(16, 185, 129, 0.12)', borderColor: 'rgba(16, 185, 129, 0.3)', padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#34d399', fontSize: '0.85rem' }}>
                    <CheckCircle size={16} />
                    <strong>Laporan Hasil Jahit Terkunci</strong>
                  </div>
                  {user.role === 'master_admin' && (
                    <button
                      type="button"
                      onClick={() => setUnlockModal({ open: true, type: 'result', reason: '' })}
                      className="btn btn-secondary"
                      style={{ padding: '4px 8px', minHeight: '28px', fontSize: '0.75rem' }}
                    >
                      <Unlock size={12} /> Buka Kunci
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="glass-card">
              <div className="input-group">
                <label className="input-label">Hasil Jahit Grade A (pcs)</label>
                <input
                  type="number"
                  step="1"
                  required
                  disabled={isResultLocked || saving}
                  className="input-field input-number-large"
                  placeholder="0"
                  value={gradeA}
                  onChange={(e) => setGradeA(e.target.value)}
                />
              </div>

              <div className="input-group">
                <label className="input-label">Hasil Jahit Grade B (pcs)</label>
                <input
                  type="number"
                  step="1"
                  disabled={isResultLocked || saving}
                  className="input-field input-number-large"
                  placeholder="0"
                  value={gradeB}
                  onChange={(e) => setGradeB(e.target.value)}
                />
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  *Jika diisi, backend otomatis membuat dokumen Draft MO Grade B di Odoo
                </span>
              </div>

              <div className="input-group">
                <label className="input-label">Sisa Kain Makloon / BSKL (Kg)</label>
                <input
                  type="number"
                  step="0.01"
                  disabled={isResultLocked || saving}
                  className="input-field input-number-large"
                  placeholder="0.00"
                  value={sisaKg}
                  onChange={(e) => setSisaKg(e.target.value)}
                />
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  *Jika diisi, backend otomatis membuat Draft Transfer Pengembalian BSKL ke Gudang
                </span>
              </div>

              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Nomor Surat Jalan Vendor</label>
                <input
                  type="text"
                  disabled={isResultLocked || saving}
                  className="input-field"
                  placeholder="Contoh: SJ/VDKWS/2026/001"
                  value={noSuratJalan}
                  onChange={(e) => setNoSuratJalan(e.target.value)}
                />
              </div>
            </div>

            {!isResultLocked && (
              <button
                type="submit"
                disabled={saving}
                className="btn btn-primary btn-block"
              >
                <Send size={16} />
                <span>Kunci & Kirim Laporan Jahit</span>
              </button>
            )}
          </form>
        )}

        {/* ================= TAB 3: BAHAN & SURAT JALAN ================= */}
        {activeTab === 'bahan' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="glass-card">
              <h4 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '10px' }}>
                Ringkasan Pengiriman Gudang
              </h4>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Kain dari Gudang:</span>
                  <strong>{Number(order.kain_dari_gudang).toLocaleString('id-ID')} {order.unit_kain || 'yd'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Aksesoris dari Gudang:</span>
                  <strong>{Number(order.accessories_dari_gudang).toLocaleString('id-ID')} pcs</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Estimasi Output SPB:</span>
                  <strong>{Number(order.estimasi_dari_spb).toLocaleString('id-ID')} pcs</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Status Bahan:</span>
                  <span className={`badge ${order.status_kebutuhan_kain === 'Cukup' ? 'badge-emerald' : 'badge-amber'}`}>
                    {order.status_kebutuhan_kain}
                  </span>
                </div>
              </div>
            </div>

            {/* Aksesoris List */}
            {accsLines.length > 0 && (
              <div className="glass-card">
                <h4 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '10px' }}>
                  Aksesoris ({accsLines.length} Item)
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {accsLines.map((a) => (
                    <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '6px' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{a.nama_item}</span>
                      <strong>{a.qty} {a.uom}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ================= UNLOCK MODAL (MASTER ADMIN ONLY) ================= */}
      {unlockModal.open && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ fontSize: '1.15rem', color: '#ffffff', marginBottom: '8px' }}>
              Buka Kunci Tahap {unlockModal.type === 'cutting' ? 'Potong' : 'Hasil Jahit'}
            </h3>
            <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Membuka kunci memungkinkan vendor mengubah kembali data di HP mereka. Wajib isi alasan untuk catatan audit:
            </p>

            <div className="input-group">
              <label className="input-label">Alasan Unlock</label>
              <textarea
                rows={3}
                required
                className="input-field"
                placeholder="Contoh: Revisi timbangan roll nomor 3 salah input oleh mandor..."
                value={unlockModal.reason}
                onChange={(e) => setUnlockModal((m) => ({ ...m, reason: e.target.value }))}
                style={{ resize: 'none' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '18px' }}>
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
                disabled={saving}
                onClick={handleUnlock}
                className="btn btn-danger"
                style={{ flex: 1 }}
              >
                {saving ? 'Membuka...' : 'Ya, Buka Kunci'}
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
        <div className="card" style={{ textAlign: 'center', padding: '40px', marginTop: '40px' }}>
          <div className="spinner" style={{ margin: '0 auto 16px' }}></div>
          <p style={{ color: 'var(--text-muted)' }}>Memuat detail SPK...</p>
        </div>
      }
    >
      <OrderDetailContent />
    </Suspense>
  );
}

