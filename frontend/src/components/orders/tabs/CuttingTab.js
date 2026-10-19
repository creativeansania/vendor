'use client';

import CuttingSummaryCard from './cutting/CuttingSummaryCard';
import FabricRollsSection from './cutting/FabricRollsSection';
import AccessoryLinesSection from './cutting/AccessoryLinesSection';
import CuttingSubmitBar from './cutting/CuttingSubmitBar';

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
      <CuttingSummaryCard
        order={order}
        targetSpkQty={targetSpkQty}
        currentActualCutting={currentActualCutting}
        selisihCutting={selisihCutting}
        actualCutting={actualCutting}
        setActualCutting={setActualCutting}
        handleFillCuttingWithTargetSpk={handleFillCuttingWithTargetSpk}
        canEditCutting={canEditCutting}
        saving={saving}
      />

      {/* SECTION 1: BAHAN KAIN */}
      <FabricRollsSection
        fabricLines={fabricLines}
        order={order}
        canEditCutting={canEditCutting}
        saving={saving}
        penerimaanQtys={penerimaanQtys}
        rollWeights={rollWeights}
        totalPhysicalFabric={totalPhysicalFabric}
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
        handleFillAllAccessories={handleFillAllAccessories}
        handlePenerimaanChange={handlePenerimaanChange}
        handleFillCuttingFromPenerimaan={handleFillCuttingFromPenerimaan}
        handleWeightChange={handleWeightChange}
      />

      {/* EMPTY STATE IF NO LINES AT ALL */}
      {fabricLines.length === 0 && accessoryLines.length === 0 && (
        <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          SPK ini tidak memiliki rincian bahan kain terpisah.
          <br />
          Silakan langsung isi <strong>Hasil Potong</strong> pada kartu di atas.
        </div>
      )}

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
