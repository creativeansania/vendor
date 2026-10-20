'use client';

export default function TransferFilterPills({
  transferFilter,
  setTransferFilter,
  transferCounts
}) {
  return (
    <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
      <button
        type="button"
        onClick={() => setTransferFilter('all')}
        className={`filter-pill ${transferFilter === 'all' ? 'active' : ''}`}
        style={{ fontSize: '0.75rem', padding: '4px 10px' }}
      >
        Semua ({transferCounts.all})
      </button>
      {transferCounts.komponen > 0 && (
        <button
          type="button"
          onClick={() => setTransferFilter('komponen')}
          className={`filter-pill ${transferFilter === 'komponen' ? 'active' : ''}`}
          style={{ fontSize: '0.75rem', padding: '4px 10px' }}
        >
          📦 Kain & Bahan ({transferCounts.komponen})
        </button>
      )}
      {transferCounts.produkJadi > 0 && (
        <button
          type="button"
          onClick={() => setTransferFilter('produk_jadi')}
          className={`filter-pill ${transferFilter === 'produk_jadi' ? 'active' : ''}`}
          style={{ fontSize: '0.75rem', padding: '4px 10px' }}
        >
          👗 Penerimaan Jahit ({transferCounts.produkJadi})
        </button>
      )}
      {transferCounts.retur > 0 && (
        <button
          type="button"
          onClick={() => setTransferFilter('retur')}
          className={`filter-pill ${transferFilter === 'retur' ? 'active' : ''}`}
          style={{ fontSize: '0.75rem', padding: '4px 10px' }}
        >
          🔁 Retur / Lainnya ({transferCounts.retur})
        </button>
      )}
    </div>
  );
}
