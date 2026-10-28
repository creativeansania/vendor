'use client';

import { Layers, ShoppingBag, ChevronDown, ChevronUp } from 'lucide-react';
import DashboardOrderCard from '../DashboardOrderCard';

function formatShortDate(dateStr) {
  if (!dateStr) return null;
  try {
    const [y, m, d] = dateStr.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1] || m} ${y}`;
  } catch {
    return dateStr;
  }
}

export default function SalesOrderGroupCard({
  group,
  isCollapsed,
  onToggle,
  onSelectOrder,
  onAskWa
}) {
  return (
    <div
      className="card"
      style={{
        padding: 0,
        borderRadius: '18px',
        border: '1px solid var(--border-default)',
        overflow: 'hidden',
        background: 'var(--bg-card)',
        boxShadow: 'var(--shadow-sm)'
      }}
    >
      {/* SO Group Header Bar */}
      <div
        onClick={onToggle}
        style={{
          padding: '14px 18px',
          background: group.isNonSo
            ? 'var(--bg-card-subtle)'
            : 'linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(217, 119, 6, 0.02) 100%)',
          borderBottom: isCollapsed ? 'none' : '1px solid var(--border-default)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          userSelect: 'none'
        }}
      >
        {/* Left: Icon + SO Label + Badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', minWidth: 0 }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: group.isNonSo ? 'var(--border-subtle)' : 'var(--brand-gold-light)',
              color: group.isNonSo ? 'var(--text-muted)' : 'var(--brand-gold)',
              border: `1px solid ${group.isNonSo ? 'var(--border-default)' : 'var(--brand-gold-border)'}`,
              flexShrink: 0
            }}
          >
            {group.isNonSo ? <Layers size={18} /> : <ShoppingBag size={18} />}
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
                {group.isNonSo ? 'Kategori SPK' : 'Sales Order'}
              </span>
              <span className="badge badge-indigo mono-num" style={{ fontSize: '0.7rem', padding: '2px 8px' }}>
                {group.orders.length} SPK
              </span>
              {group.hasKainKurang && (
                <span
                  className="badge"
                  style={{
                    fontSize: '0.66rem',
                    padding: '2px 7px',
                    background: 'var(--status-rose-bg)',
                    color: 'var(--status-rose)',
                    border: '1px solid var(--status-rose-border)',
                    fontWeight: 800
                  }}
                >
                  ⚠️ Ada Kain Kurang
                </span>
              )}
              {group.vendorNames.size === 1 && (
                <span className="badge badge-slate hide-on-mobile" style={{ fontSize: '0.68rem', padding: '2px 7px' }}>
                  {Array.from(group.vendorNames)[0]}
                </span>
              )}
            </div>

            <div
              className="mono-num"
              style={{
                fontSize: '1.05rem',
                fontWeight: 800,
                color: group.isNonSo ? 'var(--text-primary)' : 'var(--brand-gold)',
                marginTop: '2px'
              }}
            >
              {group.soLabel}
            </div>
          </div>
        </div>

        {/* Right: Summary Metrics + Chevron */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Total Target
            </div>
            <div className="mono-num" style={{ fontSize: '0.98rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              {group.totalTargetPcs.toLocaleString('id-ID')} <span style={{ fontSize: '0.72rem', fontWeight: 500 }}>pcs</span>
            </div>
          </div>

          {group.earliestDeadline && (
            <div className="hide-on-mobile" style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                Deadline
              </div>
              <div className="mono-num" style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                {formatShortDate(group.earliestDeadline)}
              </div>
            </div>
          )}

          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              border: '1px solid var(--border-default)',
              background: 'var(--bg-card)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              flexShrink: 0
            }}
          >
            {isCollapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
          </div>
        </div>
      </div>

      {/* SO Cards Body */}
      {!isCollapsed && (
        <div style={{ padding: '16px', background: 'var(--bg-card-subtle)' }}>
          <div className="orders-grid">
            {group.orders.map((o) => (
              <DashboardOrderCard
                key={o.id}
                order={o}
                onClick={() => onSelectOrder(o.id)}
                onAskWa={onAskWa}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

