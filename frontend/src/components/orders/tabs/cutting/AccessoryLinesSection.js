'use client';

import { useState } from 'react';
import { Zap, Check, PackageCheck, Scissors } from 'lucide-react';
import { getLineUom } from '@/lib/utils/formatters';

export default function AccessoryLinesSection({
  accessoryLines = [],
  order,
  canEditCutting,
  saving,
  penerimaanQtys = {},
  rollWeights = {},
  handleFillAllAccessories,
  handleFillAllAccessoriesFromSj,
  handlePenerimaanChange,
  handleFillCuttingFromPenerimaan,
  handleWeightChange
}) {
  const [activeAccTab, setActiveAccTab] = useState('penerimaan'); // 'penerimaan' | 'pemakaian'

  if (accessoryLines.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
      {/* SECTION TITLE & TAB SWITCHER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px', flexWrap: 'wrap', gap: '8px' }}>
        <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          🏷️ Aksesoris & Bahan Pelengkap ({accessoryLines.length} item)
        </span>
      </div>

      {/* SUB-TABS: PENERIMAAN vs PEMAKAIAN */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '6px',
          background: 'var(--bg-card-subtle)',
          padding: '4px',
          borderRadius: '12px',
          border: '1px solid var(--border-default)'
        }}
      >
        <button
          type="button"
          onClick={() => setActiveAccTab('penerimaan')}
          className={`segmented-tab-btn ${activeAccTab === 'penerimaan' ? 'active' : ''}`}
          style={{
            padding: '8px 12px',
            fontSize: '0.8rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            borderRadius: '10px'
          }}
        >
          <PackageCheck size={14} />
          <span>1. Penerimaan ({accessoryLines.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveAccTab('pemakaian')}
          className={`segmented-tab-btn ${activeAccTab === 'pemakaian' ? 'active' : ''}`}
          style={{
            padding: '8px 12px',
            fontSize: '0.8rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            borderRadius: '10px'
          }}
        >
          <Scissors size={14} />
          <span>2. Pemakaian ({accessoryLines.length})</span>
        </button>
      </div>

      {/* TAB 1: PENERIMAAN AKSESORIS */}
      {activeAccTab === 'penerimaan' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Input jumlah fisik aksesoris yang diterima dari Surat Jalan:
            </span>
            {canEditCutting && handleFillAllAccessoriesFromSj && (
              <button
                type="button"
                onClick={handleFillAllAccessoriesFromSj}
                className="quick-action-pill quick-action-pill-amber"
                style={{ fontSize: '0.72rem' }}
                title="Isi semua Penerimaan aksesoris sesuai Surat Jalan Odoo"
              >
                <Zap size={11} />
                <span>Sesuai SJ Semua</span>
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
                    <span className="mono-num" style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                      {line.kode_lot || 'Aksesoris'}
                    </span>
                    <span className="badge badge-sky mono-num" style={{ fontSize: '0.68rem' }}>{lineUom}</span>
                  </div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '2px' }}>
                    {line.nama_item}
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                    Surat Jalan Transfer: <strong className="mono-num" style={{ color: 'var(--text-primary)' }}>{line.qty || 0} {lineUom}</strong>
                  </div>
                </div>

                <div className="roll-input-row" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--status-sky)', textTransform: 'uppercase' }}>
                        📦 Qty Diterima:
                      </label>
                      {canEditCutting && line.qty > 0 && (
                        <button
                          type="button"
                          onClick={() => handlePenerimaanChange(line.id, line.qty)}
                          className={`quick-action-pill ${parseFloat(penerimaanQtys[line.id]) === parseFloat(line.qty) ? 'quick-action-pill-emerald' : ''}`}
                          style={{ fontSize: '0.65rem', padding: '1px 5px' }}
                          title="Sesuai Surat Jalan Odoo"
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
                    <div style={{ width: '130px' }}>
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
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TAB 2: PEMAKAIAN AKSESORIS */}
      {activeAccTab === 'pemakaian' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Input jumlah aksesoris yang terpakai untuk proses produksi:
            </span>
            {canEditCutting && (
              <button
                type="button"
                onClick={handleFillAllAccessories}
                className="quick-action-pill quick-action-pill-amber"
                style={{ fontSize: '0.72rem' }}
                title="Isi semua aksesoris sesuai Qty Penerimaan"
              >
                <Zap size={11} />
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
                : line.qty || 0;

            return (
              <div
                key={line.id}
                className="card roll-card"
                style={{ borderLeft: '4px solid var(--brand-gold)' }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
                    <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem' }}>#{idx + 1}</span>
                    <span className="mono-num" style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                      {line.kode_lot || 'Aksesoris'}
                    </span>
                    <span className="badge badge-gold mono-num" style={{ fontSize: '0.68rem' }}>{lineUom}</span>
                  </div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '2px' }}>
                    {line.nama_item}
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                    Qty Diterima: <strong className="mono-num" style={{ color: 'var(--text-primary)' }}>{currentPenerimaan} {lineUom}</strong>
                  </div>
                </div>

                <div className="roll-input-row" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--brand-gold)', textTransform: 'uppercase' }}>
                        ✂️ Qty Terpakai:
                      </label>
                      {canEditCutting && (
                        <button
                          type="button"
                          onClick={() => handleFillCuttingFromPenerimaan(line.id)}
                          className={`quick-action-pill ${parseFloat(rollWeights[line.id]) === parseFloat(currentPenerimaan) ? 'quick-action-pill-emerald' : ''}`}
                          style={{ fontSize: '0.65rem', padding: '1px 5px' }}
                          title="Gunakan nilai Qty Terima"
                        >
                          {parseFloat(rollWeights[line.id]) === parseFloat(currentPenerimaan) ? (
                            <>
                              <Check size={10} />
                              <span>Pas</span>
                            </>
                          ) : (
                            <>
                              <Zap size={10} />
                              <span>Pakai Semua</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                    <div style={{ width: '130px' }}>
                      <div className="input-addon-group" style={{ height: '38px', borderColor: rollWeights[line.id] ? 'var(--brand-gold)' : 'var(--border-strong)' }}>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          disabled={!canEditCutting || saving}
                          placeholder={String(currentPenerimaan)}
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
    </div>
  );
}
