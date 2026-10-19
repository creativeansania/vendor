'use client';

import { Zap, Check } from 'lucide-react';
import { getLineUom, getLineLabel } from '@/lib/utils/formatters';

export default function FabricRollsSection({
  fabricLines = [],
  order,
  canEditCutting,
  saving,
  penerimaanQtys = {},
  rollWeights = {},
  totalPhysicalFabric = 0,
  handleFillAllFabricFromPenerimaan,
  handlePenerimaanChange,
  handleFillCuttingFromPenerimaan,
  handleWeightChange
}) {
  if (fabricLines.length === 0) return null;

  return (
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
  );
}
