'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { useOrderDetail } from '@/lib/hooks/useOrderDetail';
import OrderNavbar from '@/components/orders/OrderNavbar';
import OrderBanner from '@/components/orders/OrderBanner';
import OrderSpecCard from '@/components/orders/OrderSpecCard';
import TarifMakloonCard from '@/components/orders/TarifMakloonCard';
import OrderTabsNav from '@/components/orders/OrderTabsNav';
import CuttingTab from '@/components/orders/tabs/CuttingTab';
import SewingTab from '@/components/orders/tabs/SewingTab';
import TransferTab from '@/components/orders/tabs/TransferTab';
import SafetyConfirmationModal from '@/components/orders/SafetyConfirmationModal';

function OrderDetailContent() {
  const routeParams = useParams();
  const orderId = routeParams?.id;
  const detail = useOrderDetail(orderId);

  if (detail.loading || !detail.order) {
    return (
      <div style={{ padding: '80px 20px', textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto 16px' }}></div>
        <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Memuat data SPK...</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', width: '100%', overflowX: 'hidden' }}>
      {/* Top Navbar */}
      <OrderNavbar
        order={detail.order}
        isBackorder={detail.isBackorder}
        actualCutting={detail.actualCutting}
        syncingOdoo={detail.syncingOdoo}
        loading={detail.loading}
        handleForceSyncOdoo={detail.handleForceSyncOdoo}
        handleShareToWa={detail.handleShareToWa}
        loadData={detail.loadData}
      />

      {/* Main Content Area */}
      <main className="main-content">
        {/* Alerts / Feedback Message & Backorder Banner */}
        <OrderBanner feedback={detail.feedback} isBackorder={detail.isBackorder} />

        {/* Master SPK Specification Card */}
        <OrderSpecCard
          order={detail.order}
          skuCode={detail.skuCode}
          cleanProductName={detail.cleanProductName}
          targetSpkQty={detail.targetSpkQty}
        />

        {/* Master Vendor & Admin: Biaya & Tarif Makloon Card */}
        <TarifMakloonCard
          order={detail.order}
          user={detail.user}
          syncingOdoo={detail.syncingOdoo}
          handleForceSyncOdoo={detail.handleForceSyncOdoo}
        />

        {/* Operational Segmented Tabs */}
        <OrderTabsNav
          activeTab={detail.activeTab}
          setActiveTab={detail.setActiveTab}
          rollLinesCount={detail.rollLines?.length || 0}
          transfersCount={detail.transfers?.length || 0}
        />

        {/* TAB 1: HASIL POTONG & BAHAN */}
        {detail.activeTab === 'timbang' && (
          <CuttingTab
            order={detail.order}
            targetSpkQty={detail.targetSpkQty}
            currentActualCutting={detail.currentActualCutting}
            selisihCutting={detail.selisihCutting}
            actualCutting={detail.actualCutting}
            setActualCutting={detail.setActualCutting}
            handleFillCuttingWithTargetSpk={detail.handleFillCuttingWithTargetSpk}
            canEditCutting={detail.canEditCutting}
            saving={detail.saving}
            fabricLines={detail.fabricLines}
            accessoryLines={detail.accessoryLines}
            penerimaanQtys={detail.penerimaanQtys}
            rollWeights={detail.rollWeights}
            totalPhysicalFabric={detail.totalPhysicalFabric}
            handleFillAllFabricFromPenerimaan={detail.handleFillAllFabricFromPenerimaan}
            handleFillAllAccessories={detail.handleFillAllAccessories}
            handlePenerimaanChange={detail.handlePenerimaanChange}
            handleFillCuttingFromPenerimaan={detail.handleFillCuttingFromPenerimaan}
            handleWeightChange={detail.handleWeightChange}
            handleRequestSubmitCutting={detail.handleRequestSubmitCutting}
          />
        )}

        {/* TAB 2: INPUT HASIL JAHIT */}
        {detail.activeTab === 'hasil' && (
          <SewingTab
            order={detail.order}
            targetSpkQty={detail.targetSpkQty}
            currentActualCutting={detail.currentActualCutting}
            totalYieldPcs={detail.totalYieldPcs}
            gradeA={detail.gradeA}
            setGradeA={detail.setGradeA}
            gradeB={detail.gradeB}
            setGradeB={detail.setGradeB}
            sisaPanjang={detail.sisaPanjang}
            setSisaPanjang={detail.setSisaPanjang}
            sisaSedang={detail.sisaSedang}
            setSisaSedang={detail.setSisaSedang}
            sisaPendek={detail.sisaPendek}
            setSisaPendek={detail.setSisaPendek}
            totalSisaKg={detail.totalSisaKg}
            sisaKg={detail.sisaKg}
            setSisaKg={detail.setSisaKg}
            noSuratJalan={detail.noSuratJalan}
            setNoSuratJalan={detail.setNoSuratJalan}
            setPresetGradeA={detail.setPresetGradeA}
            canEditResult={detail.canEditResult}
            saving={detail.saving}
            handleRequestSubmitProduction={detail.handleRequestSubmitProduction}
          />
        )}

        {/* TAB 3: DOKUMEN TRANSFER ODOO */}
        {detail.activeTab === 'transfer' && (
          <TransferTab
            order={detail.order}
            transfers={detail.transfers}
            filteredTransfers={detail.filteredTransfers}
            transferFilter={detail.transferFilter}
            setTransferFilter={detail.setTransferFilter}
            transferCounts={detail.transferCounts}
            copiedTransferId={detail.copiedTransferId}
            handleCopyTransferName={detail.handleCopyTransferName}
            handleForceSyncOdoo={detail.handleForceSyncOdoo}
            syncingOdoo={detail.syncingOdoo}
          />
        )}
      </main>

      {/* SAFETY CONFIRMATION & EXTREME DEVIATION MODAL */}
      <SafetyConfirmationModal
        safetyModal={detail.safetyModal}
        order={detail.order}
        saving={detail.saving}
        onClose={() => detail.setSafetyModal((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
}

export default function OrderDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px', margin: '40px auto', maxWidth: '400px' }}>
          <div className="spinner" style={{ margin: '0 auto 16px' }}></div>
          <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Memuat detail SPK...</p>
        </div>
      }
    >
      <OrderDetailContent />
    </Suspense>
  );
}
