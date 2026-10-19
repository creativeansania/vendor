'use client';

import { Plus, Minus } from 'lucide-react';
import { adjustQty } from '@/lib/utils/formatters';

/**
 * Universal QuantityStepper component with touch-friendly adjustment buttons,
 * input with unit addon, and configurable step intervals.
 */
export default function QuantityStepper({
  value,
  onChange,
  unit = 'PCS',
  min = 0,
  step = 1,
  disabled = false,
  placeholder = '0',
  quickSteps = [-10, -1, 1, 10],
  style = {}
}) {
  const handleStep = (delta) => {
    if (disabled) return;
    adjustQty(onChange, value, delta, min);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', ...style }}>
      {/* Input Group with Unit Addon */}
      <div className="input-addon-group" style={{ height: '42px', borderColor: value ? 'var(--brand-gold)' : 'var(--border-strong)' }}>
        <input
          type="number"
          step={step}
          min={min}
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-addon-field mono-num"
          style={{ fontSize: '1.15rem', fontWeight: 800 }}
        />
        <span className="input-addon-label" style={{ fontSize: '0.74rem', fontWeight: 700 }}>
          {unit.toUpperCase()}
        </span>
      </div>

      {/* Quick Stepper Buttons Row */}
      {!disabled && Array.isArray(quickSteps) && quickSteps.length > 0 && (
        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
          {quickSteps.map((delta) => {
            const isNegative = delta < 0;
            return (
              <button
                key={delta}
                type="button"
                onClick={() => handleStep(delta)}
                className="quick-action-pill"
                style={{
                  flex: 1,
                  justifyContent: 'center',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  height: '28px',
                  background: isNegative ? 'var(--bg-card-subtle)' : 'var(--brand-gold-light)',
                  color: isNegative ? 'var(--text-secondary)' : 'var(--brand-gold)',
                  borderColor: isNegative ? 'var(--border-default)' : 'var(--brand-gold-border)'
                }}
                title={`${isNegative ? 'Kurangi' : 'Tambah'} ${Math.abs(delta)} ${unit}`}
              >
                {delta > 0 ? `+${delta}` : delta}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
