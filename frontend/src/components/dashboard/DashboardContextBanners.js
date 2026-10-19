'use client';

import { AlertTriangle, Flame, Clock } from 'lucide-react';

export default function DashboardContextBanners({ status, totalCount, onClearStatus }) {
  if (status === 'kain_kurang') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          marginBottom: '16px',
          background: 'var(--status-rose-bg)',
          border: '1.5px solid var(--status-rose-border)',
          borderRadius: '12px',
          color: 'var(--status-rose)',
          fontSize: '0.86rem',
          flexWrap: 'wrap',
          gap: '8px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertTriangle size={18} color="var(--status-rose)" />
          <span>
            Menampilkan <strong>{totalCount} SPK</strong> dengan status <strong>Kain Kurang</strong>. Harap pastikan fisik kain sebelum memotong.
          </span>
        </div>
        <button
          type="button"
          onClick={onClearStatus}
          className="quick-action-pill"
          style={{ fontSize: '0.74rem', background: 'var(--bg-card)', borderColor: 'var(--status-rose-border)', color: 'var(--status-rose)', height: '28px' }}
        >
          Lihat Semua SPK
        </button>
      </div>
    );
  }

  if (status === 'overdue') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          marginBottom: '16px',
          background: 'var(--status-amber-bg)',
          border: '1.5px solid var(--status-amber-border)',
          borderRadius: '12px',
          color: 'var(--status-amber)',
          fontSize: '0.86rem',
          flexWrap: 'wrap',
          gap: '8px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Flame size={18} color="var(--brand-gold)" />
          <span>
            Menampilkan <strong>{totalCount} SPK</strong> yang <strong>Lewat Batas Deadline (Overdue)</strong>. Mohon percepat proses potong & jahit!
          </span>
        </div>
        <button
          type="button"
          onClick={onClearStatus}
          className="quick-action-pill"
          style={{ fontSize: '0.74rem', background: 'var(--bg-card)', borderColor: 'var(--status-amber-border)', color: 'var(--status-amber)', height: '28px' }}
        >
          Lihat Semua SPK
        </button>
      </div>
    );
  }

  if (status === 'deadline_week') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          marginBottom: '16px',
          background: 'var(--status-sky-bg)',
          border: '1.5px solid var(--status-sky-border)',
          borderRadius: '12px',
          color: 'var(--status-sky)',
          fontSize: '0.86rem',
          flexWrap: 'wrap',
          gap: '8px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Clock size={18} color="var(--status-sky)" />
          <span>
            Menampilkan <strong>{totalCount} SPK</strong> dengan batas deadline dalam <strong>7 hari ke depan</strong>.
          </span>
        </div>
        <button
          type="button"
          onClick={onClearStatus}
          className="quick-action-pill"
          style={{ fontSize: '0.74rem', background: 'var(--bg-card)', borderColor: 'var(--status-sky-border)', color: 'var(--status-sky)', height: '28px' }}
        >
          Lihat Semua SPK
        </button>
      </div>
    );
  }

  return null;
}
