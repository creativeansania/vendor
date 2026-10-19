'use client';

import { Scissors, Zap, Check, Save } from 'lucide-react';
import { getLineUom, getLineLabel } from '@/lib/utils/formatters';

export default function CuttingTab({
  order,
  targetSpkQty,
  currentActualCutting,
  selisihCutting,
  actualCutting,
  setActualCutting,
  handleFillCuttingWithTargetSpk,
  canEditCutting,
  saving,
  fabricLines,
  accessoryLines,
  penerimaanQtys,
  rollWeights,
  totalPhysicalFabric,
  handleFillAllFabricFromPenerimaan,
  handleFillAllAccessories,
  handlePenerimaanChange,
  handleFillCuttingFromPenerimaan,
  handleWeightChange,
  handleRequestSubmitCutting
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* CARD 1: HASIL POTONG */}
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

      {/* SECTION 1: BAHAN KAIN (FABRIC ROLLS) IF PRESENT */}
      {fabricLines.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              🧵 Rincian Bahan Kain ({fabricLines.length} baris)
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {canEditCutting && (
                <button
                  type="button"
                  onClick={handleFillAllFabricFromPenerimaan}
                  className="quick-action-pill quick-action-pill-amber"
                  style={{ fontSize: '0.72rem' }}
                  title="Isi semua hasil potong kain sesuai Qty Penerimaan"
                >
                  <Zap size={11} />
                  <span>Sesuai Penerimaan Semua</span>
                </button>
              )}
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Total Fisik Potong: <strong className="mono-num" style={{ color: 'var(--brand-gold)', fontWeight: 800 }}>{totalPhysicalFabric.toFixed(2)} {getLineUom(fabricLines[0], order?.unit_kain)}</strong>
              </span>
            </div>
          </div>

          {fabricLines.map((line, idx) => {
            const lineUom = getLineUom(line, order?.unit_kain);
            const lineLabel = getLineLabel(line, order?.unit_kain);
            const currentPenerimaan =
              penerimaanQtys[line.id] !== undefined
                ? penerimaanQtys[line.id]
                : line.qty_penerimaan !== undefined && line.qty_penerimaan !== null
                ? line.qty_penerimaan
                : line.qty || '';

            return (
              <div
                key={line.id}
                className="card roll-card"
                style={{ borderLeft: '4px solid var(--brand-gold)' }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
                    <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem' }}>#{idx + 1}</span>
                    <span className="mono-num" style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                      Lot: {line.kode_lot || 'Tanpa Lot'}
                    </span>
                    <span className="badge badge-gold mono-num" style={{ fontSize: '0.68rem' }}>{lineUom}</span>
                  </div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '2px' }}>
                    {line.nama_item}
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                    Surat Jalan Transfer: <strong className="mono-num" style={{ color: 'var(--text-primary)' }}>{line.qty || 0} {lineUom}</strong>
                  </div>
                </div>

                <div className="roll-input-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {/* INPUT 1: QTY PENERIMAAN */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--status-sky)', textTransform: 'uppercase' }}>
                        📦 Penerimaan:
                      </label>
                      {canEditCutting && line.qty > 0 && (
                        <button
                          type="button"
                          onClick={() => handlePenerimaanChange(line.id, line.qty)}
                          className={`quick-action-pill ${parseFloat(penerimaanQtys[line.id]) === parseFloat(line.qty) ? 'quick-action-pill-emerald' : ''}`}
                          style={{ fontSize: '0.65rem', padding: '1px 5px' }}
                          title="Default sesuai Surat Jalan / SPK"
                        >
                          {parseFloat(penerimaanQtys[line.id]) === parseFloat(line.qty) ? (
                            <>
                              <Check size={10} />
                              <span>SJ</span>
                            </>
                          ) : (
                            <>
                              <Zap size={10} />
                              <span>SJ ({line.qty})</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                    <div style={{ width: '120px' }}>
                      <div className="input-addon-group" style={{ height: '38px', borderColor: 'var(--border-strong)' }}>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          disabled={!canEditCutting || saving}
                          placeholder={line.qty ? String(line.qty) : '0.00'}
                          value={currentPenerimaan}
                          onChange={(e) => handlePenerimaanChange(line.id, e.target.value)}
                          className="input-addon-field"
                          style={{ fontSize: '0.95rem', fontWeight: 700 }}
                        />
                        <span className="input-addon-label" style={{ fontSize: '0.68rem', padding: '0 6px' }}>
                          {lineUom}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* INPUT 2: QTY CUTTING / TERPAKAI */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--brand-gold)', textTransform: 'uppercase' }}>
                        ✂️ {lineLabel}:
                      </label>
                      {canEditCutting && (
                        <button
                          type="button"
                          onClick={() => handleFillCuttingFromPenerimaan(line.id)}
                          className={`quick-action-pill ${parseFloat(rollWeights[line.id]) === parseFloat(currentPenerimaan) ? 'quick-action-pill-emerald' : ''}`}
                          style={{ fontSize: '0.65rem', padding: '1px 5px' }}
                          title="Gunakan nilai Qty Penerimaan"
                        >
                          {parseFloat(rollWeights[line.id]) === parseFloat(currentPenerimaan) ? (
                            <>
                              <Check size={10} />
                              <span>Pas</span>
                            </>
                          ) : (
                            <>
                              <Zap size={10} />
                              <span>Pakai Masuk</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                    <div style={{ width: '120px' }}>
                      <div className="input-addon-group" style={{ height: '38px', borderColor: rollWeights[line.id] ? 'var(--brand-gold)' : 'var(--border-strong)' }}>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          disabled={!canEditCutting || saving}
                          placeholder="0.00"
                          value={rollWeights[line.id] !== undefined ? rollWeights[line.id] : ''}
                          onChange={(e) => handleWeightChange(line.id, e.target.value)}
                          className="input-addon-field"
                          style={{ fontSize: '0.95rem', fontWeight: 800 }}
                        />
                        <span className="input-addon-label" style={{ fontSize: '0.68rem', padding: '0 6px' }}>
                          {lineUom}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* SECTION 2: AKSESORIS & PELENGKAP */}
      {accessoryLines.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: fabricLines.length > 0 ? '6px' : '0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              🏷️ Aksesoris & Bahan Pelengkap ({accessoryLines.length} item)
            </span>
            {canEditCutting && (
              <button
                type="button"
                onClick={handleFillAllAccessories}
                className="quick-action-pill quick-action-pill-amber"
                style={{ fontSize: '0.74rem' }}
                title="Isi semua baris aksesoris sekaligus sesuai Qty Penerimaan"
              >
                <Zap size={12} />
                <span>Sesuai Penerimaan Semua</span>
              </button>
            )}
          </div>

          {accessoryLines.map((line, idx) => {
            const lineUom = getLineUom(line, order?.unit_kain);
            const currentPenerimaan =
              penerimaanQtys[line.id] !== undefined
                ? penerimaanQtys[line.id]
                : line.qty_penerimaan !== undefined && line.qty_penerimaan !== null
                ? line.qty_penerimaan
                : line.qty || '';

            return (
              <div
                key={line.id}
                className="card roll-card"
                style={{ borderLeft: '4px solid var(--status-sky)' }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
                    <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem' }}>#{idx + 1}</span>
                    <span className="badge badge-sky mono-num" style={{ fontSize: '0.68rem' }}>{lineUom}</span>
                    {line.kode_lot && (
                      <span className="mono-num" style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                        Lot: {line.kode_lot}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '2px' }}>
                    {line.nama_item}
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                    Surat Jalan Transfer: <strong className="mono-num" style={{ color: 'var(--text-primary)' }}>{line.qty || 0} {lineUom}</strong>
                  </div>
                </div>

                <div className="roll-input-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {/* INPUT 1: PENERIMAAN */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--status-sky)', textTransform: 'uppercase' }}>
                        📦 Penerimaan:
                      </label>
                      {canEditCutting && line.qty > 0 && (
                        <button
                          type="button"
                          onClick={() => handlePenerimaanChange(line.id, line.qty)}
                          className={`quick-action-pill ${parseFloat(penerimaanQtys[line.id]) === parseFloat(line.qty) ? 'quick-action-pill-emerald' : ''}`}
                          style={{ fontSize: '0.65rem', padding: '1px 5px' }}
                          title="Default sesuai Surat Jalan / SPK"
                        >
                          {parseFloat(penerimaanQtys[line.id]) === parseFloat(line.qty) ? (
                            <>
                              <Check size={10} />
                              <span>SJ</span>
                            </>
                          ) : (
                            <>
                              <Zap size={10} />
                              <span>SJ ({line.qty})</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                    <div style={{ width: '120px' }}>
                      <div className="input-addon-group" style={{ height: '38px', borderColor: 'var(--border-strong)' }}>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          disabled={!canEditCutting || saving}
                          placeholder={line.qty ? String(line.qty) : '0'}
                          value={currentPenerimaan}
                          onChange={(e) => handlePenerimaanChange(line.id, e.target.value)}
                          className="input-addon-field"
                          style={{ fontSize: '0.95rem', fontWeight: 700 }}
                        />
                        <span className="input-addon-label" style={{ fontSize: '0.68rem', padding: '0 6px' }}>
                          {lineUom}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* INPUT 2: FISIK TERPAKAI */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--status-sky)', textTransform: 'uppercase' }}>
                        Jumlah Fisik:
                      </label>
                      {canEditCutting && (
                        <button
                          type="button"
                          onClick={() => handleFillCuttingFromPenerimaan(line.id)}
                          className={`quick-action-pill ${parseFloat(rollWeights[line.id]) === parseFloat(currentPenerimaan) ? 'quick-action-pill-emerald' : ''}`}
                          style={{ fontSize: '0.65rem', padding: '1px 5px' }}
                          title="Gunakan nilai Qty Penerimaan"
                        >
                          {parseFloat(rollWeights[line.id]) === parseFloat(currentPenerimaan) ? (
                            <>
                              <Check size={10} />
                              <span>Pas</span>
                            </>
                          ) : (
                            <>
                              <Zap size={10} />
                              <span>Pakai Masuk</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                    <div style={{ width: '120px' }}>
                      <div className="input-addon-group" style={{ height: '38px', borderColor: rollWeights[line.id] ? 'var(--status-sky)' : 'var(--border-strong)' }}>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          disabled={!canEditCutting || saving}
                          placeholder={line.qty ? String(line.qty) : '0'}
                          value={rollWeights[line.id] !== undefined ? rollWeights[line.id] : ''}
                          onChange={(e) => handleWeightChange(line.id, e.target.value)}
                          className="input-addon-field"
                          style={{ fontSize: '0.95rem', fontWeight: 800 }}
                        />
                        <span className="input-addon-label" style={{ fontSize: '0.68rem', padding: '0 6px' }}>
                          {lineUom}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* EMPTY STATE IF NO LINES AT ALL */}
      {fabricLines.length === 0 && accessoryLines.length === 0 && (
        <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          SPK ini tidak memiliki rincian bahan kain terpisah.
          <br />
          Silakan langsung isi <strong>Hasil Potong</strong> pada kartu di atas.
        </div>
      )}

      {/* Sticky Submit Cutting Button */}
      {canEditCutting && (
        <div className="sticky-bottom-action">
          <button
            type="button"
            disabled={saving || (actualCutting === '' && totalPhysicalFabric <= 0 && Object.keys(rollWeights).length === 0)}
            onClick={handleRequestSubmitCutting}
            className="btn btn-primary"
            style={{ width: '100%', padding: '14px 20px', fontSize: '1rem', borderRadius: '14px' }}
          >
            <Save size={18} />
            <span>{saving ? 'Menyimpan...' : 'Simpan Hasil Potong'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
