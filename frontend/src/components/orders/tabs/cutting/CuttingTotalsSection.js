'use client';

import { Truck, PackageCheck, Scissors, Target } from 'lucide-react';

export default function CuttingTotalsSection({
  order,
  fabricLines = [],
  penerimaanQtys = {},
  totalPhysicalFabric = 0,
  actualCutting = '',
  estimasiSpb = 0,
  selisihCutting = 0,
  currentActualCutting = 0
}) {
  const unitKain = (order?.unit_kain || fabricLines[0]?.uom || 'yard').toUpperCase();

  const totalQtyKirim = fabricLines.reduce((sum, l) => sum + (parseFloat(l.qty) || 0), 0);

  const totalQtyPenerimaan = fabricLines.reduce((sum, l) => {
    const val =
      penerimaanQtys[l.id] !== undefined
        ? penerimaanQtys[l.id]
        : (l.qty_penerimaan !== undefined && l.qty_penerimaan !== null ? l.qty_penerimaan : (l.qty || 0));
    return sum + (parseFloat(val) || 0);
  }, 0);

  const effectiveCutting =
    currentActualCutting > 0
      ? currentActualCutting
      : (totalPhysicalFabric > 0
          ? totalPhysicalFabric
          : (parseFloat(actualCutting) || parseFloat(order?.actual_cutting) || 0));

  const effectiveEstimasi =
    estimasiSpb > 0
      ? estimasiSpb
      : (parseFloat(order?.estimasi_dari_spb) || 0);

  const selisih = effectiveCutting - effectiveEstimasi;

  return (
    <div className="card" style={{ padding: '16px 18px', borderRadius: '16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <span style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          📊 Ringkasan Total Bahan & Hasil Potong
        </span>
        <span className="badge badge-gold mono-num" style={{ fontSize: '0.72rem', fontWeight: 700 }}>
          Satuan Kain: {unitKain}
        </span>
      </div>

      {/* Grid of 4 Metric Boxes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: '10px', marginBottom: '12px' }}>
        {/* 1. Total Qty Kirim */}
        <div className="hero-tile">
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text-secondary)', fontSize: '0.72rem', fontWeight: 700, marginBottom: '4px' }}>
            <Truck size={13} style={{ color: 'var(--status-sky)' }} />
            <span>Total Qty Kirim</span>
          </div>
          <div className="mono-num" style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            {totalQtyKirim.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}{' '}
            <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{unitKain.toLowerCase()}</span>
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            Surat Jalan Odoo
          </div>
        </div>

        {/* 2. Total Qty Penerimaan */}
        <div className="hero-tile">
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text-secondary)', fontSize: '0.72rem', fontWeight: 700, marginBottom: '4px' }}>
            <PackageCheck size={13} style={{ color: 'var(--status-emerald)' }} />
            <span>Total Qty Penerimaan</span>
          </div>
          <div className="mono-num" style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            {totalQtyPenerimaan.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}{' '}
            <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{unitKain.toLowerCase()}</span>
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            Diterima di Konveksi
          </div>
        </div>

        {/* 3. Total Qty Cutting / Pemakaian */}
        <div className="hero-tile" style={{ background: 'var(--brand-gold-light)', borderColor: 'var(--brand-gold-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--brand-gold)', fontSize: '0.72rem', fontWeight: 800, marginBottom: '4px' }}>
            <Scissors size={13} />
            <span>Total Qty Potong</span>
          </div>
          <div className="mono-num" style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--brand-gold)' }}>
            {effectiveCutting.toLocaleString('id-ID')}{' '}
            <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>pcs</span>
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            Actual Cutting
          </div>
        </div>

        {/* 4. Estimasi dari SPB */}
        <div className="hero-tile">
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text-secondary)', fontSize: '0.72rem', fontWeight: 700, marginBottom: '4px' }}>
            <Target size={13} style={{ color: 'var(--brand-gold)' }} />
            <span>Estimasi SPB</span>
          </div>
          <div className="mono-num" style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            {effectiveEstimasi.toLocaleString('id-ID')}{' '}
            <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>pcs</span>
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            Target Standar SPB
          </div>
        </div>
      </div>

      {/* Selisih Hasil Cutting Banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
          padding: '10px 14px',
          borderRadius: '12px',
          background: 'var(--bg-card-subtle)',
          border: '1px solid var(--border-default)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            ✂️ Selisih Hasil Cutting:
          </span>
          <span className="mono-num" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Actual ({effectiveCutting} pcs) - Estimasi SPB ({effectiveEstimasi} pcs) =
          </span>
          <strong
            className="mono-num"
            style={{
              fontSize: '0.95rem',
              fontWeight: 800,
              color:
                effectiveCutting === 0
                  ? 'var(--text-muted)'
                  : selisih > 0
                  ? 'var(--status-emerald)'
                  : selisih < 0
                  ? 'var(--status-rose)'
                  : 'var(--text-primary)'
            }}
          >
            {effectiveCutting === 0 ? '-' : (selisih > 0 ? `+${selisih}` : selisih)} pcs
          </strong>
        </div>

        <div>
          {effectiveCutting === 0 ? (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Belum diisi</span>
          ) : selisih === 0 ? (
            <span className="badge badge-emerald" style={{ fontSize: '0.72rem', padding: '3px 8px' }}>
              ✓ Pas (0 pcs)
            </span>
          ) : selisih > 0 ? (
            <span className="badge badge-emerald" style={{ fontSize: '0.72rem', padding: '3px 8px' }}>
              ↑ Lebih +{selisih} pcs
            </span>
          ) : (
            <span className="badge badge-amber" style={{ fontSize: '0.72rem', padding: '3px 8px' }}>
              ↓ Kurang {Math.abs(selisih)} pcs
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
