'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi, getCurrentUser, logout } from '@/lib/api';
import {
  Search,
  Filter,
  LogOut,
  Scissors,
  CheckCircle2,
  Clock,
  Layers,
  Users,
  ChevronRight,
  RefreshCw,
  Sparkles,
  Lock
} from 'lucide-react';

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedVendor, setSelectedVendor] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Check auth
  useEffect(() => {
    const u = getCurrentUser();
    if (!u) {
      router.push('/login');
    } else {
      setUser(u);
    }
  }, [router]);

  // Load vendors list if admin/master_admin
  useEffect(() => {
    if (user && ['master_admin', 'admin'].includes(user.role)) {
      fetchApi('/pwa/vendors')
        .then((res) => {
          if (res.success) setVendors(res.vendors || []);
        })
        .catch(() => {});
    }
  }, [user]);

  // Fetch orders
  const loadOrders = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const queryParams = new URLSearchParams({
        page: String(page),
        limit: '15'
      });
      if (search.trim()) queryParams.set('search', search.trim());
      if (status !== 'all') queryParams.set('status', status);
      if (selectedVendor) queryParams.set('vendorId', selectedVendor);

      const res = await fetchApi(`/pwa/orders?${queryParams.toString()}`);
      if (res.success) {
        setOrders(res.orders || []);
        setTotalPages(res.pagination?.totalPages || 1);
        setTotalCount(res.pagination?.total || 0);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [user, page, search, status, selectedVendor]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    loadOrders();
  };

  const getRoleBadge = (role) => {
    switch (role) {
      case 'master_admin':
        return <span className="badge badge-rose">Master Admin</span>;
      case 'admin':
        return <span className="badge badge-cyan">Admin Internal</span>;
      case 'master_vendor':
        return <span className="badge badge-indigo">Master Vendor</span>;
      case 'admin_vendor':
        return <span className="badge badge-amber">Admin Vendor</span>;
      default:
        return null;
    }
  };

  if (!user) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', paddingBottom: '32px' }}>
      {/* Top Header */}
      <header className="app-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '1.15rem' }}>{user.vendor_name || 'Ansania Internal'}</h2>
            {getRoleBadge(user.role)}
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Halo, <strong>{user.name}</strong>
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {user.role === 'master_admin' && (
            <button
              onClick={() => router.push('/admin/users')}
              className="btn btn-secondary"
              style={{ padding: '8px 12px', minHeight: '36px', fontSize: '0.8rem' }}
              title="Kelola Akun"
            >
              <Users size={16} />
              <span>Akun</span>
            </button>
          )}

          <button
            onClick={logout}
            className="btn btn-secondary"
            style={{ padding: '8px 10px', minHeight: '36px' }}
            title="Keluar"
          >
            <LogOut size={16} color="#fb7185" />
          </button>
        </div>
      </header>

      {/* Main Body */}
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Search & Vendor Filter */}
        <div className="glass-card" style={{ padding: '12px 14px' }}>
          <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '8px', marginBottom: vendors.length > 0 ? '10px' : '0' }}>
            <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
              <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '12px' }} />
              <input
                type="text"
                placeholder="Cari MO / Produk / SO..."
                className="input-field"
                style={{ paddingLeft: '36px', height: '38px', minHeight: '38px', fontSize: '0.875rem', width: '100%' }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ height: '38px', minHeight: '38px', padding: '0 14px', fontSize: '0.85rem' }}
            >
              Cari
            </button>
          </form>

          {/* Vendor Filter for Internal & Master Admin */}
          {vendors.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)' }}>
              <Filter size={14} color="var(--text-muted)" />
              <select
                className="input-field"
                style={{ height: '34px', minHeight: '34px', padding: '0 10px', fontSize: '0.8rem', flex: 1 }}
                value={selectedVendor}
                onChange={(e) => {
                  setSelectedVendor(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Semua Vendor ({vendors.length})</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Status Filter Tabs */}
        <div className="tabs-scroll">
          <button
            className={`tab-pill ${status === 'all' ? 'active' : ''}`}
            onClick={() => { setStatus('all'); setPage(1); }}
          >
            Semua ({totalCount})
          </button>
          <button
            className={`tab-pill ${status === 'cutting_pending' ? 'active' : ''}`}
            onClick={() => { setStatus('cutting_pending'); setPage(1); }}
          >
            ✂️ Perlu Timbang
          </button>
          <button
            className={`tab-pill ${status === 'cutting_locked' ? 'active' : ''}`}
            onClick={() => { setStatus('cutting_locked'); setPage(1); }}
          >
            🔒 Potong Terkunci
          </button>
          <button
            className={`tab-pill ${status === 'result_locked' ? 'active' : ''}`}
            onClick={() => { setStatus('result_locked'); setPage(1); }}
          >
            ✅ Hasil Terkunci
          </button>
        </div>

        {/* Orders List */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
            <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 10px auto' }} />
            <p style={{ fontSize: '0.85rem' }}>Memuat data SPK...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="glass-card" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
            <Layers size={36} style={{ margin: '0 auto 12px auto', opacity: 0.4 }} />
            <h4 style={{ color: 'var(--text-primary)', marginBottom: '4px' }}>Tidak Ada SPK Ditemukan</h4>
            <p style={{ fontSize: '0.825rem' }}>Coba ubah kata kunci pencarian atau filter status.</p>
          </div>
        ) : (
          orders.map((o) => {
            const isBahanCukup = o.status_kebutuhan_kain === 'Cukup';
            const isCuttingLocked = Boolean(o.cutting_locked_at) || Boolean(o.is_backorder);
            const isResultLocked = Boolean(o.result_locked_at);

            return (
              <div
                key={o.id}
                onClick={() => router.push(`/orders/${o.id}`)}
                className="glass-card glass-card-interactive"
                style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '10px' }}
              >
                {/* Header: MO Name & Badges */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                      <h3 style={{ fontSize: '1.05rem', color: '#ffffff' }}>{o.mo_name}</h3>
                      {o.is_backorder ? (
                        <span className="badge badge-indigo" style={{ fontSize: '0.65rem' }}>Backorder</span>
                      ) : null}
                    </div>
                    {['master_admin', 'admin'].includes(user.role) && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)' }}>{o.vendor_name}</p>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                    <span className={`badge ${isBahanCukup ? 'badge-emerald' : 'badge-amber'}`}>
                      {isBahanCukup ? 'Bahan Cukup' : 'Bahan Kurang'}
                    </span>
                    {isResultLocked ? (
                      <span className="badge badge-emerald" style={{ fontSize: '0.65rem' }}>
                        <Lock size={10} /> Hasil Jahit Selesai
                      </span>
                    ) : isCuttingLocked ? (
                      <span className="badge badge-cyan" style={{ fontSize: '0.65rem' }}>
                        <Lock size={10} /> Potong Terkunci
                      </span>
                    ) : (
                      <span className="badge badge-amber" style={{ fontSize: '0.65rem' }}>
                        <Scissors size={10} /> Siap Timbang
                      </span>
                    )}
                  </div>
                </div>

                {/* Product Name */}
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.3 }}>
                  {o.product_name || 'Produk tanpa nama'}
                </p>

                {/* Key Metrics Row */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '8px',
                  background: 'rgba(0, 0, 0, 0.25)',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-md)'
                }}>
                  <div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Target SPK</span>
                    <p style={{ fontSize: '0.9rem', fontWeight: 700 }}>{Number(o.qty_spk).toLocaleString('id-ID')} pcs</p>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Kain Gudang</span>
                    <p style={{ fontSize: '0.9rem', fontWeight: 700 }}>{Number(o.kain_dari_gudang).toLocaleString('id-ID')} {o.unit_kain || 'yd'}</p>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Hasil Potong</span>
                    <p style={{ fontSize: '0.9rem', fontWeight: 700, color: o.actual_cutting > 0 ? '#34d399' : 'var(--text-muted)' }}>
                      {o.actual_cutting > 0 ? `${Number(o.actual_cutting).toLocaleString('id-ID')} kg` : '-'}
                    </p>
                  </div>
                </div>

                {/* Bottom Row: Price & Tap cue */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '2px' }}>
                  {user.role !== 'admin_vendor' && Number(o.harga_vendor) > 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Tarif:</span>
                      <strong style={{ fontSize: '0.85rem', color: '#38bdf8' }}>
                        Rp {Number(o.harga_vendor).toLocaleString('id-ID')} / pcs
                      </strong>
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      SO: {o.sales_order || '-'}
                    </span>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: '2px', color: 'var(--accent-cyan)', fontSize: '0.8rem', fontWeight: 600 }}>
                    <span>Detail SPK</span>
                    <ChevronRight size={16} />
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
            <button
              className="btn btn-secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              style={{ fontSize: '0.8rem', padding: '6px 14px', minHeight: '36px' }}
            >
              Sebelumnya
            </button>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Halaman {page} dari {totalPages}
            </span>
            <button
              className="btn btn-secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              style={{ fontSize: '0.8rem', padding: '6px 14px', minHeight: '36px' }}
            >
              Selanjutnya
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
