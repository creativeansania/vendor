'use client';

import { useState, useMemo } from 'react';
import { X, Search, Check } from 'lucide-react';

export default function BuyerFormModal({
  open,
  mode = 'create',
  initialData = null,
  odooPartners = [],
  loadingPartners = false,
  submitting = false,
  onClose,
  onSubmit
}) {
  const [buyerName, setBuyerName] = useState(initialData?.buyer_name || '');
  const [selectedIds, setSelectedIds] = useState(initialData?.odoo_partner_ids || []);
  const [startDate, setStartDate] = useState(
    initialData?.start_date !== undefined ? initialData.start_date : '2026-06-01'
  );
  const [notes, setNotes] = useState(initialData?.notes || '');
  const [partnerSearch, setPartnerSearch] = useState('');

  const filteredPartners = useMemo(() => {
    const q = partnerSearch.trim().toLowerCase();
    if (!q) return odooPartners;
    return odooPartners.filter(
      (p) =>
        p.partner_name.toLowerCase().includes(q) || String(p.partner_id).includes(q)
    );
  }, [odooPartners, partnerSearch]);

  if (!open) return null;

  const togglePartner = (partner) => {
    setSelectedIds((prev) => {
      const exists = prev.includes(partner.partner_id);
      const next = exists
        ? prev.filter((id) => id !== partner.partner_id)
        : [...prev, partner.partner_id];

      // Auto-fill display name on first selection if empty
      if (!exists && !buyerName.trim() && next.length === 1) {
        setBuyerName(partner.partner_name);
      }
      return next;
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const nameMap = new Map(odooPartners.map((p) => [p.partner_id, p.partner_name]));
    const existingNames = initialData?.odoo_partner_names || [];
    const existingIds = initialData?.odoo_partner_ids || [];
    const fallbackMap = new Map(existingIds.map((id, idx) => [id, existingNames[idx] || `Partner #${id}`]));

    const partnerNames = selectedIds.map(
      (id) => nameMap.get(id) || fallbackMap.get(id) || `Partner #${id}`
    );

    onSubmit({
      buyer_name: buyerName.trim(),
      odoo_partner_ids: selectedIds,
      odoo_partner_names: partnerNames,
      start_date: startDate.trim(),
      notes: notes.trim()
    });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(15, 23, 42, 0.58)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '580px',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '20px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)'
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px'
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>
              {mode === 'edit' ? 'Edit Link Dashboard Buyer' : 'Buat Link Dashboard Buyer Baru'}
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Pilih 1 atau lebih Customer Odoo External untuk digabung dalam 1 link monitoring.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={onClose}
            disabled={submitting}
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '0.8rem',
                fontWeight: 600,
                marginBottom: '6px',
                color: 'var(--text-primary)'
              }}
            >
              Nama Tampilan Buyer (Header Dashboard)
            </label>
            <input
              type="text"
              required
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
              placeholder="Contoh: PT. Bersama Zatta Jaya Tbk (Elzatta)"
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-default)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: '0.86rem'
              }}
            />
          </div>

          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '6px'
              }}
            >
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Customer Odoo External ({selectedIds.length} dipilih)
              </label>
              {selectedIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--status-rose)',
                    fontSize: '0.75rem',
                    cursor: 'pointer'
                  }}
                >
                  Kosongkan pilihan
                </button>
              )}
            </div>

            <div style={{ position: 'relative', marginBottom: '8px' }}>
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)'
                }}
              />
              <input
                type="text"
                value={partnerSearch}
                onChange={(e) => setPartnerSearch(e.target.value)}
                placeholder="Cari nama buyer atau Partner ID Odoo..."
                style={{
                  width: '100%',
                  padding: '8px 10px 8px 32px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem'
                }}
              />
            </div>

            <div
              style={{
                maxHeight: '210px',
                overflowY: 'auto',
                border: '1px solid var(--border-default)',
                borderRadius: '8px',
                background: 'var(--bg-card-subtle)'
              }}
            >
              {loadingPartners ? (
                <div style={{ padding: '18px', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Memuat daftar Customer External dari Odoo...
                </div>
              ) : filteredPartners.length === 0 ? (
                <div style={{ padding: '18px', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Tidak ada Customer External yang cocok.
                </div>
              ) : (
                filteredPartners.map((p) => {
                  const checked = selectedIds.includes(p.partner_id);
                  return (
                    <button
                      key={p.partner_id}
                      type="button"
                      onClick={() => togglePartner(p)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '10px',
                        padding: '9px 12px',
                        border: 'none',
                        borderBottom: '1px solid var(--border-subtle)',
                        background: checked ? 'var(--status-sky-bg)' : 'transparent',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        textAlign: 'left'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        <span
                          style={{
                            width: '18px',
                            height: '18px',
                            borderRadius: '5px',
                            border: `1.5px solid ${checked ? 'var(--status-sky)' : 'var(--border-strong)'}`,
                            background: checked ? 'var(--status-sky)' : 'transparent',
                            color: '#ffffff',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                          }}
                        >
                          {checked && <Check size={12} />}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: '0.82rem',
                              fontWeight: checked ? 600 : 500,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {p.partner_name}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            ID #{p.partner_id} · {p.so_count} SO · {p.line_count} item
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  marginBottom: '6px',
                  color: 'var(--text-primary)'
                }}
              >
                Periode Tanggal PO Mulai
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '0.84rem'
                }}
              />
              <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Filter SO berdasarkan Tgl PO mulai tanggal ini. Kosongkan untuk semua periode.
              </p>
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  marginBottom: '6px',
                  color: 'var(--text-primary)'
                }}
              >
                Catatan Internal (Opsional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="PIC / keterangan internal..."
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '0.84rem'
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Batal
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !buyerName.trim() || selectedIds.length === 0}
            >
              {submitting
                ? 'Menyimpan & Sinkronisasi...'
                : mode === 'edit'
                ? 'Simpan Perubahan'
                : 'Buat Link & Sinkronkan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
