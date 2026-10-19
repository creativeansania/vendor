'use client';

import { Package, Scissors, RefreshCw, FileText, Truck, Check, Copy } from 'lucide-react';
import { formatDateIndo } from '@/lib/utils/formatters';

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
  const getCategoryBadge = (category) => {
    switch (category) {
      case 'komponen':
        return {
          label: 'Pengiriman Kain & Bahan',
          icon: <Package size={14} />,
          bg: 'rgba(59, 130, 246, 0.1)',
          border: 'rgba(59, 130, 246, 0.25)',
          color: 'var(--status-sky)'
        };
      case 'produk_jadi':
        return {
          label: 'Penerimaan Hasil Jahit',
          icon: <Scissors size={14} />,
          bg: 'rgba(34, 197, 94, 0.1)',
          border: 'rgba(34, 197, 94, 0.25)',
          color: 'var(--status-emerald)'
        };
      case 'retur':
        return {
          label: 'Retur Bahan / Makloon',
          icon: <RefreshCw size={14} />,
          bg: 'rgba(245, 158, 11, 0.1)',
          border: 'rgba(245, 158, 11, 0.25)',
          color: 'var(--status-amber)'
        };
      default:
        return {
          label: 'Transfer Internal',
          icon: <FileText size={14} />,
          bg: 'rgba(148, 163, 184, 0.1)',
          border: 'rgba(148, 163, 184, 0.25)',
          color: 'var(--text-muted)'
        };
    }
  };

  const getStateBadge = (state) => {
    switch (state) {
      case 'done':
        return { label: 'Selesai', bg: 'var(--status-emerald-bg)', border: 'var(--status-emerald-border)', color: 'var(--status-emerald)' };
      case 'assigned':
        return { label: 'Siap Kirim / Proses', bg: 'var(--status-sky-bg)', border: 'var(--status-sky-border)', color: 'var(--status-sky)' };
      case 'confirmed':
        return { label: 'Menunggu Bahan', bg: 'var(--status-amber-bg)', border: 'var(--status-amber-border)', color: 'var(--status-amber)' };
      case 'draft':
        return { label: 'Draft', bg: 'var(--bg-card-subtle)', border: 'var(--border-default)', color: 'var(--text-muted)' };
      default:
        return { label: state || 'Tercatat', bg: 'var(--bg-card-subtle)', border: 'var(--border-default)', color: 'var(--text-muted)' };
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div className="card" style={{ padding: '18px 20px', borderRadius: '16px' }}>
        {/* Header Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'rgba(59, 130, 246, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--status-sky)',
                flexShrink: 0
              }}
            >
              <Truck size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.02rem', margin: 0, fontWeight: 800, color: 'var(--text-primary)' }}>
                Dokumen Transfer & Surat Jalan
              </h3>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                Daftar transfer bahan dan surat jalan untuk SPK #{order?.mo_name || order?.id}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={handleForceSyncOdoo}
              disabled={syncingOdoo}
              className="btn btn-secondary"
              style={{ fontSize: '0.76rem', padding: '6px 12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}
              title="Perbarui status dokumen transfer langsung dari Odoo"
            >
              <RefreshCw size={13} className={syncingOdoo ? 'spinner' : ''} />
              <span>{syncingOdoo ? 'Sinkron Odoo...' : 'Tarik Transfer Odoo'}</span>
            </button>
          </div>
        </div>

        {/* Filter Pills */}
        {transfers.length > 0 && (
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
        )}

        {/* Transfer Documents Cards List */}
        {filteredTransfers.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filteredTransfers.map((t, idx) => {
              const cat = getCategoryBadge(t.category);
              const st = getStateBadge(t.state);
              const isCopied = copiedTransferId === (t.id || t.name);

              return (
                <div
                  key={t.id || idx}
                  style={{
                    padding: '14px 16px',
                    background: 'var(--bg-card-subtle)',
                    borderRadius: '12px',
                    border: '1px solid var(--border-default)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {/* Row 1: Category badge, Transfer Number, Status Badge */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: '6px',
                          background: cat.bg,
                          border: `1px solid ${cat.border}`,
                          color: cat.color,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px'
                        }}
                      >
                        {cat.icon}
                        <span>{cat.label}</span>
                      </span>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span className="mono-num" style={{ fontSize: '0.96rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                          {t.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyTransferName(t.name, t.id || t.name)}
                          className="btn btn-secondary btn-icon"
                          style={{ width: '26px', height: '26px', borderRadius: '6px', padding: 0 }}
                          title="Salin nomor transfer"
                        >
                          {isCopied ? <Check size={12} color="var(--status-emerald)" /> : <Copy size={12} />}
                        </button>
                        {isCopied && (
                          <span style={{ fontSize: '0.68rem', color: 'var(--status-emerald)', fontWeight: 700 }}>
                            Tersalin!
                          </span>
                        )}
                      </div>
                    </div>

                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: '6px',
                        background: st.bg,
                        border: `1px solid ${st.border}`,
                        color: st.color
                      }}
                    >
                      {st.label}
                    </span>
                  </div>

                  {/* Row 2: Origin, Picking Type, Date */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                      gap: '8px',
                      fontSize: '0.78rem',
                      marginTop: '8px',
                      paddingTop: '8px',
                      borderTop: '1px dashed var(--border-default)'
                    }}
                  >
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>No. Referensi / Asal:</span>{' '}
                      <strong className="mono-num" style={{ color: 'var(--text-primary)' }}>
                        {t.origin || '-'}
                      </strong>
                    </div>

                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Tipe Operasi:</span>{' '}
                      <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                        {t.pickingType || '-'}
                      </span>
                    </div>

                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {t.state === 'done' ? 'Tanggal Selesai:' : 'Jadwal Transfer:'}
                      </span>{' '}
                      <strong style={{ color: 'var(--text-primary)' }}>
                        {formatDateIndo(t.dateDone || t.scheduledDate)}
                      </strong>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Empty state for transfers */
          <div
            style={{
              padding: '32px 20px',
              textAlign: 'center',
              background: 'var(--bg-card-subtle)',
              borderRadius: '12px',
              border: '1px dashed var(--border-default)'
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: 'rgba(59, 130, 246, 0.1)',
                color: 'var(--status-sky)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px'
              }}
            >
              <Truck size={24} />
            </div>
            <div style={{ fontSize: '0.94rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
              Belum Ada Dokumen Transfer
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '420px', margin: '0 auto 14px', lineHeight: 1.5 }}>
              Belum ada dokumen transfer atau surat jalan yang tercatat untuk SPK ini di Odoo.
            </p>
            <button
              type="button"
              onClick={handleForceSyncOdoo}
              disabled={syncingOdoo}
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', padding: '8px 16px', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <RefreshCw size={14} className={syncingOdoo ? 'spinner' : ''} />
              <span>{syncingOdoo ? 'Memeriksa Odoo...' : 'Tarik Ulang dari Odoo'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
