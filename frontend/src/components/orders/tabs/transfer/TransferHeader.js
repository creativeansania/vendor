'use client';

import { Truck, RefreshCw } from 'lucide-react';

export default function TransferHeader({
  order,
  handleForceSyncOdoo,
  syncingOdoo
}) {
  return (
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
  );
}
