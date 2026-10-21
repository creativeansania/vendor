'use client';

import StatusBadge from '@/components/common/StatusBadge';
import { Building2, MessageCircle, ChevronRight } from 'lucide-react';

function formatRupiahPrice(val) {
  const num = parseFloat(val);
  if (!num || isNaN(num)) return null;
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(num);
}

export default function DashboardOrderCard({ order, onClick, onAskWa }) {
  const isBackorder = Boolean(
    order.is_backorder ||
    (order.mo_name && /-0*([2-9]|\d{2,})$/.test(order.mo_name.trim())) ||
    (order.parent_wip_order_id && !/-0*1$/.test((order.mo_name || '').trim()))
  );
  const isCuttingLocked = Boolean(order.cutting_locked_at) || isBackorder;
  const isResultLocked = Boolean(order.result_locked_at);
  const price = formatRupiahPrice(order.harga_vendor);

  // Parse SKU prefix
  const skuMatch = order.product_name?.match(/^\[(.*?)\]\s*(.*)$/);
  const skuCode = skuMatch ? skuMatch[1] : null;
  const cleanProductName = skuMatch ? skuMatch[2] : order.product_name;

  return (
    <div
      onClick={onClick}
      className="card card-interactive"
      style={{
        padding: '18px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: '12px',
        borderRadius: '16px'
      }}
    >
      {/* Top Bar: Reference + Badges */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minWidth: 0 }}>
            <span className="mono-num" style={{ fontSize: '1.02rem', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
              {order.mo_name}
            </span>
            {isBackorder && (
              <span className="badge badge-purple" style={{ fontSize: '0.65rem' }}>
                Backorder
              </span>
            )}
          </div>

          {/* Status Badges */}
          <div style={{ flexShrink: 0, display: 'flex', gap: '4px', alignItems: 'center' }}>
            {order.status_kebutuhan_kain === 'Kurang' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAskWa(order, true);
                }}
                className="badge"
                style={{
                  fontSize: '0.68rem',
                  padding: '2px 7px',
                  background: 'var(--status-rose-bg)',
                  color: 'var(--status-rose)',
                  border: '1px solid var(--status-rose-border)',
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
                title="Laporkan kain kurang ke WhatsApp Group"
              >
                ⚠️ Kurang
              </button>
            )}
            <StatusBadge
              type="order_stage"
              value={isResultLocked ? 'result_locked' : isCuttingLocked ? 'cutting_locked' : 'cutting_pending'}
            />
          </div>
        </div>

        {/* SKU & Product Name */}
        {skuCode && (
          <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem', padding: '2px 8px', marginBottom: '4px' }}>
            {skuCode}
          </span>
        )}
        <div style={{ fontSize: '0.94rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.35, marginBottom: '4px' }}>
          {cleanProductName}
        </div>

        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span>SO:</span>
          {order.source_document || order.sales_order ? (
            <span className="mono-num" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
              {order.source_document || order.sales_order}
            </span>
          ) : (
            <span
              className="badge badge-slate"
              style={{
                fontSize: '0.68rem',
                padding: '2px 7px',
                fontWeight: 600
              }}
              title="Make-to-Stock (Pemenuhan Stok Gudang)"
            >
              Stok Gudang (Non-SO)
            </span>
          )}
        </div>
      </div>

      {/* Middle Metrics Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '8px',
          padding: '10px 12px',
          background: 'var(--bg-card-subtle)',
          borderRadius: '12px',
          border: '1px solid var(--border-default)',
          textAlign: 'center'
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Target SPK</div>
          <div className="mono-num" style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {Number(order.qty_target || order.qty_spk || 0).toLocaleString('id-ID')} <span style={{ fontSize: '0.7rem', fontWeight: 400 }}>pcs</span>
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Hasil Jahit</div>
          <div className="mono-num" style={{ fontSize: '0.92rem', fontWeight: 800, color: isResultLocked ? 'var(--status-emerald)' : 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {isResultLocked ? Number(order.qty_grade_a || 0).toLocaleString('id-ID') : '-'}
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Kain</div>
          <div
            style={{
              fontSize: '0.82rem',
              fontWeight: 800,
              color: order.status_kebutuhan_kain === 'Kurang' ? 'var(--status-rose)' : 'var(--status-emerald)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {order.status_kebutuhan_kain === 'Kurang' ? '⚠️ Kurang' : (order.status_kebutuhan_kain || 'Cukup')}
          </div>
        </div>
      </div>

      {/* Bottom Footer: Vendor & Price */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)', minWidth: 0 }}>
          <Building2 size={14} color="var(--brand-gold)" style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{order.vendor_name}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAskWa(order);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              borderRadius: '8px',
              background: 'var(--status-emerald-bg)',
              border: '1px solid var(--status-emerald-border)',
              color: 'var(--status-emerald)',
              fontSize: '0.72rem',
              fontWeight: 700,
              cursor: 'pointer'
            }}
            title="Tanyakan SPK ini ke WhatsApp Group"
          >
            <MessageCircle size={13} color="var(--status-emerald)" />
            <span>Tanya WA</span>
          </button>

          {price && (
            <div className="mono-num" style={{ fontSize: '0.86rem', fontWeight: 800, color: 'var(--brand-gold)' }}>
              {price}
            </div>
          )}
          <div style={{ color: 'var(--text-muted)' }}>
            <ChevronRight size={17} />
          </div>
        </div>
      </div>
    </div>
  );
}
