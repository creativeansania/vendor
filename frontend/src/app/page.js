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
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  RefreshCw,
  Building2,
  Lock,
  ArrowRight,
  TrendingUp,
  AlertCircle,
  X
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

  const handleClearSearch = () => {
    setSearch('');
    setPage(1);
  };

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > totalPages || newPage === page) return;
    setPage(newPage);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const pageNumbers = useMemo(() => {
    if (totalPages <= 1) return [];

    const delta = 1; // Number of pages around current page
    const range = [];
    const rangeWithDots = [];
    let prev;

    for (let i = 1; i <= totalPages; i++) {
      if (
        i === 1 ||
        i === totalPages ||
        (i >= page - delta && i <= page + delta) ||
        (page <= 3 && i <= 5) ||
        (page >= totalPages - 2 && i >= totalPages - 4)
      ) {
        range.push(i);
      }
    }

    const uniqueRange = Array.from(new Set(range)).sort((a, b) => a - b);

    for (let i of uniqueRange) {
      if (prev) {
        if (i - prev === 2) {
          rangeWithDots.push(prev + 1);
        } else if (i - prev !== 1) {
          rangeWithDots.push('...');
        }
      }
      rangeWithDots.push(i);
      prev = i;
    }

    return rangeWithDots;
  }, [page, totalPages]);

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
          <div className="brand-icon" style={{ width: '36px', height: '36px', fontSize: '1rem', borderRadius: '10px' }}>
            AN
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: '0.98rem', margin: 0, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user.vendor_name || 'Ansania Operations'}
              </h1>
              {getRoleBadge(user.role)}
            </div>
            <p style={{ margin: '1px 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.name}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {user.role === 'master_admin' && (
            <button
              onClick={() => router.push('/admin/users')}
              className="btn btn-secondary"
              style={{ fontSize: '0.78rem', padding: '7px 12px', borderRadius: '10px' }}
              title="Kelola Pengguna"
            >
              <Users size={15} />
              <span className="hide-on-mobile">Akun</span>
            </button>
          )}

          <button
            onClick={logout}
            className="btn btn-secondary btn-icon"
            style={{ width: '36px', height: '36px', borderRadius: '10px' }}
            title="Keluar"
          >
            <LogOut size={16} color="var(--status-rose)" />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="main-content">
        {/* KPI Summary Cards */}
        <div className="metrics-grid">
          {/* Card 1: Total SPK */}
          <div className="card metric-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="metric-label" style={{ fontSize: '0.68rem' }}>Total SPK</span>
              <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Layers size={14} />
              </div>
            </div>
            <div className="metric-value mono-num" style={{ fontSize: '1.5rem' }}>{totalCount}</div>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Sinkron Odoo</span>
          </div>

          {/* Card 2: Perlu Potong */}
          <div className="card metric-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="metric-label" style={{ fontSize: '0.68rem', color: 'var(--brand-gold)' }}>Perlu Potong</span>
              <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: '#fffbeb', color: '#d97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Scissors size={14} />
              </div>
            </div>
            <div className="metric-value mono-num" style={{ fontSize: '1.5rem', color: 'var(--brand-gold)' }}>
              {orders.filter(o => !o.cutting_locked_at && !o.is_backorder).length}
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--brand-gold)' }}>Halaman ini</span>
          </div>

          {/* Card 3: Sedang Jahit */}
          <div className="card metric-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="metric-label" style={{ fontSize: '0.68rem', color: 'var(--status-sky)' }}>Sedang Jahit</span>
              <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: '#f0f9ff', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Lock size={14} />
              </div>
            </div>
            <div className="metric-value mono-num" style={{ fontSize: '1.5rem', color: 'var(--status-sky)' }}>
              {orders.filter(o => o.cutting_locked_at && !o.result_locked_at).length}
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--status-sky)' }}>Halaman ini</span>
          </div>

          {/* Card 4: Selesai */}
          <div className="card metric-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="metric-label" style={{ fontSize: '0.68rem', color: 'var(--status-emerald)' }}>Selesai</span>
              <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: '#ecfdf5', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircle2 size={14} />
              </div>
            </div>
            <div className="metric-value mono-num" style={{ fontSize: '1.5rem', color: 'var(--status-emerald)' }}>
              {orders.filter(o => o.result_locked_at).length}
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--status-emerald)' }}>Halaman ini</span>
          </div>
        </div>

        {/* Toolbar: Search, Vendor Filter, Status Filter */}
        <div className="card" style={{ padding: '16px', borderRadius: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', width: '100%' }}>
              {/* Search Bar */}
              <form onSubmit={handleSearchSubmit} style={{ flex: 1, minWidth: 0, display: 'flex', gap: '8px', width: '100%' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
                  <Search size={18} color="var(--text-muted)" style={{ position: 'absolute', left: '14px', pointerEvents: 'none' }} />
                  <input
                    type="text"
                    placeholder="Ketik 4 angka nomor SPK (misal: 1495) atau nama produk..."
                    className="input-field"
                    style={{
                      paddingLeft: '40px',
                      paddingRight: search ? '40px' : '14px',
                      height: '44px',
                      fontSize: '0.92rem',
                      borderRadius: '12px',
                      fontWeight: 500
                    }}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={handleClearSearch}
                      style={{
                        position: 'absolute',
                        right: '10px',
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        background: '#f1f5f9',
                        border: '1px solid #cbd5e1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        color: '#475569',
                        transition: 'all 0.15s ease'
                      }}
                      title="Hapus ketikan pencarian"
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ height: '44px', padding: '0 20px', fontSize: '0.9rem', flexShrink: 0, borderRadius: '12px', fontWeight: 700 }}
                >
                  Cari
                </button>
              </form>

              {/* Vendor Selector for internal staff */}
              {vendors.length > 0 && (
                <div style={{ width: '100%', minWidth: 0 }}>
                  <select
                    className="select-field"
                    style={{ height: '44px', fontSize: '0.88rem', borderRadius: '12px' }}
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

            {/* Active Search Filter Banner */}
            {search.trim() && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 14px',
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '10px',
                  fontSize: '0.84rem',
                  flexWrap: 'wrap',
                  gap: '8px'
                }}
              >
                <div style={{ color: '#92400e', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>Hasil pencarian:</span>
                  <strong className="mono-num" style={{ background: '#ffffff', padding: '2px 8px', borderRadius: '6px', border: '1px solid #fde68a' }}>
                    "{search.trim()}"
                  </strong>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>({totalCount} SPK ditemukan)</span>
                </div>
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="quick-action-pill"
                  style={{
                    fontSize: '0.74rem',
                    background: '#ffffff',
                    borderColor: '#f59e0b',
                    color: '#b45309',
                    height: '28px'
                  }}
                  title="Kembali ke semua SPK"
                >
                  <X size={13} />
                  <span>Bersihkan & Lihat Semua</span>
                </button>
              </div>
            )}

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
          <div className="card" style={{ textAlign: 'center', padding: '60px 20px', borderRadius: '16px' }}>
            <div className="spinner" style={{ margin: '0 auto 16px auto' }}></div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', fontWeight: 600 }}>Memuat data SPK...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '60px 20px', borderRadius: '16px' }}>
            <Layers size={40} style={{ margin: '0 auto 12px auto', color: 'var(--text-muted)' }} />
            <h3 style={{ fontSize: '1.05rem', marginBottom: '6px', fontWeight: 800 }}>Tidak Ada SPK Ditemukan</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', maxWidth: '440px', margin: '0 auto' }}>
              {search.trim()
                ? `Tidak ditemukan SPK yang cocok dengan "${search.trim()}". Cukup ketik 4 angka belakang nomor SPK (contoh: 1495) atau tekan tombol di bawah.`
                : 'Coba sesuaikan kata kunci pencarian atau ubah filter status di atas.'}
            </p>
            {search.trim() && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="btn btn-secondary"
                style={{ marginTop: '16px', borderRadius: '12px', fontSize: '0.88rem', fontWeight: 700 }}
              >
                <X size={15} />
                <span>Bersihkan Pencarian & Lihat Semua SPK</span>
              </button>
            )}
          </div>
        ) : (
          <div className="orders-grid">
            {orders.map((o) => {
              const isBackorder = Boolean(o.is_backorder);
              const isCuttingLocked = Boolean(o.cutting_locked_at) || isBackorder;
              const isResultLocked = Boolean(o.result_locked_at);
              const price = formatRupiah(o.harga_vendor);

              // Parse SKU prefix
              const skuMatch = o.product_name?.match(/^\[(.*?)\]\s*(.*)$/);
              const skuCode = skuMatch ? skuMatch[1] : null;
              const cleanProductName = skuMatch ? skuMatch[2] : o.product_name;

              return (
                <div
                  key={o.id}
                  onClick={() => router.push(`/orders/${o.id}`)}
                  className="card card-interactive"
                  style={{
                    padding: '18px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '12px',
                    borderRadius: '16px'
                  }}
                >
                  {/* Top Bar: Reference + Badges */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minWidth: 0 }}>
                        <span className="mono-num" style={{ fontSize: '1.02rem', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
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
                          <span className="badge badge-emerald" style={{ fontSize: '0.7rem' }}>
                            <CheckCircle2 size={12} /> Selesai
                          </span>
                        ) : isCuttingLocked ? (
                          <span className="badge badge-sky" style={{ fontSize: '0.7rem' }}>
                            <Lock size={12} /> Jahit
                          </span>
                        ) : (
                          <span className="badge badge-amber" style={{ fontSize: '0.7rem' }}>
                            <Scissors size={12} /> Potong
                          </span>
                        )}
                      </div>
                    </div>

                    {/* SKU & Product Name */}
                    {skuCode && (
                      <span className="badge badge-slate mono-num" style={{ fontSize: '0.7rem', padding: '2px 8px', marginBottom: '4px' }}>
                        {skuCode}
                      </span>
                    )}
                    <div style={{ fontSize: '0.94rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.35, marginBottom: '4px' }}>
                      {cleanProductName}
                    </div>

                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span>SO:</span>
                      {o.source_document || o.sales_order ? (
                        <span className="mono-num" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                          {o.source_document || o.sales_order}
                        </span>
                      ) : (
                        <span
                          className="badge badge-slate"
                          style={{
                            fontSize: '0.68rem',
                            padding: '2px 7px',
                            fontWeight: 600,
                            background: '#f1f5f9',
                            color: '#475569',
                            border: '1px solid #cbd5e1'
                          }}
                          title="Make-to-Stock (Pemenuhan Stok Gudang)"
                        >
                          Stok Gudang (Non-SO)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Middle Metrics Row */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '8px',
                      padding: '10px 12px',
                      background: 'var(--bg-card-subtle)',
                      borderRadius: '12px',
                      border: '1px solid var(--border-default)',
                      textAlign: 'center'
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Target SPK</div>
                      <div className="mono-num" style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {Number(o.qty_target || o.qty_spk || 0).toLocaleString('id-ID')} <span style={{ fontSize: '0.7rem', fontWeight: 400 }}>pcs</span>
                      </div>
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Hasil Jahit</div>
                      <div className="mono-num" style={{ fontSize: '0.92rem', fontWeight: 800, color: isResultLocked ? 'var(--status-emerald)' : 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {isResultLocked ? Number(o.qty_grade_a || 0).toLocaleString('id-ID') : '-'}
                      </div>
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Kain</div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: o.status_kebutuhan_kain === 'Cukup' ? 'var(--status-emerald)' : 'var(--status-amber)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {o.status_kebutuhan_kain || 'Cukup'}
                      </div>
                    </div>
                  </div>

                  {/* Bottom Footer: Vendor & Price */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '2px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)', minWidth: 0 }}>
                      <Building2 size={14} color="var(--brand-gold)" style={{ flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{o.vendor_name}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      {price && (
                        <div className="mono-num" style={{ fontSize: '0.86rem', fontWeight: 800, color: 'var(--brand-gold)' }}>
                          {price}
                        </div>
                      )}
                      <div style={{ color: 'var(--text-muted)' }}>
                        <ChevronRight size={17} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Numbered Pagination Controls */}
        {totalPages > 1 && (
          <div className="pagination-wrapper">
            <div className="pagination-list">
              {/* Prev Button */}
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1}
                className="pagination-item pagination-item-nav"
                title="Halaman Sebelumnya"
              >
                <ChevronLeft size={16} />
                <span className="hide-on-mobile">Prev</span>
              </button>

              {/* Numbered Page Buttons */}
              {pageNumbers.map((pItem, idx) => {
                if (pItem === '...') {
                  return (
                    <span key={`dots-${idx}`} className="pagination-ellipsis">
                      •••
                    </span>
                  );
                }
                const isCurrent = pItem === page;
                return (
                  <button
                    key={pItem}
                    onClick={() => handlePageChange(pItem)}
                    className={`pagination-item ${isCurrent ? 'active' : ''}`}
                    aria-current={isCurrent ? 'page' : undefined}
                    title={`Halaman ${pItem}`}
                  >
                    {pItem}
                  </button>
                );
              })}

              {/* Next Button */}
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages}
                className="pagination-item pagination-item-nav"
                title="Halaman Selanjutnya"
              >
                <span className="hide-on-mobile">Next</span>
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Pagination Info & Quick Jump */}
            <div className="pagination-info" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <span style={{ fontSize: '0.84rem' }}>
                Halaman <strong className="mono-num" style={{ color: 'var(--text-primary)' }}>{page}</strong> dari <strong className="mono-num">{totalPages}</strong> ({totalCount} total SPK)
              </span>

              {totalPages > 5 && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: 'var(--border-strong)' }}>•</span>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Lompat ke:</span>
                  <select
                    value={page}
                    onChange={(e) => handlePageChange(Number(e.target.value))}
                    className="select-field"
                    style={{
                      height: '34px',
                      padding: '2px 10px',
                      fontSize: '0.82rem',
                      borderRadius: '8px',
                      width: 'auto',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((pNum) => (
                      <option key={pNum} value={pNum}>
                        Hal {pNum}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
