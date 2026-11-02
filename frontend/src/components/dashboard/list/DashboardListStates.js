'use client';

import { Layers, X } from 'lucide-react';

export function DashboardLoadingState() {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '60px 20px', borderRadius: '16px' }}>
      <div className="spinner" style={{ margin: '0 auto 16px auto' }}></div>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', fontWeight: 600 }}>Memuat data SPK...</p>
    </div>
  );
}

export function DashboardEmptyState({
  status,
  search,
  searchMo,
  searchProduct,
  onClearSearch,
  onClearMoSearch,
  onClearProductSearch,
  onClearStatus
}) {
  const activeMo = (searchMo || '').trim();
  const activeProduct = (searchProduct || '').trim();
  const legacySearch = (search || '').trim();
  const hasSearch = Boolean(activeMo || activeProduct || legacySearch);

  let searchDesc = '';
  if (activeMo && activeProduct) {
    searchDesc = `Tidak ditemukan SPK dengan No. MO "${activeMo}" dan Produk/Warna "${activeProduct}".`;
  } else if (activeMo) {
    searchDesc = `Tidak ditemukan SPK dengan No. MO "${activeMo}". Coba ketik 4 digit nomor MO atau bersihkan pencarian.`;
  } else if (activeProduct) {
    searchDesc = `Tidak ditemukan SPK dengan Produk / Varian Warna "${activeProduct}". Coba gunakan kata kunci warna atau nama kain lain.`;
  } else if (legacySearch) {
    searchDesc = `Tidak ditemukan SPK yang cocok dengan "${legacySearch}".`;
  }

  return (
    <div className="card" style={{ textAlign: 'center', padding: '60px 20px', borderRadius: '16px' }}>
      <Layers size={40} style={{ margin: '0 auto 12px auto', color: 'var(--text-muted)' }} />
      <h3 style={{ fontSize: '1.05rem', marginBottom: '6px', fontWeight: 800 }}>
        {status === 'kain_kurang' ? 'Tidak Ada SPK Kain Kurang di Halaman Ini' : 'Tidak Ada SPK Ditemukan'}
      </h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', maxWidth: '460px', margin: '0 auto', lineHeight: 1.5 }}>
        {status === 'kain_kurang'
          ? 'Semua SPK pada halaman ini memiliki kain yang cukup. Silakan cek halaman lain atau kembali ke Semua SPK.'
          : hasSearch
          ? searchDesc
          : 'Coba sesuaikan kata kunci pencarian atau ubah filter status di atas.'}
      </p>
      {status === 'kain_kurang' ? (
        <button
          type="button"
          onClick={onClearStatus}
          className="btn btn-secondary"
          style={{ marginTop: '16px', borderRadius: '12px', fontSize: '0.88rem', fontWeight: 700 }}
        >
          <span>Lihat Semua SPK</span>
        </button>
      ) : (
        hasSearch && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
            {activeMo && onClearMoSearch && (
              <button
                type="button"
                onClick={onClearMoSearch}
                className="btn btn-secondary"
                style={{ borderRadius: '12px', fontSize: '0.82rem', fontWeight: 600 }}
              >
                <X size={14} />
                <span>Hapus Filter MO ({activeMo})</span>
              </button>
            )}
            {activeProduct && onClearProductSearch && (
              <button
                type="button"
                onClick={onClearProductSearch}
                className="btn btn-secondary"
                style={{ borderRadius: '12px', fontSize: '0.82rem', fontWeight: 600 }}
              >
                <X size={14} />
                <span>Hapus Filter Produk ({activeProduct})</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClearSearch}
              className="btn btn-primary"
              style={{ borderRadius: '12px', fontSize: '0.84rem', fontWeight: 700 }}
            >
              <X size={14} />
              <span>Bersihkan Semua Pencarian</span>
            </button>
          </div>
        )
      )}
    </div>
  );
}

