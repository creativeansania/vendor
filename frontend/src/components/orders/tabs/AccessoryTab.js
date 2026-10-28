'use client';

import AccessoryLinesSection from './cutting/AccessoryLinesSection';
import CuttingSubmitBar from './cutting/CuttingSubmitBar';

export default function AccessoryTab({
  order,
  canEditCutting,
  saving,
  accessoryLines = [],
  penerimaanQtys = {},
  rollWeights = {},
  actualCutting = '',
  totalPhysicalFabric = 0,
  handleFillAllAccessoriesFromSj,
  handleFillAllAccessories,
  handlePenerimaanChange,
  handleFillCuttingFromPenerimaan,
  handleWeightChange,
  handleRequestSubmitCutting
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {accessoryLines.length === 0 ? (
        <div className="card" style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.88rem', borderRadius: '16px' }}>
          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🏷️</div>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
            Tidak Ada Rincian Aksesoris
          </div>
          <div>
            SPK ini tidak memiliki baris aksesoris atau bahan pelengkap terpisah dari Surat Jalan Odoo.
          </div>
        </div>
      ) : (
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
      )}

      {/* Sticky Submit Button for Aksesoris */}
      {accessoryLines.length > 0 && (
        <CuttingSubmitBar
          canEditCutting={canEditCutting}
          saving={saving}
          actualCutting={actualCutting}
          totalPhysicalFabric={totalPhysicalFabric}
          rollWeights={rollWeights}
          label="Simpan Data Aksesoris"
          onSubmit={() => handleRequestSubmitCutting('accessory')}
        />
      )}
    </div>
  );
}
