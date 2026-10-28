'use client';

import { Send, Truck, Lock } from 'lucide-react';
import BsklCategoryCard from './bskl/BsklCategoryCard';

export default function BsklTab({
  order,
  sisaPanjang = '',
  setSisaPanjang,
  sisaSedang = '',
  setSisaSedang,
  sisaPendek = '',
  setSisaPendek,
  totalSisaKg = 0,
  noSuratJalanBskl = '',
  setNoSuratJalanBskl,
  canEditBskl = true,
  isBsklLocked = false,
  saving = false,
  handleRequestSubmitBskl
}) {
  const currentTotalSisa = totalSisaKg || (
    Number((parseFloat(sisaPanjang) || 0) + (parseFloat(sisaSedang) || 0) + (parseFloat(sisaPendek) || 0)).toFixed(2)
  );

  const bsklTransfer = order?.bskl_transfer;
  const isTransferDone = bsklTransfer?.state === 'done' || bsklTransfer?.stateDisplay === 'Selesai';

  const categories = [
    {
      indexLabel: '#1',
      title: 'Sisa Potong Panjang (> 1 Meter)',
      description: 'Kain utuh potongan panjang untuk dikembalikan ke Gudang WHGB',
      accentColor: 'var(--brand-gold)',
      unitBadgeClass: 'badge-gold',
      value: sisaPanjang,
      onChange: setSisaPanjang
    },
    {
      indexLabel: '#2',
      title: 'Sisa Potong Sedang (50cm - 1 Meter)',
      description: 'Potongan kain perca sedang (kombinasi produk / kerajinan)',
      accentColor: 'var(--status-amber)',
      unitBadgeClass: 'badge-amber',
      value: sisaSedang,
      onChange: setSisaSedang
    },
    {
      indexLabel: '#3',
      title: 'Sisa Potong Pendek (< 50cm / Majun)',
      description: 'Potongan kain kecil, majun, atau limbah kain',
      accentColor: 'var(--status-rose)',
      unitBadgeClass: 'badge-rose',
      value: sisaPendek,
      onChange: setSisaPendek
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* HEADER INFO */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            ✂️ Sisa Potong Kain (BSKL)
          </span>
          <span className="badge badge-gold mono-num" style={{ fontSize: '0.68rem' }}>3 Kategori</span>
        </div>
        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          Total Sisa: <strong className="mono-num" style={{ color: 'var(--brand-gold)', fontWeight: 800, fontSize: '1rem' }}>{currentTotalSisa} KG</strong>
        </div>
      </div>

      {/* LOCK BANNER IF VALIDATED */}
      {(!canEditBskl || isTransferDone || isBsklLocked) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 16px',
            borderRadius: '10px',
            background: 'var(--status-sky-bg)',
            border: '1px solid var(--status-sky-border)',
            color: 'var(--status-sky)',
            fontSize: '0.82rem'
          }}
        >
          <Lock size={18} style={{ flexShrink: 0 }} />
          <div>
            <strong>Terkunci:</strong> Dokumen transfer BSKL telah divalidasi oleh Gudang Ansania di Odoo ({bsklTransfer?.name || 'Selesai'}). Input sisa kain tidak dapat diubah lagi oleh vendor.
          </div>
        </div>
      )}

      {/* CARDS 1-3: SISA POTONG CATEGORIES */}
      {categories.map((cat) => (
        <BsklCategoryCard
          key={cat.indexLabel}
          indexLabel={cat.indexLabel}
          title={cat.title}
          description={cat.description}
          accentColor={cat.accentColor}
          unitBadgeClass={cat.unitBadgeClass}
          value={cat.value}
          onChange={cat.onChange}
          canEdit={canEditBskl}
          saving={saving}
        />
      ))}

      {/* CARD 4: NO SURAT JALAN / DELIVERY SLIP PABRIK */}
      <div className="card roll-card" style={{ borderLeft: '4px solid var(--status-sky)', padding: '16px', flexDirection: 'column', alignItems: 'stretch' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
              <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem' }}>#4</span>
              <span className="mono-num" style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--status-sky)' }}>
                Surat Jalan / Delivery Slip Pengembalian BSKL
              </span>
              <span className="badge badge-sky mono-num" style={{ fontSize: '0.68rem' }}>PABRIK/VENDOR</span>
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Nomor surat jalan fisik saat kain sisa dikembalikan ke Gudang WHGB Ansania
            </div>
          </div>
        </div>

        <div style={{ marginTop: '4px' }}>
          <input
            type="text"
            disabled={!canEditBskl || saving}
            placeholder="Contoh: SJ/BSKL/001/2026 (atau nomor resi pengiriman)"
            value={noSuratJalanBskl}
            onChange={(e) => setNoSuratJalanBskl && setNoSuratJalanBskl(e.target.value)}
            className="input-field"
            style={{ fontSize: '0.95rem', height: '42px', width: '100%' }}
          />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
            Nomor ini akan otomatis tercatat pada kolom <strong>Delivery Slip Pabrik/Vendor</strong> dokumen transfer Odoo.
          </span>
        </div>
      </div>

      {/* CARD 5: STATUS DOKUMEN TRANSFER ODOO */}
      {bsklTransfer && (
        <div className="card" style={{ padding: '14px 16px', background: 'var(--bg-card-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Truck size={20} style={{ color: 'var(--brand-gold)' }} />
              <div>
                <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                  Dokumen Transfer: <span className="mono-num">{bsklTransfer.name}</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Tujuan: <strong>WHGB/Stock</strong> | Origin: {bsklTransfer.origin}
                </div>
              </div>
            </div>

            <span className={`badge ${bsklTransfer.state === 'done' ? 'badge-emerald' : 'badge-gold'}`} style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
              {bsklTransfer.stateDisplay || bsklTransfer.state}
            </span>
          </div>
        </div>
      )}

      {/* SUBMIT BUTTON TRIGGER FOR BSKL */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
          Kain sisa potong akan dibuatkan Internal Transfer ke Gudang WHGB di Odoo.
        </div>

        <button
          type="button"
          disabled={!canEditBskl || saving || Number(currentTotalSisa) <= 0}
          onClick={handleRequestSubmitBskl}
          className="btn btn-gold"
          style={{ fontSize: '0.88rem', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <Send size={15} />
          <span>Simpan &amp; Buat Transfer BSKL ke WHGB</span>
        </button>
      </div>
    </div>
  );
}
