'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi, getCurrentUser, logout } from '@/lib/api';
import InstallPwaPrompt from '@/components/InstallPwaPrompt';
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
  X,
  Smartphone,
  MessageCircle,
  ArrowUpDown,
  Calendar,
  Flame,
  AlertTriangle
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
  const [kainKurangCount, setKainKurangCount] = useState(0);
  const [sort, setSort] = useState('latest');
  const [period, setPeriod] = useState('');
  const [backorderFilter, setBackorderFilter] = useState('');
  const [metrics, setMetrics] = useState({
    total: 0,
    cutting_pending: 0,
    sewing_active: 0,
    result_locked: 0,
    kain_kurang: 0,
    overdue: 0,
    deadline_week: 0,
    backorder_count: 0
  });

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
      if (sort !== 'latest') queryParams.set('sort', sort);
      if (period) queryParams.set('period', period);
      if (backorderFilter) queryParams.set('backorder', backorderFilter);

      const res = await fetchApi(`/pwa/orders?${queryParams.toString()}`);
      if (res.success) {
        setOrders(res.orders || []);
        setTotalPages(res.pagination?.totalPages || 1);
        setTotalCount(res.pagination?.total || 0);
        setKainKurangCount(res.pagination?.kainKurangCount || 0);
        if (res.metrics) {
          setMetrics(res.metrics);
        }
      }
    } catch (err) {
      console.error('Failed to load orders:', err);
    } finally {
      setLoading(false);
    }
  }, [user, page, search, status, selectedVendor, sort, period, backorderFilter]);

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

  const handleToggleStatus = (targetStatus) => {
    setStatus((prev) => (prev === targetStatus ? 'all' : targetStatus));
    setPage(1);
  };

  const handleResetFilters = () => {
    setStatus('all');
    setSearch('');
    setSelectedVendor('');
    setSort('latest');
    setPeriod('');
    setBackorderFilter('');
    setPage(1);
  };

  const hasActiveFilters = Boolean(
    status !== 'all' ||
    search.trim() ||
    selectedVendor ||
    sort !== 'latest' ||
    period ||
    backorderFilter
  );

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > totalPages || newPage === page) return;
    setPage(newPage);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Local count of orders with kain kurang on loaded list (for immediate UI response)
  const localKainKurangCount = useMemo(() => {
    return orders.filter(
      (o) =>
        o.status_kebutuhan_kain === 'Kurang' ||
        (o.status_kebutuhan_kain && o.status_kebutuhan_kain.toLowerCase().includes('kurang'))
    ).length;
  }, [orders]);

  const activeKainKurangBadge = kainKurangCount > 0 ? kainKurangCount : localKainKurangCount;

  // Filtered orders with resilient fallback for kain_kurang
  const displayedOrders = useMemo(() => {
    if (status === 'kain_kurang') {
      return orders.filter(
        (o) =>
          o.status_kebutuhan_kain === 'Kurang' ||
          (o.status_kebutuhan_kain && o.status_kebutuhan_kain.toLowerCase().includes('kurang'))
      );
    }
    return orders;
  }, [orders, status]);

  // Share SPK context to WhatsApp Group from card
  const handleAskWaFromCard = (o, isKainKurang = false) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://vendor-sandy-eight.vercel.app';
    const currentUrl = `${origin}/orders/${o.id}`;
    const spkNo = o.mo_name || `SPK #${o.id}`;
    const product = o.product_name || '-';
    const target = `${Number(o.qty_target || o.qty_spk || 0).toLocaleString('id-ID')} pcs`;
    const kainInfo = `${o.status_kebutuhan_kain || 'Cukup'}${o.kain_dari_gudang !== null && o.kain_dari_gudang !== undefined ? ` (Terima: ${Number(o.kain_dari_gudang).toLocaleString('id-ID')} ${o.unit_kain || 'kg'} / Butuh: ${Number(o.qty_kebutuhan_kain || 0).toLocaleString('id-ID')} ${o.unit_kain || 'kg'})` : ''}`;

    let msg = `Halo Tim Kantiss, mau tanya / ada kendala terkait SPK ini:\n\n`;
    msg += `📋 *No SPK*: ${spkNo}\n`;
    msg += `👗 *Produk*: ${product}\n`;
    msg += `🎯 *Target SPK*: ${target}\n`;
    msg += `📦 *Status Kain*: ${kainInfo}\n`;
    msg += `🔗 *Link SPK*: ${currentUrl}\n\n`;

    if (isKainKurang) {
      msg += `⚠️ *Kendala*: Total kain yang kami terima di konveksi KURANG dari kebutuhan standar SPK. Mohon arahan apakah kain boleh dipotong atau menunggu kiriman tambahan? Terima kasih.\n`;
    } else {
      msg += `💬 *Pertanyaan / Kendala*: `;
    }

    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, '_blank');
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
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('open-pwa-install'))}
            className="btn btn-secondary"
            style={{ fontSize: '0.78rem', padding: '7px 12px', borderRadius: '10px' }}
            title="Pasang di Layar Utama HP"
          >
            <Smartphone size={15} color="var(--brand-gold)" />
            <span className="hide-on-mobile">Pasang di HP</span>
          </button>

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
        {/* PWA Home Screen Install Banner for Older Operators */}
        <InstallPwaPrompt />

        {/* KPI Summary Cards (Interactive Filters) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '10px'
        }}>
          {/* Card 1: Total SPK */}
          <div
            onClick={() => handleToggleStatus('all')}
            className="card metric-card"
            style={{
              cursor: 'pointer',
              border: status === 'all' ? '2px solid var(--brand-gold)' : '1px solid var(--border-default)',
              boxShadow: status === 'all' ? '0 4px 14px rgba(217, 119, 6, 0.15)' : 'none',
              transform: status === 'all' ? 'scale(1.02)' : 'none',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              background: status === 'all' ? 'rgba(217, 119, 6, 0.04)' : 'var(--bg-card)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="metric-label" style={{ fontSize: '0.68rem' }}>Semua SPK</span>
              <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Layers size={14} />
              </div>
            </div>
            <div className="metric-value mono-num" style={{ fontSize: '1.45rem', marginTop: '4px' }}>
              {metrics.total || totalCount}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Sinkron Odoo</span>
              {status === 'all' && (
                <span style={{ fontSize: '0.64rem', fontWeight: 700, color: 'var(--brand-gold)', background: 'rgba(217, 119, 6, 0.12)', padding: '1px 6px', borderRadius: '4px' }}>Aktif</span>
              )}
            </div>
          </div>

          {/* Card 2: Perlu Potong */}
          <div
            onClick={() => handleToggleStatus('cutting_pending')}
            className="card metric-card"
            style={{
              cursor: 'pointer',
              border: status === 'cutting_pending' ? '2px solid #d97706' : '1px solid var(--border-default)',
              boxShadow: status === 'cutting_pending' ? '0 4px 14px rgba(217, 119, 6, 0.15)' : 'none',
              transform: status === 'cutting_pending' ? 'scale(1.02)' : 'none',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              background: status === 'cutting_pending' ? '#fffbeb' : 'var(--bg-card)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="metric-label" style={{ fontSize: '0.68rem', color: '#b45309' }}>Perlu Potong</span>
              <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: '#fffbeb', color: '#d97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Scissors size={14} />
              </div>
            </div>
            <div className="metric-value mono-num" style={{ fontSize: '1.45rem', color: '#b45309', marginTop: '4px' }}>
              {metrics.cutting_pending}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
              <span style={{ fontSize: '0.7rem', color: '#d97706' }}>Antrean Meja</span>
              {status === 'cutting_pending' && (
                <span style={{ fontSize: '0.64rem', fontWeight: 700, color: '#b45309', background: '#fef3c7', padding: '1px 6px', borderRadius: '4px' }}>Aktif</span>
              )}
            </div>
          </div>

          {/* Card 3: Sedang Jahit */}
          <div
            onClick={() => handleToggleStatus('cutting_locked')}
            className="card metric-card"
            style={{
              cursor: 'pointer',
              border: status === 'cutting_locked' ? '2px solid #0284c7' : '1px solid var(--border-default)',
              boxShadow: status === 'cutting_locked' ? '0 4px 14px rgba(2, 132, 199, 0.15)' : 'none',
              transform: status === 'cutting_locked' ? 'scale(1.02)' : 'none',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              background: status === 'cutting_locked' ? '#f0f9ff' : 'var(--bg-card)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="metric-label" style={{ fontSize: '0.68rem', color: '#0369a1' }}>Sedang Jahit</span>
              <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: '#f0f9ff', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Lock size={14} />
              </div>
            </div>
            <div className="metric-value mono-num" style={{ fontSize: '1.45rem', color: '#0284c7', marginTop: '4px' }}>
              {metrics.sewing_active}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
              <span style={{ fontSize: '0.7rem', color: '#0369a1' }}>Proses Sewing</span>
              {status === 'cutting_locked' && (
                <span style={{ fontSize: '0.64rem', fontWeight: 700, color: '#0369a1', background: '#e0f2fe', padding: '1px 6px', borderRadius: '4px' }}>Aktif</span>
              )}
            </div>
          </div>

          {/* Card 4: Kain Kurang */}
          <div
            onClick={() => handleToggleStatus('kain_kurang')}
            className="card metric-card"
            style={{
              cursor: 'pointer',
              border: status === 'kain_kurang' ? '2px solid #ef4444' : (metrics.kain_kurang > 0 ? '1px solid #fca5a5' : '1px solid var(--border-default)'),
              boxShadow: status === 'kain_kurang' ? '0 4px 14px rgba(239, 68, 68, 0.2)' : 'none',
              transform: status === 'kain_kurang' ? 'scale(1.02)' : 'none',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              background: status === 'kain_kurang' ? '#fef2f2' : (metrics.kain_kurang > 0 ? '#fff8f8' : 'var(--bg-card)')
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="metric-label" style={{ fontSize: '0.68rem', color: '#b91c1c' }}>Kain Kurang</span>
              <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: '#fee2e2', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangle size={14} />
              </div>
            </div>
            <div className="metric-value mono-num" style={{ fontSize: '1.45rem', color: '#dc2626', marginTop: '4px' }}>
              {metrics.kain_kurang}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
              <span style={{ fontSize: '0.7rem', color: '#b91c1c' }}>Perlu Solusi</span>
              {status === 'kain_kurang' && (
                <span style={{ fontSize: '0.64rem', fontWeight: 700, color: '#b91c1c', background: '#fee2e2', padding: '1px 6px', borderRadius: '4px' }}>Aktif</span>
              )}
            </div>
          </div>

          {/* Card 5: Overdue */}
          <div
            onClick={() => handleToggleStatus('overdue')}
            className="card metric-card"
            style={{
              cursor: 'pointer',
              border: status === 'overdue' ? '2px solid #ea580c' : (metrics.overdue > 0 ? '1px solid #fed7aa' : '1px solid var(--border-default)'),
              boxShadow: status === 'overdue' ? '0 4px 14px rgba(234, 88, 12, 0.2)' : 'none',
              transform: status === 'overdue' ? 'scale(1.02)' : 'none',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              background: status === 'overdue' ? '#fff7ed' : 'var(--bg-card)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="metric-label" style={{ fontSize: '0.68rem', color: '#c2410c' }}>Lewat Batas</span>
              <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: '#ffedd5', color: '#ea580c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Flame size={14} />
              </div>
            </div>
            <div className="metric-value mono-num" style={{ fontSize: '1.45rem', color: '#ea580c', marginTop: '4px' }}>
              {metrics.overdue}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
              <span style={{ fontSize: '0.7rem', color: '#c2410c' }}>Overdue SPK</span>
              {status === 'overdue' && (
                <span style={{ fontSize: '0.64rem', fontWeight: 700, color: '#c2410c', background: '#fed7aa', padding: '1px 6px', borderRadius: '4px' }}>Aktif</span>
              )}
            </div>
          </div>

          {/* Card 6: Selesai */}
          <div
            onClick={() => handleToggleStatus('result_locked')}
            className="card metric-card"
            style={{
              cursor: 'pointer',
              border: status === 'result_locked' ? '2px solid #059669' : '1px solid var(--border-default)',
              boxShadow: status === 'result_locked' ? '0 4px 14px rgba(5, 150, 105, 0.15)' : 'none',
              transform: status === 'result_locked' ? 'scale(1.02)' : 'none',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              background: status === 'result_locked' ? '#ecfdf5' : 'var(--bg-card)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="metric-label" style={{ fontSize: '0.68rem', color: '#047857' }}>Selesai</span>
              <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: '#ecfdf5', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircle2 size={14} />
              </div>
            </div>
            <div className="metric-value mono-num" style={{ fontSize: '1.45rem', color: '#059669', marginTop: '4px' }}>
              {metrics.result_locked}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
              <span style={{ fontSize: '0.7rem', color: '#047857' }}>SJ Terbit</span>
              {status === 'result_locked' && (
                <span style={{ fontSize: '0.64rem', fontWeight: 700, color: '#047857', background: '#d1fae5', padding: '1px 6px', borderRadius: '4px' }}>Aktif</span>
              )}
            </div>
          </div>
        </div>

        {/* Toolbar: Search & Extended Filter Controls */}
        <div className="card" style={{ padding: '16px', borderRadius: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Search Bar */}
            <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '8px', width: '100%' }}>
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

            {/* Extended Controls: Vendor, Sort, Period, Type */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', width: '100%' }}>
              {/* Vendor Selector for internal staff */}
              {vendors.length > 0 && (
                <div style={{ minWidth: 0 }}>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Building2 size={13} /> Mitra CMT / Vendor
                  </label>
                  <select
                    className="select-field"
                    style={{ height: '40px', fontSize: '0.84rem', borderRadius: '10px' }}
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

              {/* Sorting Selector */}
              <div style={{ minWidth: 0 }}>
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <ArrowUpDown size={13} /> Urutan (Sort)
                </label>
                <select
                  className="select-field"
                  style={{ height: '40px', fontSize: '0.84rem', borderRadius: '10px' }}
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="latest">🆕 SPK Terbaru Dibuat</option>
                  <option value="deadline_asc">⏳ Deadline Paling Dekat</option>
                  <option value="deadline_desc">📅 Deadline Paling Jauh</option>
                  <option value="qty_desc">📦 Target SPK Terbesar</option>
                  <option value="qty_asc">🔹 Target SPK Terkecil</option>
                  <option value="oldest">⌛ SPK Terlama (FIFO)</option>
                </select>
              </div>

              {/* Period Selector */}
              <div style={{ minWidth: 0 }}>
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Calendar size={13} /> Periode Mulai SPK
                </label>
                <select
                  className="select-field"
                  style={{ height: '40px', fontSize: '0.84rem', borderRadius: '10px' }}
                  value={period}
                  onChange={(e) => {
                    setPeriod(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Semua Waktu</option>
                  <option value="this_month">📅 Bulan Ini (Mulai SPK)</option>
                  <option value="last_month">🗓️ Bulan Lalu (Mulai SPK)</option>
                </select>
              </div>

              {/* Backorder / Regular Selector */}
              <div style={{ minWidth: 0 }}>
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Filter size={13} /> Tipe Produksi
                </label>
                <select
                  className="select-field"
                  style={{ height: '40px', fontSize: '0.84rem', borderRadius: '10px' }}
                  value={backorderFilter}
                  onChange={(e) => {
                    setBackorderFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Semua Tipe SPK</option>
                  <option value="regular">📋 SPK Induk / Reguler Saja</option>
                  <option value="backorder">🔄 SPK Backorder Saja</option>
                </select>
              </div>
            </div>

            {/* Active Filters Summary Banner */}
            {hasActiveFilters && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'var(--bg-card-subtle)',
                  border: '1px solid var(--border-default)',
                  borderRadius: '10px',
                  fontSize: '0.82rem',
                  flexWrap: 'wrap',
                  gap: '8px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Filter aktif:</span>
                  {search.trim() && (
                    <span style={{ background: '#fff', border: '1px solid #cbd5e1', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                      Cari: "{search}"
                    </span>
                  )}
                  {status !== 'all' && (
                    <span style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
                      Status: {status}
                    </span>
                  )}
                  {selectedVendor && (
                    <span style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', color: '#6d28d9', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                      Vendor: {vendors.find(v => String(v.id) === String(selectedVendor))?.name || selectedVendor}
                    </span>
                  )}
                  {sort !== 'latest' && (
                    <span style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                      Sort: {sort === 'deadline_asc' ? 'Deadline Terdekat' : sort === 'qty_desc' ? 'Qty Terbesar' : sort}
                    </span>
                  )}
                  {period && (
                    <span style={{ background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                      Periode: {period === 'this_month' ? 'Bulan Ini' : period === 'last_month' ? 'Bulan Lalu' : period}
                    </span>
                  )}
                  {backorderFilter && (
                    <span style={{ background: '#f8fafc', border: '1px solid #cbd5e1', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                      Tipe: {backorderFilter === 'regular' ? 'Reguler' : 'Backorder'}
                    </span>
                  )}
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>({totalCount} SPK sesuai filter)</span>
                </div>
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="quick-action-pill"
                  style={{
                    fontSize: '0.74rem',
                    background: '#ffffff',
                    borderColor: '#cbd5e1',
                    color: '#475569',
                    height: '28px'
                  }}
                  title="Kembalikan semua filter ke awal"
                >
                  <X size={13} />
                  <span>Reset Filter</span>
                </button>
              </div>
            )}

            {/* Status Filter Chips (Fluid Touch Scroll) */}
            <div className="filter-bar">
              <button
                className={`filter-chip ${status === 'all' ? 'active' : ''}`}
                onClick={() => handleToggleStatus('all')}
              >
                Semua ({metrics.total || totalCount})
              </button>
              <button
                className={`filter-chip ${status === 'cutting_pending' ? 'active' : ''}`}
                onClick={() => handleToggleStatus('cutting_pending')}
              >
                ✂️ Belum Potong ({metrics.cutting_pending})
              </button>
              <button
                className={`filter-chip ${status === 'cutting_locked' ? 'active' : ''}`}
                onClick={() => handleToggleStatus('cutting_locked')}
              >
                🔒 Sedang Jahit ({metrics.sewing_active})
              </button>
              <button
                className={`filter-chip ${status === 'kain_kurang' ? 'active' : ''}`}
                onClick={() => handleToggleStatus('kain_kurang')}
                style={
                  status === 'kain_kurang'
                    ? {
                        background: '#fef2f2',
                        borderColor: '#ef4444',
                        color: '#b91c1c',
                        fontWeight: 800,
                        boxShadow: '0 2px 8px rgba(239, 68, 68, 0.2)'
                      }
                    : metrics.kain_kurang > 0
                    ? {
                        borderColor: '#fca5a5',
                        color: '#b91c1c',
                        background: '#fff5f5',
                        fontWeight: 700
                      }
                    : {}
                }
              >
                ⚠️ Kain Kurang ({metrics.kain_kurang || activeKainKurangBadge || 0})
              </button>
              <button
                className={`filter-chip ${status === 'overdue' ? 'active' : ''}`}
                onClick={() => handleToggleStatus('overdue')}
                style={
                  status === 'overdue'
                    ? {
                        background: '#fff7ed',
                        borderColor: '#ea580c',
                        color: '#c2410c',
                        fontWeight: 800,
                        boxShadow: '0 2px 8px rgba(234, 88, 12, 0.2)'
                      }
                    : metrics.overdue > 0
                    ? {
                        borderColor: '#fed7aa',
                        color: '#c2410c',
                        background: '#fffaf5',
                        fontWeight: 600
                      }
                    : {}
                }
              >
                🔥 Overdue ({metrics.overdue})
              </button>
              <button
                className={`filter-chip ${status === 'deadline_week' ? 'active' : ''}`}
                onClick={() => handleToggleStatus('deadline_week')}
              >
                ⏰ Deadline 7 Hari ({metrics.deadline_week})
              </button>
              <button
                className={`filter-chip ${status === 'backorder' ? 'active' : ''}`}
                onClick={() => handleToggleStatus('backorder')}
              >
                🔄 Backorder ({metrics.backorder_count})
              </button>
              <button
                className={`filter-chip ${status === 'result_locked' ? 'active' : ''}`}
                onClick={() => handleToggleStatus('result_locked')}
              >
                ✅ Selesai ({metrics.result_locked})
              </button>
            </div>
          </div>
        </div>

        {/* Status Context Banners */}
        {status === 'kain_kurang' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px',
              marginBottom: '16px',
              background: '#fef2f2',
              border: '1.5px solid #fecaca',
              borderRadius: '12px',
              color: '#991b1b',
              fontSize: '0.86rem',
              flexWrap: 'wrap',
              gap: '8px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={18} color="#dc2626" />
              <span>
                Menampilkan <strong>{totalCount} SPK</strong> dengan status <strong>Kain Kurang</strong>. Harap pastikan fisik kain sebelum memotong.
              </span>
            </div>
            <button
              type="button"
              onClick={() => { setStatus('all'); setPage(1); }}
              className="quick-action-pill"
              style={{ fontSize: '0.74rem', background: '#ffffff', borderColor: '#fca5a5', color: '#b91c1c', height: '28px' }}
            >
              Lihat Semua SPK
            </button>
          </div>
        )}

        {status === 'overdue' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px',
              marginBottom: '16px',
              background: '#fff7ed',
              border: '1.5px solid #fed7aa',
              borderRadius: '12px',
              color: '#9a3412',
              fontSize: '0.86rem',
              flexWrap: 'wrap',
              gap: '8px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Flame size={18} color="#ea580c" />
              <span>
                Menampilkan <strong>{totalCount} SPK</strong> yang <strong>Lewat Batas Deadline (Overdue)</strong>. Mohon percepat proses potong & jahit!
              </span>
            </div>
            <button
              type="button"
              onClick={() => { setStatus('all'); setPage(1); }}
              className="quick-action-pill"
              style={{ fontSize: '0.74rem', background: '#ffffff', borderColor: '#fdba74', color: '#c2410c', height: '28px' }}
            >
              Lihat Semua SPK
            </button>
          </div>
        )}

        {status === 'deadline_week' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px',
              marginBottom: '16px',
              background: '#f0f9ff',
              border: '1.5px solid #bae6fd',
              borderRadius: '12px',
              color: '#075985',
              fontSize: '0.86rem',
              flexWrap: 'wrap',
              gap: '8px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={18} color="#0284c7" />
              <span>
                Menampilkan <strong>{totalCount} SPK</strong> dengan batas deadline dalam <strong>7 hari ke depan</strong>.
              </span>
            </div>
            <button
              type="button"
              onClick={() => { setStatus('all'); setPage(1); }}
              className="quick-action-pill"
              style={{ fontSize: '0.74rem', background: '#ffffff', borderColor: '#7dd3fc', color: '#0369a1', height: '28px' }}
            >
              Lihat Semua SPK
            </button>
          </div>
        )}

        {/* Orders Grid */}
        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: '60px 20px', borderRadius: '16px' }}>
            <div className="spinner" style={{ margin: '0 auto 16px auto' }}></div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', fontWeight: 600 }}>Memuat data SPK...</p>
          </div>
        ) : displayedOrders.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '60px 20px', borderRadius: '16px' }}>
            <Layers size={40} style={{ margin: '0 auto 12px auto', color: 'var(--text-muted)' }} />
            <h3 style={{ fontSize: '1.05rem', marginBottom: '6px', fontWeight: 800 }}>
              {status === 'kain_kurang' ? 'Tidak Ada SPK Kain Kurang di Halaman Ini' : 'Tidak Ada SPK Ditemukan'}
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', maxWidth: '440px', margin: '0 auto' }}>
              {status === 'kain_kurang'
                ? 'Semua SPK pada halaman ini memiliki kain yang cukup. Silakan cek halaman lain atau kembali ke Semua SPK.'
                : search.trim()
                ? `Tidak ditemukan SPK yang cocok dengan "${search.trim()}". Cukup ketik 4 angka belakang nomor SPK (contoh: 1495) atau tekan tombol di bawah.`
                : 'Coba sesuaikan kata kunci pencarian atau ubah filter status di atas.'}
            </p>
            {status === 'kain_kurang' ? (
              <button
                type="button"
                onClick={() => { setStatus('all'); setPage(1); }}
                className="btn btn-secondary"
                style={{ marginTop: '16px', borderRadius: '12px', fontSize: '0.88rem', fontWeight: 700 }}
              >
                <span>Lihat Semua SPK</span>
              </button>
            ) : search.trim() && (
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
            {displayedOrders.map((o) => {
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
                      <div style={{ flexShrink: 0, display: 'flex', gap: '4px', alignItems: 'center' }}>
                        {o.status_kebutuhan_kain === 'Kurang' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAskWaFromCard(o, true);
                            }}
                            className="badge"
                            style={{
                              fontSize: '0.68rem',
                              padding: '2px 7px',
                              background: '#fef2f2',
                              color: '#dc2626',
                              border: '1px solid #fecaca',
                              fontWeight: 800,
                              cursor: 'pointer'
                            }}
                            title="Laporkan kain kurang ke WhatsApp Group"
                          >
                            ⚠️ Kurang
                          </button>
                        )}
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
                      <div
                        style={{
                          fontSize: '0.82rem',
                          fontWeight: 800,
                          color: o.status_kebutuhan_kain === 'Kurang' ? '#dc2626' : 'var(--status-emerald)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                      >
                        {o.status_kebutuhan_kain === 'Kurang' ? '⚠️ Kurang' : (o.status_kebutuhan_kain || 'Cukup')}
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
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAskWaFromCard(o);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '4px 8px',
                          borderRadius: '8px',
                          background: '#ecfdf5',
                          border: '1px solid #a7f3d0',
                          color: '#059669',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                        title="Tanyakan SPK ini ke WhatsApp Group"
                      >
                        <MessageCircle size={13} color="#059669" />
                        <span>Tanya WA</span>
                      </button>

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
