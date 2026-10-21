'use client';

import SewingSummaryCard from './sewing/SewingSummaryCard';
import SewingRincianSection from './sewing/SewingRincianSection';

export default function SewingTab({
  order,
  targetSpkQty,
  currentActualCutting,
  totalYieldPcs,
  gradeA,
  setGradeA,
  gradeB,
  setGradeB,
  noSuratJalanGradeA,
  setNoSuratJalanGradeA,
  noSuratJalanGradeB,
  setNoSuratJalanGradeB,
  setPresetGradeA,
  canEditGradeA,
  canEditGradeB,
  gradeBSubmitCount = 0,
  saving,
  handleRequestSubmitGradeA,
  handleRequestSubmitGradeB
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* SUMMARY CARD: HASIL JAHIT */}
      <SewingSummaryCard
        order={order}
        targetSpkQty={targetSpkQty}
        currentActualCutting={currentActualCutting}
        totalYieldPcs={totalYieldPcs}
        gradeA={gradeA}
        gradeB={gradeB}
      />

      {/* SECTION: RINCIAN & TRIGGER BUTTONS (GRADE A & GRADE B) */}
      <SewingRincianSection
        targetSpkQty={targetSpkQty}
        totalYieldPcs={totalYieldPcs}
        gradeA={gradeA}
        setGradeA={setGradeA}
        gradeB={gradeB}
        setGradeB={setGradeB}
        noSuratJalanGradeA={noSuratJalanGradeA}
        setNoSuratJalanGradeA={setNoSuratJalanGradeA}
        noSuratJalanGradeB={noSuratJalanGradeB}
        setNoSuratJalanGradeB={setNoSuratJalanGradeB}
        setPresetGradeA={setPresetGradeA}
        canEditGradeA={canEditGradeA}
        canEditGradeB={canEditGradeB}
        gradeBSubmitCount={gradeBSubmitCount}
        saving={saving}
        onSubmitGradeA={handleRequestSubmitGradeA}
        onSubmitGradeB={handleRequestSubmitGradeB}
      />
    </div>
  );
}
