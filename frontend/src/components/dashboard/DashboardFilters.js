'use client';

import { Search, X, Building2, ArrowUpDown, Calendar, Filter } from 'lucide-react';

export default function DashboardFilters({
  search,
  onSearchChange,
  onSearchSubmit,
  onClearSearch,
  vendors = [],
  selectedVendor,
  onSelectVendor,
  sort,
  onSortChange,
  period,
  onPeriodChange,
  backorderFilter,
  onBackorderFilterChange,
  hasActiveFilters,
  totalCount,
  status,
  onResetFilters,
  metrics,
  activeKainKurangBadge,
  onToggleStatus
}) {
  return (
    <div className="card" style={{ padding: '16px', borderRadius: '16px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* Search Bar */}
        <form onSubmit={onSearchSubmit} style={{ display: 'flex', gap: '8px', width: '100%' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
            <Search size={18} color="var(--text-muted)" style={{ position: 'absolute', left: '14px', pointerEvents: 'none' }} />
            <input
              type="text"
              placeholder="Ketik 4 angka nomor SPK (misal: 1495) atau nama produk..."
              className="input-field"
              style={{
                paddingLeft: '40px',
                paddingRight: search ? '40px' : '14px',
                height: '44px',
                fontSize: '0.92rem',
                borderRadius: '12px',
                fontWeight: 500
              }}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={onClearSearch}
                style={{
                  position: 'absolute',
                  right: '10px',
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: 'var(--bg-card-hover)',
                  border: '1px solid var(--border-default)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  transition: 'all 0.15s ease'
                }}
                title="Hapus ketikan pencarian"
              >
                <X size={15} />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ height: '44px', padding: '0 20px', fontSize: '0.9rem', flexShrink: 0, borderRadius: '12px', fontWeight: 700 }}
          >
            Cari
          </button>
        </form>

        {/* Extended Controls: Vendor, Sort, Period, Type */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', width: '100%' }}>
          {/* Vendor Selector for internal staff */}
          {vendors.length > 0 && (
            <div style={{ minWidth: 0 }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Building2 size={13} /> Mitra CMT / Vendor
              </label>
              <select
                className="select-field"
                style={{ height: '40px', fontSize: '0.84rem', borderRadius: '10px' }}
                value={selectedVendor}
                onChange={(e) => onSelectVendor(e.target.value)}
              >
                <option value="">Semua Vendor ({vendors.length})</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.code})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Sorting Selector */}
          <div style={{ minWidth: 0 }}>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <ArrowUpDown size={13} /> Urutan (Sort)
            </label>
            <select
              className="select-field"
              style={{ height: '40px', fontSize: '0.84rem', borderRadius: '10px' }}
              value={sort}
              onChange={(e) => onSortChange(e.target.value)}
            >
              <option value="latest">🆕 SPK Terbaru Dibuat</option>
              <option value="deadline_asc">⏳ Deadline Paling Dekat</option>
              <option value="deadline_desc">📅 Deadline Paling Jauh</option>
              <option value="qty_desc">📦 Target SPK Terbesar</option>
              <option value="qty_asc">🔹 Target SPK Terkecil</option>
              <option value="oldest">⌛ SPK Terlama (FIFO)</option>
            </select>
          </div>

          {/* Period Selector */}
          <div style={{ minWidth: 0 }}>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Calendar size={13} /> Periode Mulai SPK
            </label>
            <select
              className="select-field"
              style={{ height: '40px', fontSize: '0.84rem', borderRadius: '10px' }}
              value={period}
              onChange={(e) => onPeriodChange(e.target.value)}
            >
              <option value="">Semua Waktu</option>
              <option value="this_month">📅 Bulan Ini (Mulai SPK)</option>
              <option value="last_month">🗓️ Bulan Lalu (Mulai SPK)</option>
            </select>
          </div>

          {/* Backorder / Regular Selector */}
          <div style={{ minWidth: 0 }}>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Filter size={13} /> Tipe Produksi
            </label>
            <select
              className="select-field"
              style={{ height: '40px', fontSize: '0.84rem', borderRadius: '10px' }}
              value={backorderFilter}
              onChange={(e) => onBackorderFilterChange(e.target.value)}
            >
              <option value="">Semua Tipe SPK</option>
              <option value="regular">📋 SPK Induk / Reguler Saja</option>
              <option value="backorder">🔄 SPK Backorder Saja</option>
            </select>
          </div>
        </div>

        {/* Active Filters Summary Banner */}
        {hasActiveFilters && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              background: 'var(--bg-card-subtle)',
              border: '1px solid var(--border-default)',
              borderRadius: '10px',
              fontSize: '0.82rem',
              flexWrap: 'wrap',
              gap: '8px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Filter aktif:</span>
              {search.trim() && (
                <span style={{ background: 'var(--bg-card-subtle)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                  Cari: "{search}"
                </span>
              )}
              {status !== 'all' && (
                <span style={{ background: 'var(--status-sky-bg)', border: '1px solid var(--status-sky-border)', color: 'var(--status-sky)', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
                  Status: {status}
                </span>
              )}
              {selectedVendor && (
                <span style={{ background: 'var(--status-purple-bg)', border: '1px solid var(--status-purple-border)', color: 'var(--status-purple)', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                  Vendor: {vendors.find((v) => String(v.id) === String(selectedVendor))?.name || selectedVendor}
                </span>
              )}
              {sort !== 'latest' && (
                <span style={{ background: 'var(--status-emerald-bg)', border: '1px solid var(--status-emerald-border)', color: 'var(--status-emerald)', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                  Sort: {sort === 'deadline_asc' ? 'Deadline Terdekat' : sort === 'qty_desc' ? 'Qty Terbesar' : sort}
                </span>
              )}
              {period && (
                <span style={{ background: 'var(--status-amber-bg)', border: '1px solid var(--status-amber-border)', color: 'var(--status-amber)', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                  Periode: {period === 'this_month' ? 'Bulan Ini' : period === 'last_month' ? 'Bulan Lalu' : period}
                </span>
              )}
              {backorderFilter && (
                <span style={{ background: 'var(--bg-card-subtle)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                  Tipe: {backorderFilter === 'regular' ? 'Reguler' : 'Backorder'}
                </span>
              )}
              <span style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>({totalCount} SPK sesuai filter)</span>
            </div>
            <button
              type="button"
              onClick={onResetFilters}
              className="quick-action-pill"
              style={{
                fontSize: '0.74rem',
                background: 'var(--bg-card)',
                borderColor: 'var(--border-strong)',
                color: 'var(--text-secondary)',
                height: '28px'
              }}
              title="Kembalikan semua filter ke awal"
            >
              <X size={13} />
              <span>Reset Filter</span>
            </button>
          </div>
        )}

        {/* Status Filter Chips (Fluid Touch Scroll) */}
        <div className="filter-bar">
          <button
            className={`filter-chip ${status === 'all' ? 'active' : ''}`}
            onClick={() => onToggleStatus('all')}
          >
            Semua ({metrics.total || totalCount})
          </button>
          <button
            className={`filter-chip ${status === 'cutting_pending' ? 'active' : ''}`}
            onClick={() => onToggleStatus('cutting_pending')}
          >
            ✂️ Belum Potong ({metrics.cutting_pending})
          </button>
          <button
            className={`filter-chip ${status === 'cutting_locked' ? 'active' : ''}`}
            onClick={() => onToggleStatus('cutting_locked')}
          >
            🔒 Sedang Jahit ({metrics.sewing_active})
          </button>
          <button
            className={`filter-chip ${status === 'kain_kurang' ? 'active' : ''}`}
            onClick={() => onToggleStatus('kain_kurang')}
            style={
              status === 'kain_kurang'
                ? {
                    background: 'var(--status-rose-bg)',
                    borderColor: 'var(--status-rose)',
                    color: 'var(--status-rose)',
                    fontWeight: 800,
                    boxShadow: '0 2px 8px rgba(244, 63, 94, 0.25)'
                  }
                : metrics.kain_kurang > 0
                ? {
                    borderColor: 'var(--status-rose-border)',
                    color: 'var(--status-rose)',
                    background: 'var(--status-rose-bg)',
                    fontWeight: 700
                  }
                : {}
            }
          >
            ⚠️ Kain Kurang ({metrics.kain_kurang || activeKainKurangBadge || 0})
          </button>
          <button
            className={`filter-chip ${status === 'overdue' ? 'active' : ''}`}
            onClick={() => onToggleStatus('overdue')}
            style={
              status === 'overdue'
                ? {
                    background: 'var(--status-amber-bg)',
                    borderColor: 'var(--status-amber)',
                    color: 'var(--status-amber)',
                    fontWeight: 800,
                    boxShadow: '0 2px 8px var(--brand-gold-glow)'
                  }
                : metrics.overdue > 0
                ? {
                    borderColor: 'var(--status-amber-border)',
                    color: 'var(--status-amber)',
                    background: 'var(--status-amber-bg)',
                    fontWeight: 600
                  }
                : {}
            }
          >
            🔥 Overdue ({metrics.overdue})
          </button>
          <button
            className={`filter-chip ${status === 'deadline_week' ? 'active' : ''}`}
            onClick={() => onToggleStatus('deadline_week')}
          >
            ⏰ Deadline 7 Hari ({metrics.deadline_week})
          </button>
          <button
            className={`filter-chip ${status === 'backorder' ? 'active' : ''}`}
            onClick={() => onToggleStatus('backorder')}
          >
            🔄 Backorder ({metrics.backorder_count})
          </button>
          <button
            className={`filter-chip ${status === 'result_locked' ? 'active' : ''}`}
            onClick={() => onToggleStatus('result_locked')}
          >
            ✅ Selesai ({metrics.result_locked})
          </button>
        </div>
      </div>
    </div>
  );
}
