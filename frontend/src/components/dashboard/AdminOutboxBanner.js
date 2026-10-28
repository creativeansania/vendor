'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi } from '@/lib/api';
import { RefreshCw, AlertTriangle, Clock, CheckCircle2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';

const ACTION_LABELS = {
  cutting_rolls: 'Potong Kain & Roll',
  grade_a: 'Hasil Jahit Grade A',
  grade_b: 'Hasil Jahit Grade B',
  bskl: 'Sisa Potong (BSKL)',
  production_result: 'Hasil Produksi'
};

export default function AdminOutboxBanner({ user, onAfterSync }) {
  const router = useRouter();
  const isAdmin = user && ['master_admin', 'admin'].includes(user.role);

  const [summary, setSummary] = useState({ pendingCount: 0, failedCount: 0, items: [] });
  const [retrying, setRetrying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);

  const loadSummary = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await fetchApi('/admin/sync-outbox?mode=summary');
      if (res?.success) {
        setSummary({
          pendingCount: res.pendingCount || 0,
          failedCount: res.failedCount || 0,
          items: res.items || []
        });
      }
    } catch {
      // Silent background check so normal dashboard UX is never interrupted
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    const timer = setTimeout(() => {
      if (active) loadSummary();
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [isAdmin, loadSummary]);

  const handleRetryAll = async () => {
    if (retrying) return;
    setRetrying(true);
    setToastMsg(null);
    try {
      const res = await fetchApi('/admin/sync-outbox', {
        method: 'POST',
        body: JSON.stringify({ limit: 25 })
      });
      if (res?.success) {
        setSummary({
          pendingCount: res.pendingCount || 0,
          failedCount: res.failedCount || 0,
          items: res.items || []
        });
        setToastMsg({
          type: (res.failed || 0) > 0 ? 'warning' : 'success',
          text: res.message || 'Antrean sinkronisasi Odoo berhasil diproses.'
        });
        if (onAfterSync && (res.synced || 0) > 0) {
          onAfterSync();
        }
      }
    } catch (err) {
      setToastMsg({
        type: 'error',
        text: 'Gagal memproses antrean Odoo: ' + err.message
      });
    } finally {
      setRetrying(false);
    }
  };

  if (!isAdmin) return null;

  const totalActive = (summary.pendingCount || 0) + (summary.failedCount || 0);
  if (totalActive === 0 && !toastMsg) return null;

  const hasFailed = (summary.failedCount || 0) > 0;

  return (
    <div
      className="card"
      style={{
        padding: '12px 16px',
        borderRadius: '12px',
        background: hasFailed
          ? 'var(--status-amber-bg)'
          : toastMsg?.type === 'success' && totalActive === 0
          ? 'var(--status-emerald-bg)'
          : 'var(--bg-card-subtle)',
        border: `1.5px solid ${
          hasFailed
            ? 'var(--status-amber-border)'
            : toastMsg?.type === 'success' && totalActive === 0
            ? 'var(--status-emerald-border)'
            : 'var(--border-strong)'
        }`
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
          {totalActive === 0 ? (
            <CheckCircle2 size={18} style={{ color: 'var(--status-emerald)', flexShrink: 0 }} />
          ) : hasFailed ? (
            <AlertTriangle size={18} style={{ color: 'var(--status-amber)', flexShrink: 0 }} />
          ) : (
            <Clock size={18} style={{ color: 'var(--brand-primary)', flexShrink: 0 }} />
          )}

          <div style={{ fontSize: '0.84rem', lineHeight: 1.4 }}>
            {totalActive === 0 && toastMsg ? (
              <span style={{ fontWeight: 700, color: 'var(--status-emerald)' }}>{toastMsg.text}</span>
            ) : (
              <>
                <strong style={{ color: hasFailed ? 'var(--status-amber)' : 'var(--text-primary)' }}>
                  Antrean Sinkronisasi Odoo:
                </strong>{' '}
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                  {summary.failedCount > 0 && `${summary.failedCount} gagal terkirim`}
                  {summary.failedCount > 0 && summary.pendingCount > 0 && ' · '}
                  {summary.pendingCount > 0 && `${summary.pendingCount} sedang diproses`}
                </span>
                {toastMsg && (
                  <div style={{ fontSize: '0.78rem', marginTop: '2px', color: 'var(--text-secondary)' }}>
                    {toastMsg.text}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {summary.items.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="btn btn-secondary"
              style={{ fontSize: '0.76rem', padding: '6px 10px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <span>Rincian ({summary.items.length})</span>
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}

          {totalActive > 0 && (
            <button
              type="button"
              disabled={retrying}
              onClick={handleRetryAll}
              className="btn btn-primary"
              style={{ fontSize: '0.78rem', padding: '6px 12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <RefreshCw size={14} className={retrying ? 'spin' : ''} />
              <span>{retrying ? 'Menyinkronkan...' : 'Kirim Ulang ke Odoo'}</span>
            </button>
          )}
        </div>
      </div>

      {expanded && summary.items.length > 0 && (
        <div
          style={{
            marginTop: '10px',
            paddingTop: '10px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}
        >
          {summary.items.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 10px',
                borderRadius: '8px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                fontSize: '0.78rem',
                flexWrap: 'wrap'
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontWeight: 700 }}>
                  <span>{item.moName}</span>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>·</span>
                  <span style={{ color: 'var(--brand-primary)' }}>{ACTION_LABELS[item.action] || item.action}</span>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>({item.vendorName})</span>
                </div>
                {item.lastError && (
                  <div style={{ color: 'var(--status-rose)', fontSize: '0.74rem', marginTop: '2px' }}>
                    Percobaan {item.attempts}x: {item.lastError}
                  </div>
                )}
              </div>

              {item.wipOrderId && (
                <button
                  type="button"
                  onClick={() => router.push(`/orders/${item.wipOrderId}`)}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.74rem', padding: '4px 9px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <span>Buka SPK</span>
                  <ExternalLink size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

