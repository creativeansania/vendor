'use client';

import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';

export default function OrderBanner({ feedback, isBackorder }) {
  return (
    <>
      {feedback?.text && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '0.86rem',
            fontWeight: 600,
            background: feedback.type === 'success' ? 'var(--status-emerald-bg)' : 'var(--status-rose-bg)',
            border: `1.5px solid ${feedback.type === 'success' ? 'var(--status-emerald-border)' : 'var(--status-rose-border)'}`,
            color: feedback.type === 'success' ? 'var(--status-emerald)' : 'var(--status-rose)',
            boxShadow: 'var(--shadow-subtle)'
          }}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
          ) : (
            <AlertTriangle size={18} style={{ flexShrink: 0 }} />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {isBackorder && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            background: 'var(--status-purple-bg)',
            border: '1px solid var(--status-purple-border)',
            color: 'var(--status-purple)',
            fontSize: '0.84rem'
          }}
        >
          <Info size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong>Backorder Turunan:</strong> Data hasil potong/bahan diwarisi otomatis dari MO induk. Anda dapat langsung menginput hasil jahit.
          </div>
        </div>
      )}
    </>
  );
}
