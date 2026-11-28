'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  RefreshCw,
  ChevronRight,
  ChevronDown,
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
  getMondayWeekKeyClient,
  STATUS_LABELS
} from '@/lib/buyerDashboardClient';
import BuyerFilterPanel from './BuyerFilterPanel';
import BuyerCharts from './BuyerCharts';
import BuyerPoTable from './BuyerPoTable';

const STATUS_PILLS = [
  { key: 'selesai', label: 'PO selesai', accent: '#047857' },
  { key: 'on_track', label: 'PO on track', accent: '#2563eb' },
  { key: 'perlu_perhatian', label: 'PO perlu perhatian', accent: '#d97706' },
  { key: 'terlambat', label: 'PO terlambat', accent: '#dc2626' }
];

const INITIAL_FILTERS = {
  search: '',
  onlyOpen: false,
  status: 'all',
  stage: 'all',
  poNumber: 'all',
  artikel: 'all',
  warna: 'all',
  deliveryMonth: 'all',
  week: 'all',
  planFrom: '',
  planTo: '',
  poFrom: '',
  poTo: ''
};

function matchesCoreFilters(item, f, excludeKeys = []) {
  const skip = new Set(excludeKeys);

  if (!skip.has('onlyOpen') && f.onlyOpen && item.health_status === 'selesai') {
    return false;
  }
  if (!skip.has('status') && f.status !== 'all' && item.health_status !== f.status) {
    return false;
  }
  if (!skip.has('stage') && f.stage !== 'all' && item.stage_key !== f.stage) {
    return false;
  }
  if (!skip.has('poNumber') && f.poNumber !== 'all' && item.no_po_kss !== f.poNumber) {
    return false;
  }
  if (!skip.has('artikel') && f.artikel !== 'all' && item.nama_artikel !== f.artikel) {
    return false;
  }
  if (!skip.has('warna') && f.warna !== 'all' && item.warna !== f.warna) {
    return false;
  }
  if (!skip.has('deliveryMonth') && f.deliveryMonth !== 'all') {
    if (f.deliveryMonth === '__unscheduled__') {
      if (item.plan_delivery) return false;
    } else if (!item.plan_delivery || !item.plan_delivery.startsWith(f.deliveryMonth)) {
      return false;
    }
  }
  if (!skip.has('week') && f.week !== 'all') {
    const wk = getMondayWeekKeyClient(item.plan_delivery);
    if (wk !== f.week) return false;
  }
  if (!skip.has('planRange') && (f.planFrom || f.planTo)) {
    if (!item.plan_delivery) return false;
    if (f.planFrom && item.plan_delivery < f.planFrom) return false;
    if (f.planTo && item.plan_delivery > f.planTo) return false;
  }
  if (!skip.has('poRange') && (f.poFrom || f.poTo)) {
    if (!item.tgl_po) return false;
    if (f.poFrom && item.tgl_po < f.poFrom) return false;
    if (f.poTo && item.tgl_po > f.poTo) return false;
  }
  if (!skip.has('search') && f.search.trim()) {
    const q = f.search.trim().toLowerCase();
    const hay = `${item.no_po_kss} ${item.no_po_buyer} ${item.sku} ${item.nama_artikel} ${item.warna} ${item.stage_label}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }

  return true;
}

export default function BuyerDashboardView({ token }) {
  const [data, setData] = useState(null);
  const [cacheMeta, setCacheMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [filters, setFilters] = useState(INITIAL_FILTERS);
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

  const handleChangeFilter = useCallback((key, value) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      // Keep cascading dropdowns consistent: reset warna if artikel/PO changed and warna is no longer valid
      if (key === 'artikel' || key === 'poNumber') {
        next.warna = 'all';
      }
      // If user picks a specific Plan Delivery month, clear conflicting week click
      if (key === 'deliveryMonth' && value !== 'all') {
        next.week = 'all';
      }
      return next;
    });
  }, []);

  const handleResetFilters = useCallback(() => {
    setFilters(INITIAL_FILTERS);
  }, []);

  const allItems = useMemo(() => data?.items || [], [data]);

  // Dynamic dropdown option lists derived from live buyer data
  const filterOptions = useMemo(() => {
    const poMap = new Map();
    const artikelSet = new Set();
    const monthCountMap = new Map();
    let hasUnscheduled = false;

    for (const item of allItems) {
      if (item.no_po_kss && !poMap.has(item.no_po_kss)) {
        const buyerRef =
          item.no_po_buyer && item.no_po_buyer !== '-' ? ` (${item.no_po_buyer})` : '';
        poMap.set(item.no_po_kss, {
          kss: item.no_po_kss,
          label: `${item.no_po_kss}${buyerRef}`
        });
      }
      if (item.nama_artikel) artikelSet.add(item.nama_artikel);
      if (item.plan_delivery && item.plan_delivery.length >= 7) {
        const ym = item.plan_delivery.slice(0, 7);
        monthCountMap.set(ym, (monthCountMap.get(ym) || 0) + 1);
      } else {
        hasUnscheduled = true;
      }
    }

    // Warna options cascade cleanly from selected PO & Artikel
    const warnaSet = new Set();
    for (const item of allItems) {
      if (filters.poNumber !== 'all' && item.no_po_kss !== filters.poNumber) continue;
      if (filters.artikel !== 'all' && item.nama_artikel !== filters.artikel) continue;
      if (item.warna) warnaSet.add(item.warna);
    }

    return {
      poNumbers: Array.from(poMap.values()).sort((a, b) => a.kss.localeCompare(b.kss)),
      artikels: Array.from(artikelSet).sort((a, b) => a.localeCompare(b)),
      warnas: Array.from(warnaSet).sort((a, b) => a.localeCompare(b)),
      deliveryMonths: Array.from(monthCountMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, count]) => ({ key, count })),
      hasUnscheduled
    };
  }, [allItems, filters.poNumber, filters.artikel]);

  // Final filtered items (drives KPIs, narrative, Perlu Perhatian, Daftar PO, CSV export)
  const filteredItems = useMemo(
    () => allItems.filter((item) => matchesCoreFilters(item, filters)),
    [allItems, filters]
  );

  // Cross-filter slices so status pills, stage bars, and weekly columns remain easy to switch
  const itemsForStatusPills = useMemo(
    () => allItems.filter((item) => matchesCoreFilters(item, filters, ['status'])),
    [allItems, filters]
  );
  const itemsForStages = useMemo(
    () => allItems.filter((item) => matchesCoreFilters(item, filters, ['stage'])),
    [allItems, filters]
  );
  const itemsForWeekly = useMemo(
    () => allItems.filter((item) => matchesCoreFilters(item, filters, ['week'])),
    [allItems, filters]
  );

  const agg = useMemo(() => computeClientAggregates(filteredItems), [filteredItems]);
  const statusPillsAgg = useMemo(
    () => computeClientAggregates(itemsForStatusPills),
    [itemsForStatusPills]
  );
  const stagesAgg = useMemo(() => computeClientAggregates(itemsForStages), [itemsForStages]);
  const weeklyAgg = useMemo(() => computeClientAggregates(itemsForWeekly), [itemsForWeekly]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.search.trim()) n++;
    if (filters.onlyOpen) n++;
    if (filters.status !== 'all') n++;
    if (filters.stage !== 'all') n++;
    if (filters.poNumber !== 'all') n++;
    if (filters.artikel !== 'all') n++;
    if (filters.warna !== 'all') n++;
    if (filters.deliveryMonth !== 'all') n++;
    if (filters.week !== 'all') n++;
    if (filters.planFrom || filters.planTo) n++;
    if (filters.poFrom || filters.poTo) n++;
    return n;
  }, [filters]);

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

  const { summary, attention_items: attentionItems } = agg;
  const pillCounts = statusPillsAgg.summary.status_counts;
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

        {/* Full Interactive Filter Panel */}
        <BuyerFilterPanel
          filters={filters}
          onChangeFilter={handleChangeFilter}
          onResetAll={handleResetFilters}
          options={filterOptions}
          activeFilterCount={activeFilterCount}
          refreshing={refreshing}
          onRefresh={() => loadDashboard(true)}
          onExportCsv={() => exportBuyerItemsToCsv(data.buyer_name, filteredItems)}
          canExport={filteredItems.length > 0}
        />

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
            const isSelected = filters.status === pill.key;
            return (
              <button
                key={pill.key}
                type="button"
                className={`buyer-status-pill ${isSelected ? 'active' : ''}`}
                style={{ '--pill-accent': pill.accent }}
                onClick={() =>
                  handleChangeFilter('status', filters.status === pill.key ? 'all' : pill.key)
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

        {/* Side-by-side Interactive Charts */}
        <BuyerCharts
          stages={stagesAgg.stages}
          weekly={weeklyAgg.weekly}
          unscheduledCount={weeklyAgg.summary.unscheduled_count}
          unscheduledQty={weeklyAgg.summary.unscheduled_qty}
          selectedStage={filters.stage}
          onToggleStage={(key) =>
            handleChangeFilter('stage', filters.stage === key ? 'all' : key)
          }
          selectedWeek={filters.week}
          onToggleWeek={(wk) =>
            handleChangeFilter('week', filters.week === wk ? 'all' : wk)
          }
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
                  <strong>Tahap WIP Produksi:</strong> ditentukan otomatis berdasarkan kategori
                  produksi (<em>POLOS</em> / <em>DIGITAL PRINT</em>), SPK manufaktur, dan Purchase
                  Order bahan baku pabrikan: Persiapan Bahan → Dyeing / Printing (SPK Pabrik Celup
                  atau PO bahan baku terkonfirmasi) → Digital Printing (khusus motif print) →
                  Cutting, Sewing &amp; Finishing → Close / Selesai (seluruh SPK selesai atau
                  progres ≥ 100%).
                </li>
                <li>
                  <strong>Filter &amp; Grafik Interaktif:</strong> gunakan panel filter di atas
                  (No PO, Artikel, Warna, Status, Tahap WIP, Bulan/Rentang Plan Delivery, Rentang
                  Tgl PO) atau klik langsung kartu status, batang tahap WIP, maupun batang minggu
                  pada grafik <em>Jadwal kirim per minggu</em>.
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
