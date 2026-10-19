'use client';

import { Scissors, Zap } from 'lucide-react';

export default function CuttingSummaryCard({
  order,
  targetSpkQty,
  currentActualCutting,
  selisihCutting,
  actualCutting,
  setActualCutting,
  handleFillCuttingWithTargetSpk,
  canEditCutting,
  saving
}) {
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
            <Scissors size={18} />
          </div>
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
              Hasil Potong
            </h3>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              Jumlah kain yang selesai dipotong di meja potong
            </div>
          </div>
        </div>
        <span className="badge badge-gold mono-num" style={{ textTransform: 'uppercase', fontSize: '0.75rem', fontWeight: 700 }}>
          Satuan: {order.unit_kain || 'PCS'}
        </span>
      </div>

      {/* 3 Metric Tiles: Target SPK, Hasil Potong, Selisih */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
        {/* 1. Target SPK */}
        <div className="hero-tile">
          <div className="metric-label" style={{ fontSize: '0.7rem' }}>Target SPK</div>
          <div className="mono-num" style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2 }}>
            {targetSpkQty.toLocaleString('id-ID')} <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>pcs</span>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Target dari SPK
          </div>
        </div>

        {/* 2. Hasil Potong Fisik Input */}
        <div className="hero-tile" style={{ background: 'var(--brand-gold-light)', borderColor: 'var(--brand-gold-border)' }}>
          <div className="metric-label" style={{ fontSize: '0.7rem', color: 'var(--brand-gold)' }}>Hasil Potong</div>
          {canEditCutting ? (
            <div>
              <div className="input-addon-group" style={{ height: '42px', borderColor: actualCutting ? 'var(--brand-gold)' : 'var(--border-strong)' }}>
                <input
                  type="number"
                  step="1"
                  min="0"
                  disabled={saving}
                  placeholder={targetSpkQty > 0 ? String(targetSpkQty) : '0'}
                  value={actualCutting}
                  onChange={(e) => setActualCutting(e.target.value)}
                  className="input-addon-field"
                  style={{ fontSize: '1.25rem', fontWeight: 800 }}
                />
                <span className="input-addon-label">PCS</span>
              </div>
              {targetSpkQty > 0 && actualCutting === '' && (
                <button
                  type="button"
                  onClick={handleFillCuttingWithTargetSpk}
                  className="quick-action-pill quick-action-pill-amber"
                  style={{ marginTop: '6px', width: '100%', fontSize: '0.7rem' }}
                  title="Samakan dengan Target SPK"
                >
                  <Zap size={11} />
                  <span>Samakan Target SPK ({targetSpkQty})</span>
                </button>
              )}
            </div>
          ) : (
            <div className="mono-num" style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--brand-gold)', lineHeight: 1.2 }}>
              {(parseFloat(order.actual_cutting) || currentActualCutting).toLocaleString('id-ID')}{' '}
              <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>pcs</span>
            </div>
          )}
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            Kain yang sudah dipotong
          </div>
        </div>

        {/* 3. Selisih vs Target SPK */}
        <div className="hero-tile">
          <div className="metric-label" style={{ fontSize: '0.7rem' }}>Selisih vs Target</div>
          <div
            className="mono-num"
            style={{
              fontSize: '1.35rem',
              fontWeight: 800,
              lineHeight: 1.2,
              color:
                selisihCutting > 0
                  ? 'var(--status-emerald)'
                  : selisihCutting < 0
                  ? 'var(--status-rose)'
                  : 'var(--text-primary)'
            }}
          >
            {currentActualCutting > 0
              ? selisihCutting > 0
                ? `+${selisihCutting.toLocaleString('id-ID')}`
                : selisihCutting.toLocaleString('id-ID')
              : '0'}{' '}
            <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>pcs</span>
          </div>
          <div style={{ marginTop: '2px' }}>
            {currentActualCutting === 0 ? (
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Belum diisi</span>
            ) : selisihCutting === 0 ? (
              <span className="badge badge-emerald" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>Pas</span>
            ) : selisihCutting > 0 ? (
              <span className="badge badge-emerald" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>Lebih {selisihCutting}</span>
            ) : (
              <span className="badge badge-amber" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>Kurang {Math.abs(selisihCutting)}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
