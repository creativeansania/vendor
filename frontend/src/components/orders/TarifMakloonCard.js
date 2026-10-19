'use client';

import { Tag, RefreshCw } from 'lucide-react';

export default function TarifMakloonCard({
  order,
  user,
  syncingOdoo,
  handleForceSyncOdoo
}) {
  if (user?.role === 'admin_vendor') return null;

  return (
    <div
      className="card"
      style={{
        padding: '14px 18px',
        borderRadius: '16px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-default)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'var(--brand-gold-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <Tag size={18} color="var(--brand-gold)" />
          </div>
          <div>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--brand-gold)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Tarif Makloon
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="mono-num" style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                {Number(order.harga_vendor || 0) > 0
                  ? `Rp ${Number(order.harga_vendor).toLocaleString('id-ID')} / pcs`
                  : 'Rp 0.00'}
              </span>
              {Number(order.harga_vendor || 0) === 0 && (
                <span className="badge badge-amber" style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
                  Belum Diinput di Odoo
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          {Number(order.total_harga || 0) > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Total Biaya Makloon:</div>
              <div className="mono-num" style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--status-emerald)' }}>
                Rp {Number(order.total_harga).toLocaleString('id-ID')}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleForceSyncOdoo}
            disabled={syncingOdoo}
            className="btn btn-secondary"
            style={{
              fontSize: '0.74rem',
              padding: '6px 12px',
              borderRadius: '10px',
              gap: '6px',
              border: '1px solid var(--brand-gold-border)',
              background: 'var(--brand-gold-light)',
              color: 'var(--brand-gold)',
              fontWeight: 700
            }}
            title="Cek tarif terbaru dari Odoo"
          >
            <RefreshCw size={13} className={syncingOdoo ? 'spinner' : ''} />
            <span>{syncingOdoo ? 'Mengecek...' : 'Sinkronkan Tarif Odoo'}</span>
          </button>
        </div>
      </div>
      {Number(order.harga_vendor || 0) === 0 && (
        <div
          style={{
            fontSize: '0.73rem',
            color: 'var(--text-secondary)',
            background: 'var(--brand-gold-light)',
            padding: '6px 10px',
            borderRadius: '8px',
            border: '1px dashed var(--brand-gold-border)'
          }}
        >
          💡 <em>Tarif makloon belum ada di Odoo. Klik tombol <strong>Sinkronkan Tarif Odoo</strong> di atas jika harga baru saja diinput di Odoo.</em>
        </div>
      )}
    </div>
  );
}
