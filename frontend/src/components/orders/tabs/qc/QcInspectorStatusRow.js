'use client';

import { UserCheck, CheckCircle2, XCircle, Ban } from 'lucide-react';

const STATUS_OPTIONS = [
  {
    value: 'Passed',
    label: 'Passed',
    Icon: CheckCircle2,
    activeBorder: 'var(--status-emerald)',
    activeBg: 'var(--status-emerald-bg)',
    activeColor: 'var(--status-emerald)'
  },
  {
    value: 'Reject',
    label: 'Reject',
    Icon: XCircle,
    activeBorder: 'var(--status-rose)',
    activeBg: 'var(--status-rose-bg)',
    activeColor: 'var(--status-rose)'
  },
  {
    value: 'Cancel',
    label: 'Cancel',
    Icon: Ban,
    activeBorder: 'var(--border-highlight)',
    activeBg: 'var(--bg-card-hover)',
    activeColor: 'var(--text-primary)'
  }
];

export default function QcInspectorStatusRow({
  inspectors,
  qcPassId,
  qcPassName,
  onInspectorChange,
  qcStatus,
  onStatusChange
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
      {/* Field 1: QC Pass Inspector */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <UserCheck size={15} style={{ color: 'var(--brand-gold)' }} />
          <span>QC Pass (Petugas / PIC)</span>
        </label>
        <select
          value={qcPassId}
          onChange={(e) => onInspectorChange(e.target.value)}
          className="select-field"
          style={{
            fontSize: '0.88rem',
            padding: '9px 12px',
            borderRadius: '10px',
            background: 'var(--bg-surface)'
          }}
        >
          {inspectors.map((ins) => (
            <option key={ins.id} value={ins.id}>
              {ins.name}
            </option>
          ))}
          {!inspectors.some((i) => String(i.id) === qcPassId) && qcPassName && (
            <option value={qcPassId}>{qcPassName}</option>
          )}
        </select>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          Petugas QC resmi yang bertugas: Yana Suryana atau Dindin.
        </span>
      </div>

      {/* Field 2: QC Status Pills */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          QC Status
        </label>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {STATUS_OPTIONS.map(({ value, label, Icon, activeBorder, activeBg, activeColor }) => {
            const isSelected = qcStatus === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => onStatusChange(value)}
                style={{
                  flex: 1,
                  minWidth: '85px',
                  padding: '9px 12px',
                  borderRadius: '10px',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  border: isSelected ? `2px solid ${activeBorder}` : '1px solid var(--border-color)',
                  background: isSelected ? activeBg : 'var(--bg-surface)',
                  color: isSelected ? activeColor : 'var(--text-secondary)',
                  transition: 'all 0.2s ease'
                }}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          Hasil audit QC terhadap garment selesai jahit.
        </span>
      </div>
    </div>
  );
}

