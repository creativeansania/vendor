'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Plus,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Edit3,
  Power,
  KeyRound,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Link2
} from 'lucide-react';
import { fetchApi, ensureCurrentUser, logout } from '@/lib/api';
import ThemeToggle from '@/components/ThemeToggle';
import BuyerFormModal from '@/components/admin/BuyerFormModal';
import { formatIntId, formatPctId, formatSyncedAtWib } from '@/lib/buyerDashboardClient';

export default function AdminBuyersPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState(null);
  const [dashboards, setDashboards] = useState([]);
  const [odooPartners, setOdooPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingPartners, setLoadingPartners] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshingToken, setRefreshingToken] = useState(null);
  const [copiedToken, setCopiedToken] = useState(null);
  const [feedback, setFeedback] = useState({ text: '', type: '' });

  const [modalState, setModalState] = useState({
    open: false,
    mode: 'create',
    item: null
  });

  const loadDashboards = useCallback(async (withPartners = false) => {
    setLoading(true);
    try {
      const qs = withPartners ? '?include_partners=1' : '';
      const res = await fetchApi(`/admin/buyers${qs}`);
      setDashboards(res.dashboards || []);
      if (withPartners && Array.isArray(res.odoo_partners)) {
        setOdooPartners(res.odoo_partners);
      }
    } catch (err) {
      setFeedback({ text: 'Gagal memuat daftar link buyer: ' + err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  const ensurePartnersLoaded = useCallback(async () => {
    if (odooPartners.length > 0) return;
    setLoadingPartners(true);
    try {
      const res = await fetchApi('/admin/buyers?include_partners=1');
      if (Array.isArray(res.odoo_partners)) {
        setOdooPartners(res.odoo_partners);
      }
    } catch (err) {
      setFeedback({ text: 'Gagal memuat daftar Customer Odoo: ' + err.message, type: 'error' });
    } finally {
      setLoadingPartners(false);
    }
  }, [odooPartners.length]);

  useEffect(() => {
    let active = true;
    ensureCurrentUser().then((u) => {
      if (!active) return;
      if (!u) {
        logout();
        return;
      }
      if (!['master_admin', 'admin'].includes(u.role)) {
        router.replace('/');
        return;
      }
      setCurrentUser(u);
      loadDashboards(false);
    });
    return () => {
      active = false;
    };
  }, [router, loadDashboards]);

  const buildShareUrl = (token) => {
    if (typeof window === 'undefined') return `/buyer/${token}`;
    return `${window.location.origin}/buyer/${token}`;
  };

  const handleCopyLink = async (token) => {
    const url = buildShareUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken((prev) => (prev === token ? null : prev)), 2000);
    } catch {
      window.prompt('Salin link dashboard buyer:', url);
    }
  };

  const handleOpenCreate = () => {
    setModalState({ open: true, mode: 'create', item: null });
    ensurePartnersLoaded();
  };

  const handleOpenEdit = (item) => {
    setModalState({ open: true, mode: 'edit', item });
    ensurePartnersLoaded();
  };

  const handleModalSubmit = async (payload) => {
    setSubmitting(true);
    setFeedback({ text: '', type: '' });
    try {
      if (modalState.mode === 'edit' && modalState.item) {
        await fetchApi(`/admin/buyers/${encodeURIComponent(modalState.item.token)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        setFeedback({ text: `Link dashboard ${payload.buyer_name} berhasil diperbarui.`, type: 'success' });
      } else {
        const res = await fetchApi('/admin/buyers', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        setFeedback({
          text: res.sync_warning
            ? `Link dibuat, namun sinkronisasi awal tertunda: ${res.sync_warning}`
            : `Link dashboard ${payload.buyer_name} berhasil dibuat & disinkronkan!`,
          type: 'success'
        });
      }
      setModalState({ open: false, mode: 'create', item: null });
      await loadDashboards(false);
    } catch (err) {
      setFeedback({ text: err.message || 'Gagal menyimpan konfigurasi.', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefreshNow = async (item) => {
    setRefreshingToken(item.token);
    setFeedback({ text: '', type: '' });
    try {
      const res = await fetchApi(`/admin/buyers/${encodeURIComponent(item.token)}/refresh`, {
        method: 'POST'
      });
      setFeedback({
        text: `Data ${item.buyer_name} selesai disinkronkan (${formatIntId(res.summary?.total_items || 0)} item dalam ${((res.sync_duration_ms || 0) / 1000).toFixed(1)} dtk).`,
        type: 'success'
      });
      await loadDashboards(false);
    } catch (err) {
      setFeedback({ text: 'Gagal sinkronisasi: ' + err.message, type: 'error' });
    } finally {
      setRefreshingToken(null);
    }
  };

  const handleToggleActive = async (item) => {
    try {
      await fetchApi(`/admin/buyers/${encodeURIComponent(item.token)}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !item.is_active })
      });
      setFeedback({
        text: `${item.buyer_name} berhasil ${!item.is_active ? 'diaktifkan' : 'dinonaktifkan'}.`,
        type: 'success'
      });
      await loadDashboards(false);
    } catch (err) {
      setFeedback({ text: err.message, type: 'error' });
    }
  };

  const handleRotateToken = async (item) => {
    if (
      !window.confirm(
        `Reset link rahasia untuk ${item.buyer_name}? Link lama langsung tidak bisa diakses dan Anda perlu membagikan link baru ke buyer.`
      )
    ) {
      return;
    }
    try {
      await fetchApi(`/admin/buyers/${encodeURIComponent(item.token)}`, {
        method: 'PATCH',
        body: JSON.stringify({ rotate_token: true })
      });
      setFeedback({
        text: `Link rahasia ${item.buyer_name} telah direset. Silakan salin link baru.`,
        type: 'success'
      });
      await loadDashboards(false);
    } catch (err) {
      setFeedback({ text: err.message, type: 'error' });
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Hapus permanen link dashboard untuk ${item.buyer_name}?`)) {
      return;
    }
    try {
      await fetchApi(`/admin/buyers/${encodeURIComponent(item.token)}`, {
        method: 'DELETE'
      });
      setFeedback({ text: `Link dashboard ${item.buyer_name} telah dihapus.`, type: 'success' });
      await loadDashboards(false);
    } catch (err) {
      setFeedback({ text: err.message, type: 'error' });
    }
  };

  if (!currentUser) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', width: '100%', overflowX: 'clip' }}>
      <header className="navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
          <button
            onClick={() => router.push('/')}
            className="btn btn-secondary btn-icon"
            style={{ flexShrink: 0 }}
            title="Kembali ke Dashboard"
          >
            <ArrowLeft size={18} />
          </button>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: '0.98rem', margin: 0, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Link Dashboard Buyer External
            </h1>
            <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              Kelola 1 link monitoring WIP khusus per buyer · Auto-sync tiap 15 menit
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <ThemeToggle />
          <button
            onClick={handleOpenCreate}
            className="btn btn-primary"
            style={{ fontSize: '0.8rem', padding: '7px 12px' }}
          >
            <Plus size={15} />
            <span>Buat Link Buyer</span>
          </button>
        </div>
      </header>

      <main className="main-content">
        {feedback.text && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.84rem',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              background: feedback.type === 'success' ? 'var(--status-emerald-bg)' : 'var(--status-rose-bg)',
              border: `1px solid ${feedback.type === 'success' ? 'var(--status-emerald-border)' : 'var(--status-rose-border)'}`,
              color: feedback.type === 'success' ? 'var(--status-emerald)' : 'var(--status-rose)'
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

        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: '52px 20px' }}>
            <div className="spinner" style={{ margin: '0 auto 14px' }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Memuat daftar link dashboard buyer...
            </p>
          </div>
        ) : dashboards.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '52px 20px' }}>
            <Link2 size={32} style={{ color: 'var(--text-muted)', marginBottom: '10px' }} />
            <h2 style={{ fontSize: '1rem', marginBottom: '6px' }}>Belum Ada Link Buyer External</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', marginBottom: '16px' }}>
              Buat link monitoring WIP per buyer agar buyer bisa memantau progres PO tanpa login &amp; tanpa update spreadsheet manual.
            </p>
            <button onClick={handleOpenCreate} className="btn btn-primary">
              <Plus size={16} />
              Buat Link Buyer Pertama
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '14px' }}>
            {dashboards.map((item) => {
              const shareUrl = buildShareUrl(item.token);
              const summary = item.last_summary;
              const isRefreshing = refreshingToken === item.token;
              const isCopied = copiedToken === item.token;

              return (
                <div
                  key={item.token}
                  className="card"
                  style={{
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    opacity: item.is_active ? 1 : 0.72
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <div style={{ minWidth: 0 }}>
                      <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 700 }}>
                        {item.buyer_name}
                      </h3>
                      <p style={{ margin: '3px 0 0', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                        Partner Odoo: {(item.odoo_partner_names?.length ? item.odoo_partner_names : item.odoo_partner_ids.map((id) => `#${id}`)).join(', ')}
                      </p>
                    </div>
                    <span
                      style={{
                        padding: '3px 9px',
                        borderRadius: '999px',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        flexShrink: 0,
                        background: item.is_active ? 'var(--status-emerald-bg)' : 'var(--status-rose-bg)',
                        color: item.is_active ? 'var(--status-emerald)' : 'var(--status-rose)',
                        border: `1px solid ${item.is_active ? 'var(--status-emerald-border)' : 'var(--status-rose-border)'}`
                      }}
                    >
                      {item.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </div>

                  {/* Cached Summary Metrics */}
                  {summary ? (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: '8px',
                        padding: '10px',
                        borderRadius: '8px',
                        background: 'var(--bg-card-subtle)',
                        border: '1px solid var(--border-subtle)'
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Item PO</div>
                        <div className="tabular" style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                          {formatIntId(summary.total_items)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Qty PO</div>
                        <div className="tabular" style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                          {formatIntId(summary.total_qty_po)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>% Selesai</div>
                        <div className="tabular" style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                          {formatPctId(summary.pct_finish)}%
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                      Belum ada snapshot tersimpan. Klik Refresh atau buka link untuk sinkronisasi.
                    </div>
                  )}

                  {/* Shareable Link Box */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '7px 9px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-default)',
                      background: 'var(--bg-input)'
                    }}
                  >
                    <input
                      type="text"
                      readOnly
                      value={shareUrl}
                      onFocus={(e) => e.target.select()}
                      style={{
                        flex: 1,
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--text-secondary)',
                        fontSize: '0.75rem',
                        fontFamily: "'JetBrains Mono', monospace",
                        outline: 'none',
                        minWidth: 0
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '5px 9px', fontSize: '0.74rem' }}
                      onClick={() => handleCopyLink(item.token)}
                    >
                      {isCopied ? <Check size={13} color="var(--status-emerald)" /> : <Copy size={13} />}
                      {isCopied ? 'Disalin' : 'Salin'}
                    </button>
                  </div>

                  {/* Metadata & Actions */}
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {item.last_synced_at
                      ? `Sync terakhir: ${formatSyncedAtWib(item.last_synced_at)}`
                      : 'Belum pernah sinkronisasi'}
                    {item.start_date ? ` · Mulai ${item.start_date}` : ''}
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: 'auto' }}>
                    <a
                      href={`/buyer/${item.token}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-primary"
                      style={{ fontSize: '0.76rem', padding: '6px 10px', textDecoration: 'none' }}
                    >
                      <ExternalLink size={13} />
                      Buka
                    </a>

                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: '0.76rem', padding: '6px 10px' }}
                      onClick={() => handleRefreshNow(item)}
                      disabled={isRefreshing}
                    >
                      <RefreshCw size={13} className={isRefreshing ? 'spin' : ''} />
                      {isRefreshing ? 'Sync...' : 'Refresh'}
                    </button>

                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: '0.76rem', padding: '6px 9px' }}
                      onClick={() => handleOpenEdit(item)}
                      title="Edit konfigurasi buyer"
                    >
                      <Edit3 size={13} />
                    </button>

                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: '0.76rem', padding: '6px 9px' }}
                      onClick={() => handleToggleActive(item)}
                      title={item.is_active ? 'Nonaktifkan link sementara' : 'Aktifkan link kembali'}
                    >
                      <Power size={13} color={item.is_active ? 'var(--status-amber)' : 'var(--status-emerald)'} />
                    </button>

                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: '0.76rem', padding: '6px 9px' }}
                      onClick={() => handleRotateToken(item)}
                      title="Reset / buat token link baru"
                    >
                      <KeyRound size={13} />
                    </button>

                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: '0.76rem', padding: '6px 9px', marginLeft: 'auto' }}
                      onClick={() => handleDelete(item)}
                      title="Hapus link buyer"
                    >
                      <Trash2 size={13} color="var(--status-rose)" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <BuyerFormModal
        key={modalState.open ? `${modalState.mode}-${modalState.item?.token || 'new'}` : 'closed'}
        open={modalState.open}
        mode={modalState.mode}
        initialData={modalState.item}
        odooPartners={odooPartners}
        loadingPartners={loadingPartners}
        submitting={submitting}
        onClose={() => setModalState({ open: false, mode: 'create', item: null })}
        onSubmit={handleModalSubmit}
      />
    </div>
  );
}
