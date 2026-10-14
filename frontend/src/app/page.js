'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
  Building2,
  Lock,
  ArrowRight,
  TrendingUp,
  AlertCircle
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
        limit: '16'
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
      console.error('Failed to load orders:', err);
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
        return <span className="badge badge-purple" style={{ fontSize: '0.68rem' }}>Master Admin</span>;
      case 'admin':
        return <span className="badge badge-sky" style={{ fontSize: '0.68rem' }}>Admin Internal</span>;
      case 'master_vendor':
        return <span className="badge badge-emerald" style={{ fontSize: '0.68rem' }}>Master Vendor</span>;
      case 'admin_vendor':
        return <span className="badge badge-amber" style={{ fontSize: '0.68rem' }}>Admin Vendor</span>;
      default:
        return null;
    }
  };

  const formatRupiah = (val) => {
    const num = parseFloat(val);
    if (!num || isNaN(num)) return null;
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(num);
  };

  if (!user) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', width: '100%', overflowX: 'hidden' }}>
      {/* Top Navigation */}
      <header className="navbar">
        <div className="brand-badge" style={{ minWidth: 0, flex: 1 }}>
          <div className="brand-icon" style={{ width: '34px', height: '34px', fontSize: '0.95rem' }}>AN</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: '0.96rem', margin: 0, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user.vendor_name || 'Ansania Operations'}
              </h1>
              {getRoleBadge(user.role)}
            </div>
            <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.name}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {user.role === 'master_admin' && (
            <button
              onClick={() => router.push('/admin/users')}
              className="btn btn-secondary"
              style={{ fontSize: '0.78rem', padding: '7px 12px' }}
              title="Kelola Pengguna"
            >
              <Users size={15} />
              <span className="hide-on-mobile">Akun</span>
            </button>
          )}

          <button
            onClick={logout}
            className="btn btn-secondary btn-icon"
            style={{ width: '34px', height: '34px' }}
            title="Keluar"
          >
            <LogOut size={15} color="var(--status-rose)" />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="main-content">
        {/* KPI Summary Cards */}
        <div className="metrics-grid">
          <div className="card metric-card">
            <span className="metric-label" style={{ fontSize: '0.68rem' }}>Total SPK</span>
            <div className="metric-value mono-num" style={{ fontSize: '1.4rem' }}>{totalCount}</div>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Sinkron Odoo</span>
          </div>

          <div className="card metric-card">
            <span className="metric-label" style={{ fontSize: '0.68rem' }}>Perlu Potong</span>
            <div className="metric-value mono-num" style={{ fontSize: '1.4rem', color: 'var(--status-amber)' }}>
              {orders.filter(o => !o.cutting_locked_at && !o.is_backorder).length}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--status-amber)' }}>Halaman ini</span>
          </div>

          <div className="card metric-card">
            <span className="metric-label" style={{ fontSize: '0.68rem' }}>Sedang Jahit</span>
            <div className="metric-value mono-num" style={{ fontSize: '1.4rem', color: 'var(--status-sky)' }}>
              {orders.filter(o => o.cutting_locked_at && !o.result_locked_at).length}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--status-sky)' }}>Halaman ini</span>
          </div>

          <div className="card metric-card">
            <span className="metric-label" style={{ fontSize: '0.68rem' }}>Selesai</span>
            <div className="metric-value mono-num" style={{ fontSize: '1.4rem', color: 'var(--status-emerald)' }}>
              {orders.filter(o => o.result_locked_at).length}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--status-emerald)' }}>Halaman ini</span>
          </div>
        </div>

        {/* Toolbar: Search, Vendor Filter, Status Filter */}
        <div className="card" style={{ padding: '14px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', width: '100%' }}>
              {/* Search Bar */}
              <form onSubmit={handleSearchSubmit} style={{ flex: 1, minWidth: 0, display: 'flex', gap: '6px', width: '100%' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
                  <Search size={15} color="var(--text-muted)" style={{ position: 'absolute', left: '10px' }} />
                  <input
                    type="text"
                    placeholder="Cari MO, produk, SO..."
                    className="input-field"
                    style={{ paddingLeft: '34px', height: '38px', fontSize: '0.84rem' }}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn btn-primary" style={{ height: '38px', padding: '0 14px', fontSize: '0.82rem', flexShrink: 0 }}>
                  Cari
                </button>
              </form>

              {/* Vendor Selector for internal staff */}
              {vendors.length > 0 && (
                <div style={{ width: '100%', minWidth: 0 }}>
                  <select
                    className="select-field"
                    style={{ height: '38px', fontSize: '0.82rem' }}
                    value={selectedVendor}
                    onChange={(e) => {
                      setSelectedVendor(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">Semua Vendor ({vendors.length})</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Status Filter Chips (Fluid Touch Scroll) */}
            <div className="filter-bar">
              <button
                className={`filter-chip ${status === 'all' ? 'active' : ''}`}
                onClick={() => { setStatus('all'); setPage(1); }}
              >
                Semua ({totalCount})
              </button>
              <button
                className={`filter-chip ${status === 'cutting_pending' ? 'active' : ''}`}
                onClick={() => { setStatus('cutting_pending'); setPage(1); }}
              >
                ✂️ Belum Potong
              </button>
              <button
                className={`filter-chip ${status === 'cutting_locked' ? 'active' : ''}`}
                onClick={() => { setStatus('cutting_locked'); setPage(1); }}
              >
                🔒 Sedang Jahit
              </button>
              <button
                className={`filter-chip ${status === 'result_locked' ? 'active' : ''}`}
                onClick={() => { setStatus('result_locked'); setPage(1); }}
              >
                ✅ Selesai
              </button>
            </div>
          </div>
        </div>

        {/* Orders Grid */}
        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: '50px 20px' }}>
            <div className="spinner" style={{ margin: '0 auto 14px auto' }}></div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Memuat data SPK...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '50px 20px' }}>
            <Layers size={36} style={{ margin: '0 auto 10px auto', color: 'var(--text-muted)' }} />
            <h3 style={{ fontSize: '1rem', marginBottom: '4px' }}>Tidak Ada SPK Ditemukan</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              Coba sesuaikan kata kunci pencarian atau ubah filter status di atas.
            </p>
          </div>
        ) : (
          <div className="orders-grid">
            {orders.map((o) => {
              const isBackorder = Boolean(o.is_backorder);
              const isCuttingLocked = Boolean(o.cutting_locked_at) || isBackorder;
              const isResultLocked = Boolean(o.result_locked_at);
              const price = formatRupiah(o.harga_vendor);

              return (
                <div
                  key={o.id}
                  onClick={() => router.push(`/orders/${o.id}`)}
                  className="card card-interactive"
                  style={{
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '12px'
                  }}
                >
                  {/* Top Bar: Reference + Badges */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minWidth: 0 }}>
                        <span className="mono-num" style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                          {o.mo_name}
                        </span>
                        {isBackorder && (
                          <span className="badge badge-purple" style={{ fontSize: '0.65rem' }}>
                            Backorder
                          </span>
                        )}
                      </div>

                      {/* Status Badges */}
                      <div style={{ flexShrink: 0 }}>
                        {isResultLocked ? (
                          <span className="badge badge-emerald" style={{ fontSize: '0.68rem' }}>
                            <CheckCircle2 size={12} /> Selesai
                          </span>
                        ) : isCuttingLocked ? (
                          <span className="badge badge-sky" style={{ fontSize: '0.68rem' }}>
                            <Lock size={12} /> Jahit
                          </span>
                        ) : (
                          <span className="badge badge-amber" style={{ fontSize: '0.68rem' }}>
                            <Scissors size={12} /> Potong
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Product Name */}
                    <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '3px' }}>
                      {o.product_name}
                    </div>

                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      SO: <span className="mono-num">{o.source_document || o.sales_order || '-'}</span>
                    </div>
                  </div>

                  {/* Middle Metrics Row */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '6px',
                      padding: '8px 10px',
                      background: 'var(--bg-card-elevated)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                      textAlign: 'center'
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Target SPK</div>
                      <div className="mono-num" style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {Number(o.qty_target || o.qty_spk || 0).toLocaleString('id-ID')} <span style={{ fontSize: '0.7rem', fontWeight: 400 }}>pcs</span>
                      </div>
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Hasil Jahit</div>
                      <div className="mono-num" style={{ fontSize: '0.88rem', fontWeight: 700, color: isResultLocked ? 'var(--status-emerald)' : 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {isResultLocked ? Number(o.qty_grade_a || 0).toLocaleString('id-ID') : '-'}
                      </div>
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Kain</div>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: o.status_kebutuhan_kain === 'Cukup' ? 'var(--status-emerald)' : 'var(--status-amber)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {o.status_kebutuhan_kain || 'Cukup'}
                      </div>
                    </div>
                  </div>

                  {/* Bottom Footer: Vendor & Price */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '2px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.78rem', color: 'var(--text-secondary)', minWidth: 0 }}>
                      <Building2 size={13} color="var(--brand-gold)" style={{ flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.vendor_name}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      {price && (
                        <div className="mono-num" style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--brand-gold)' }}>
                          {price}
                        </div>
                      )}
                      <div style={{ color: 'var(--text-muted)' }}>
                        <ChevronRight size={16} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn btn-secondary"
              style={{ padding: '7px 14px', fontSize: '0.8rem' }}
            >
              Prev
            </button>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              <strong className="mono-num" style={{ color: 'var(--text-primary)' }}>{page}</strong> / <strong className="mono-num">{totalPages}</strong>
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="btn btn-secondary"
              style={{ padding: '7px 14px', fontSize: '0.8rem' }}
            >
              Next
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
