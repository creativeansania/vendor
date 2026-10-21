'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  Layers,
  X,
  ChevronLeft,
  ChevronRight,
  ShoppingBag,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  FolderKanban
} from 'lucide-react';
import DashboardOrderCard from './DashboardOrderCard';

function formatShortDate(dateStr) {
  if (!dateStr) return null;
  try {
    const [y, m, d] = dateStr.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1] || m} ${y}`;
  } catch (e) {
    return dateStr;
  }
}

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
  totalCount,
  pageNumbers = [],
  onPageChange
}) {
  // View mode: 'grouped' (Sales Order) or 'flat' (Standard Grid)
  const [viewMode, setViewMode] = useState('grouped');
  const [collapsedGroups, setCollapsedGroups] = useState({});

  useEffect(() => {
    try {
      const saved = localStorage.getItem('pwa_dashboard_view_mode');
      if (saved === 'flat' || saved === 'grouped') {
        setViewMode(saved);
      }
    } catch (e) {}
  }, []);

  const handleSetViewMode = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('pwa_dashboard_view_mode', mode);
    } catch (e) {}
  };

  // Group orders by Sales Order
  const groupedOrders = useMemo(() => {
    const groups = new Map();

    for (const o of orders) {
      const rawSo = (o.sales_order || o.source_document || '').trim();
      const isNonSo = !rawSo || rawSo === '-' || rawSo.toLowerCase() === 'false' || rawSo.toLowerCase() === 'none';
      const soKey = isNonSo ? 'NON_SO' : rawSo;
      const soLabel = isNonSo ? 'Tanpa Sales Order (Stok Gudang / SPK Mandiri)' : rawSo;

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
      if (o.deadline_spk) {
        if (!g.earliestDeadline || o.deadline_spk < g.earliestDeadline) {
          g.earliestDeadline = o.deadline_spk;
        }
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

  const handleExpandAll = () => {
    setCollapsedGroups({});
  };

  const handleCollapseAll = () => {
    const all = {};
    groupedOrders.forEach((g) => {
      all[g.soKey] = true;
    });
    setCollapsedGroups(all);
  };

  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '60px 20px', borderRadius: '16px' }}>
        <div className="spinner" style={{ margin: '0 auto 16px auto' }}></div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', fontWeight: 600 }}>Memuat data SPK...</p>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
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
            onClick={onClearStatus}
            className="btn btn-secondary"
            style={{ marginTop: '16px', borderRadius: '12px', fontSize: '0.88rem', fontWeight: 700 }}
          >
            <span>Lihat Semua SPK</span>
          </button>
        ) : (
          search.trim() && (
            <button
              type="button"
              onClick={onClearSearch}
              className="btn btn-secondary"
              style={{ marginTop: '16px', borderRadius: '12px', fontSize: '0.88rem', fontWeight: 700 }}
            >
              <X size={15} />
              <span>Bersihkan Pencarian & Lihat Semua SPK</span>
            </button>
          )
        )}
      </div>
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
          {groupedOrders.map((group) => {
            const isCollapsed = Boolean(collapsedGroups[group.soKey]);
            return (
              <div
                key={group.soKey}
                className="card"
                style={{
                  padding: 0,
                  borderRadius: '18px',
                  border: '1px solid var(--border-default)',
                  overflow: 'hidden',
                  background: 'var(--bg-card)',
                  boxShadow: 'var(--shadow-sm)'
                }}
              >
                {/* SO Group Header Bar */}
                <div
                  onClick={() => toggleGroup(group.soKey)}
                  style={{
                    padding: '14px 18px',
                    background: group.isNonSo
                      ? 'var(--bg-card-subtle)'
                      : 'linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(217, 119, 6, 0.02) 100%)',
                    borderBottom: isCollapsed ? 'none' : '1px solid var(--border-default)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '12px',
                    userSelect: 'none'
                  }}
                >
                  {/* Left: Icon + SO Label + Badges */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', minWidth: 0 }}>
                    <div
                      style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: group.isNonSo ? 'var(--border-subtle)' : 'var(--brand-gold-light)',
                        color: group.isNonSo ? 'var(--text-muted)' : 'var(--brand-gold)',
                        border: `1px solid ${group.isNonSo ? 'var(--border-default)' : 'var(--brand-gold-border)'}`,
                        flexShrink: 0
                      }}
                    >
                      {group.isNonSo ? <Layers size={18} /> : <ShoppingBag size={18} />}
                    </div>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
                          {group.isNonSo ? 'Kategori SPK' : 'Sales Order'}
                        </span>
                        <span className="badge badge-indigo mono-num" style={{ fontSize: '0.7rem', padding: '2px 8px' }}>
                          {group.orders.length} SPK
                        </span>
                        {group.hasKainKurang && (
                          <span
                            className="badge"
                            style={{
                              fontSize: '0.66rem',
                              padding: '2px 7px',
                              background: 'var(--status-rose-bg)',
                              color: 'var(--status-rose)',
                              border: '1px solid var(--status-rose-border)',
                              fontWeight: 800
                            }}
                          >
                            ⚠️ Ada Kain Kurang
                          </span>
                        )}
                        {group.vendorNames.size === 1 && (
                          <span className="badge badge-slate hide-on-mobile" style={{ fontSize: '0.68rem', padding: '2px 7px' }}>
                            {Array.from(group.vendorNames)[0]}
                          </span>
                        )}
                      </div>

                      <div
                        className="mono-num"
                        style={{
                          fontSize: '1.05rem',
                          fontWeight: 800,
                          color: group.isNonSo ? 'var(--text-primary)' : 'var(--brand-gold)',
                          marginTop: '2px'
                        }}
                      >
                        {group.soLabel}
                      </div>
                    </div>
                  </div>

                  {/* Right: Summary Metrics + Chevron */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                        Total Target
                      </div>
                      <div className="mono-num" style={{ fontSize: '0.98rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                        {group.totalTargetPcs.toLocaleString('id-ID')} <span style={{ fontSize: '0.72rem', fontWeight: 500 }}>pcs</span>
                      </div>
                    </div>

                    {group.earliestDeadline && (
                      <div className="hide-on-mobile" style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                          Deadline
                        </div>
                        <div className="mono-num" style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                          {formatShortDate(group.earliestDeadline)}
                        </div>
                      </div>
                    )}

                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-default)',
                        background: 'var(--bg-card)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-muted)',
                        flexShrink: 0
                      }}
                    >
                      {isCollapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
                    </div>
                  </div>
                </div>

                {/* SO Cards Body */}
                {!isCollapsed && (
                  <div style={{ padding: '16px', background: 'var(--bg-card-subtle)' }}>
                    <div className="orders-grid">
                      {group.orders.map((o) => (
                        <DashboardOrderCard
                          key={o.id}
                          order={o}
                          onClick={() => onSelectOrder(o.id)}
                          onAskWa={onAskWa}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Flat Grid View */
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

      {/* Numbered Pagination Controls */}
      {totalPages > 1 && (
        <div className="pagination-wrapper">
          <div className="pagination-list">
            {/* Prev Button */}
            <button
              onClick={() => onPageChange(page - 1)}
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
                  key={`page-${pItem}`}
                  onClick={() => onPageChange(pItem)}
                  className={`pagination-item ${isCurrent ? 'active' : ''}`}
                >
                  {pItem}
                </button>
              );
            })}

            {/* Next Button */}
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="pagination-item pagination-item-nav"
              title="Halaman Berikutnya"
            >
              <span className="hide-on-mobile">Next</span>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
