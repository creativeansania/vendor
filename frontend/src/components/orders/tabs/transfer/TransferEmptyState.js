'use client';

import { Truck, RefreshCw } from 'lucide-react';

export default function TransferEmptyState({
  handleForceSyncOdoo,
  syncingOdoo
}) {
  return (
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
  );
}
