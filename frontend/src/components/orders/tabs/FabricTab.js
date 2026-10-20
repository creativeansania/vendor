'use client';

import { Zap, Check } from 'lucide-react';
import { getLineUom } from '@/lib/utils/formatters';
import CuttingTotalsSection from './cutting/CuttingTotalsSection';
import CuttingSubmitBar from './cutting/CuttingSubmitBar';

export default function FabricTab({
  order,
  targetSpkQty,
  currentActualCutting,
  selisihCutting,
  estimasiSpb,
  actualCutting,
  setActualCutting,
  handleFillCuttingWithTargetSpk,
  handleFillCuttingWithEstimasiSpb,
  canEditCutting,
  saving,
  fabricLines = [],
  penerimaanQtys = {},
  rollWeights = {},
  totalPhysicalFabric = 0,
  handleFillAllFabricFromSj,
  handleFillAllFabricFromPenerimaan,
  handlePenerimaanChange,
  handleFillCuttingFromPenerimaan,
  handleWeightChange,
  handleRequestSubmitCutting
}) {
  const effectiveEstimasi =
    estimasiSpb > 0
      ? estimasiSpb
      : (parseFloat(order?.estimasi_dari_spb) || 0);

  const unitKain = (order?.unit_kain || fabricLines[0]?.uom || 'yard').toUpperCase();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* 1. RINGKASAN TOTAL: KIRIM, TERIMA, POTONG, ESTIMASI SPB & SELISIH HASIL CUTTING */}
      <CuttingTotalsSection
        order={order}
        fabricLines={fabricLines}
        penerimaanQtys={penerimaanQtys}
        totalPhysicalFabric={totalPhysicalFabric}
        actualCutting={actualCutting}
        estimasiSpb={estimasiSpb}
        selisihCutting={selisihCutting}
        currentActualCutting={currentActualCutting}
      />

      {/* FALLBACK INPUT IF NO FABRIC ROLL LINES */}
      {fabricLines.length === 0 ? (
        <div className="card" style={{ padding: '16px 18px', borderRadius: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                ✂️ Input Qty Potong (Actual Cutting)
              </h4>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                SPK ini tidak memiliki rincian roll kain terpisah. Masukkan hasil potong langsung dalam satuan PCS.
              </div>
            </div>
            <span className="badge badge-gold mono-num">PCS</span>
          </div>
          <div style={{ maxWidth: '220px' }}>
            <div className="input-addon-group" style={{ height: '42px', borderColor: actualCutting ? 'var(--brand-gold)' : 'var(--border-strong)' }}>
              <input
                type="number"
                step="1"
                min="0"
                disabled={!canEditCutting || saving}
                placeholder={effectiveEstimasi > 0 ? String(effectiveEstimasi) : (targetSpkQty > 0 ? String(targetSpkQty) : '0')}
                value={actualCutting}
                onChange={(e) => setActualCutting(e.target.value)}
                className="input-addon-field"
                style={{ fontSize: '1.2rem', fontWeight: 800 }}
              />
              <span className="input-addon-label">PCS</span>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              🧵 Rincian Roll Kain ({fabricLines.length} baris)
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {canEditCutting && handleFillAllFabricFromSj && (
                <button
                  type="button"
                  onClick={handleFillAllFabricFromSj}
                  className="quick-action-pill quick-action-pill-amber"
                  style={{ fontSize: '0.72rem' }}
                  title="Isi semua Qty Penerimaan kain sesuai Surat Jalan Odoo"
                >
                  <Zap size={11} />
                  <span>Sesuai SJ Semua</span>
                </button>
              )}
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Total Qty Potong: <strong className="mono-num" style={{ color: 'var(--brand-gold)', fontWeight: 800 }}>{totalPhysicalFabric.toLocaleString('id-ID')} PCS</strong>
              </span>
            </div>
          </div>

          {fabricLines.map((line, idx) => {
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

                  {/* INPUT 2: QTY POTONG (SATUAN PCS) */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--brand-gold)', textTransform: 'uppercase' }}>
                        ✂️ Qty Potong:
                      </label>
                      {canEditCutting && fabricLines.length === 1 && effectiveEstimasi > 0 && (
                        <button
                          type="button"
                          onClick={() => handleWeightChange(line.id, String(effectiveEstimasi))}
                          className={`quick-action-pill ${parseFloat(rollWeights[line.id]) === effectiveEstimasi ? 'quick-action-pill-emerald' : ''}`}
                          style={{ fontSize: '0.65rem', padding: '1px 5px' }}
                          title="Isi sesuai Estimasi SPB"
                        >
                          {parseFloat(rollWeights[line.id]) === effectiveEstimasi ? (
                            <>
                              <Check size={10} />
                              <span>SPB</span>
                            </>
                          ) : (
                            <>
                              <Zap size={10} />
                              <span>SPB ({effectiveEstimasi})</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                    <div style={{ width: '120px' }}>
                      <div className="input-addon-group" style={{ height: '38px', borderColor: rollWeights[line.id] ? 'var(--brand-gold)' : 'var(--border-strong)' }}>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          disabled={!canEditCutting || saving}
                          placeholder="0"
                          value={rollWeights[line.id] !== undefined ? rollWeights[line.id] : ''}
                          onChange={(e) => handleWeightChange(line.id, e.target.value)}
                          className="input-addon-field"
                          style={{ fontSize: '0.95rem', fontWeight: 800 }}
                        />
                        <span className="input-addon-label" style={{ fontSize: '0.68rem', padding: '0 6px' }}>
                          PCS
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

      {/* Sticky Submit Button for Kain */}
      <CuttingSubmitBar
        canEditCutting={canEditCutting}
        saving={saving}
        actualCutting={actualCutting}
        totalPhysicalFabric={totalPhysicalFabric}
        rollWeights={rollWeights}
        label="Simpan Data Kain & Hasil Potong"
        onSubmit={handleRequestSubmitCutting}
      />
    </div>
  );
}
