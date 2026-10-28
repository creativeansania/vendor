'use client';

import { useRef } from 'react';
import { Camera, Upload, Trash2, Image as ImageIcon, Info } from 'lucide-react';

export default function QcPhotoCaptureField({
  imagePreviewSrc,
  onFileChange,
  onClearPhoto
}) {
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Camera size={15} style={{ color: 'var(--brand-gold)' }} />
        <span>Gambar QC (Foto Bukti Pemeriksaan)</span>
      </label>

      {/* Hidden Inputs for Camera vs Gallery Picker */}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={cameraInputRef}
        onChange={onFileChange}
        style={{ display: 'none' }}
      />
      <input
        type="file"
        accept="image/*"
        ref={galleryInputRef}
        onChange={onFileChange}
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
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
              onClick={onClearPhoto}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--status-rose)',
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
              background: 'var(--brand-gold-light)',
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
          background: 'var(--brand-gold-light)',
          border: '1px solid var(--brand-gold-border)',
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
          <strong style={{ color: 'var(--brand-gold)' }}>Alur Foto QC (Hemat Storage):</strong> Gunakan tombol <em>&quot;Buka Kamera HP&quot;</em> untuk memotret pakaian saat audit fisik, atau <em>&quot;Pilih dari Galeri&quot;</em>. Foto disimpan langsung ke Odoo ERP dan <strong>TIDAK disimpan ke Supabase</strong> sehingga menghemat 100% kuota storage database Anda.
        </div>
      </div>
    </div>
  );
}
