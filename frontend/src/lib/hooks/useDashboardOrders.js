'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi, getCurrentUser } from '@/lib/api';

export function useDashboardOrders() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
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

  // 350ms debounce for search input to prevent rapid API requests
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 350);
    return () => clearTimeout(handler);
  }, [search]);

  // Auth verification
  useEffect(() => {
    const u = getCurrentUser();
    if (!u) {
      router.push('/login');
    } else {
      setUser(u);
    }
  }, [router]);

  // Load vendors list for internal staff / admin
  useEffect(() => {
    if (user && ['master_admin', 'admin'].includes(user.role)) {
      fetchApi('/pwa/vendors')
        .then((res) => {
          if (res.success) setVendors(res.vendors || []);
        })
        .catch(() => {});
    }
  }, [user]);

  // Fetch orders from API
  const loadOrders = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const queryParams = new URLSearchParams({
        page: String(page),
        limit: '24'
      });
      if (debouncedSearch.trim()) queryParams.set('search', debouncedSearch.trim());
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
  }, [user, page, debouncedSearch, status, selectedVendor, sort, period, backorderFilter]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const handleSearchSubmit = (e) => {
    if (e && e.preventDefault) e.preventDefault();
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

  // Local count of orders with kain kurang on loaded list
  const localKainKurangCount = useMemo(() => {
    return orders.filter(
      (o) =>
        o.status_kebutuhan_kain === 'Kurang' ||
        (o.status_kebutuhan_kain && o.status_kebutuhan_kain.toLowerCase().includes('kurang'))
    ).length;
  }, [orders]);

  const activeKainKurangBadge = kainKurangCount > 0 ? kainKurangCount : localKainKurangCount;

  // Filtered orders with fallback for kain_kurang
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

    const delta = 1;
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

  return {
    user,
    orders,
    vendors,
    loading,
    search,
    setSearch,
    status,
    setStatus,
    selectedVendor,
    setSelectedVendor,
    sort,
    setSort,
    period,
    setPeriod,
    backorderFilter,
    setBackorderFilter,
    page,
    setPage,
    totalPages,
    totalCount,
    metrics,
    hasActiveFilters,
    activeKainKurangBadge,
    displayedOrders,
    pageNumbers,
    loadOrders,
    handleSearchSubmit,
    handleClearSearch,
    handleToggleStatus,
    handleResetFilters,
    handlePageChange,
    handleAskWaFromCard
  };
}
