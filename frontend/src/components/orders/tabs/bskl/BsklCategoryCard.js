'use client';

import { Check } from 'lucide-react';
import { adjustQty } from '@/lib/utils/formatters';

export default function BsklCategoryCard({
  indexLabel,
  title,
  description,
  accentColor,
  unitBadgeClass,
  value,
  onChange,
  canEdit,
  saving
}) {
  const numVal = parseFloat(value) || 0;

  return (
    <div className="card roll-card" style={{ borderLeft: `4px solid ${accentColor}`, padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '8px', flex: 1 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem' }}>{indexLabel}</span>
            <span className="mono-num" style={{ fontWeight: 800, fontSize: '0.95rem', color: accentColor }}>
              {title}
            </span>
            <span className={`badge ${unitBadgeClass} mono-num`} style={{ fontSize: '0.68rem' }}>KG</span>
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            {description}
          </div>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={() => onChange && onChange('0')}
            className={`quick-action-pill ${parseFloat(value) === 0 ? 'quick-action-pill-emerald' : ''}`}
            style={{ fontSize: '0.68rem', padding: '2px 8px' }}
          >
            {parseFloat(value) === 0 ? (
              <>
                <Check size={11} />
                <span>Nol (0)</span>
              </>
            ) : (
              <span>Reset 0</span>
            )}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ width: '150px' }}>
          <div className="input-addon-group" style={{ height: '40px', borderColor: numVal > 0 ? accentColor : 'var(--border-strong)' }}>
            <input
              type="number"
              step="0.01"
              min="0"
              disabled={!canEdit || saving}
              placeholder="0.00"
              value={value}
              onChange={(e) => onChange && onChange(e.target.value)}
              className="input-addon-field"
              style={{ fontSize: '1rem', fontWeight: 800 }}
            />
            <span className="input-addon-label" style={{ fontSize: '0.72rem', padding: '0 8px' }}>
              KG
            </span>
          </div>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: '3px' }}>
            <button type="button" onClick={() => onChange && onChange('0')} className="stepper-btn" style={{ padding: '0 8px', height: '40px', fontSize: '0.78rem' }}>0</button>
            <button type="button" onClick={() => adjustQty(onChange, value, +0.5)} className="stepper-btn" style={{ padding: '0 8px', height: '40px', fontSize: '0.78rem' }}>+0.5</button>
            <button type="button" onClick={() => adjustQty(onChange, value, +1.0)} className="stepper-btn" style={{ padding: '0 8px', height: '40px', fontSize: '0.78rem' }}>+1.0</button>
          </div>
        )}
      </div>
    </div>
  );
}

