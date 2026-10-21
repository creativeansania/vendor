'use client';

import { Scissors, Check, Send, Truck, Lock, AlertCircle, Info } from 'lucide-react';
import { adjustQty } from '@/lib/utils/formatters';

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
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            color: '#1e40af',
            fontSize: '0.82rem'
          }}
        >
          <Lock size={18} style={{ flexShrink: 0 }} />
          <div>
            <strong>Terkunci:</strong> Dokumen transfer BSKL telah divalidasi oleh Gudang Ansania di Odoo ({bsklTransfer?.name || 'Selesai'}). Input sisa kain tidak dapat diubah lagi oleh vendor.
          </div>
        </div>
      )}

      {/* CARD 1: SISA POTONG PANJANG (> 1 METER) */}
      <div className="card roll-card" style={{ borderLeft: '4px solid var(--brand-gold)', padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '8px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
              <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem' }}>#1</span>
              <span className="mono-num" style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--brand-gold)' }}>
                Sisa Potong Panjang (&gt; 1 Meter)
              </span>
              <span className="badge badge-gold mono-num" style={{ fontSize: '0.68rem' }}>KG</span>
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Kain utuh potongan panjang untuk dikembalikan ke Gudang WHGB
            </div>
          </div>

          {canEditBskl && (
            <button
              type="button"
              onClick={() => setSisaPanjang && setSisaPanjang('0')}
              className={`quick-action-pill ${parseFloat(sisaPanjang) === 0 ? 'quick-action-pill-emerald' : ''}`}
              style={{ fontSize: '0.68rem', padding: '2px 8px' }}
            >
              {parseFloat(sisaPanjang) === 0 ? (
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
            <div className="input-addon-group" style={{ height: '40px', borderColor: parseFloat(sisaPanjang) > 0 ? 'var(--brand-gold)' : 'var(--border-strong)' }}>
              <input
                type="number"
                step="0.01"
                min="0"
                disabled={!canEditBskl || saving}
                placeholder="0.00"
                value={sisaPanjang}
                onChange={(e) => setSisaPanjang && setSisaPanjang(e.target.value)}
                className="input-addon-field"
                style={{ fontSize: '1rem', fontWeight: 800 }}
              />
              <span className="input-addon-label" style={{ fontSize: '0.72rem', padding: '0 8px' }}>
                KG
              </span>
            </div>
          </div>
          {canEditBskl && (
            <div style={{ display: 'flex', gap: '3px' }}>
              <button type="button" onClick={() => setSisaPanjang && setSisaPanjang('0')} className="stepper-btn" style={{ padding: '0 8px', height: '40px', fontSize: '0.78rem' }}>0</button>
              <button type="button" onClick={() => adjustQty(setSisaPanjang, sisaPanjang, +0.5)} className="stepper-btn" style={{ padding: '0 8px', height: '40px', fontSize: '0.78rem' }}>+0.5</button>
              <button type="button" onClick={() => adjustQty(setSisaPanjang, sisaPanjang, +1.0)} className="stepper-btn" style={{ padding: '0 8px', height: '40px', fontSize: '0.78rem' }}>+1.0</button>
            </div>
          )}
        </div>
      </div>

      {/* CARD 2: SISA POTONG SEDANG (50 CM - 1 METER) */}
      <div className="card roll-card" style={{ borderLeft: '4px solid #f59e0b', padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '8px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
              <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem' }}>#2</span>
              <span className="mono-num" style={{ fontWeight: 800, fontSize: '0.95rem', color: '#f59e0b' }}>
                Sisa Potong Sedang (50cm - 1 Meter)
              </span>
              <span className="badge badge-amber mono-num" style={{ fontSize: '0.68rem' }}>KG</span>
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Potongan kain perca sedang (kombinasi produk / kerajinan)
            </div>
          </div>

          {canEditBskl && (
            <button
              type="button"
              onClick={() => setSisaSedang && setSisaSedang('0')}
              className={`quick-action-pill ${parseFloat(sisaSedang) === 0 ? 'quick-action-pill-emerald' : ''}`}
              style={{ fontSize: '0.68rem', padding: '2px 8px' }}
            >
              {parseFloat(sisaSedang) === 0 ? (
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
            <div className="input-addon-group" style={{ height: '40px', borderColor: parseFloat(sisaSedang) > 0 ? '#f59e0b' : 'var(--border-strong)' }}>
              <input
                type="number"
                step="0.01"
                min="0"
                disabled={!canEditBskl || saving}
                placeholder="0.00"
                value={sisaSedang}
                onChange={(e) => setSisaSedang && setSisaSedang(e.target.value)}
                className="input-addon-field"
                style={{ fontSize: '1rem', fontWeight: 800 }}
              />
              <span className="input-addon-label" style={{ fontSize: '0.72rem', padding: '0 8px' }}>
                KG
              </span>
            </div>
          </div>
          {canEditBskl && (
            <div style={{ display: 'flex', gap: '3px' }}>
              <button type="button" onClick={() => setSisaSedang && setSisaSedang('0')} className="stepper-btn" style={{ padding: '0 8px', height: '40px', fontSize: '0.78rem' }}>0</button>
              <button type="button" onClick={() => adjustQty(setSisaSedang, sisaSedang, +0.5)} className="stepper-btn" style={{ padding: '0 8px', height: '40px', fontSize: '0.78rem' }}>+0.5</button>
              <button type="button" onClick={() => adjustQty(setSisaSedang, sisaSedang, +1.0)} className="stepper-btn" style={{ padding: '0 8px', height: '40px', fontSize: '0.78rem' }}>+1.0</button>
            </div>
          )}
        </div>
      </div>

      {/* CARD 3: SISA POTONG PENDEK (< 50 CM / MAJUN) */}
      <div className="card roll-card" style={{ borderLeft: '4px solid #ef4444', padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '8px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
              <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem' }}>#3</span>
              <span className="mono-num" style={{ fontWeight: 800, fontSize: '0.95rem', color: '#ef4444' }}>
                Sisa Potong Pendek (&lt; 50cm / Majun)
              </span>
              <span className="badge badge-rose mono-num" style={{ fontSize: '0.68rem' }}>KG</span>
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Potongan kain kecil, majun, atau limbah kain
            </div>
          </div>

          {canEditBskl && (
            <button
              type="button"
              onClick={() => setSisaPendek && setSisaPendek('0')}
              className={`quick-action-pill ${parseFloat(sisaPendek) === 0 ? 'quick-action-pill-emerald' : ''}`}
              style={{ fontSize: '0.68rem', padding: '2px 8px' }}
            >
              {parseFloat(sisaPendek) === 0 ? (
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
            <div className="input-addon-group" style={{ height: '40px', borderColor: parseFloat(sisaPendek) > 0 ? '#ef4444' : 'var(--border-strong)' }}>
              <input
                type="number"
                step="0.01"
                min="0"
                disabled={!canEditBskl || saving}
                placeholder="0.00"
                value={sisaPendek}
                onChange={(e) => setSisaPendek && setSisaPendek(e.target.value)}
                className="input-addon-field"
                style={{ fontSize: '1rem', fontWeight: 800 }}
              />
              <span className="input-addon-label" style={{ fontSize: '0.72rem', padding: '0 8px' }}>
                KG
              </span>
            </div>
          </div>
          {canEditBskl && (
            <div style={{ display: 'flex', gap: '3px' }}>
              <button type="button" onClick={() => setSisaPendek && setSisaPendek('0')} className="stepper-btn" style={{ padding: '0 8px', height: '40px', fontSize: '0.78rem' }}>0</button>
              <button type="button" onClick={() => adjustQty(setSisaPendek, sisaPendek, +0.5)} className="stepper-btn" style={{ padding: '0 8px', height: '40px', fontSize: '0.78rem' }}>+0.5</button>
              <button type="button" onClick={() => adjustQty(setSisaPendek, sisaPendek, +1.0)} className="stepper-btn" style={{ padding: '0 8px', height: '40px', fontSize: '0.78rem' }}>+1.0</button>
            </div>
          )}
        </div>
      </div>

      {/* CARD 4: NO SURAT JALAN / DELIVERY SLIP PABRIK (x_studio_delivery_slip_pabrikvendor) */}
      <div className="card roll-card" style={{ borderLeft: '4px solid var(--status-sky)', padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '8px' }}>
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

        <div style={{ marginTop: '8px' }}>
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
          disabled={!canEditBskl || saving || currentTotalSisa <= 0}
          onClick={handleRequestSubmitBskl}
          className="btn btn-gold"
          style={{ fontSize: '0.88rem', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <Send size={15} />
          <span>Simpan & Buat Transfer BSKL ke WHGB</span>
        </button>
      </div>
    </div>
  );
}
