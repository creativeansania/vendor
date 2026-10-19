'use client';

/**
 * Universal MetricTile component for KPI summaries and executive highlight cards.
 * Automatically adapts styles based on variant and active states.
 */
export default function MetricTile({
  label,
  value,
  unit,
  subtext,
  badge,
  icon,
  variant = 'default',
  active = false,
  interactive = false,
  onClick,
  style = {},
  className = ''
}) {
  const getVariantStyles = () => {
    switch (variant) {
      case 'gold':
        return {
          background: active ? 'var(--brand-gold-light)' : 'var(--bg-card)',
          borderColor: active ? 'var(--brand-gold)' : 'var(--border-default)',
          color: 'var(--brand-gold)',
          iconBg: 'var(--brand-gold-light)',
          iconColor: 'var(--brand-gold)',
          activeShadow: '0 4px 14px var(--brand-gold-glow)'
        };
      case 'sky':
        return {
          background: active ? 'var(--status-sky-bg)' : 'var(--bg-card)',
          borderColor: active ? 'var(--status-sky)' : 'var(--border-default)',
          color: 'var(--status-sky)',
          iconBg: 'var(--status-sky-bg)',
          iconColor: 'var(--status-sky)',
          activeShadow: '0 4px 14px rgba(14, 165, 233, 0.2)'
        };
      case 'emerald':
        return {
          background: active ? 'var(--status-emerald-bg)' : 'var(--bg-card)',
          borderColor: active ? 'var(--status-emerald)' : 'var(--border-default)',
          color: 'var(--status-emerald)',
          iconBg: 'var(--status-emerald-bg)',
          iconColor: 'var(--status-emerald)',
          activeShadow: '0 4px 14px rgba(16, 185, 129, 0.2)'
        };
      case 'rose':
        return {
          background: active ? 'var(--status-rose-bg)' : 'var(--bg-card)',
          borderColor: active ? 'var(--status-rose)' : 'var(--border-default)',
          color: 'var(--status-rose)',
          iconBg: 'var(--status-rose-bg)',
          iconColor: 'var(--status-rose)',
          activeShadow: '0 4px 14px rgba(244, 63, 94, 0.2)'
        };
      case 'amber':
        return {
          background: active ? 'var(--status-amber-bg)' : 'var(--bg-card)',
          borderColor: active ? 'var(--status-amber)' : 'var(--border-default)',
          color: 'var(--status-amber)',
          iconBg: 'var(--status-amber-bg)',
          iconColor: 'var(--status-amber)',
          activeShadow: '0 4px 14px rgba(245, 158, 11, 0.2)'
        };
      default:
        return {
          background: active ? 'rgba(217, 119, 6, 0.04)' : 'var(--bg-card)',
          borderColor: active ? 'var(--brand-gold)' : 'var(--border-default)',
          color: 'var(--text-primary)',
          iconBg: 'var(--status-sky-bg)',
          iconColor: 'var(--status-sky)',
          activeShadow: '0 4px 14px rgba(217, 119, 6, 0.15)'
        };
    }
  };

  const vStyles = getVariantStyles();

  return (
    <div
      onClick={interactive || onClick ? onClick : undefined}
      className={`card metric-card ${className}`}
      style={{
        cursor: interactive || onClick ? 'pointer' : 'default',
        border: active ? `2px solid ${vStyles.borderColor}` : `1px solid ${vStyles.borderColor}`,
        boxShadow: active ? vStyles.activeShadow : 'none',
        transform: active ? 'scale(1.02)' : 'none',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        background: vStyles.background,
        ...style
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="metric-label" style={{ fontSize: '0.68rem', color: variant !== 'default' ? vStyles.color : 'inherit' }}>
          {label}
        </span>
        {icon && (
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              background: vStyles.iconBg,
              color: vStyles.iconColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {icon}
          </div>
        )}
      </div>

      <div
        className="metric-value mono-num"
        style={{
          fontSize: '1.45rem',
          color: variant !== 'default' ? vStyles.color : 'var(--text-primary)',
          marginTop: '4px'
        }}
      >
        {value}{' '}
        {unit && (
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)' }}>
            {unit}
          </span>
        )}
      </div>

      {(subtext || badge || active) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
          <span style={{ fontSize: '0.7rem', color: variant !== 'default' ? vStyles.color : 'var(--text-muted)' }}>
            {subtext}
          </span>
          {badge}
          {active && !badge && (
            <span
              style={{
                fontSize: '0.64rem',
                fontWeight: 700,
                color: vStyles.color,
                background: vStyles.iconBg,
                padding: '1px 6px',
                borderRadius: '4px'
              }}
            >
              Aktif
            </span>
          )}
        </div>
      )}
    </div>
  );
}
