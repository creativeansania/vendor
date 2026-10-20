'use client';

import { Package, Scissors, RefreshCw, FileText, Check, Copy } from 'lucide-react';
import StatusBadge from '@/components/common/StatusBadge';
import { formatDateIndo } from '@/lib/utils/formatters';

const CATEGORY_MAP = {
  komponen: {
    label: 'Pengiriman Kain & Bahan',
    icon: <Package size={14} />,
    bg: 'rgba(59, 130, 246, 0.1)',
    border: 'rgba(59, 130, 246, 0.25)',
    color: 'var(--status-sky)'
  },
  produk_jadi: {
    label: 'Penerimaan Hasil Jahit',
    icon: <Scissors size={14} />,
    bg: 'rgba(34, 197, 94, 0.1)',
    border: 'rgba(34, 197, 94, 0.25)',
    color: 'var(--status-emerald)'
  },
  retur: {
    label: 'Retur Bahan / Makloon',
    icon: <RefreshCw size={14} />,
    bg: 'rgba(245, 158, 11, 0.1)',
    border: 'rgba(245, 158, 11, 0.25)',
    color: 'var(--status-amber)'
  }
};

const DEFAULT_CATEGORY = {
  label: 'Transfer Internal',
  icon: <FileText size={14} />,
  bg: 'rgba(148, 163, 184, 0.1)',
  border: 'rgba(148, 163, 184, 0.25)',
  color: 'var(--text-muted)'
};

const STATE_LABEL_MAP = {
  done: 'Selesai',
  assigned: 'Siap Kirim / Proses',
  confirmed: 'Menunggu Bahan',
  waiting: 'Menunggu Bahan',
  draft: 'Draft',
  cancel: 'Dibatalkan'
};

export default function TransferDocumentCard({
  transfer: t,
  copiedTransferId,
  handleCopyTransferName
}) {
  const cat = CATEGORY_MAP[t.category] || DEFAULT_CATEGORY;
  const isCopied = copiedTransferId === (t.id || t.name);
  const stateLabel = STATE_LABEL_MAP[t.state] || t.state || 'Tercatat';

  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--bg-card-subtle)',
        borderRadius: '12px',
        border: '1px solid var(--border-default)',
        transition: 'all 0.15s ease'
      }}
    >
      {/* Row 1: Category badge, Transfer Number, Status Badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: '6px',
              background: cat.bg,
              border: `1px solid ${cat.border}`,
              color: cat.color,
              display: 'flex',
              alignItems: 'center',
              gap: '5px'
            }}
          >
            {cat.icon}
            <span>{cat.label}</span>
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span className="mono-num" style={{ fontSize: '0.96rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              {t.name}
            </span>
            <button
              type="button"
              onClick={() => handleCopyTransferName(t.name, t.id || t.name)}
              className="btn btn-secondary btn-icon"
              style={{ width: '26px', height: '26px', borderRadius: '6px', padding: 0 }}
              title="Salin nomor transfer"
            >
              {isCopied ? <Check size={12} color="var(--status-emerald)" /> : <Copy size={12} />}
            </button>
            {isCopied && (
              <span style={{ fontSize: '0.68rem', color: 'var(--status-emerald)', fontWeight: 700 }}>
                Tersalin!
              </span>
            )}
          </div>
        </div>

        <StatusBadge
          type="transfer_state"
          value={t.state}
          label={stateLabel}
          size="sm"
        />
      </div>

      {/* Row 2: Origin, Picking Type, Date */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '8px',
          fontSize: '0.78rem',
          marginTop: '8px',
          paddingTop: '8px',
          borderTop: '1px dashed var(--border-default)'
        }}
      >
        <div>
          <span style={{ color: 'var(--text-muted)' }}>No. Referensi / Asal:</span>{' '}
          <strong className="mono-num" style={{ color: 'var(--text-primary)' }}>
            {t.origin || '-'}
          </strong>
        </div>

        <div>
          <span style={{ color: 'var(--text-muted)' }}>Tipe Operasi:</span>{' '}
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
            {t.pickingType || '-'}
          </span>
        </div>

        <div>
          <span style={{ color: 'var(--text-muted)' }}>
            {t.state === 'done' ? 'Tanggal Selesai:' : 'Jadwal Transfer:'}
          </span>{' '}
          <strong style={{ color: 'var(--text-primary)' }}>
            {formatDateIndo(t.dateDone || t.scheduledDate)}
          </strong>
        </div>
      </div>
    </div>
  );
}
