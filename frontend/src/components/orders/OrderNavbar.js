'use client';

import { useRouter } from 'next/navigation';
import ThemeToggle from '@/components/ThemeToggle';
import StatusBadge from '@/components/common/StatusBadge';
import {
  ArrowLeft,
  RefreshCw,
  MessageCircle
} from 'lucide-react';

export default function OrderNavbar({
  order,
  isBackorder,
  actualCutting,
  syncingOdoo,
  loading,
  handleForceSyncOdoo,
  handleShareToWa,
  loadData
}) {
  const router = useRouter();

  return (
    <header className="navbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
        <button
          onClick={() => router.push('/')}
          className="btn btn-secondary btn-icon"
          style={{ flexShrink: 0, borderRadius: '10px' }}
          title="Kembali ke Dashboard"
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span className="mono-num" style={{ fontSize: '1.02rem', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
              {order.mo_name}
            </span>
            {isBackorder && <span className="badge badge-purple" style={{ fontSize: '0.68rem' }}>Backorder</span>}
            <StatusBadge
              type="order_stage"
              value={order.status_produksi === 'Selesai' ? 'result_locked' : actualCutting !== '' || order.actual_cutting ? 'cutting_locked' : 'cutting_pending'}
              label={order.status_produksi === 'Selesai' ? 'Selesai' : actualCutting !== '' || order.actual_cutting ? 'Sedang Jahit' : 'Belum Potong'}
            />
          </div>
          <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span>SO:</span>
            {order.source_document || order.sales_order ? (
              <strong className="mono-num" style={{ color: 'var(--text-primary)' }}>
                {order.source_document || order.sales_order}
              </strong>
            ) : (
              <span
                className="badge badge-slate"
                style={{ fontSize: '0.65rem', padding: '1px 6px', fontWeight: 600 }}
                title="Make-to-Stock (Pemenuhan Stok Gudang)"
              >
                Stok Gudang (Non-SO)
              </span>
            )}
            <span>•</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {order.vendor_name}
            </span>
            {order.finishing && (
              <>
                <span>•</span>
                <span className="badge badge-indigo" style={{ fontSize: '0.66rem', padding: '1px 6px', fontWeight: 700 }}>
                  ✨ {order.finishing}
                </span>
              </>
            )}
            {order.packing && (
              <>
                <span>•</span>
                <span className="badge badge-cyan" style={{ fontSize: '0.66rem', padding: '1px 6px', fontWeight: 700 }}>
                  📦 {order.packing}
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <button
          type="button"
          onClick={handleForceSyncOdoo}
          disabled={syncingOdoo || loading}
          className="btn btn-secondary"
          style={{
            fontSize: '0.8rem',
            fontWeight: 700,
            padding: '7px 12px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: 'var(--shadow-subtle)',
            cursor: syncingOdoo ? 'not-allowed' : 'pointer',
            opacity: syncingOdoo ? 0.75 : 1
          }}
          title="Tarik & sinkronkan data terbaru langsung dari Odoo ERP"
        >
          <RefreshCw size={14} className={syncingOdoo ? 'spinner' : ''} style={{ color: 'var(--status-sky)' }} />
          <span className="hide-on-mobile">{syncingOdoo ? 'Menyinkronkan...' : 'Tarik Data Odoo'}</span>
        </button>

        <button
          type="button"
          onClick={() => handleShareToWa()}
          className="btn"
          style={{
            background: 'var(--status-emerald)',
            color: 'var(--text-inverted)',
            border: 'none',
            fontSize: '0.8rem',
            fontWeight: 700,
            padding: '7px 12px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: 'var(--shadow-subtle)',
            cursor: 'pointer'
          }}
          title="Kirim pertanyaan atau kendala SPK ini ke WhatsApp Group"
        >
          <MessageCircle size={15} />
          <span className="hide-on-mobile">Tanya di WA</span>
        </button>

        <ThemeToggle />

        <button
          onClick={loadData}
          className="btn btn-secondary btn-icon"
          style={{ width: '36px', height: '36px', borderRadius: '10px' }}
          title="Segarkan Data"
          disabled={loading}
        >
          <RefreshCw size={15} className={loading ? 'spinner' : ''} />
        </button>
      </div>
    </header>
  );
}
