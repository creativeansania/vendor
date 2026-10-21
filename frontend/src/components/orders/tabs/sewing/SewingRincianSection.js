'use client';

import { Zap, Check, Send, AlertTriangle, Lock } from 'lucide-react';
import { adjustQty } from '@/lib/utils/formatters';

export default function SewingRincianSection({
  targetSpkQty,
  totalYieldPcs,
  gradeA,
  setGradeA,
  gradeB,
  setGradeB,
  noSuratJalanGradeA,
  setNoSuratJalanGradeA,
  noSuratJalanGradeB,
  setNoSuratJalanGradeB,
  setPresetGradeA,
  canEditGradeA,
  canEditGradeB,
  gradeBSubmitCount = 0,
  saving,
  onSubmitGradeA,
  onSubmitGradeB
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px', flexWrap: 'wrap', gap: '8px' }}>
        <span style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          👕 Hasil Jahit Baju Jadi
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {canEditGradeA && targetSpkQty > 0 && (
            <button
              type="button"
              onClick={() => setPresetGradeA(targetSpkQty)}
              className="quick-action-pill quick-action-pill-emerald"
              style={{ fontSize: '0.72rem' }}
              title="Samakan Grade A dengan Target SPK"
            >
              <Zap size={11} />
              <span>Samakan SPK ({targetSpkQty})</span>
            </button>
          )}
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Total Baju: <strong className="mono-num" style={{ color: 'var(--brand-gold)', fontWeight: 800 }}>{totalYieldPcs} PCS</strong>
          </span>
        </div>
      </div>

      {/* CARD 1: GRADE A (BAGUS) */}
      <div className="card roll-card" style={{ borderLeft: '4px solid var(--status-emerald)', padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
              <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem' }}>#1</span>
              <span className="mono-num" style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--status-emerald)' }}>
                Grade A (Bagus)
              </span>
              <span className="badge badge-emerald mono-num" style={{ fontSize: '0.68rem' }}>PCS</span>
              {!canEditGradeA && (
                <span className="badge badge-slate" style={{ fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: '4px', background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
                  <Lock size={10} /> Terkunci (MO Selesai)
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Target Pesanan SPK: <strong className="mono-num" style={{ color: 'var(--text-primary)' }}>{targetSpkQty} PCS</strong>
            </div>
          </div>

          {canEditGradeA && targetSpkQty > 0 && (
            <button
              type="button"
              onClick={() => setPresetGradeA(targetSpkQty)}
              className={`quick-action-pill ${parseFloat(gradeA) === targetSpkQty ? 'quick-action-pill-emerald' : ''}`}
              style={{ fontSize: '0.7rem', padding: '3px 8px' }}
              title="Samakan dengan Target SPK"
            >
              {parseFloat(gradeA) === targetSpkQty ? (
                <>
                  <Check size={11} />
                  <span>Pas Target ({targetSpkQty})</span>
                </>
              ) : (
                <>
                  <Zap size={11} />
                  <span>Isi Target SPK ({targetSpkQty})</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Input Row: Qty + SJ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', alignItems: 'end', marginBottom: '14px' }}>
          <div>
            <label style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--status-emerald)', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
              Jumlah Baju Grade A (PCS):
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div className="input-addon-group" style={{ height: '40px', flex: 1, borderColor: gradeA ? 'var(--status-emerald)' : 'var(--border-strong)' }}>
                <input
                  type="number"
                  step="1"
                  min="0"
                  disabled={!canEditGradeA || saving}
                  placeholder="0"
                  value={gradeA}
                  onChange={(e) => setGradeA(e.target.value)}
                  className="input-addon-field"
                  style={{ fontSize: '1rem', fontWeight: 800 }}
                />
                <span className="input-addon-label" style={{ fontSize: '0.72rem', padding: '0 8px' }}>
                  PCS
                </span>
              </div>
              {canEditGradeA && (
                <div style={{ display: 'flex', gap: '3px' }}>
                  <button type="button" onClick={() => adjustQty(setGradeA, gradeA, -1)} className="stepper-btn" style={{ padding: '0 8px', height: '40px', fontSize: '0.78rem' }}>-1</button>
                  <button type="button" onClick={() => adjustQty(setGradeA, gradeA, +1)} className="stepper-btn" style={{ padding: '0 8px', height: '40px', fontSize: '0.78rem' }}>+1</button>
                  <button type="button" onClick={() => adjustQty(setGradeA, gradeA, +5)} className="stepper-btn" style={{ padding: '0 8px', height: '40px', fontSize: '0.78rem' }}>+5</button>
                </div>
              )}
            </div>
          </div>

          <div>
            <label style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
              📄 No. Surat Jalan Baju Grade A:
            </label>
            <input
              type="text"
              disabled={!canEditGradeA || saving}
              placeholder="Contoh: SJ/GR-A/001"
              value={noSuratJalanGradeA}
              onChange={(e) => setNoSuratJalanGradeA(e.target.value)}
              className="input-field"
              style={{ fontSize: '0.92rem', height: '40px', width: '100%' }}
            />
          </div>
        </div>

        {/* Trigger Button Grade A */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
          <button
            type="button"
            disabled={!canEditGradeA || saving || !gradeA || parseFloat(gradeA) <= 0}
            onClick={onSubmitGradeA}
            className="btn btn-emerald"
            style={{ fontSize: '0.84rem', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Send size={14} />
            <span>Kirim Grade A & Surat Jalan</span>
          </button>
        </div>
      </div>

      {/* CARD 2: GRADE B (REJECT / BS) */}
      <div className="card roll-card" style={{ borderLeft: '4px solid var(--status-rose)', padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
              <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem' }}>#2</span>
              <span className="mono-num" style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--status-rose)' }}>
                Grade B (Reject / BS)
              </span>
              <span className="badge badge-rose mono-num" style={{ fontSize: '0.68rem' }}>PCS</span>
              {gradeBSubmitCount > 0 && (
                <span className={`badge ${gradeBSubmitCount >= 2 ? 'badge-rose' : 'badge-gold'}`} style={{ fontSize: '0.68rem' }}>
                  {gradeBSubmitCount >= 2 ? 'Terkunci (Submit 2x)' : 'Sudah Submit 1x (Sisa 1x Revisi)'}
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Cacat jahitan, noda, bolong, atau BS (Otomatis dibuatkan MO Turunan Grade B)
            </div>
          </div>

          {canEditGradeB && (
            <button
              type="button"
              onClick={() => setGradeB('0')}
              className={`quick-action-pill ${parseFloat(gradeB) === 0 ? 'quick-action-pill-emerald' : ''}`}
              style={{ fontSize: '0.7rem', padding: '3px 8px' }}
              title="Nol Grade B"
            >
              {parseFloat(gradeB) === 0 ? (
                <>
                  <Check size={11} />
                  <span>Nol (0)</span>
                </>
              ) : (
                <span>Reset 0</span>
              )}
            </button>
          )}
        </div>

        {/* Input Row: Qty + SJ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', alignItems: 'end', marginBottom: '14px' }}>
          <div>
            <label style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--status-rose)', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
              Jumlah Baju Grade B (PCS):
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div className="input-addon-group" style={{ height: '40px', flex: 1, borderColor: parseFloat(gradeB) > 0 ? 'var(--status-rose)' : 'var(--border-strong)' }}>
                <input
                  type="number"
                  step="1"
                  min="0"
                  disabled={!canEditGradeB || saving}
                  placeholder="0"
                  value={gradeB}
                  onChange={(e) => setGradeB(e.target.value)}
                  className="input-addon-field"
                  style={{ fontSize: '1rem', fontWeight: 800 }}
                />
                <span className="input-addon-label" style={{ fontSize: '0.72rem', padding: '0 8px' }}>
                  PCS
                </span>
              </div>
              {canEditGradeB && (
                <div style={{ display: 'flex', gap: '3px' }}>
                  <button type="button" onClick={() => setGradeB('0')} className="stepper-btn stepper-btn-primary" style={{ padding: '0 8px', height: '40px', fontSize: '0.78rem' }}>0</button>
                  <button type="button" onClick={() => adjustQty(setGradeB, gradeB, +1)} className="stepper-btn" style={{ padding: '0 8px', height: '40px', fontSize: '0.78rem' }}>+1</button>
                  <button type="button" onClick={() => adjustQty(setGradeB, gradeB, +2)} className="stepper-btn" style={{ padding: '0 8px', height: '40px', fontSize: '0.78rem' }}>+2</button>
                </div>
              )}
            </div>
          </div>

          <div>
            <label style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
              📄 No. Surat Jalan Baju Grade B:
            </label>
            <input
              type="text"
              disabled={!canEditGradeB || saving}
              placeholder="Contoh: SJ/GR-B/001"
              value={noSuratJalanGradeB}
              onChange={(e) => setNoSuratJalanGradeB(e.target.value)}
              className="input-field"
              style={{ fontSize: '0.92rem', height: '40px', width: '100%' }}
            />
          </div>
        </div>

        {/* Trigger Button Grade B */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-subtle)', paddingTop: '10px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            {gradeBSubmitCount === 0 && 'Jatah: 1x submit awal + 1x revisi'}
            {gradeBSubmitCount === 1 && '⚠️ Anda menggunakan revisi ke-1 (setelah ini akan terkunci)'}
            {gradeBSubmitCount >= 2 && '🔒 Batas 2x submit tercapai. Hubungi Master Admin jika butuh buka kunci.'}
          </div>

          <button
            type="button"
            disabled={!canEditGradeB || saving || gradeBSubmitCount >= 2}
            onClick={onSubmitGradeB}
            className={`btn ${gradeBSubmitCount > 0 ? 'btn-amber' : 'btn-rose'}`}
            style={{ fontSize: '0.84rem', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Send size={14} />
            <span>
              {gradeBSubmitCount === 0
                ? 'Submit Grade B'
                : gradeBSubmitCount === 1
                  ? 'Simpan Revisi Grade B (Terakhir)'
                  : 'Grade B Terkunci'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
