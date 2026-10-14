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
        return <span className="badge badge-purple">Master Admin</span>;
      case 'admin':
        return <span className="badge badge-sky">Admin Internal</span>;
      case 'master_vendor':
        return <span className="badge badge-emerald">Master Vendor</span>;
      case 'admin_vendor':
        return <span className="badge badge-amber">Admin Vendor</span>;
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
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', paddingBottom: '48px' }}>
      {/* Top Navigation */}
      <header className="navbar">
        <div className="brand-badge">
          <div className="brand-icon">AN</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: '1.05rem', margin: 0, fontWeight: 700 }}>
                {user.vendor_name || 'Ansania Operations'}
              </h1>
              {getRoleBadge(user.role)}
            </div>
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Operator: <strong style={{ color: 'var(--text-primary)' }}>{user.name}</strong>
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {user.role === 'master_admin' && (
            <button
              onClick={() => router.push('/admin/users')}
              className="btn btn-secondary"
              style={{ fontSize: '0.82rem', padding: '8px 14px' }}
            >
              <Users size={16} />
              <span>Kelola Akun</span>
            </button>
          )}

          <button
            onClick={logout}
            className="btn btn-secondary btn-icon"
            title="Keluar dari Akun"
          >
            <LogOut size={16} color="var(--status-rose)" />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main style={{ padding: '20px 20px 0', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* KPI Summary Cards */}
        <div className="metrics-grid">
          <div className="card metric-card">
            <span className="metric-label">Total SPK Terdaftar</span>
            <div className="metric-value mono-num">{totalCount}</div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Sinkron Odoo real-time</span>
          </div>

          <div className="card metric-card">
            <span className="metric-label">Perlu Timbang Potong</span>
            <div className="metric-value mono-num" style={{ color: 'var(--status-amber)' }}>
              {orders.filter(o => !o.cutting_locked_at && !o.is_backorder).length}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--status-amber)' }}>Halaman ini</span>
          </div>

          <div className="card metric-card">
            <span className="metric-label">Sedang Proses Jahit</span>
            <div className="metric-value mono-num" style={{ color: 'var(--status-sky)' }}>
              {orders.filter(o => o.cutting_locked_at && !o.result_locked_at).length}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--status-sky)' }}>Halaman ini</span>
          </div>

          <div className="card metric-card">
            <span className="metric-label">Selesai / Terkunci</span>
            <div className="metric-value mono-num" style={{ color: 'var(--status-emerald)' }}>
              {orders.filter(o => o.result_locked_at).length}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--status-emerald)' }}>Halaman ini</span>
          </div>
        </div>

        {/* Toolbar: Search, Vendor Filter, Status Filter */}
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {/* Search Bar */}
              <form onSubmit={handleSearchSubmit} style={{ flex: 1, minWidth: '260px', display: 'flex', gap: '8px' }}>
                <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
                  <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '12px' }} />
                  <input
                    type="text"
                    placeholder="Cari nomor SPK (MO), nama produk, atau nomor SO..."
                    className="input-field"
                    style={{ paddingLeft: '38px', height: '40px' }}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn btn-primary" style={{ height: '40px', padding: '0 18px' }}>
                  Cari
                </button>
              </form>

              {/* Vendor Selector for internal staff */}
              {vendors.length > 0 && (
                <div style={{ minWidth: '220px', display: 'flex', alignItems: 'center' }}>
                  <select
                    className="select-field"
                    style={{ height: '40px' }}
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

            {/* Status Filter Chips */}
            <div className="filter-bar">
              <button
                className={`filter-chip ${status === 'all' ? 'active' : ''}`}
                onClick={() => { setStatus('all'); setPage(1); }}
              >
                Semua SPK ({totalCount})
              </button>
              <button
                className={`filter-chip ${status === 'cutting_pending' ? 'active' : ''}`}
                onClick={() => { setStatus('cutting_pending'); setPage(1); }}
              >
                ✂️ Belum Timbang Potong
              </button>
              <button
                className={`filter-chip ${status === 'cutting_locked' ? 'active' : ''}`}
                onClick={() => { setStatus('cutting_locked'); setPage(1); }}
              >
                🔒 Sedang Jahit (Potong Terkunci)
              </button>
              <button
                className={`filter-chip ${status === 'result_locked' ? 'active' : ''}`}
                onClick={() => { setStatus('result_locked'); setPage(1); }}
              >
                ✅ Selesai (Hasil Jahit Terkunci)
              </button>
            </div>
          </div>
        </div>

        {/* Orders Grid */}
        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div className="spinner" style={{ margin: '0 auto 16px auto' }}></div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Memuat data SPK dari cache database...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
            <Layers size={42} style={{ margin: '0 auto 12px auto', color: 'var(--text-muted)' }} />
            <h3 style={{ fontSize: '1.1rem', marginBottom: '6px' }}>Tidak Ada SPK Ditemukan</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
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
                    padding: '18px 20px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '14px'
                  }}
                >
                  {/* Top Bar: Reference + Badges */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span className="mono-num" style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {o.mo_name}
                        </span>
                        {isBackorder && (
                          <span className="badge badge-purple" style={{ fontSize: '0.7rem' }}>
                            Backorder
                          </span>
                        )}
                      </div>

                      {/* Status Badges */}
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {isResultLocked ? (
                          <span className="badge badge-emerald">
                            <CheckCircle2 size={13} /> Selesai
                          </span>
                        ) : isCuttingLocked ? (
                          <span className="badge badge-sky">
                            <Lock size={13} /> Sedang Jahit
                          </span>
                        ) : (
                          <span className="badge badge-amber">
                            <Scissors size={13} /> Perlu Timbang
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Product Name */}
                    <div style={{ fontSize: '0.98rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                      {o.product_name}
                    </div>

                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      SO: <span className="mono-num">{o.source_document || '-'}</span>
                    </div>
                  </div>

                  {/* Middle Metrics Row */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '8px',
                      padding: '10px 12px',
                      background: 'var(--bg-card-elevated)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Target SPK</div>
                      <div className="mono-num" style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {Number(o.qty_target).toLocaleString('id-ID')} <span style={{ fontSize: '0.75rem', fontWeight: 400 }}>pcs</span>
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Hasil Jahit</div>
                      <div className="mono-num" style={{ fontSize: '0.95rem', fontWeight: 700, color: isResultLocked ? 'var(--status-emerald)' : 'var(--text-secondary)' }}>
                        {isResultLocked ? Number(o.qty_grade_a || 0).toLocaleString('id-ID') : '-'}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Status Kain</div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: o.status_kebutuhan_kain === 'Cukup' ? 'var(--status-emerald)' : 'var(--status-amber)' }}>
                        {o.status_kebutuhan_kain || 'Cukup'}
                      </div>
                    </div>
                  </div>

                  {/* Bottom Footer: Vendor & Price */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      <Building2 size={14} color="var(--brand-gold)" />
                      <span>{o.vendor_name}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {price && (
                        <div className="mono-num" style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--brand-gold)' }}>
                          {price}
                        </div>
                      )}
                      <div style={{ color: 'var(--text-muted)' }}>
                        <ChevronRight size={18} />
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
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '10px' }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn btn-secondary"
              style={{ padding: '8px 16px' }}
            >
              Sebelumnya
            </button>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Halaman <strong className="mono-num" style={{ color: 'var(--text-primary)' }}>{page}</strong> dari <strong className="mono-num">{totalPages}</strong>
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="btn btn-secondary"
              style={{ padding: '8px 16px' }}
            >
              Selanjutnya
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
