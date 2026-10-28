'use client';

export default function OrderSpecCard({
  order,
  skuCode,
  cleanProductName,
  targetSpkQty
}) {
  return (
    <div className="card" style={{ padding: '18px 20px', borderRadius: '16px' }}>
      {/* Header Row: SKU & Title */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
          {skuCode ? (
            <span className="badge badge-slate mono-num" style={{ fontSize: '0.76rem', fontWeight: 700, padding: '4px 10px' }}>
              SKU: {skuCode}
            </span>
          ) : (
            <span className="badge badge-slate" style={{ fontSize: '0.76rem' }}>Produk WIP</span>
          )}
          <span className="badge badge-gold mono-num" style={{ fontSize: '0.74rem' }}>
            SPK #{order.id}
          </span>
        </div>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.35, margin: 0 }}>
          {cleanProductName}
        </h2>
      </div>

      {/* Executive Highlight Tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
        {/* Tile 1: Target SPK */}
        <div className="hero-tile" style={{ background: 'var(--brand-gold-light)', borderColor: 'var(--brand-gold-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.7rem', fontWeight: 700, color: 'var(--brand-gold)', textTransform: 'uppercase' }}>
            <span>🎯 Target SPK</span>
          </div>
          <div className="mono-num" style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--brand-gold)', lineHeight: 1.1 }}>
            {targetSpkQty.toLocaleString('id-ID')} <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>pcs</span>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Target Pesanan SPK
          </div>
        </div>

        {/* Tile 2: Mitra CMT */}
        <div className="hero-tile">
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            <span>🏭 Mitra CMT</span>
          </div>
          <div style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.25, wordBreak: 'break-word' }}>
            {order.vendor_name || 'Vendor CMT'}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Pelaksana Jahit
          </div>
        </div>

        {/* Tile 3: Status Produksi */}
        <div
          className="hero-tile"
          style={{
            background: order.status_produksi === 'Selesai' ? 'var(--status-emerald-bg)' : 'var(--status-sky-bg)',
            borderColor: order.status_produksi === 'Selesai' ? 'var(--status-emerald-border)' : 'var(--status-sky-border)'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.7rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              color: order.status_produksi === 'Selesai' ? 'var(--status-emerald)' : 'var(--status-sky)'
            }}
          >
            <span
              className="pulse-dot"
              style={{ background: order.status_produksi === 'Selesai' ? 'var(--status-emerald)' : 'var(--status-sky)' }}
            />
            <span>Status Produksi</span>
          </div>
          <div
            style={{
              fontSize: '1.15rem',
              fontWeight: 800,
              color: order.status_produksi === 'Selesai' ? 'var(--status-emerald)' : 'var(--status-sky)',
              lineHeight: 1.1
            }}
          >
            {order.status_produksi || 'Proses'}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            Tahap Pengerjaan
          </div>
        </div>
      </div>

      {/* Finishing & Packing Specification Strip (Always Displayed) */}
      <div
        style={{
          marginTop: '12px',
          paddingTop: '12px',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
          flexWrap: 'wrap',
          fontSize: '0.84rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>✨ Finishing:</span>
          <span className="badge badge-indigo" style={{ fontWeight: 800, fontSize: '0.8rem', padding: '3px 10px' }}>
            {order.finishing || '-'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>📦 Packing:</span>
          <span className="badge badge-cyan" style={{ fontWeight: 800, fontSize: '0.8rem', padding: '3px 10px' }}>
            {order.packing || '-'}
          </span>
        </div>
      </div>
    </div>
  );
}
