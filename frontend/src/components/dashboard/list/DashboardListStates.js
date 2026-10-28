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

export function DashboardEmptyState({ status, search, onClearSearch, onClearStatus }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '60px 20px', borderRadius: '16px' }}>
      <Layers size={40} style={{ margin: '0 auto 12px auto', color: 'var(--text-muted)' }} />
      <h3 style={{ fontSize: '1.05rem', marginBottom: '6px', fontWeight: 800 }}>
        {status === 'kain_kurang' ? 'Tidak Ada SPK Kain Kurang di Halaman Ini' : 'Tidak Ada SPK Ditemukan'}
      </h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', maxWidth: '440px', margin: '0 auto' }}>
        {status === 'kain_kurang'
          ? 'Semua SPK pada halaman ini memiliki kain yang cukup. Silakan cek halaman lain atau kembali ke Semua SPK.'
          : search.trim()
          ? `Tidak ditemukan SPK yang cocok dengan "${search.trim()}". Cukup ketik 4 angka belakang nomor SPK (contoh: 1495) atau tekan tombol di bawah.`
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
        search.trim() && (
          <button
            type="button"
            onClick={onClearSearch}
            className="btn btn-secondary"
            style={{ marginTop: '16px', borderRadius: '12px', fontSize: '0.88rem', fontWeight: 700 }}
          >
            <X size={15} />
            <span>Bersihkan Pencarian &amp; Lihat Semua SPK</span>
          </button>
        )
      )}
    </div>
  );
}

