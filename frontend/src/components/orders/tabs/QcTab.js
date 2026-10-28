'use client';

import {
  ClipboardCheck,
  CheckCircle2,
  RefreshCw,
  Save,
  ShieldCheck,
  AlertTriangle,
  FileText
} from 'lucide-react';
import { adjustQty, formatDateIndo } from '@/lib/utils/formatters';
import { useQcForm } from '@/lib/hooks/order-detail/useQcForm';
import QcInspectorStatusRow from './qc/QcInspectorStatusRow';
import QcPhotoCaptureField from './qc/QcPhotoCaptureField';

export default function QcTab({
  order,
  targetSpkQty = 0,
  saving = false,
  onSaveQc
}) {
  const {
    inspectors,
    localFeedback,
    qcPassId,
    qcPassName,
    qtyQcPass,
    setQtyQcPass,
    qcStatus,
    setQcStatus,
    keteranganQms,
    setKeteranganQms,
    setGambarQc,
    imagePreviewSrc,
    handleInspectorChange,
    handleFileChange,
    handlePresetGradeA,
    handleSubmit
  } = useQcForm({ order, targetSpkQty, onSaveQc });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* HEADER INFO */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.98rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ClipboardCheck size={20} style={{ color: 'var(--brand-gold)' }} />
            <span>5. Quality Control (QC)</span>
          </span>
          <span className="badge badge-purple" style={{ fontSize: '0.68rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
            <ShieldCheck size={12} />
            <span>Internal Admin Only</span>
          </span>
        </div>

        {order?.qc_checked_at && (
          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            Terakhir diupdate: <strong className="mono-num">{formatDateIndo(order.qc_checked_at)}</strong>
          </div>
        )}
      </div>

      {/* FEEDBACK ALERT */}
      {localFeedback && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '10px',
            fontSize: '0.84rem',
            background: localFeedback.type === 'error' ? 'var(--status-rose-bg)' : 'var(--status-emerald-bg)',
            border: `1px solid ${localFeedback.type === 'error' ? 'var(--status-rose-border)' : 'var(--status-emerald-border)'}`,
            color: localFeedback.type === 'error' ? 'var(--status-rose)' : 'var(--status-emerald)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          {localFeedback.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          <span>{localFeedback.text}</span>
        </div>
      )}

      {/* FORM CARD */}
      <form onSubmit={handleSubmit} className="card" style={{ padding: '22px', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* ROW 1: QC PASS (INSPECTOR) & QC STATUS */}
        <QcInspectorStatusRow
          inspectors={inspectors}
          qcPassId={qcPassId}
          qcPassName={qcPassName}
          onInspectorChange={handleInspectorChange}
          qcStatus={qcStatus}
          onStatusChange={setQcStatus}
        />

        {/* ROW 2: QTY QC PASS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Qty QC Pass (Pcs)
            </label>
            <button
              type="button"
              onClick={handlePresetGradeA}
              className="badge badge-gold"
              style={{
                fontSize: '0.72rem',
                cursor: 'pointer',
                border: 'none',
                padding: '4px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
              title="Samakan Qty QC Pass dengan Qty Kirim Grade A"
            >
              <span>⚡ Samakan Grade A ({order?.qty_grade_a || 0} pcs)</span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={() => adjustQty(setQtyQcPass, qtyQcPass, -10, 0)}
              className="btn btn-secondary"
              style={{ padding: '8px 12px', fontSize: '0.78rem', minWidth: '42px' }}
            >
              -10
            </button>
            <button
              type="button"
              onClick={() => adjustQty(setQtyQcPass, qtyQcPass, -1, 0)}
              className="btn btn-secondary"
              style={{ padding: '8px 12px', fontSize: '0.78rem', minWidth: '38px' }}
            >
              -1
            </button>

            <input
              type="number"
              step="any"
              min="0"
              value={qtyQcPass}
              onChange={(e) => setQtyQcPass(e.target.value)}
              placeholder="0.00"
              className="input-field mono-num"
              style={{
                flex: 1,
                fontSize: '1.25rem',
                fontWeight: 800,
                textAlign: 'center',
                color: 'var(--brand-gold)',
                padding: '8px 12px'
              }}
            />

            <button
              type="button"
              onClick={() => adjustQty(setQtyQcPass, qtyQcPass, 1, 0)}
              className="btn btn-secondary"
              style={{ padding: '8px 12px', fontSize: '0.78rem', minWidth: '38px' }}
            >
              +1
            </button>
            <button
              type="button"
              onClick={() => adjustQty(setQtyQcPass, qtyQcPass, 10, 0)}
              className="btn btn-secondary"
              style={{ padding: '8px 12px', fontSize: '0.78rem', minWidth: '42px' }}
            >
              +10
            </button>
          </div>
        </div>

        {/* ROW 3: KETERANGAN QMS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <FileText size={15} style={{ color: 'var(--brand-gold)' }} />
            <span>Keterangan QMS</span>
          </label>
          <textarea
            value={keteranganQms}
            onChange={(e) => setKeteranganQms(e.target.value)}
            rows={3}
            placeholder="Catatan hasil audit Quality Management System, kondisi spesifikasi jahitan, finishing, cacat minor/major, dll..."
            className="input-field"
            style={{
              fontSize: '0.86rem',
              padding: '10px 14px',
              borderRadius: '10px',
              resize: 'vertical'
            }}
          />
        </div>

        {/* ROW 4: GAMBAR QC */}
        <QcPhotoCaptureField
          imagePreviewSrc={imagePreviewSrc}
          onFileChange={handleFileChange}
          onClearPhoto={() => setGambarQc(null)}
        />

        {/* SUBMIT BUTTON */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary"
            style={{
              padding: '12px 24px',
              fontSize: '0.92rem',
              fontWeight: 800,
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            {saving ? (
              <>
                <RefreshCw size={17} className="animate-spin" />
                <span>Menyimpan ke Odoo...</span>
              </>
            ) : (
              <>
                <Save size={17} />
                <span>Simpan &amp; Sinkronkan Hasil QC ke Odoo</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
