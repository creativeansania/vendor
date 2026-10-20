'use client';

import TransferHeader from './transfer/TransferHeader';
import TransferFilterPills from './transfer/TransferFilterPills';
import TransferDocumentCard from './transfer/TransferDocumentCard';
import TransferEmptyState from './transfer/TransferEmptyState';

export default function TransferTab({
  order,
  transfers,
  filteredTransfers,
  transferFilter,
  setTransferFilter,
  transferCounts,
  copiedTransferId,
  handleCopyTransferName,
  handleForceSyncOdoo,
  syncingOdoo
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div className="card" style={{ padding: '18px 20px', borderRadius: '16px' }}>
        {/* Header Bar */}
        <TransferHeader
          order={order}
          handleForceSyncOdoo={handleForceSyncOdoo}
          syncingOdoo={syncingOdoo}
        />

        {/* Filter Pills */}
        {transfers.length > 0 && (
          <TransferFilterPills
            transferFilter={transferFilter}
            setTransferFilter={setTransferFilter}
            transferCounts={transferCounts}
          />
        )}

        {/* Transfer Documents Cards List */}
        {filteredTransfers.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filteredTransfers.map((t, idx) => (
              <TransferDocumentCard
                key={t.id || idx}
                transfer={t}
                copiedTransferId={copiedTransferId}
                handleCopyTransferName={handleCopyTransferName}
              />
            ))}
          </div>
        ) : (
          /* Empty state for transfers */
          <TransferEmptyState
            handleForceSyncOdoo={handleForceSyncOdoo}
            syncingOdoo={syncingOdoo}
          />
        )}
      </div>
    </div>
  );
}
