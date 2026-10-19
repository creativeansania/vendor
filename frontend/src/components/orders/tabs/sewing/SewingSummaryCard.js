'use client';

import { Package } from 'lucide-react';

export default function SewingSummaryCard({
  order,
  targetSpkQty,
  currentActualCutting,
  totalYieldPcs,
  gradeA,
  gradeB
}) {
  const selisih = totalYieldPcs - targetSpkQty;

  return (
    <div className="card" style={{ padding: '18px 20px', borderRadius: '16px' }}>
      {/* Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '10px',
              background: 'var(--brand-gold-light)',
              color: 'var(--brand-gold)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <Package size={18} />
          </div>
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
              Hasil Jahit
            </h3>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              Total baju jadi yang selesai dijahit (Grade A + Grade B)
            </div>
          </div>
        </div>
        <span className="badge badge-gold mono-num" style={{ textTransform: 'uppercase', fontSize: '0.75rem', fontWeight: 700 }}>
          Satuan: PCS
        </span>
      </div>

      {/* 3 Metric Tiles: Target SPK, Hasil Jahit, Selisih */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
        {/* 1. Target SPK */}
        <div className="hero-tile">
          <div className="metric-label" style={{ fontSize: '0.7rem' }}>Target SPK</div>
          <div className="mono-num" style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2 }}>
            {targetSpkQty.toLocaleString('id-ID')} <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>pcs</span>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Hasil potong: {(parseFloat(order.actual_cutting) || currentActualCutting || 0).toLocaleString('id-ID')} pcs
          </div>
        </div>

        {/* 2. Total Hasil Jahit */}
        <div className="hero-tile" style={{ background: 'var(--brand-gold-light)', borderColor: 'var(--brand-gold-border)' }}>
          <div className="metric-label" style={{ fontSize: '0.7rem', color: 'var(--brand-gold)' }}>Total Hasil Jahit</div>
          <div className="mono-num" style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--brand-gold)', lineHeight: 1.2 }}>
            {totalYieldPcs.toLocaleString('id-ID')} <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>pcs</span>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            Grade A: {parseFloat(gradeA) || 0} + Grade B: {parseFloat(gradeB) || 0}
          </div>
        </div>

        {/* 3. Selisih vs Target */}
        <div className="hero-tile">
          <div className="metric-label" style={{ fontSize: '0.7rem' }}>Selisih vs Target</div>
          <div
            className="mono-num"
            style={{
              fontSize: '1.35rem',
              fontWeight: 800,
              lineHeight: 1.2,
              color:
                selisih > 0
                  ? 'var(--status-emerald)'
                  : selisih < 0
                  ? 'var(--status-rose)'
                  : 'var(--text-primary)'
            }}
          >
            {totalYieldPcs > 0
              ? (selisih > 0 ? `+${selisih.toLocaleString('id-ID')}` : selisih.toLocaleString('id-ID'))
              : '0'}{' '}
            <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>pcs</span>
          </div>
          <div style={{ marginTop: '2px' }}>
            {totalYieldPcs === 0 ? (
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Belum diisi</span>
            ) : selisih === 0 ? (
              <span className="badge badge-emerald" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>Pas</span>
            ) : selisih > 0 ? (
              <span className="badge badge-emerald" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>Lebih {selisih}</span>
            ) : (
              <span className="badge badge-amber" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>Kurang {Math.abs(selisih)}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
