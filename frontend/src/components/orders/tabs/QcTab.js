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
  UserCheck,
  Image as ImageIcon,
  Info
} from 'lucide-react';
import { adjustQty, formatDateIndo } from '@/lib/utils/formatters';
import { fetchApi } from '@/lib/api';

export default function QcTab({
  order,
  targetSpkQty = 0,
  saving = false,
  onSaveQc,
  user
}) {
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  // Strictly limited to the 2 designated QC inspectors: Yana Suryana & Dindin
  const DEFAULT_INSPECTORS = [
    { id: 14299, name: 'Yana Suryana' },
    { id: 318, name: 'Dindin' }
  ];

  const [inspectors, setInspectors] = useState(DEFAULT_INSPECTORS);
  const [loadingInspectors, setLoadingInspectors] = useState(false);
  const [localFeedback, setLocalFeedback] = useState(null);

  // Form states: Default to Yana Suryana (14299) if not yet assigned
  const [qcPassId, setQcPassId] = useState(() => {
    if (order?.qc_pass_id && (Number(order.qc_pass_id) === 14299 || Number(order.qc_pass_id) === 318)) {
      return String(order.qc_pass_id);
    }
    return '14299';
  });
  const [qcPassName, setQcPassName] = useState(() => {
    if (order?.qc_pass_id && Number(order.qc_pass_id) === 318) return 'Dindin';
    return order?.qc_pass_name || 'Yana Suryana';
  });
  const [qtyQcPass, setQtyQcPass] = useState(
    order?.qty_qc_pass !== undefined && order?.qty_qc_pass !== null
      ? String(order.qty_qc_pass)
      : (order?.qty_grade_a !== undefined && order?.qty_grade_a !== null ? String(order.qty_grade_a) : '0')
  );
  const [qcStatus, setQcStatus] = useState(order?.qc_status || 'Passed');
  const [keteranganQms, setKeteranganQms] = useState(order?.keterangan_qms || '');
  const [gambarQc, setGambarQc] = useState(order?.gambar_qc || null);

  // Keep state synchronized if order prop updates
  useEffect(() => {
    if (order) {
      if (order.qc_pass_id && (Number(order.qc_pass_id) === 14299 || Number(order.qc_pass_id) === 318)) {
        setQcPassId(String(order.qc_pass_id));
        setQcPassName(Number(order.qc_pass_id) === 318 ? 'Dindin' : (order.qc_pass_name || 'Yana Suryana'));
      }
      if (order.qty_qc_pass !== undefined && order.qty_qc_pass !== null) {
        setQtyQcPass(String(order.qty_qc_pass));
      }
      if (order.qc_status) {
        setQcStatus(order.qc_status);
      }
      if (order.keterangan_qms) {
        setKeteranganQms(order.keterangan_qms);
      }
      if (order.gambar_qc) {
        setGambarQc(order.gambar_qc);
      }
    }
  }, [order]);

  // Load QC details & live image from Odoo via fetchApi
  useEffect(() => {
    let isMounted = true;
    async function loadInspectorsAndQcData() {
      if (!order?.id) return;
      setLoadingInspectors(true);
      try {
        const res = await fetchApi(`/orders/${order.id}/qc`);
        if (isMounted && res?.success) {
          if (Array.isArray(res.inspectors) && res.inspectors.length > 0) {
            setInspectors(res.inspectors);
          }
          // Populate live image from Odoo if not already set locally
          if (res.gambarQc && !gambarQc) {
            setGambarQc(res.gambarQc);
          }
        }
      } catch (err) {
        console.warn('Failed to load QC data via fetchApi:', err);
      } finally {
        if (isMounted) setLoadingInspectors(false);
      }
    }
    loadInspectorsAndQcData();
    return () => { isMounted = false; };
  }, [order?.id]);

  // Client-side image compression to optimize speed & minimize Odoo storage
  const compressImage = (dataUrl, maxWidth = 1280, quality = 0.78) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  };

  // Handle image upload from file or camera
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setLocalFeedback({ type: 'error', text: 'File harus berupa gambar (JPG, PNG, atau WEBP).' });
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      setLocalFeedback({ type: 'error', text: 'Ukuran foto maksimal 15MB.' });
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const compressed = await compressImage(reader.result, 1280, 0.78);
        setGambarQc(compressed);
        setLocalFeedback({ type: 'success', text: 'Foto berhasil dimuat & dioptimasi. Foto akan disimpan ke Odoo saat Anda klik "Simpan & Sinkronkan".' });
      } catch (err) {
        setGambarQc(reader.result);
        setLocalFeedback({ type: 'success', text: 'Foto berhasil dimuat. Klik "Simpan & Sinkronkan" untuk mengirim ke Odoo.' });
      }
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
              Petugas QC resmi yang bertugas: Yana Suryana atau Dindin.
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

        {/* ROW 4: GAMBAR QC (CAMERA & GALLERY PHOTO CAPTURE) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Camera size={15} style={{ color: 'var(--brand-gold)' }} />
            <span>Gambar QC (Foto Bukti Pemeriksaan)</span>
          </label>

          {/* Hidden Inputs for Camera vs Gallery Picker */}
          {/* Input 1: Camera capture (directly activates rear camera on smartphones) */}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            ref={cameraInputRef}
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          {/* Input 2: Gallery / File selector (select existing photo from phone or desktop) */}
          <input
            type="file"
            accept="image/*"
            ref={galleryInputRef}
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />

          {imagePreviewSrc ? (
            <div
              style={{
                position: 'relative',
                width: '100%',
                maxWidth: '420px',
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
                  maxHeight: '280px',
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
                  background: 'rgba(15, 23, 42, 0.9)',
                  backdropFilter: 'blur(6px)',
                  borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                  flexWrap: 'wrap',
                  gap: '8px'
                }}
              >
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="btn btn-secondary"
                    style={{
                      fontSize: '0.74rem',
                      padding: '5px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px'
                    }}
                    title="Buka Kamera untuk foto ulang"
                  >
                    <Camera size={13} />
                    <span>Foto Ulang</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="btn btn-secondary"
                    style={{
                      fontSize: '0.74rem',
                      padding: '5px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px'
                    }}
                    title="Pilih foto lain dari galeri"
                  >
                    <Upload size={13} />
                    <span>Ganti File</span>
                  </button>
                </div>
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
                    gap: '4px',
                    padding: '5px 8px'
                  }}
                >
                  <Trash2 size={14} />
                  <span>Hapus</span>
                </button>
              </div>
            </div>
          ) : (
            <div
              style={{
                width: '100%',
                maxWidth: '420px',
                padding: '22px 16px',
                borderRadius: '14px',
                border: '2px dashed var(--border-color)',
                background: 'var(--bg-surface)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '14px',
                transition: 'all 0.2s ease',
                color: 'var(--text-muted)'
              }}
            >
              <div
                style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '50%',
                  background: 'rgba(217, 119, 6, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--brand-gold)'
                }}
              >
                <Camera size={30} />
              </div>

              <div style={{ textAlign: 'center' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-primary)', display: 'block' }}>
                  Ambil Foto Pemeriksaan QC
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Buka kamera langsung dari HP atau upload foto pakaian dari galeri
                </span>
              </div>

              {/* DUAL ACTION BUTTONS: CAMERA VS GALLERY */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="btn btn-primary"
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    padding: '8px 14px',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Camera size={15} />
                  <span>Buka Kamera HP</span>
                </button>
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="btn btn-secondary"
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    padding: '8px 14px',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <ImageIcon size={15} />
                  <span>Pilih dari Galeri</span>
                </button>
              </div>
            </div>
          )}

          {/* Workflow Explanation Banner */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '8px',
              background: 'rgba(217, 119, 6, 0.08)',
              border: '1px solid rgba(217, 119, 6, 0.2)',
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              maxWidth: '560px'
            }}
          >
            <Info size={16} style={{ color: 'var(--brand-gold)', flexShrink: 0, marginTop: '1px' }} />
            <div>
              <strong style={{ color: 'var(--brand-gold)' }}>Alur Foto QC (Hemat Storage):</strong> Gunakan tombol <em>"Buka Kamera HP"</em> untuk memotret pakaian saat audit fisik, atau <em>"Pilih dari Galeri"</em>. Foto disimpan langsung ke Odoo ERP dan <strong>TIDAK disimpan ke Supabase</strong> sehingga menghemat 100% kuota storage database Anda.
            </div>
          </div>
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
