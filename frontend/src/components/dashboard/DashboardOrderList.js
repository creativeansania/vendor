'use client';

import { useState, useMemo } from 'react';
import { LayoutGrid, FolderKanban } from 'lucide-react';
import DashboardOrderCard from './DashboardOrderCard';
import { DashboardLoadingState, DashboardEmptyState } from './list/DashboardListStates';
import SalesOrderGroupCard from './list/SalesOrderGroupCard';
import DashboardPagination from './list/DashboardPagination';

export default function DashboardOrderList({
  loading,
  orders = [],
  status,
  search,
  onClearSearch,
  onClearStatus,
  onSelectOrder,
  onAskWa,
  page,
  totalPages,
  pageNumbers = [],
  onPageChange
}) {
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('pwa_dashboard_view_mode');
        if (saved === 'flat' || saved === 'grouped') return saved;
      } catch {}
    }
    return 'grouped';
  });
  const [collapsedGroups, setCollapsedGroups] = useState({});

  const handleSetViewMode = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('pwa_dashboard_view_mode', mode);
    } catch {}
  };

  // Group orders by Sales Order
  const groupedOrders = useMemo(() => {
    const groups = new Map();

    for (const o of orders) {
      const rawSo = (o.sales_order || o.source_document || '').trim();
      const isNonSo = !rawSo || rawSo === '-' || rawSo.toLowerCase() === 'false' || rawSo.toLowerCase() === 'none';
      const soKey = isNonSo ? 'NON_SO' : rawSo;
      const soLabel = isNonSo ? 'Menunggu Penautan Sales Order' : rawSo;

      if (!groups.has(soKey)) {
        groups.set(soKey, {
          soKey,
          soLabel,
          isNonSo,
          orders: [],
          totalTargetPcs: 0,
          hasKainKurang: false,
          vendorNames: new Set(),
          earliestDeadline: null
        });
      }

      const g = groups.get(soKey);
      g.orders.push(o);
      g.totalTargetPcs += Number(o.qty_target || o.qty_spk || 0);

      if (o.status_kebutuhan_kain === 'Kurang') {
        g.hasKainKurang = true;
      }
      if (o.vendor_name && o.vendor_name !== 'Unknown') {
        g.vendorNames.add(o.vendor_name);
      }
      if (o.deadline_spk && (!g.earliestDeadline || o.deadline_spk < g.earliestDeadline)) {
        g.earliestDeadline = o.deadline_spk;
      }
    }

    return Array.from(groups.values());
  }, [orders]);

  const toggleGroup = (key) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const handleExpandAll = () => setCollapsedGroups({});

  const handleCollapseAll = () => {
    const all = {};
    groupedOrders.forEach((g) => {
      all[g.soKey] = true;
    });
    setCollapsedGroups(all);
  };

  if (loading) {
    return <DashboardLoadingState />;
  }

  if (orders.length === 0) {
    return (
      <DashboardEmptyState
        status={status}
        search={search}
        onClearSearch={onClearSearch}
        onClearStatus={onClearStatus}
      />
    );
  }

  return (
    <>
      {/* View Switcher & Group Summary Toolbar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '16px',
          padding: '4px 2px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Daftar SPK Produksi
          </span>
          <span className="badge badge-slate mono-num" style={{ fontSize: '0.74rem' }}>
            {orders.length} SPK {viewMode === 'grouped' ? `• ${groupedOrders.length} Sales Order` : ''}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {viewMode === 'grouped' && groupedOrders.length > 1 && (
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleExpandAll}
                className="btn-ghost"
                style={{ fontSize: '0.74rem', padding: '4px 8px', borderRadius: '6px', color: 'var(--text-muted)' }}
              >
                Buka Semua
              </button>
              <span style={{ color: 'var(--border-default)' }}>|</span>
              <button
                type="button"
                onClick={handleCollapseAll}
                className="btn-ghost"
                style={{ fontSize: '0.74rem', padding: '4px 8px', borderRadius: '6px', color: 'var(--text-muted)' }}
              >
                Tutup Semua
              </button>
            </div>
          )}

          {/* View Toggle */}
          <div
            style={{
              display: 'flex',
              padding: '3px',
              background: 'var(--bg-card)',
              borderRadius: '10px',
              border: '1px solid var(--border-default)'
            }}
          >
            <button
              type="button"
              onClick={() => handleSetViewMode('grouped')}
              className={`segmented-tab-btn ${viewMode === 'grouped' ? 'active' : ''}`}
              style={{
                fontSize: '0.76rem',
                padding: '4px 10px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
              title="Kelompokkan SPK berdasarkan Sales Order"
            >
              <FolderKanban size={13} />
              <span>Per Sales Order</span>
            </button>
            <button
              type="button"
              onClick={() => handleSetViewMode('flat')}
              className={`segmented-tab-btn ${viewMode === 'flat' ? 'active' : ''}`}
              style={{
                fontSize: '0.76rem',
                padding: '4px 10px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
              title="Tampilkan semua SPK dalam grid biasa"
            >
              <LayoutGrid size={13} />
              <span>Grid Biasa</span>
            </button>
          </div>
        </div>
      </div>

      {/* Orders Content: Grouped vs Flat */}
      {viewMode === 'grouped' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {groupedOrders.map((group) => (
            <SalesOrderGroupCard
              key={group.soKey}
              group={group}
              isCollapsed={Boolean(collapsedGroups[group.soKey])}
              onToggle={() => toggleGroup(group.soKey)}
              onSelectOrder={onSelectOrder}
              onAskWa={onAskWa}
            />
          ))}
        </div>
      ) : (
        <div className="orders-grid">
          {orders.map((o) => (
            <DashboardOrderCard
              key={o.id}
              order={o}
              onClick={() => onSelectOrder(o.id)}
              onAskWa={onAskWa}
            />
          ))}
        </div>
      )}

      <DashboardPagination
        page={page}
        totalPages={totalPages}
        pageNumbers={pageNumbers}
        onPageChange={onPageChange}
      />
    </>
  );
}
