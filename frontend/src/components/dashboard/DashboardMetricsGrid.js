'use client';

import { Layers, Scissors, Lock, AlertTriangle, Flame, CheckCircle2 } from 'lucide-react';

export default function DashboardMetricsGrid({ metrics, totalCount, status, onToggleStatus }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: '10px'
      }}
    >
      {/* Card 1: Total SPK */}
      <div
        onClick={() => onToggleStatus('all')}
        className="card metric-card"
        style={{
          cursor: 'pointer',
          border: status === 'all' ? '2px solid var(--brand-gold)' : '1px solid var(--border-default)',
          boxShadow: status === 'all' ? '0 4px 14px rgba(217, 119, 6, 0.15)' : 'none',
          transform: status === 'all' ? 'scale(1.02)' : 'none',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          background: status === 'all' ? 'rgba(217, 119, 6, 0.04)' : 'var(--bg-card)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="metric-label" style={{ fontSize: '0.68rem' }}>Semua SPK</span>
          <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'var(--status-sky-bg)', color: 'var(--status-sky)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Layers size={14} />
          </div>
        </div>
        <div className="metric-value mono-num" style={{ fontSize: '1.45rem', marginTop: '4px' }}>
          {metrics.total || totalCount}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Sinkron Odoo</span>
          {status === 'all' && (
            <span style={{ fontSize: '0.64rem', fontWeight: 700, color: 'var(--brand-gold)', background: 'rgba(217, 119, 6, 0.12)', padding: '1px 6px', borderRadius: '4px' }}>Aktif</span>
          )}
        </div>
      </div>

      {/* Card 2: Perlu Potong */}
      <div
        onClick={() => onToggleStatus('cutting_pending')}
        className="card metric-card"
        style={{
          cursor: 'pointer',
          border: status === 'cutting_pending' ? '2px solid var(--brand-gold)' : '1px solid var(--border-default)',
          boxShadow: status === 'cutting_pending' ? '0 4px 14px var(--brand-gold-glow)' : 'none',
          transform: status === 'cutting_pending' ? 'scale(1.02)' : 'none',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          background: status === 'cutting_pending' ? 'var(--brand-gold-light)' : 'var(--bg-card)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="metric-label" style={{ fontSize: '0.68rem', color: 'var(--brand-gold)' }}>Perlu Potong</span>
          <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'var(--brand-gold-light)', color: 'var(--brand-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Scissors size={14} />
          </div>
        </div>
        <div className="metric-value mono-num" style={{ fontSize: '1.45rem', color: 'var(--brand-gold)', marginTop: '4px' }}>
          {metrics.cutting_pending}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--brand-gold)' }}>Antrean Meja</span>
          {status === 'cutting_pending' && (
            <span style={{ fontSize: '0.64rem', fontWeight: 700, color: 'var(--brand-gold)', background: 'var(--brand-gold-light)', padding: '1px 6px', borderRadius: '4px' }}>Aktif</span>
          )}
        </div>
      </div>

      {/* Card 3: Sedang Jahit */}
      <div
        onClick={() => onToggleStatus('cutting_locked')}
        className="card metric-card"
        style={{
          cursor: 'pointer',
          border: status === 'cutting_locked' ? '2px solid var(--status-sky)' : '1px solid var(--border-default)',
          boxShadow: status === 'cutting_locked' ? '0 4px 14px rgba(14, 165, 233, 0.2)' : 'none',
          transform: status === 'cutting_locked' ? 'scale(1.02)' : 'none',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          background: status === 'cutting_locked' ? 'var(--status-sky-bg)' : 'var(--bg-card)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="metric-label" style={{ fontSize: '0.68rem', color: 'var(--status-sky)' }}>Sedang Jahit</span>
          <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'var(--status-sky-bg)', color: 'var(--status-sky)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Lock size={14} />
          </div>
        </div>
        <div className="metric-value mono-num" style={{ fontSize: '1.45rem', color: 'var(--status-sky)', marginTop: '4px' }}>
          {metrics.sewing_active}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--status-sky)' }}>Proses Sewing</span>
          {status === 'cutting_locked' && (
            <span style={{ fontSize: '0.64rem', fontWeight: 700, color: 'var(--status-sky)', background: 'var(--status-sky-bg)', padding: '1px 6px', borderRadius: '4px' }}>Aktif</span>
          )}
        </div>
      </div>

      {/* Card 4: Kain Kurang */}
      <div
        onClick={() => onToggleStatus('kain_kurang')}
        className="card metric-card"
        style={{
          cursor: 'pointer',
          border: status === 'kain_kurang' ? '2px solid var(--status-rose)' : (metrics.kain_kurang > 0 ? '1px solid var(--status-rose-border)' : '1px solid var(--border-default)'),
          boxShadow: status === 'kain_kurang' ? '0 4px 14px rgba(244, 63, 94, 0.2)' : 'none',
          transform: status === 'kain_kurang' ? 'scale(1.02)' : 'none',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          background: status === 'kain_kurang' || metrics.kain_kurang > 0 ? 'var(--status-rose-bg)' : 'var(--bg-card)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="metric-label" style={{ fontSize: '0.68rem', color: 'var(--status-rose)' }}>Kain Kurang</span>
          <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'var(--status-rose-bg)', color: 'var(--status-rose)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertTriangle size={14} />
          </div>
        </div>
        <div className="metric-value mono-num" style={{ fontSize: '1.45rem', color: 'var(--status-rose)', marginTop: '4px' }}>
          {metrics.kain_kurang}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--status-rose)' }}>Perlu Solusi</span>
          {status === 'kain_kurang' && (
            <span style={{ fontSize: '0.64rem', fontWeight: 700, color: 'var(--status-rose)', background: 'var(--status-rose-bg)', padding: '1px 6px', borderRadius: '4px' }}>Aktif</span>
          )}
        </div>
      </div>

      {/* Card 5: Overdue */}
      <div
        onClick={() => onToggleStatus('overdue')}
        className="card metric-card"
        style={{
          cursor: 'pointer',
          border: status === 'overdue' ? '2px solid var(--status-amber)' : (metrics.overdue > 0 ? '1px solid var(--status-amber-border)' : '1px solid var(--border-default)'),
          boxShadow: status === 'overdue' ? '0 4px 14px rgba(245, 158, 11, 0.2)' : 'none',
          transform: status === 'overdue' ? 'scale(1.02)' : 'none',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          background: status === 'overdue' || metrics.overdue > 0 ? 'var(--status-amber-bg)' : 'var(--bg-card)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="metric-label" style={{ fontSize: '0.68rem', color: 'var(--status-amber)' }}>Lewat Batas</span>
          <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'var(--status-amber-bg)', color: 'var(--status-amber)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Flame size={14} />
          </div>
        </div>
        <div className="metric-value mono-num" style={{ fontSize: '1.45rem', color: 'var(--status-amber)', marginTop: '4px' }}>
          {metrics.overdue}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--status-amber)' }}>Overdue SPK</span>
          {status === 'overdue' && (
            <span style={{ fontSize: '0.64rem', fontWeight: 700, color: 'var(--status-amber)', background: 'var(--status-amber-bg)', padding: '1px 6px', borderRadius: '4px' }}>Aktif</span>
          )}
        </div>
      </div>

      {/* Card 6: Selesai */}
      <div
        onClick={() => onToggleStatus('result_locked')}
        className="card metric-card"
        style={{
          cursor: 'pointer',
          border: status === 'result_locked' ? '2px solid var(--status-emerald)' : '1px solid var(--border-default)',
          boxShadow: status === 'result_locked' ? '0 4px 14px rgba(16, 185, 129, 0.2)' : 'none',
          transform: status === 'result_locked' ? 'scale(1.02)' : 'none',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          background: status === 'result_locked' ? 'var(--status-emerald-bg)' : 'var(--bg-card)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="metric-label" style={{ fontSize: '0.68rem', color: 'var(--status-emerald)' }}>Selesai</span>
          <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'var(--status-emerald-bg)', color: 'var(--status-emerald)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CheckCircle2 size={14} />
          </div>
        </div>
        <div className="metric-value mono-num" style={{ fontSize: '1.45rem', color: 'var(--status-emerald)', marginTop: '4px' }}>
          {metrics.result_locked}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--status-emerald)' }}>SJ Terbit</span>
          {status === 'result_locked' && (
            <span style={{ fontSize: '0.64rem', fontWeight: 700, color: 'var(--status-emerald)', background: 'var(--status-emerald-bg)', padding: '1px 6px', borderRadius: '4px' }}>Aktif</span>
          )}
        </div>
      </div>
    </div>
  );
}
