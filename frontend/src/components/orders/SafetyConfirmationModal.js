'use client';

import { ShieldAlert, Lock, AlertTriangle } from 'lucide-react';

export default function SafetyConfirmationModal({
  safetyModal,
  order,
  saving,
  onClose
}) {
  if (!safetyModal?.open) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-content" style={{ maxWidth: '460px', padding: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '14px' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              background: safetyModal.isExtreme ? 'var(--status-rose-bg)' : 'var(--brand-gold-light)',
              border: `1.5px solid ${safetyModal.isExtreme ? 'var(--status-rose-border)' : 'var(--brand-gold-border)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: safetyModal.isExtreme ? 'var(--status-rose)' : 'var(--brand-gold)',
              flexShrink: 0
            }}
          >
            {safetyModal.isExtreme ? <ShieldAlert size={24} /> : <Lock size={22} />}
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.3 }}>
              {safetyModal.title}
            </h3>
            <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              SPK #{order?.id} • {order?.mo_name}
            </p>
          </div>
        </div>

        {/* Comparison Metrics Grid */}
        <div className="comparison-card">
          <div className="comparison-box">
            <span className="comparison-box-label">{safetyModal.targetLabel || 'Target SPK'}</span>
            <span className="comparison-box-value" style={{ fontSize: '1.05rem' }}>{safetyModal.targetVal}</span>
          </div>
          <div className="comparison-box" style={{ background: 'var(--bg-card)', borderRadius: '8px', padding: '4px' }}>
            <span className="comparison-box-label" style={{ color: safetyModal.isExtreme ? 'var(--status-rose)' : 'var(--brand-gold)' }}>
              Input Anda
            </span>
            <span className="comparison-box-value" style={{ fontSize: '1.05rem', color: safetyModal.isExtreme ? 'var(--status-rose)' : 'var(--brand-gold)' }}>
              {safetyModal.actualVal}
            </span>
          </div>
          <div className="comparison-box">
            <span className="comparison-box-label">Selisih</span>
            <span
              className="comparison-box-value"
              style={{
                fontSize: '1.05rem',
                color: safetyModal.isExtreme ? 'var(--status-rose)' : 'var(--text-primary)'
              }}
            >
              {safetyModal.diffVal}
            </span>
          </div>
        </div>

        {/* Warning Message Box */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: '12px',
            background: safetyModal.isExtreme ? 'var(--status-rose-bg)' : 'var(--bg-card-subtle)',
            border: `1px solid ${safetyModal.isExtreme ? 'var(--status-rose-border)' : 'var(--border-default)'}`,
            fontSize: '0.82rem',
            lineHeight: 1.5,
            color: safetyModal.isExtreme ? 'var(--status-rose)' : 'var(--text-secondary)',
            marginBottom: '18px'
          }}
        >
          {safetyModal.isExtreme && (
            <div style={{ fontWeight: 800, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <AlertTriangle size={15} />
              <span>PERIKSA KEMBALI ANGKA INPUT</span>
            </div>
          )}
          <p style={{ margin: 0 }}>{safetyModal.warningMessage}</p>
        </div>

        {/* Modal Actions */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary"
            style={{ flex: 1, height: '44px', borderRadius: '12px', fontWeight: 700 }}
          >
            Cek Lagi
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              if (safetyModal.onConfirm) safetyModal.onConfirm();
            }}
            className={`btn ${safetyModal.isExtreme ? 'btn-danger' : 'btn-primary'}`}
            style={{ flex: 1.2, height: '44px', borderRadius: '12px', fontWeight: 800, fontSize: '0.88rem' }}
          >
            {saving ? 'Menyimpan...' : safetyModal.isExtreme ? 'Ya, Sudah Benar & Simpan' : 'Ya, Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}
