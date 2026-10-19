'use client';

import SewingSummaryCard from './sewing/SewingSummaryCard';
import SewingRincianSection from './sewing/SewingRincianSection';
import SewingSubmitBar from './sewing/SewingSubmitBar';

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
      {/* CARD 1: HASIL JAHIT */}
      <SewingSummaryCard
        order={order}
        targetSpkQty={targetSpkQty}
        currentActualCutting={currentActualCutting}
        totalYieldPcs={totalYieldPcs}
        gradeA={gradeA}
        gradeB={gradeB}
      />

      {/* SECTION: RINCIAN HASIL JAHIT */}
      <SewingRincianSection
        targetSpkQty={targetSpkQty}
        totalYieldPcs={totalYieldPcs}
        gradeA={gradeA}
        setGradeA={setGradeA}
        gradeB={gradeB}
        setGradeB={setGradeB}
        sisaKg={sisaKg}
        setSisaKg={setSisaKg}
        noSuratJalan={noSuratJalan}
        setNoSuratJalan={setNoSuratJalan}
        setPresetGradeA={setPresetGradeA}
        canEditResult={canEditResult}
        saving={saving}
      />

      {/* STICKY SUBMIT BUTTON */}
      <SewingSubmitBar
        canEditResult={canEditResult}
        saving={saving}
        totalYieldPcs={totalYieldPcs}
        onSubmit={handleRequestSubmitProduction}
      />
    </div>
  );
}
