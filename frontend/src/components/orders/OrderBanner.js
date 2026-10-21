'use client';

import { CheckCircle2, AlertTriangle, Info, Lock, Unlock } from 'lucide-react';

export default function OrderBanner({
  feedback,
  isBackorder,
  isMasterAdmin = false,
  isUnlockedByAdmin = false,
  isCuttingLocked = false,
  isGradeALocked = false,
  isGradeBLocked = false,
  isBsklLocked = false,
  handleAdminToggleUnlock,
  saving = false
}) {
  const isAnyLocked = isCuttingLocked || isGradeALocked || isGradeBLocked || isBsklLocked;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* FEEDBACK ALERT */}
      {feedback?.text && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '0.86rem',
            fontWeight: 600,
            background: feedback.type === 'success' ? 'var(--status-emerald-bg)' : 'var(--status-rose-bg)',
            border: `1.5px solid ${feedback.type === 'success' ? 'var(--status-emerald-border)' : 'var(--status-rose-border)'}`,
            color: feedback.type === 'success' ? 'var(--status-emerald)' : 'var(--status-rose)',
            boxShadow: 'var(--shadow-subtle)'
          }}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
          ) : (
            <AlertTriangle size={18} style={{ flexShrink: 0 }} />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* MASTER ADMIN UNLOCK CONTROL BAR */}
      {isMasterAdmin && (
        <div
          style={{
            padding: '10px 16px',
            borderRadius: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
            background: isUnlockedByAdmin ? '#fffbeb' : '#f8fafc',
            border: `1.5px solid ${isUnlockedByAdmin ? '#fde68a' : '#cbd5e1'}`,
            fontSize: '0.82rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isUnlockedByAdmin ? (
              <Unlock size={18} style={{ color: '#d97706', flexShrink: 0 }} />
            ) : (
              <Lock size={18} style={{ color: '#64748b', flexShrink: 0 }} />
            )}
            <div>
              {isUnlockedByAdmin ? (
                <span style={{ color: '#92400e', fontWeight: 700 }}>
                  Kunci Dibuka oleh Master Admin: User lain & vendor dapat mengedit kembali seluruh isian.
                </span>
              ) : (
                <span style={{ color: '#334155', fontWeight: 600 }}>
                  Panel Master Admin: {isAnyLocked ? 'Sebagian tahapan terkunci sesuai aturan sistem.' : 'Kondisi tahapan saat ini aktif.'}
                </span>
              )}
            </div>
          </div>

          <div>
            <button
              type="button"
              disabled={saving}
              onClick={handleAdminToggleUnlock}
              className={`btn ${isUnlockedByAdmin ? 'btn-secondary' : 'btn-primary'}`}
              style={{
                fontSize: '0.78rem',
                padding: '6px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                borderRadius: '8px'
              }}
            >
              {isUnlockedByAdmin ? (
                <>
                  <Lock size={13} />
                  <span>Kunci Kembali (Relock)</span>
                </>
              ) : (
                <>
                  <Unlock size={13} />
                  <span>🔓 Buka Kunci (Unlock untuk Semua User)</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* BACKORDER BANNER */}
      {isBackorder && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            background: 'var(--status-purple-bg)',
            border: '1px solid var(--status-purple-border)',
            color: 'var(--status-purple)',
            fontSize: '0.84rem'
          }}
        >
          <Info size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong>SPK Backorder (Kekurangan Bahan):</strong> Alur kerja difokuskan untuk penerimaan kain susulan dan pemotongan. Tab Aksesoris, Jahit, dan BSKL disembunyikan karena dikelola pada SPK Induk.
          </div>
        </div>
      )}
    </div>
  );
}
