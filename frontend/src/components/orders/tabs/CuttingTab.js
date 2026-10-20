'use client';

import CuttingTotalsSection from './cutting/CuttingTotalsSection';
import FabricRollsSection from './cutting/FabricRollsSection';
import AccessoryLinesSection from './cutting/AccessoryLinesSection';
import CuttingSubmitBar from './cutting/CuttingSubmitBar';

export default function CuttingTab({
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
  accessoryLines = [],
  penerimaanQtys = {},
  rollWeights = {},
  totalPhysicalFabric = 0,
  handleFillAllFabricFromSj,
  handleFillAllFabricFromPenerimaan,
  handleFillAllAccessoriesFromSj,
  handleFillAllAccessories,
  handlePenerimaanChange,
  handleFillCuttingFromPenerimaan,
  handleWeightChange,
  handleRequestSubmitCutting
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* 1. TOTALS & SUMMARY: QTY KIRIM, PENERIMAAN, CUTTING/PEMAKAIAN & SELISIH HASIL CUTTING */}
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
      {fabricLines.length === 0 && (
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
                placeholder={estimasiSpb > 0 ? String(estimasiSpb) : (targetSpkQty > 0 ? String(targetSpkQty) : '0')}
                value={actualCutting}
                onChange={(e) => setActualCutting(e.target.value)}
                className="input-addon-field"
                style={{ fontSize: '1.2rem', fontWeight: 800 }}
              />
              <span className="input-addon-label">PCS</span>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 1: BAHAN KAIN */}
      <FabricRollsSection
        fabricLines={fabricLines}
        order={order}
        canEditCutting={canEditCutting}
        saving={saving}
        penerimaanQtys={penerimaanQtys}
        rollWeights={rollWeights}
        totalPhysicalFabric={totalPhysicalFabric}
        estimasiSpb={estimasiSpb}
        handleFillAllFabricFromSj={handleFillAllFabricFromSj}
        handleFillAllFabricFromPenerimaan={handleFillAllFabricFromPenerimaan}
        handlePenerimaanChange={handlePenerimaanChange}
        handleFillCuttingFromPenerimaan={handleFillCuttingFromPenerimaan}
        handleWeightChange={handleWeightChange}
      />

      {/* SECTION 2: AKSESORIS */}
      <AccessoryLinesSection
        accessoryLines={accessoryLines}
        order={order}
        canEditCutting={canEditCutting}
        saving={saving}
        penerimaanQtys={penerimaanQtys}
        rollWeights={rollWeights}
        handleFillAllAccessoriesFromSj={handleFillAllAccessoriesFromSj}
        handleFillAllAccessories={handleFillAllAccessories}
        handlePenerimaanChange={handlePenerimaanChange}
        handleFillCuttingFromPenerimaan={handleFillCuttingFromPenerimaan}
        handleWeightChange={handleWeightChange}
      />

      {/* Sticky Submit Cutting Button */}
      <CuttingSubmitBar
        canEditCutting={canEditCutting}
        saving={saving}
        actualCutting={actualCutting}
        totalPhysicalFabric={totalPhysicalFabric}
        rollWeights={rollWeights}
        onSubmit={handleRequestSubmitCutting}
      />
    </div>
  );
}
