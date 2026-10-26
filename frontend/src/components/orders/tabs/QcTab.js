'use client';

import { useState, useRef, useEffect } from 'react';
import {
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  Ban,
  Camera,
  Upload,
  Trash2,
  RefreshCw,
  Save,
  ShieldCheck,
  AlertTriangle,
  FileText,
  UserCheck
} from 'lucide-react';
import { adjustQty, formatDateIndo } from '@/lib/utils/formatters';

export default function QcTab({
  order,
  targetSpkQty = 0,
  saving = false,
  onSaveQc,
  user
}) {
  const fileInputRef = useRef(null);

  // Local form state initialized from order
  const [qcPassId, setQcPassId] = useState(order?.qc_pass_id ? String(order.qc_pass_id) : '');
  const [qcPassName, setQcPassName] = useState(order?.qc_pass_name || '');
  const [qtyQcPass, setQtyQcPass] = useState(
    order?.qty_qc_pass !== undefined && order?.qty_qc_pass !== null
      ? String(order.qty_qc_pass)
      : (order?.qty_grade_a !== undefined && order?.qty_grade_a !== null ? String(order.qty_grade_a) : '0')
  );
  const [qcStatus, setQcStatus] = useState(order?.qc_status || 'Passed');
  const [keteranganQms, setKeteranganQms] = useState(order?.keterangan_qms || '');
  const [gambarQc, setGambarQc] = useState(order?.gambar_qc || null);
  const [inspectors, setInspectors] = useState([]);
  const [loadingInspectors, setLoadingInspectors] = useState(false);
  const [localFeedback, setLocalFeedback] = useState(null);

  // Sync state if order prop changes
  useEffect(() => {
    if (order) {
      if (order.qc_pass_id) setQcPassId(String(order.qc_pass_id));
      if (order.qc_pass_name) setQcPassName(order.qc_pass_name);
      if (order.qty_qc_pass !== undefined && order.qty_qc_pass !== null) {
        setQtyQcPass(String(order.qty_qc_pass));
      }
      if (order.qc_status) setQcStatus(order.qc_status);
      if (order.keterangan_qms) setKeteranganQms(order.keterangan_qms);
      if (order.gambar_qc) setGambarQc(order.gambar_qc);
    }
  }, [order]);

  // Load QC inspectors from API
  useEffect(() => {
    let isMounted = true;
    async function loadInspectors() {
      if (!order?.id) return;
      setLoadingInspectors(true);
      try {
        const res = await fetch(`/api/orders/${order.id}/qc`);
        const data = await res.json();
        if (isMounted && data.success && Array.isArray(data.inspectors)) {
          setInspectors(data.inspectors);
          // If no qcPassId currently set, default to QC inspector if available
          if (!order?.qc_pass_id) {
            const qcPartner = data.inspectors.find(i => i.id === 64 || i.name.toLowerCase().includes('qc'));
            if (qcPartner) {
              setQcPassId(String(qcPartner.id));
              setQcPassName(qcPartner.name);
            }
          }
        }
      } catch (err) {
        console.warn('Failed to load inspectors:', err);
      } finally {
        if (isMounted) setLoadingInspectors(false);
      }
    }
    loadInspectors();
    return () => { isMounted = false; };
  }, [order?.id, order?.qc_pass_id]);

  // Handle image upload from file or camera
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setLocalFeedback({ type: 'error', text: 'File harus berupa gambar (JPG, PNG, atau WEBP).' });
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setLocalFeedback({ type: 'error', text: 'Ukuran foto maksimal 8MB.' });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setGambarQc(reader.result);
      setLocalFeedback(null);
    };
    reader.onerror = () => {
      setLocalFeedback({ type: 'error', text: 'Gagal membaca file gambar.' });
    };
    reader.readAsDataURL(file);
  };

  // Quick preset: samakan dengan Grade A atau Target SPK
  const handlePresetGradeA = () => {
    const preset = order?.qty_grade_a !== undefined && Number(order?.qty_grade_a) > 0
      ? order.qty_grade_a
      : (targetSpkQty || 0);
    setQtyQcPass(String(preset));
  };

  // Submit form
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalFeedback(null);

    const selectedInspector = inspectors.find(i => String(i.id) === String(qcPassId));
    const passName = selectedInspector ? selectedInspector.name : qcPassName;

    const payload = {
      qcPassId: qcPassId ? Number(qcPassId) : null,
      qcPassName: passName || null,
      qtyQcPass: parseFloat(qtyQcPass) || 0,
      qcStatus: qcStatus || 'Passed',
      keteranganQms: (keteranganQms || '').trim(),
      gambarQc: gambarQc || null
    };

    if (onSaveQc) {
      await onSaveQc(payload);
    }
  };

  // Image source formatter (handles raw base64 or data URI)
  const imagePreviewSrc = gambarQc
    ? (gambarQc.startsWith('data:') ? gambarQc : `data:image/jpeg;base64,${gambarQc}`)
    : null;

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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
          {/* Field 1: QC Pass */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <UserCheck size={15} style={{ color: 'var(--brand-gold)' }} />
              <span>QC Pass (Petugas / PIC)</span>
            </label>
            <select
              value={qcPassId}
              onChange={(e) => {
                const val = e.target.value;
                setQcPassId(val);
                const found = inspectors.find(i => String(i.id) === val);
                if (found) setQcPassName(found.name);
              }}
              className="input-field"
              style={{
                fontSize: '0.88rem',
                padding: '9px 12px',
                borderRadius: '10px',
                background: 'var(--bg-surface)'
              }}
            >
              <option value="">-- Pilih Petugas QC --</option>
              {inspectors.map((ins) => (
                <option key={ins.id} value={ins.id}>
                  {ins.name}
                </option>
              ))}
              {!inspectors.some(i => String(i.id) === qcPassId) && qcPassName && (
                <option value={qcPassId}>{qcPassName}</option>
              )}
            </select>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Partner res.partner di Odoo yang memvalidasi standar kualitas.
            </span>
          </div>

          {/* Field 2: QC Status Pills */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              QC Status
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {/* Passed */}
              <button
                type="button"
                onClick={() => setQcStatus('Passed')}
                style={{
                  flex: 1,
                  minWidth: '85px',
                  padding: '9px 12px',
                  borderRadius: '10px',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  border: qcStatus === 'Passed' ? '2px solid #10b981' : '1px solid var(--border-color)',
                  background: qcStatus === 'Passed' ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-surface)',
                  color: qcStatus === 'Passed' ? '#10b981' : 'var(--text-secondary)',
                  transition: 'all 0.2s ease'
                }}
              >
                <CheckCircle2 size={16} />
                <span>Passed</span>
              </button>

              {/* Reject */}
              <button
                type="button"
                onClick={() => setQcStatus('Reject')}
                style={{
                  flex: 1,
                  minWidth: '85px',
                  padding: '9px 12px',
                  borderRadius: '10px',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  border: qcStatus === 'Reject' ? '2px solid #ef4444' : '1px solid var(--border-color)',
                  background: qcStatus === 'Reject' ? 'rgba(239, 68, 68, 0.15)' : 'var(--bg-surface)',
                  color: qcStatus === 'Reject' ? '#ef4444' : 'var(--text-secondary)',
                  transition: 'all 0.2s ease'
                }}
              >
                <XCircle size={16} />
                <span>Reject</span>
              </button>

              {/* Cancel */}
              <button
                type="button"
                onClick={() => setQcStatus('Cancel')}
                style={{
                  flex: 1,
                  minWidth: '85px',
                  padding: '9px 12px',
                  borderRadius: '10px',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  border: qcStatus === 'Cancel' ? '2px solid #64748b' : '1px solid var(--border-color)',
                  background: qcStatus === 'Cancel' ? 'rgba(100, 116, 139, 0.15)' : 'var(--bg-surface)',
                  color: qcStatus === 'Cancel' ? '#64748b' : 'var(--text-secondary)',
                  transition: 'all 0.2s ease'
                }}
              >
                <Ban size={16} />
                <span>Cancel</span>
              </button>
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Hasil audit QC terhadap garment selesai jahit.
            </span>
          </div>
        </div>

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
            {/* Decrement buttons */}
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

            {/* Input */}
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

            {/* Increment buttons */}
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

        {/* ROW 4: GAMBAR QC (CAMERA / UPLOAD BOX) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Camera size={15} style={{ color: 'var(--brand-gold)' }} />
            <span>Gambar QC (Bukti Pemeriksaan)</span>
          </label>

          <input
            type="file"
            accept="image/*"
            capture="environment"
            ref={fileInputRef}
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />

          {imagePreviewSrc ? (
            <div
              style={{
                position: 'relative',
                width: '100%',
                maxWidth: '360px',
                borderRadius: '14px',
                overflow: 'hidden',
                border: '2px solid var(--border-color)',
                background: '#0f172a'
              }}
            >
              <img
                src={imagePreviewSrc}
                alt="Gambar Bukti QC"
                style={{
                  width: '100%',
                  maxHeight: '260px',
                  objectFit: 'contain',
                  display: 'block'
                }}
              />
              <div
                style={{
                  padding: '10px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'rgba(15, 23, 42, 0.85)',
                  backdropFilter: 'blur(4px)',
                  borderTop: '1px solid rgba(255, 255, 255, 0.1)'
                }}
              >
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="btn btn-secondary"
                  style={{
                    fontSize: '0.74rem',
                    padding: '5px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px'
                  }}
                >
                  <Upload size={13} />
                  <span>Ganti Foto</span>
                </button>
                <button
                  type="button"
                  onClick={() => setGambarQc(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#ef4444',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Trash2 size={14} />
                  <span>Hapus</span>
                </button>
              </div>
            </div>
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: '100%',
                maxWidth: '360px',
                height: '180px',
                borderRadius: '14px',
                border: '2px dashed var(--border-color)',
                background: 'var(--bg-surface)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                color: 'var(--text-muted)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--brand-gold)';
                e.currentTarget.style.background = 'rgba(217, 119, 6, 0.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-color)';
                e.currentTarget.style.background = 'var(--bg-surface)';
              }}
            >
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  background: 'rgba(217, 119, 6, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--brand-gold)'
                }}
              >
                <Camera size={28} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block' }}>
                  Ambil Foto Kamera / Unggah Gambar
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Format JPG, PNG, WEBP (Maksimal 8MB)
                </span>
              </div>
            </div>
          )}
        </div>

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
                <span>Simpan & Sinkronkan Hasil QC ke Odoo</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
