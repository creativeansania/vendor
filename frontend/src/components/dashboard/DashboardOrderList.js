'use client';

import { Layers, X, ChevronLeft, ChevronRight } from 'lucide-react';
import DashboardOrderCard from './DashboardOrderCard';

export default function DashboardOrderList({
  loading,
  orders = [],
  status,
  search,
  onClearSearch,
  onClearStatus,
  onSelectOrder,
  onAskWa,
  page,
  totalPages,
  totalCount,
  pageNumbers = [],
  onPageChange
}) {
  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '60px 20px', borderRadius: '16px' }}>
        <div className="spinner" style={{ margin: '0 auto 16px auto' }}></div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', fontWeight: 600 }}>Memuat data SPK...</p>
      </div>
    );
  }

  if (orders.length === 0) {
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
              <span>Bersihkan Pencarian & Lihat Semua SPK</span>
            </button>
          )
        )}
      </div>
    );
  }

  return (
    <>
      {/* Orders Grid */}
      <div className="orders-grid">
        {orders.map((o) => (
          <DashboardOrderCard
            key={o.id}
            order={o}
            onClick={() => onSelectOrder(o.id)}
            onAskWa={onAskWa}
          />
        ))}
      </div>

      {/* Numbered Pagination Controls */}
      {totalPages > 1 && (
        <div className="pagination-wrapper">
          <div className="pagination-list">
            {/* Prev Button */}
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="pagination-item pagination-item-nav"
              title="Halaman Sebelumnya"
            >
              <ChevronLeft size={16} />
              <span className="hide-on-mobile">Prev</span>
            </button>

            {/* Numbered Page Buttons */}
            {pageNumbers.map((pItem, idx) => {
              if (pItem === '...') {
                return (
                  <span key={`dots-${idx}`} className="pagination-ellipsis">
                    •••
                  </span>
                );
              }
              const isCurrent = pItem === page;
              return (
                <button
                  key={pItem}
                  onClick={() => onPageChange(pItem)}
                  className={`pagination-item ${isCurrent ? 'active' : ''}`}
                  aria-current={isCurrent ? 'page' : undefined}
                  title={`Halaman ${pItem}`}
                >
                  {pItem}
                </button>
              );
            })}

            {/* Next Button */}
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="pagination-item pagination-item-nav"
              title="Halaman Selanjutnya"
            >
              <span className="hide-on-mobile">Next</span>
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Pagination Info & Quick Jump */}
          <div className="pagination-info" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <span style={{ fontSize: '0.84rem' }}>
              Halaman <strong className="mono-num" style={{ color: 'var(--text-primary)' }}>{page}</strong> dari <strong className="mono-num">{totalPages}</strong> ({totalCount} total SPK)
            </span>

            {totalPages > 5 && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--border-strong)' }}>•</span>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Lompat ke:</span>
                <select
                  value={page}
                  onChange={(e) => onPageChange(Number(e.target.value))}
                  className="select-field"
                  style={{
                    height: '34px',
                    padding: '2px 10px',
                    fontSize: '0.82rem',
                    borderRadius: '8px',
                    width: 'auto',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((pNum) => (
                    <option key={pNum} value={pNum}>
                      Hal {pNum}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
