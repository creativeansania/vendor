'use client';

import { useState } from 'react';
import {
  Search,
  Download,
  RefreshCw,
  SlidersHorizontal,
  X,
  RotateCcw
} from 'lucide-react';
import {
  WIP_STAGES_CLIENT,
  STATUS_LABELS,
  formatMonthId,
  formatDateId,
  formatWeekRangeId
} from '@/lib/buyerDashboardClient';

export default function BuyerFilterPanel({
  filters,
  onChangeFilter,
  onResetAll,
  options,
  activeFilterCount,
  refreshing,
  onRefresh,
  onExportCsv,
  canExport
}) {
  const [expanded, setExpanded] = useState(true);

  const chips = [];
  if (filters.onlyOpen) {
    chips.push({ key: 'onlyOpen', label: 'Belum selesai saja', onClear: () => onChangeFilter('onlyOpen', false) });
  }
  if (filters.status !== 'all') {
    chips.push({
      key: 'status',
      label: `Status: ${STATUS_LABELS[filters.status] || filters.status}`,
      onClear: () => onChangeFilter('status', 'all')
    });
  }
  if (filters.stage !== 'all') {
    const st = WIP_STAGES_CLIENT.find((s) => s.key === filters.stage);
    chips.push({
      key: 'stage',
      label: `Tahap: ${st?.label || filters.stage}`,
      onClear: () => onChangeFilter('stage', 'all')
    });
  }
  if (filters.deliveryMonth !== 'all') {
    const label =
      filters.deliveryMonth === '__unscheduled__'
        ? 'Plan Delivery: Belum dijadwalkan'
        : `Bulan Kirim: ${formatMonthId(filters.deliveryMonth)}`;
    chips.push({
      key: 'deliveryMonth',
      label,
      onClear: () => onChangeFilter('deliveryMonth', 'all')
    });
  }
  if (filters.week !== 'all') {
    chips.push({
      key: 'week',
      label: `Minggu Kirim: ${formatWeekRangeId(filters.week)}`,
      onClear: () => onChangeFilter('week', 'all')
    });
  }
  if (filters.planFrom || filters.planTo) {
    const fromTxt = filters.planFrom ? formatDateId(filters.planFrom) : 'Awal';
    const toTxt = filters.planTo ? formatDateId(filters.planTo) : 'Akhir';
    chips.push({
      key: 'planRange',
      label: `Plan Delivery: ${fromTxt} – ${toTxt}`,
      onClear: () => {
        onChangeFilter('planFrom', '');
        onChangeFilter('planTo', '');
      }
    });
  }
  if (filters.poFrom || filters.poTo) {
    const fromTxt = filters.poFrom ? formatDateId(filters.poFrom) : 'Awal';
    const toTxt = filters.poTo ? formatDateId(filters.poTo) : 'Akhir';
    chips.push({
      key: 'poRange',
      label: `Tgl PO: ${fromTxt} – ${toTxt}`,
      onClear: () => {
        onChangeFilter('poFrom', '');
        onChangeFilter('poTo', '');
      }
    });
  }
  if (filters.poNumber !== 'all') {
    chips.push({
      key: 'poNumber',
      label: `PO: ${filters.poNumber}`,
      onClear: () => onChangeFilter('poNumber', 'all')
    });
  }
  if (filters.artikel !== 'all') {
    chips.push({
      key: 'artikel',
      label: `Artikel: ${filters.artikel}`,
      onClear: () => onChangeFilter('artikel', 'all')
    });
  }
  if (filters.warna !== 'all') {
    chips.push({
      key: 'warna',
      label: `Warna: ${filters.warna}`,
      onClear: () => onChangeFilter('warna', 'all')
    });
  }

  return (
    <div className="buyer-filter-panel">
      {/* Top Row: Search, Quick Toggle, Collapse Filter, Export & Refresh */}
      <div className="buyer-toolbar">
        <div className="buyer-search-wrap">
          <Search size={15} className="buyer-search-icon" />
          <input
            type="text"
            className="buyer-search-input"
            value={filters.search}
            onChange={(e) => onChangeFilter('search', e.target.value)}
            placeholder="Cari No PO KSS, No PO Buyer, SKU, artikel, atau warna..."
          />
        </div>

        <button
          type="button"
          className={`buyer-chip-btn ${filters.onlyOpen ? 'active' : ''}`}
          onClick={() => onChangeFilter('onlyOpen', !filters.onlyOpen)}
        >
          Belum selesai saja
        </button>

        <button
          type="button"
          className={`buyer-chip-btn ${expanded ? 'active' : ''}`}
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Sembunyikan panel filter' : 'Tampilkan semua opsi filter'}
        >
          <SlidersHorizontal size={14} />
          Filter
          {activeFilterCount > 0 && (
            <span className="buyer-filter-count-badge">{activeFilterCount}</span>
          )}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
          {activeFilterCount > 0 && (
            <button
              type="button"
              className="buyer-chip-btn"
              onClick={onResetAll}
              title="Hapus semua filter aktif"
            >
              <RotateCcw size={13} />
              Reset
            </button>
          )}
          <button
            type="button"
            className="buyer-chip-btn"
            onClick={onExportCsv}
            disabled={!canExport}
            title="Unduh tabel PO sesuai filter ke file CSV (Excel)"
          >
            <Download size={14} />
            Export CSV
          </button>
          <button
            type="button"
            className="buyer-chip-btn"
            onClick={onRefresh}
            disabled={refreshing}
            title="Perbarui data (otomatis disinkronkan tiap 15 menit)"
          >
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
            {refreshing ? 'Memuat...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Expanded 4x2 Structured Filter Grid */}
      {expanded && (
        <div className="buyer-filter-grid">
          {/* 1. No PO (KSS / Buyer) */}
          <div className="buyer-filter-field">
            <label className="buyer-filter-label" htmlFor="bf-po">
              No PO (KSS / Buyer)
            </label>
            <select
              id="bf-po"
              className="buyer-select"
              value={filters.poNumber}
              onChange={(e) => onChangeFilter('poNumber', e.target.value)}
            >
              <option value="all">Semua PO ({options.poNumbers.length})</option>
              {options.poNumbers.map((po) => (
                <option key={po.kss} value={po.kss}>
                  {po.label}
                </option>
              ))}
            </select>
          </div>

          {/* 2. Nama Artikel */}
          <div className="buyer-filter-field">
            <label className="buyer-filter-label" htmlFor="bf-artikel">
              Nama Artikel
            </label>
            <select
              id="bf-artikel"
              className="buyer-select"
              value={filters.artikel}
              onChange={(e) => onChangeFilter('artikel', e.target.value)}
            >
              <option value="all">Semua Artikel ({options.artikels.length})</option>
              {options.artikels.map((art) => (
                <option key={art} value={art}>
                  {art}
                </option>
              ))}
            </select>
          </div>

          {/* 3. Warna (cascading based on selected PO / Artikel) */}
          <div className="buyer-filter-field">
            <label className="buyer-filter-label" htmlFor="bf-warna">
              Warna
            </label>
            <select
              id="bf-warna"
              className="buyer-select"
              value={filters.warna}
              onChange={(e) => onChangeFilter('warna', e.target.value)}
            >
              <option value="all">Semua Warna ({options.warnas.length})</option>
              {options.warnas.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>

          {/* 4. Status PO */}
          <div className="buyer-filter-field">
            <label className="buyer-filter-label" htmlFor="bf-status">
              Status PO
            </label>
            <select
              id="bf-status"
              className="buyer-select"
              value={filters.status}
              onChange={(e) => onChangeFilter('status', e.target.value)}
            >
              <option value="all">Semua Status</option>
              <option value="selesai">Selesai</option>
              <option value="on_track">On Track</option>
              <option value="perlu_perhatian">Perlu Perhatian</option>
              <option value="terlambat">Terlambat</option>
            </select>
          </div>

          {/* 5. Tahap WIP */}
          <div className="buyer-filter-field">
            <label className="buyer-filter-label" htmlFor="bf-stage">
              Tahap WIP Produksi
            </label>
            <select
              id="bf-stage"
              className="buyer-select"
              value={filters.stage}
              onChange={(e) => onChangeFilter('stage', e.target.value)}
            >
              <option value="all">Semua Tahap</option>
              {WIP_STAGES_CLIENT.map((st) => (
                <option key={st.key} value={st.key}>
                  {st.label}
                </option>
              ))}
            </select>
          </div>

          {/* 6. Bulan Plan Delivery */}
          <div className="buyer-filter-field">
            <label className="buyer-filter-label" htmlFor="bf-month">
              Bulan Plan Delivery
            </label>
            <select
              id="bf-month"
              className="buyer-select"
              value={filters.deliveryMonth}
              onChange={(e) => onChangeFilter('deliveryMonth', e.target.value)}
            >
              <option value="all">Semua Bulan ({options.deliveryMonths.length})</option>
              {options.deliveryMonths.map((m) => (
                <option key={m.key} value={m.key}>
                  {formatMonthId(m.key)} ({m.count} item)
                </option>
              ))}
              {options.hasUnscheduled && (
                <option value="__unscheduled__">Belum dijadwalkan</option>
              )}
            </select>
          </div>

          {/* 7. Rentang Plan Delivery (Dari – Sampai) */}
          <div className="buyer-filter-field">
            <label className="buyer-filter-label">Rentang Plan Delivery</label>
            <div className="buyer-date-pair">
              <input
                type="date"
                aria-label="Plan Delivery Dari"
                className="buyer-date-input"
                value={filters.planFrom}
                onChange={(e) => onChangeFilter('planFrom', e.target.value)}
              />
              <span className="buyer-date-sep">–</span>
              <input
                type="date"
                aria-label="Plan Delivery Sampai"
                className="buyer-date-input"
                value={filters.planTo}
                onChange={(e) => onChangeFilter('planTo', e.target.value)}
              />
            </div>
          </div>

          {/* 8. Rentang Tanggal PO (Dari – Sampai) */}
          <div className="buyer-filter-field">
            <label className="buyer-filter-label">Rentang Tanggal PO</label>
            <div className="buyer-date-pair">
              <input
                type="date"
                aria-label="Tanggal PO Dari"
                className="buyer-date-input"
                value={filters.poFrom}
                onChange={(e) => onChangeFilter('poFrom', e.target.value)}
              />
              <span className="buyer-date-sep">–</span>
              <input
                type="date"
                aria-label="Tanggal PO Sampai"
                className="buyer-date-input"
                value={filters.poTo}
                onChange={(e) => onChangeFilter('poTo', e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Active Removable Filter Chips */}
      {chips.length > 0 && (
        <div className="buyer-active-chips">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="buyer-active-chip"
              onClick={chip.onClear}
              title="Klik untuk hapus filter ini"
            >
              <span>{chip.label}</span>
              <X size={12} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
