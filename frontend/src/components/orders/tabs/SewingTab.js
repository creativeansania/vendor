'use client';

import { Package, Zap, Check, CheckCircle2 } from 'lucide-react';
import { adjustQty } from '@/lib/utils/formatters';

export default function SewingTab({
  order,
  targetSpkQty,
  currentActualCutting,
  totalYieldPcs,
  gradeA,
  setGradeA,
  gradeB,
  setGradeB,
  sisaKg,
  setSisaKg,
  noSuratJalan,
  setNoSuratJalan,
  setPresetGradeA,
  canEditResult,
  saving,
  handleRequestSubmitProduction
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* CARD 1: HASIL JAHIT (MATCHING TAB 1 CARD 1 EXACTLY) */}
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

        {/* 3 Metric Tiles (IDENTICAL TO TAB 1): Target SPK, Hasil Jahit, Selisih */}
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
                  totalYieldPcs - targetSpkQty > 0
                    ? 'var(--status-emerald)'
                    : totalYieldPcs - targetSpkQty < 0
                    ? 'var(--status-rose)'
                    : 'var(--text-primary)'
              }}
            >
              {totalYieldPcs > 0
                ? (totalYieldPcs - targetSpkQty > 0 ? `+${(totalYieldPcs - targetSpkQty).toLocaleString('id-ID')}` : (totalYieldPcs - targetSpkQty).toLocaleString('id-ID'))
                : '0'}{' '}
              <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>pcs</span>
            </div>
            <div style={{ marginTop: '2px' }}>
              {totalYieldPcs === 0 ? (
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Belum diisi</span>
              ) : totalYieldPcs - targetSpkQty === 0 ? (
                <span className="badge badge-emerald" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>Pas</span>
              ) : totalYieldPcs - targetSpkQty > 0 ? (
                <span className="badge badge-emerald" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>Lebih {totalYieldPcs - targetSpkQty}</span>
              ) : (
                <span className="badge badge-amber" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>Kurang {Math.abs(totalYieldPcs - targetSpkQty)}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION: RINCIAN HASIL JAHIT */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px', flexWrap: 'wrap', gap: '8px' }}>
          <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            👕 Rincian Hasil Jahit & Sisa Kain
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {canEditResult && targetSpkQty > 0 && (
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
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Total Baju: <strong className="mono-num" style={{ color: 'var(--brand-gold)', fontWeight: 800 }}>{totalYieldPcs} PCS</strong>
            </span>
          </div>
        </div>

        {/* CARD 1: GRADE A (BAGUS) */}
        <div className="card roll-card" style={{ borderLeft: '4px solid var(--status-emerald)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
              <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem' }}>#1</span>
              <span className="mono-num" style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--status-emerald)' }}>
                Grade A
              </span>
              <span className="badge badge-emerald mono-num" style={{ fontSize: '0.68rem' }}>PCS</span>
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '2px' }}>
              Baju Jadi (Standar Bagus)
            </div>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              Target Pesanan SPK: <strong className="mono-num" style={{ color: 'var(--text-primary)' }}>{targetSpkQty} PCS</strong>
            </div>
          </div>

          <div className="roll-input-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--status-emerald)', textTransform: 'uppercase' }}>
                  👕 Grade A (Bagus):
                </label>
                {canEditResult && targetSpkQty > 0 && (
                  <button
                    type="button"
                    onClick={() => setPresetGradeA(targetSpkQty)}
                    className={`quick-action-pill ${parseFloat(gradeA) === targetSpkQty ? 'quick-action-pill-emerald' : ''}`}
                    style={{ fontSize: '0.65rem', padding: '1px 5px' }}
                    title="Samakan dengan Target SPK"
                  >
                    {parseFloat(gradeA) === targetSpkQty ? (
                      <>
                        <Check size={10} />
                        <span>Pas</span>
                      </>
                    ) : (
                      <>
                        <Zap size={10} />
                        <span>SPK ({targetSpkQty})</span>
                      </>
                    )}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '130px' }}>
                  <div className="input-addon-group" style={{ height: '38px', borderColor: gradeA ? 'var(--status-emerald)' : 'var(--border-strong)' }}>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      disabled={!canEditResult || saving}
                      placeholder="0"
                      value={gradeA}
                      onChange={(e) => setGradeA(e.target.value)}
                      className="input-addon-field"
                      style={{ fontSize: '0.95rem', fontWeight: 800 }}
                    />
                    <span className="input-addon-label" style={{ fontSize: '0.68rem', padding: '0 6px' }}>
                      PCS
                    </span>
                  </div>
                </div>
                {canEditResult && (
                  <div style={{ display: 'flex', gap: '3px' }}>
                    <button type="button" onClick={() => adjustQty(setGradeA, gradeA, -1)} className="stepper-btn" style={{ padding: '0 8px', height: '38px', fontSize: '0.75rem' }} title="Kurangi 1">-1</button>
                    <button type="button" onClick={() => adjustQty(setGradeA, gradeA, +1)} className="stepper-btn" style={{ padding: '0 8px', height: '38px', fontSize: '0.75rem' }} title="Tambah 1">+1</button>
                    <button type="button" onClick={() => adjustQty(setGradeA, gradeA, +5)} className="stepper-btn" style={{ padding: '0 8px', height: '38px', fontSize: '0.75rem' }} title="Tambah 5">+5</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* CARD 2: GRADE B (REJECT / BS) */}
        <div className="card roll-card" style={{ borderLeft: '4px solid var(--status-rose)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
              <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem' }}>#2</span>
              <span className="mono-num" style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--status-rose)' }}>
                Grade B
              </span>
              <span className="badge badge-rose mono-num" style={{ fontSize: '0.68rem' }}>PCS</span>
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '2px' }}>
              Baju Cacat / Reject (BS)
            </div>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              Cacat jahitan, noda, bolong, atau BS
            </div>
          </div>

          <div className="roll-input-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--status-rose)', textTransform: 'uppercase' }}>
                  ⚠️ Grade B (Reject):
                </label>
                {canEditResult && (
                  <button
                    type="button"
                    onClick={() => setGradeB('0')}
                    className={`quick-action-pill ${parseFloat(gradeB) === 0 ? 'quick-action-pill-emerald' : ''}`}
                    style={{ fontSize: '0.65rem', padding: '1px 5px' }}
                    title="Nol Grade B"
                  >
                    {parseFloat(gradeB) === 0 ? (
                      <>
                        <Check size={10} />
                        <span>Nol (0)</span>
                      </>
                    ) : (
                      <span>Reset 0</span>
                    )}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '130px' }}>
                  <div className="input-addon-group" style={{ height: '38px', borderColor: parseFloat(gradeB) > 0 ? 'var(--status-rose)' : 'var(--border-strong)' }}>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      disabled={!canEditResult || saving}
                      placeholder="0"
                      value={gradeB}
                      onChange={(e) => setGradeB(e.target.value)}
                      className="input-addon-field"
                      style={{ fontSize: '0.95rem', fontWeight: 800 }}
                    />
                    <span className="input-addon-label" style={{ fontSize: '0.68rem', padding: '0 6px' }}>
                      PCS
                    </span>
                  </div>
                </div>
                {canEditResult && (
                  <div style={{ display: 'flex', gap: '3px' }}>
                    <button type="button" onClick={() => setGradeB('0')} className="stepper-btn stepper-btn-primary" style={{ padding: '0 8px', height: '38px', fontSize: '0.75rem' }} title="Nol Grade B">0</button>
                    <button type="button" onClick={() => adjustQty(setGradeB, gradeB, +1)} className="stepper-btn" style={{ padding: '0 8px', height: '38px', fontSize: '0.75rem' }} title="Tambah 1">+1</button>
                    <button type="button" onClick={() => adjustQty(setGradeB, gradeB, +2)} className="stepper-btn" style={{ padding: '0 8px', height: '38px', fontSize: '0.75rem' }} title="Tambah 2">+2</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* CARD 3: SISA KAIN (BSKL) */}
        <div className="card roll-card" style={{ borderLeft: '4px solid var(--brand-gold)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
              <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem' }}>#3</span>
              <span className="mono-num" style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--brand-gold)' }}>
                Sisa Kain
              </span>
              <span className="badge badge-gold mono-num" style={{ fontSize: '0.68rem' }}>KG</span>
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '2px' }}>
              Sisa Kain Potongan (BSKL)
            </div>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              Sisa bahan perca makloon yang dikembalikan
            </div>
          </div>

          <div className="roll-input-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--brand-gold)', textTransform: 'uppercase' }}>
                  ⚖️ Sisa Kain (BSKL):
                </label>
                {canEditResult && (
                  <button
                    type="button"
                    onClick={() => setSisaKg('0')}
                    className={`quick-action-pill ${parseFloat(sisaKg) === 0 ? 'quick-action-pill-emerald' : ''}`}
                    style={{ fontSize: '0.65rem', padding: '1px 5px' }}
                    title="Nol Sisa"
                  >
                    {parseFloat(sisaKg) === 0 ? (
                      <>
                        <Check size={10} />
                        <span>Nol (0)</span>
                      </>
                    ) : (
                      <span>Reset 0</span>
                    )}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '130px' }}>
                  <div className="input-addon-group" style={{ height: '38px', borderColor: 'var(--border-strong)' }}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      disabled={!canEditResult || saving}
                      placeholder="0.00"
                      value={sisaKg}
                      onChange={(e) => setSisaKg(e.target.value)}
                      className="input-addon-field"
                      style={{ fontSize: '0.95rem', fontWeight: 800 }}
                    />
                    <span className="input-addon-label" style={{ fontSize: '0.68rem', padding: '0 6px' }}>
                      KG
                    </span>
                  </div>
                </div>
                {canEditResult && (
                  <div style={{ display: 'flex', gap: '3px' }}>
                    <button type="button" onClick={() => setSisaKg('0')} className="stepper-btn" style={{ padding: '0 8px', height: '38px', fontSize: '0.75rem' }}>0</button>
                    <button type="button" onClick={() => adjustQty(setSisaKg, sisaKg, +0.5)} className="stepper-btn" style={{ padding: '0 8px', height: '38px', fontSize: '0.75rem' }}>+0.5</button>
                    <button type="button" onClick={() => adjustQty(setSisaKg, sisaKg, +1.0)} className="stepper-btn" style={{ padding: '0 8px', height: '38px', fontSize: '0.75rem' }}>+1.0</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* CARD 4: SURAT JALAN VENDOR */}
        <div className="card roll-card" style={{ borderLeft: '4px solid var(--status-sky)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
              <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem' }}>#4</span>
              <span className="mono-num" style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--status-sky)' }}>
                Surat Jalan
              </span>
              <span className="badge badge-sky mono-num" style={{ fontSize: '0.68rem' }}>VENDOR</span>
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '2px' }}>
              No. Surat Jalan Vendor
            </div>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              Nomor surat jalan resmi dari pihak konveksi
            </div>
          </div>

          <div className="roll-input-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px', width: '100%', maxWidth: '240px' }}>
              <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--status-sky)', textTransform: 'uppercase' }}>
                📄 No. Surat Jalan:
              </label>
              <input
                type="text"
                disabled={!canEditResult || saving}
                placeholder="Contoh: SJ/001/2026"
                value={noSuratJalan}
                onChange={(e) => setNoSuratJalan(e.target.value)}
                className="input-field"
                style={{ fontSize: '0.92rem', height: '38px', width: '100%' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Sticky Submit Button */}
      {canEditResult && (
        <div className="sticky-bottom-action">
          <button
            type="button"
            disabled={saving || totalYieldPcs <= 0}
            onClick={handleRequestSubmitProduction}
            className="btn btn-primary"
            style={{ width: '100%', padding: '14px 20px', fontSize: '1rem', borderRadius: '14px' }}
          >
            <CheckCircle2 size={18} />
            <span>{saving ? 'Menyimpan...' : 'Simpan Hasil Jahit'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
