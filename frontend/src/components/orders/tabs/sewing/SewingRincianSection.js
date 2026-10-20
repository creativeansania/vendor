'use client';

import { Zap, Check } from 'lucide-react';
import { adjustQty } from '@/lib/utils/formatters';

export default function SewingRincianSection({
  targetSpkQty,
  totalYieldPcs,
  gradeA,
  setGradeA,
  gradeB,
  setGradeB,
  sisaPanjang = '',
  setSisaPanjang,
  sisaSedang = '',
  setSisaSedang,
  sisaPendek = '',
  setSisaPendek,
  totalSisaKg = 0,
  sisaKg,
  setSisaKg,
  noSuratJalan,
  setNoSuratJalan,
  setPresetGradeA,
  canEditResult,
  saving
}) {
  const currentTotalSisa = totalSisaKg || (
    Number((parseFloat(sisaPanjang) || 0) + (parseFloat(sisaSedang) || 0) + (parseFloat(sisaPendek) || 0)).toFixed(2)
  );

  return (
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

      {/* SECTION HEADER: SISA KAIN POTONGAN (BSKL) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', padding: '0 2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--brand-gold)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            ✂️ Sisa Potong Kain (BSKL)
          </span>
          <span className="badge badge-gold mono-num" style={{ fontSize: '0.68rem' }}>3 Kategori</span>
        </div>
        <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
          Total Sisa: <strong className="mono-num" style={{ color: 'var(--brand-gold)', fontWeight: 800 }}>{currentTotalSisa} KG</strong>
        </div>
      </div>

      {/* CARD 3A: SISA POTONG PANJANG (> 1 METER) */}
      <div className="card roll-card" style={{ borderLeft: '4px solid var(--brand-gold)' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem' }}>#3A</span>
            <span className="mono-num" style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--brand-gold)' }}>
              Sisa Potong Panjang
            </span>
            <span className="badge badge-gold mono-num" style={{ fontSize: '0.68rem' }}>&gt; 1 mtr</span>
          </div>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '2px' }}>
            BSKL Panjang (&gt; 1 meter)
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
            Sisa potongan kain utuh panjang untuk dikembalikan ke gudang
          </div>
        </div>

        <div className="roll-input-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--brand-gold)', textTransform: 'uppercase' }}>
                📏 Panjang (&gt; 1m):
              </label>
              {canEditResult && (
                <button
                  type="button"
                  onClick={() => setSisaPanjang && setSisaPanjang('0')}
                  className={`quick-action-pill ${parseFloat(sisaPanjang) === 0 ? 'quick-action-pill-emerald' : ''}`}
                  style={{ fontSize: '0.65rem', padding: '1px 5px' }}
                  title="Nol Sisa Panjang"
                >
                  {parseFloat(sisaPanjang) === 0 ? (
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
                    value={sisaPanjang}
                    onChange={(e) => setSisaPanjang && setSisaPanjang(e.target.value)}
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
                  <button type="button" onClick={() => setSisaPanjang && setSisaPanjang('0')} className="stepper-btn" style={{ padding: '0 8px', height: '38px', fontSize: '0.75rem' }}>0</button>
                  <button type="button" onClick={() => adjustQty(setSisaPanjang, sisaPanjang, +0.5)} className="stepper-btn" style={{ padding: '0 8px', height: '38px', fontSize: '0.75rem' }}>+0.5</button>
                  <button type="button" onClick={() => adjustQty(setSisaPanjang, sisaPanjang, +1.0)} className="stepper-btn" style={{ padding: '0 8px', height: '38px', fontSize: '0.75rem' }}>+1.0</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* CARD 3B: SISA POTONG SEDANG (50 - 100 CM) */}
      <div className="card roll-card" style={{ borderLeft: '4px solid var(--brand-gold)' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem' }}>#3B</span>
            <span className="mono-num" style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--brand-gold)' }}>
              Sisa Potong Sedang
            </span>
            <span className="badge badge-gold mono-num" style={{ fontSize: '0.68rem' }}>50 - 100 cm</span>
          </div>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '2px' }}>
            BSKL Sedang (50 - 100 cm)
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
            Sisa potongan kain ukuran sedang untuk dikembalikan ke gudang
          </div>
        </div>

        <div className="roll-input-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--brand-gold)', textTransform: 'uppercase' }}>
                📐 Sedang (50-100cm):
              </label>
              {canEditResult && (
                <button
                  type="button"
                  onClick={() => setSisaSedang && setSisaSedang('0')}
                  className={`quick-action-pill ${parseFloat(sisaSedang) === 0 ? 'quick-action-pill-emerald' : ''}`}
                  style={{ fontSize: '0.65rem', padding: '1px 5px' }}
                  title="Nol Sisa Sedang"
                >
                  {parseFloat(sisaSedang) === 0 ? (
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
                    value={sisaSedang}
                    onChange={(e) => setSisaSedang && setSisaSedang(e.target.value)}
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
                  <button type="button" onClick={() => setSisaSedang && setSisaSedang('0')} className="stepper-btn" style={{ padding: '0 8px', height: '38px', fontSize: '0.75rem' }}>0</button>
                  <button type="button" onClick={() => adjustQty(setSisaSedang, sisaSedang, +0.5)} className="stepper-btn" style={{ padding: '0 8px', height: '38px', fontSize: '0.75rem' }}>+0.5</button>
                  <button type="button" onClick={() => adjustQty(setSisaSedang, sisaSedang, +1.0)} className="stepper-btn" style={{ padding: '0 8px', height: '38px', fontSize: '0.75rem' }}>+1.0</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* CARD 3C: SISA POTONG PENDEK (< 50 CM) */}
      <div className="card roll-card" style={{ borderLeft: '4px solid var(--brand-gold)' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem' }}>#3C</span>
            <span className="mono-num" style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--brand-gold)' }}>
              Sisa Potong Pendek
            </span>
            <span className="badge badge-gold mono-num" style={{ fontSize: '0.68rem' }}>&lt; 50 cm</span>
          </div>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '2px' }}>
            BSKL Pendek (&lt; 50 cm)
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
            Potongan sisa perca kain kecil (&lt; 50 cm)
          </div>
        </div>

        <div className="roll-input-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--brand-gold)', textTransform: 'uppercase' }}>
                ✂️ Pendek (&lt; 50cm):
              </label>
              {canEditResult && (
                <button
                  type="button"
                  onClick={() => setSisaPendek && setSisaPendek('0')}
                  className={`quick-action-pill ${parseFloat(sisaPendek) === 0 ? 'quick-action-pill-emerald' : ''}`}
                  style={{ fontSize: '0.65rem', padding: '1px 5px' }}
                  title="Nol Sisa Pendek"
                >
                  {parseFloat(sisaPendek) === 0 ? (
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
                    value={sisaPendek}
                    onChange={(e) => setSisaPendek && setSisaPendek(e.target.value)}
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
                  <button type="button" onClick={() => setSisaPendek && setSisaPendek('0')} className="stepper-btn" style={{ padding: '0 8px', height: '38px', fontSize: '0.75rem' }}>0</button>
                  <button type="button" onClick={() => adjustQty(setSisaPendek, sisaPendek, +0.5)} className="stepper-btn" style={{ padding: '0 8px', height: '38px', fontSize: '0.75rem' }}>+0.5</button>
                  <button type="button" onClick={() => adjustQty(setSisaPendek, sisaPendek, +1.0)} className="stepper-btn" style={{ padding: '0 8px', height: '38px', fontSize: '0.75rem' }}>+1.0</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* SUMMARY BANNER: BSKL TRANSFER DISPATCH INFO */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px',
          borderRadius: '10px',
          background: 'var(--brand-gold-light)',
          border: '1px solid var(--brand-gold-border)',
          fontSize: '0.78rem',
          color: 'var(--text-secondary)',
          flexWrap: 'wrap',
          gap: '8px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1rem' }}>📦</span>
          <span>
            Akan dibuatkan <strong>Transfer Makloon BSKL</strong> ke Gudang <strong>WHGB/Stock</strong> untuk item &gt; 0 kg.
          </span>
        </div>
        <div style={{ fontWeight: 800, color: 'var(--brand-gold)', fontSize: '0.88rem' }} className="mono-num">
          Akumulasi: {currentTotalSisa} KG
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
  );
}
