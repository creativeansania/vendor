'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search,
  Download,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  X,
  AlertCircle
} from 'lucide-react';
import '@/styles/buyer-dashboard.css';
import {
  computeClientAggregates,
  exportBuyerItemsToCsv,
  formatDateId,
  formatIntId,
  formatPctId,
  formatSyncedAtWib,
  STATUS_LABELS
} from '@/lib/buyerDashboardClient';
import BuyerCharts from './BuyerCharts';
import BuyerPoTable from './BuyerPoTable';

const STATUS_PILLS = [
  { key: 'selesai', label: 'PO selesai', accent: '#047857' },
  { key: 'on_track', label: 'PO on track', accent: '#2563eb' },
  { key: 'perlu_perhatian', label: 'PO perlu perhatian', accent: '#d97706' },
  { key: 'terlambat', label: 'PO terlambat', accent: '#dc2626' }
];

export default function BuyerDashboardView({ token }) {
  const [data, setData] = useState(null);
  const [cacheMeta, setCacheMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Interactive client-side filters
  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedStage, setSelectedStage] = useState('all');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [showAllAttention, setShowAllAttention] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  const loadDashboard = useCallback(
    async (forceRefresh = false) => {
      if (forceRefresh) setRefreshing(true);
      else setLoading(true);
      setError('');

      try {
        const qs = forceRefresh ? '?refresh=1' : '';
        const res = await fetch(`/api/buyer/${encodeURIComponent(token)}${qs}`, {
          cache: 'no-store'
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) {
          throw new Error(json.message || 'Gagal memuat dashboard WIP.');
        }
        setData(json.data);
        setCacheMeta(json.cache || null);
      } catch (err) {
        setError(err.message || 'Terjadi kesalahan saat memuat data.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token]
  );

  useEffect(() => {
    loadDashboard(false);
  }, [loadDashboard]);

  // Base filtered items (by search + onlyOpen) for status pills counts
  const baseFilteredItems = useMemo(() => {
    const allItems = data?.items || [];
    const q = search.trim().toLowerCase();

    return allItems.filter((item) => {
      if (onlyOpen && item.health_status === 'selesai') return false;
      if (q) {
        const hay = `${item.no_po_kss} ${item.no_po_buyer} ${item.sku} ${item.nama_artikel} ${item.warna} ${item.stage_label}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, search, onlyOpen]);

  // Final filtered items (including clicked status pill & stage bar)
  const filteredItems = useMemo(() => {
    return baseFilteredItems.filter((item) => {
      if (selectedStatus !== 'all' && item.health_status !== selectedStatus) return false;
      if (selectedStage !== 'all' && item.stage_key !== selectedStage) return false;
      return true;
    });
  }, [baseFilteredItems, selectedStatus, selectedStage]);

  const baseAgg = useMemo(() => computeClientAggregates(baseFilteredItems), [baseFilteredItems]);
  const agg = useMemo(() => computeClientAggregates(filteredItems), [filteredItems]);

  const hasActiveFilter =
    Boolean(search.trim()) || selectedStatus !== 'all' || selectedStage !== 'all' || onlyOpen;

  const resetFilters = () => {
    setSearch('');
    setSelectedStatus('all');
    setSelectedStage('all');
    setOnlyOpen(false);
  };

  if (loading) {
    return (
      <div className="buyer-portal-backdrop">
        <div className="buyer-portal-container" style={{ textAlign: 'center', paddingTop: '96px' }}>
          <div
            className="spinner"
            style={{
              margin: '0 auto 14px',
              borderColor: '#e2e8f0',
              borderTopColor: '#2563eb'
            }}
          />
          <p style={{ fontSize: '0.9rem', color: '#64748b' }}>
            Memuat data Monitoring WIP Produksi...
          </p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="buyer-portal-backdrop">
        <div className="buyer-portal-container" style={{ maxWidth: '520px', paddingTop: '88px', textAlign: 'center' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: '#fef2f2',
              color: '#dc2626',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '14px'
            }}
          >
            <AlertCircle size={24} />
          </div>
          <h1 style={{ fontSize: '1.25rem', marginBottom: '8px' }}>Dashboard Tidak Tersedia</h1>
          <p style={{ fontSize: '0.88rem', color: '#64748b', lineHeight: 1.55, marginBottom: '18px' }}>
            {error || 'Link dashboard tidak ditemukan atau sudah dinonaktifkan.'}
          </p>
          <button
            type="button"
            className="buyer-chip-btn"
            onClick={() => loadDashboard(false)}
          >
            <RefreshCw size={14} />
            Coba Muat Ulang
          </button>
        </div>
      </div>
    );
  }

  const { summary, stages, weekly, attention_items: attentionItems } = agg;
  const pillCounts = baseAgg.summary.status_counts;
  const visibleAttention = showAllAttention ? attentionItems : attentionItems.slice(0, 8);

  return (
    <div className="buyer-portal-backdrop">
      <div className="buyer-portal-container">
        {/* Header & Narrative Summary */}
        <header className="buyer-header">
          <h1 className="buyer-title">Monitoring WIP Produksi</h1>
          <p className="buyer-subtitle">
            Progres PO {data.buyer_name}, dari proses produksi hingga siap kirim.
          </p>
          <p className="buyer-narrative">
            Secara keseluruhan <strong>{formatPctId(summary.pct_finish)}%</strong> dari{' '}
            <strong>{formatIntId(summary.total_qty_po)} pcs</strong> sudah selesai;{' '}
            <strong>{formatIntId(summary.status_counts.perlu_perhatian)} item PO</strong> perlu
            perhatian dan{' '}
            <strong>{formatIntId(summary.status_counts.terlambat)} item PO</strong> melewati jadwal
            kirim.
          </p>
        </header>

        {/* Clean Interactive Filter Bar */}
        <div className="buyer-toolbar">
          <div className="buyer-search-wrap">
            <Search size={15} className="buyer-search-icon" />
            <input
              type="text"
              className="buyer-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari No PO KSS, No PO Buyer, SKU, artikel, atau warna..."
            />
          </div>

          <button
            type="button"
            className={`buyer-chip-btn ${onlyOpen ? 'active' : ''}`}
            onClick={() => setOnlyOpen((v) => !v)}
          >
            Belum selesai saja
          </button>

          {selectedStatus !== 'all' && (
            <button
              type="button"
              className="buyer-chip-btn active"
              onClick={() => setSelectedStatus('all')}
            >
              Status: {STATUS_LABELS[selectedStatus]}
              <X size={13} />
            </button>
          )}

          {selectedStage !== 'all' && (
            <button
              type="button"
              className="buyer-chip-btn active"
              onClick={() => setSelectedStage('all')}
            >
              Tahap: {stages.find((s) => s.key === selectedStage)?.label || selectedStage}
              <X size={13} />
            </button>
          )}

          {hasActiveFilter && (
            <button type="button" className="buyer-chip-btn" onClick={resetFilters}>
              Reset
            </button>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
            <button
              type="button"
              className="buyer-chip-btn"
              onClick={() => exportBuyerItemsToCsv(data.buyer_name, filteredItems)}
              disabled={filteredItems.length === 0}
              title="Unduh tabel PO ke file CSV (Excel)"
            >
              <Download size={14} />
              Export CSV
            </button>
            <button
              type="button"
              className="buyer-chip-btn"
              onClick={() => loadDashboard(true)}
              disabled={refreshing}
              title="Perbarui data (otomatis setiap 15 menit)"
            >
              <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
              {refreshing ? 'Memuat...' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* 4 KPI Summary Cards */}
        <section className="buyer-kpi-grid">
          <div className="buyer-kpi-card">
            <div className="buyer-kpi-label">Total Item PO</div>
            <div className="buyer-kpi-value">{formatIntId(summary.total_items)}</div>
            <div className="buyer-kpi-sub">
              dari {formatIntId(summary.total_po_docs)} dokumen PO · sesuai filter
            </div>
          </div>

          <div className="buyer-kpi-card">
            <div className="buyer-kpi-label">Qty PO (pcs)</div>
            <div className="buyer-kpi-value">{formatIntId(summary.total_qty_po)}</div>
            <div className="buyer-kpi-sub">total pesanan</div>
          </div>

          <div className="buyer-kpi-card">
            <div className="buyer-kpi-label">Qty selesai (pcs)</div>
            <div className="buyer-kpi-value">{formatIntId(summary.total_qty_selesai)}</div>
            <div className="buyer-kpi-sub">
              {formatPctId(summary.pct_finish)}% dari total qty PO · SFP {formatIntId(summary.total_qty_sfp)} · Terkirim {formatIntId(summary.total_qty_delivered)}
            </div>
          </div>

          <div className="buyer-kpi-card">
            <div className="buyer-kpi-label">Sisa qty PO (pcs)</div>
            <div className="buyer-kpi-value">{formatIntId(summary.total_qty_sisa)}</div>
            <div className="buyer-kpi-sub">belum selesai diproduksi</div>
          </div>
        </section>

        {/* 4 Status Pills Bar (clickable filters) */}
        <section className="buyer-status-grid">
          {STATUS_PILLS.map((pill) => {
            const isSelected = selectedStatus === pill.key;
            return (
              <button
                key={pill.key}
                type="button"
                className={`buyer-status-pill ${isSelected ? 'active' : ''}`}
                style={{ '--pill-accent': pill.accent }}
                onClick={() =>
                  setSelectedStatus((prev) => (prev === pill.key ? 'all' : pill.key))
                }
                title={`Filter ${pill.label}`}
              >
                <span className="buyer-status-pill-count">
                  {formatIntId(pillCounts[pill.key] || 0)}
                </span>
                <span className="buyer-status-pill-label">{pill.label}</span>
              </button>
            );
          })}
        </section>

        {/* Perlu Perhatian Section */}
        <section className="buyer-section">
          <h2 className="buyer-section-title">Perlu perhatian</h2>
          <p className="buyer-section-sub">
            PO yang sudah lewat atau mendekati tanggal kirim (≤ 7 hari dengan progres &lt; 80%).
          </p>

          {attentionItems.length === 0 ? (
            <div className="buyer-attention-empty">
              Tidak ada PO yang perlu perhatian khusus saat ini.
            </div>
          ) : (
            <div className="buyer-attention-list">
              {visibleAttention.map((item) => {
                const isLate = item.health_status === 'terlambat';
                const dayLabel =
                  item.days_remaining === null
                    ? ''
                    : isLate
                    ? `Lewat ${Math.abs(item.days_remaining)} hari`
                    : item.days_remaining === 0
                    ? 'Jatuh tempo hari ini'
                    : `Sisa ${item.days_remaining} hari`;

                return (
                  <div key={item.id} className="buyer-attention-row">
                    <div className="buyer-attention-main">
                      <div className="buyer-attention-top">
                        <span className={`buyer-badge buyer-badge-${item.health_status}`}>
                          {STATUS_LABELS[item.health_status]}
                          {dayLabel ? ` · ${dayLabel}` : ''}
                        </span>
                        <strong style={{ fontSize: '0.84rem', color: '#0f172a' }}>
                          {item.no_po_kss}
                        </strong>
                        {item.no_po_buyer && item.no_po_buyer !== '-' && (
                          <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                            ({item.no_po_buyer})
                          </span>
                        )}
                      </div>
                      <div className="buyer-attention-meta">
                        {item.nama_artikel} · {item.warna} · Plan Delivery:{' '}
                        <strong style={{ color: isLate ? '#b91c1c' : '#b45309' }}>
                          {formatDateId(item.plan_delivery)}
                        </strong>
                      </div>
                    </div>

                    <div className="buyer-attention-right buyer-num">
                      <span className="buyer-badge buyer-badge-stage">{item.stage_label}</span>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>
                          {formatPctId(item.pct_finish)}%
                        </div>
                        <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                          Sisa {formatIntId(item.qty_sisa)} pcs
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {attentionItems.length > 8 && (
                <div style={{ padding: '10px 16px', textAlign: 'center', background: '#f8fafc' }}>
                  <button
                    type="button"
                    className="buyer-chip-btn"
                    onClick={() => setShowAllAttention((v) => !v)}
                  >
                    {showAllAttention
                      ? 'Ringkas daftar perhatian'
                      : `Lihat semua ${formatIntId(attentionItems.length)} item perlu perhatian`}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Side-by-side Charts */}
        <BuyerCharts
          stages={stages}
          weekly={weekly}
          unscheduledCount={summary.unscheduled_count}
          unscheduledQty={summary.unscheduled_qty}
          selectedStage={selectedStage}
          onToggleStage={(key) => setSelectedStage((prev) => (prev === key ? 'all' : key))}
        />

        {/* Daftar PO Table */}
        <BuyerPoTable items={filteredItems} />

        {/* Collapsible Cara membaca dashboard */}
        <section style={{ marginTop: '14px' }}>
          <button
            type="button"
            className="buyer-guide-btn"
            onClick={() => setGuideOpen((v) => !v)}
          >
            {guideOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            Cara membaca dashboard
          </button>

          {guideOpen && (
            <div className="buyer-guide-box">
              <p style={{ margin: 0 }}>
                Dashboard ini menampilkan progres produksi pesanan (PO) Anda secara otomatis dari
                sistem produksi PT Kanti Sehati Sukses.
              </p>
              <ul>
                <li>
                  <strong>Siap Kirim (SFP) &amp; Terkirim:</strong> <em>Siap Kirim (SFP)</em> adalah
                  qty barang yang sudah lulus QC dan masuk gudang siap kirim; <em>Terkirim</em>{' '}
                  adalah qty yang telah dikirim. <em>Qty selesai</em> mengambil nilai terbesar di
                  antara keduanya, dan tetap menampilkan qty aktual apabila terdapat kelebihan hasil
                  produksi.
                </li>
                <li>
                  <strong>Status Kesehatan PO:</strong> <em>Selesai</em> jika progres ≥ 100%;{' '}
                  <em>Terlambat</em> jika belum selesai dan sudah melewati tanggal Plan Delivery;{' '}
                  <em>Perlu Perhatian</em> jika belum selesai, belum melewati Plan Delivery, sisa
                  waktu ≤ 7 hari, dan progres (% Finish) masih di bawah 80%; selebihnya{' '}
                  <em>On Track</em>.
                </li>
                <li>
                  <strong>Posisi produksi per tahap:</strong> menunjukkan tahap WIP aktual setiap
                  item (Persiapan Bahan → Celup / Print → Cutting → Jahit → QC &amp; Packing →
                  Selesai). Klik salah satu tahap atau kartu status di atas untuk menyaring tabel.
                </li>
                <li>
                  <strong>Pembaruan data:</strong> data disinkronkan otomatis setiap 15 menit.
                </li>
              </ul>
            </div>
          )}
        </section>

        {/* Footer Timestamp */}
        <footer className="buyer-footer">
          Data as of {formatSyncedAtWib(data.synced_at)}.
          {cacheMeta?.refreshing && ' · Memperbarui data terbaru di latar belakang...'}
        </footer>
      </div>
    </div>
  );
}
