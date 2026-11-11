'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi, ensureCurrentUser, logout } from '@/lib/api';
import ThemeToggle from '@/components/ThemeToggle';
import StatusBadge from '@/components/common/StatusBadge';
import {
  ArrowLeft,
  Table2,
  Package,
  Scissors,
  Save,
  RotateCcw,
  Zap,
  CheckCircle2,
  AlertCircle,
  Truck,
  Search,
  Filter,
  CheckCheck
} from 'lucide-react';

function parseProductName(rawName) {
  if (!rawName) return { sku: '', name: '-', color: '' };
  let sku = '';
  let rest = String(rawName).trim();
  const skuMatch = rest.match(/^\[(.*?)\]\s*(.*)$/);
  if (skuMatch) {
    sku = skuMatch[1];
    rest = skuMatch[2];
  }
  let color = '';
  const parenMatch = rest.match(/\((.*?)\)$/);
  if (parenMatch) {
    const inside = parenMatch[1];
    const parts = inside.split(',');
    color = parts[0].trim();
    rest = rest.replace(/\s*\(.*?\)$/, '').trim();
  } else {
    const dashParts = rest.split(' - ');
    if (dashParts.length >= 2) {
      color = dashParts[dashParts.length - 1].trim();
      rest = dashParts.slice(0, -1).join(' - ').trim();
    }
  }
  return { sku, name: rest || rawName, color };
}

export default function BatchSpreadsheetPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [selectedVendor, setSelectedVendor] = useState('');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({ text: '', type: '' });

  // Spreadsheet view mode
  const [activeSheet, setActiveSheet] = useState('kiriman'); // 'kiriman' | 'cutting'

  // Filters (Default to 'proses' so completed orders are filtered out automatically)
  const [filterSo, setFilterSo] = useState('all');
  const [filterStatus, setFilterStatus] = useState('proses');
  const [searchQuery, setSearchQuery] = useState('');
  const [salesOrders, setSalesOrders] = useState([]);
  const [loadingSos, setLoadingSos] = useState(false);

  // Global batch helpers
  const [globalSj, setGlobalSj] = useState('');

  // Editable row values map: { [orderId]: { qtyGradeA, qtyGradeB, noSuratJalan, actualCutting, isDirty } }
  const [rowInputs, setRowInputs] = useState({});

  // Input refs for Excel-like keyboard navigation: gridRefs.current[`${rowIndex}_${colKey}`]
  const inputRefs = useRef({});

  // Helper to load distinct Sales Orders for the selected vendor & status
  const loadSalesOrders = useCallback(async (customVendor, customStatus) => {
    setLoadingSos(true);
    try {
      const vnd = customVendor !== undefined ? customVendor : selectedVendor;
      const st = customStatus !== undefined ? customStatus : filterStatus;

      const params = new URLSearchParams();
      params.set('soList', '1');
      if (vnd) params.set('vendorId', vnd);
      if (st && st !== 'all') params.set('status', st);

      const res = await fetchApi(`/orders?${params.toString()}`);
      if (res?.salesOrders) {
        setSalesOrders(res.salesOrders);
      }
    } catch (err) {
      console.warn('Gagal memuat daftar sales order:', err);
    } finally {
      setLoadingSos(false);
    }
  }, [selectedVendor, filterStatus]);

  // Load orders helper for manual refresh / server search
  const loadOrders = useCallback(async (customSearch, customStatus, customVendor, customSo) => {
    setLoading(true);
    setFeedback({ text: '', type: '' });
    try {
      const st = customStatus !== undefined ? customStatus : filterStatus;
      const srch = customSearch !== undefined ? customSearch : searchQuery;
      const vnd = customVendor !== undefined ? customVendor : selectedVendor;
      const so = customSo !== undefined ? customSo : filterSo;

      const params = new URLSearchParams();
      params.set('limit', '500');
      params.set('sort', 'latest');
      if (st && st !== 'all') {
        params.set('status', st);
      }
      if (srch && srch.trim()) {
        params.set('search', srch.trim());
      }
      if (vnd) {
        params.set('vendorId', vnd);
      }
      if (so && so !== 'all') {
        params.set('salesOrder', so);
      }

      const res = await fetchApi(`/orders?${params.toString()}`);
      const loadedOrders = res.orders || [];
      setOrders(loadedOrders);

      // Initialize row inputs, preserving any unsaved edits if matching id exists
      setRowInputs((prev) => {
        const nextMap = { ...prev };
        for (const o of loadedOrders) {
          if (!nextMap[o.id]) {
            nextMap[o.id] = {
              qtyGradeA: Number(o.qty_grade_a || 0) > 0 ? o.qty_grade_a : o.qty_spk || 0,
              qtyGradeB: o.qty_grade_b || 0,
              noSuratJalan: o.no_surat_jalan_sfp || '',
              actualCutting: Number(o.actual_cutting || 0) > 0 ? o.actual_cutting : Math.round(Number(o.estimasi_dari_spb || o.qty_spk || 0)),
              isDirty: false
            };
          }
        }
        return nextMap;
      });
    } catch (err) {
      setFeedback({ text: 'Gagal memuat daftar order: ' + err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [filterStatus, searchQuery, selectedVendor, filterSo]);

  // Initial load: user, vendors, & active orders in one async flow
  useEffect(() => {
    let isMounted = true;
    async function initData() {
      try {
        const u = await ensureCurrentUser();
        if (!isMounted) return;
        setUser(u);

        // If admin, load vendor list for quick filter
        if (['master_admin', 'admin'].includes(u?.role)) {
          try {
            const vRes = await fetchApi('/vendors');
            if (isMounted && vRes?.vendors) {
              setVendors(vRes.vendors);
            }
          } catch (e) {
            console.warn('Gagal memuat daftar vendor:', e);
          }
        }

        // Determine initial vendor id if vendor user
        const isVendor = ['master_vendor', 'admin_vendor'].includes(u?.role);
        const initialVendorId = isVendor ? u?.vendor_id : '';

        // Load distinct Sales Orders for status 'proses'
        try {
          const soParams = new URLSearchParams();
          soParams.set('soList', '1');
          soParams.set('status', 'proses');
          if (initialVendorId) soParams.set('vendorId', initialVendorId);
          const soRes = await fetchApi(`/orders?${soParams.toString()}`);
          if (isMounted && soRes?.salesOrders) {
            setSalesOrders(soRes.salesOrders);
          }
        } catch (e) {
          console.warn('Gagal memuat daftar sales order:', e);
        }

        // Load active (status=proses) orders by default
        const orderParams = new URLSearchParams();
        orderParams.set('limit', '500');
        orderParams.set('sort', 'latest');
        orderParams.set('status', 'proses');
        if (initialVendorId) orderParams.set('vendorId', initialVendorId);

        const res = await fetchApi(`/orders?${orderParams.toString()}`);
        if (!isMounted) return;
        const loadedOrders = res.orders || [];
        setOrders(loadedOrders);

        const initialMap = {};
        for (const o of loadedOrders) {
          initialMap[o.id] = {
            qtyGradeA: Number(o.qty_grade_a || 0) > 0 ? o.qty_grade_a : o.qty_spk || 0,
            qtyGradeB: o.qty_grade_b || 0,
            noSuratJalan: o.no_surat_jalan_sfp || '',
            actualCutting: Number(o.actual_cutting || 0) > 0 ? o.actual_cutting : Math.round(Number(o.estimasi_dari_spb || o.qty_spk || 0)),
            isDirty: false
          };
        }
        setRowInputs(initialMap);
      } catch (err) {
        if (isMounted) {
          if (err.message && err.message.includes('401')) {
            router.push('/login');
          } else {
            setFeedback({ text: 'Gagal memuat daftar order: ' + err.message, type: 'error' });
          }
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    initData();
    return () => {
      isMounted = false;
    };
  }, [router]);

  // Combined list of Sales Orders for filter dropdown (from distinct query + current orders)
  const combinedSos = useMemo(() => {
    const set = new Set(salesOrders || []);
    for (const o of orders) {
      if (o.sales_order && o.sales_order !== '-') {
        set.add(o.sales_order);
      }
    }
    return Array.from(set).sort();
  }, [salesOrders, orders]);

  // Filtered orders displayed on spreadsheet
  const displayedOrders = useMemo(() => {
    return orders.filter((o) => {
      // Pada Sheet Cutting: Hanya tampilkan SPK tanpa backorder atau MO Induk (-001).
      // SPK anak backorder (-002, -003, dst) tidak melalui tahap potong ulang.
      if (activeSheet === 'cutting' && o.is_backorder) {
        return false;
      }

      if (filterSo !== 'all' && o.sales_order !== filterSo) {
        return false;
      }
      const isCompleted =
        o.status_produksi?.toLowerCase() === 'selesai' ||
        o.mo_state === 'done' ||
        Boolean(o.result_locked_at);

      if (filterStatus === 'proses' && isCompleted) {
        return false;
      }
      if (filterStatus === 'selesai' && !isCompleted) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const moMatch = (o.mo_name || '').toLowerCase().includes(q);
        const prodMatch = (o.product_name || '').toLowerCase().includes(q);
        const soMatch = (o.sales_order || '').toLowerCase().includes(q);
        if (!moMatch && !prodMatch && !soMatch) return false;
      }
      return true;
    });
  }, [orders, activeSheet, filterSo, filterStatus, searchQuery]);

  // Handle cell change
  const handleCellChange = (orderId, field, value) => {
    setRowInputs((prev) => ({
      ...prev,
      [orderId]: {
        ...(prev[orderId] || {}),
        [field]: value,
        isDirty: true
      }
    }));
  };

  // Excel-like Keyboard navigation handler (Enter/Down moves to next row, Up moves to prev row)
  const handleKeyDown = (e, rowIndex, colKey) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextRef = inputRefs.current[`${rowIndex + 1}_${colKey}`];
      if (nextRef) {
        nextRef.focus();
        nextRef.select?.();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevRef = inputRefs.current[`${rowIndex - 1}_${colKey}`];
      if (prevRef) {
        prevRef.focus();
        prevRef.select?.();
      }
    }
  };

  // Quick action: Apply global SJ to all visible rows
  const handleApplyGlobalSj = () => {
    if (!globalSj.trim()) return;
    setRowInputs((prev) => {
      const updated = { ...prev };
      for (const o of displayedOrders) {
        updated[o.id] = {
          ...(updated[o.id] || {}),
          noSuratJalan: globalSj.trim(),
          isDirty: true
        };
      }
      return updated;
    });
    setFeedback({ text: `No. Surat Jalan "${globalSj.trim()}" diterapkan ke ${displayedOrders.length} baris.`, type: 'success' });
  };

  // Quick action: Fill all Grade A with Target SPK
  const handleFillAllWithTarget = () => {
    setRowInputs((prev) => {
      const updated = { ...prev };
      for (const o of displayedOrders) {
        updated[o.id] = {
          ...(updated[o.id] || {}),
          qtyGradeA: o.qty_spk || 0,
          isDirty: true
        };
      }
      return updated;
    });
    setFeedback({ text: `Semua Qty Grade A disamakan dengan Target SPK (${displayedOrders.length} baris).`, type: 'success' });
  };

  // Quick action: Fill all Cutting with Estimasi SPB
  const handleFillAllCuttingEstimasi = () => {
    setRowInputs((prev) => {
      const updated = { ...prev };
      for (const o of displayedOrders) {
        const est = Math.round(Number(o.estimasi_dari_spb || o.qty_spk || 0));
        updated[o.id] = {
          ...(updated[o.id] || {}),
          actualCutting: est,
          isDirty: true
        };
      }
      return updated;
    });
    setFeedback({ text: `Semua Actual Cutting disamakan dengan Estimasi SPB (${displayedOrders.length} baris).`, type: 'success' });
  };

  // Quick action: Reset Grade B to 0 for all visible
  const handleResetGradeBZero = () => {
    setRowInputs((prev) => {
      const updated = { ...prev };
      for (const o of displayedOrders) {
        updated[o.id] = {
          ...(updated[o.id] || {}),
          qtyGradeB: 0,
          isDirty: true
        };
      }
      return updated;
    });
  };

  // Calculate live summary totals
  const totals = useMemo(() => {
    let totalTarget = 0;
    let totalEstimasi = 0;
    let totalCutting = 0;
    let totalGradeA = 0;
    let totalGradeB = 0;
    let dirtyCount = 0;

    for (const o of displayedOrders) {
      const inp = rowInputs[o.id] || {};
      totalTarget += Number(o.qty_spk || 0);
      totalEstimasi += Number(o.estimasi_dari_spb || 0);
      totalCutting += Number(inp.actualCutting ?? o.actual_cutting ?? 0);
      totalGradeA += Number(inp.qtyGradeA ?? o.qty_grade_a ?? 0);
      totalGradeB += Number(inp.qtyGradeB ?? o.qty_grade_b ?? 0);
      if (inp.isDirty) dirtyCount++;
    }

    return {
      count: displayedOrders.length,
      totalTarget,
      totalEstimasi: Math.round(totalEstimasi),
      totalCutting,
      totalGradeA,
      totalGradeB,
      dirtyCount
    };
  }, [displayedOrders, rowInputs]);

  // Submit batch changes to server
  const handleSaveAll = async () => {
    const itemsToSubmit = displayedOrders.map((o) => {
      const inp = rowInputs[o.id] || {};
      return {
        orderId: o.id,
        moName: o.mo_name,
        qtyGradeA: Number(inp.qtyGradeA || 0),
        qtyGradeB: Number(inp.qtyGradeB || 0),
        noSuratJalan: inp.noSuratJalan || globalSj || '',
        actualCutting: Number(inp.actualCutting || 0)
      };
    });

    if (itemsToSubmit.length === 0) {
      setFeedback({ text: 'Tidak ada baris yang bisa disimpan.', type: 'warning' });
      return;
    }

    const confirmMsg = activeSheet === 'kiriman'
      ? `Simpan & Kirim hasil jahit untuk ${itemsToSubmit.length} SPK (Total Grade A: ${totals.totalGradeA.toLocaleString('id-ID')} pcs)?`
      : `Simpan hasil potong (Actual Cutting) untuk ${itemsToSubmit.length} SPK (Total Cutting: ${totals.totalCutting.toLocaleString('id-ID')} pcs)?`;

    if (!window.confirm(confirmMsg)) return;

    setSaving(true);
    setFeedback({ text: '', type: '' });

    try {
      if (activeSheet === 'kiriman') {
        const payload = {
          noSuratJalan: globalSj.trim(),
          items: itemsToSubmit.map((it) => ({
            orderId: it.orderId,
            qtyGradeA: it.qtyGradeA,
            qtyGradeB: it.qtyGradeB,
            noSuratJalan: it.noSuratJalan
          }))
        };
        const res = await fetchApi('/batch/submit-shipments', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (res.success) {
          setFeedback({
            text: `✅ Sukses! ${res.successCount} SPK berhasil disimpan dan sedang disinkronkan ke Odoo.`,
            type: 'success'
          });
          loadOrders();
        } else {
          setFeedback({
            text: `⚠️ Selesai dengan beberapa catatan: ${res.successCount} sukses, ${res.errorCount} gagal.`,
            type: 'warning'
          });
          loadOrders();
        }
      } else {
        const payload = {
          items: itemsToSubmit.map((it) => ({
            orderId: it.orderId,
            actualCutting: it.actualCutting
          }))
        };
        const res = await fetchApi('/batch/submit-cuttings', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (res.success) {
          setFeedback({
            text: `✅ Sukses! Data cutting ${res.successCount} SPK berhasil disimpan ke database & Odoo.`,
            type: 'success'
          });
          loadOrders();
        } else {
          setFeedback({
            text: `⚠️ Selesai dengan catatan: ${res.successCount} sukses, ${res.errorCount} gagal.`,
            type: 'warning'
          });
          loadOrders();
        }
      }
    } catch (err) {
      setFeedback({ text: 'Gagal menyimpan: ' + err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  const isVendorRole = ['master_vendor', 'admin_vendor'].includes(user?.role);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-canvas)',
        color: 'var(--text-primary)',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* 1. Header Navbar */}
      <header
        style={{
          background: 'var(--bg-card)',
          borderBottom: '1px solid var(--border-default)',
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          position: 'sticky',
          top: 0,
          zIndex: 40
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => router.push('/')}
            className="btn btn-secondary"
            style={{ fontSize: '0.82rem', padding: '6px 12px', gap: '6px' }}
            title="Kembali ke Dashboard Orders"
          >
            <ArrowLeft size={16} />
            <span className="hide-on-mobile">Dashboard</span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'var(--status-emerald-bg)',
                color: 'var(--status-emerald)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Table2 size={18} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h1 style={{ fontSize: '1rem', margin: 0, fontWeight: 800, color: 'var(--text-primary)' }}>
                  Mode Rekap Spreadsheet
                </h1>
                <StatusBadge type="role" value={user.role} />
              </div>
              <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                {user.vendor_name || 'Ansania Operations'} • Input massal cepat tanpa buka SPK satu-satu
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ThemeToggle />
          <button
            onClick={logout}
            className="btn btn-secondary"
            style={{ fontSize: '0.78rem', padding: '6px 10px' }}
          >
            Keluar
          </button>
        </div>
      </header>

      {/* 2. Top Sub-Nav & Mode Switcher */}
      <div
        style={{
          background: 'var(--bg-card)',
          borderBottom: '1px solid var(--border-default)',
          padding: '10px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          flexWrap: 'wrap'
        }}
      >
        {/* Sheet Tabs (Kiriman vs Cutting) */}
        <div style={{ display: 'flex', gap: '6px', background: 'var(--bg-card-subtle)', padding: '4px', borderRadius: '10px', border: '1px solid var(--border-default)' }}>
          <button
            type="button"
            onClick={() => setActiveSheet('kiriman')}
            style={{
              padding: '6px 16px',
              fontSize: '0.82rem',
              fontWeight: 700,
              borderRadius: '8px',
              border: activeSheet === 'kiriman' ? '1px solid var(--status-emerald-border)' : '1px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: activeSheet === 'kiriman' ? 'var(--bg-card)' : 'transparent',
              color: activeSheet === 'kiriman' ? 'var(--status-emerald)' : 'var(--text-muted)',
              boxShadow: activeSheet === 'kiriman' ? 'var(--shadow-subtle)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <Package size={15} />
            <span>1. Sheet Kiriman (Hasil Jahit & SJ)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSheet('cutting')}
            style={{
              padding: '6px 16px',
              fontSize: '0.82rem',
              fontWeight: 700,
              borderRadius: '8px',
              border: activeSheet === 'cutting' ? '1px solid var(--brand-gold-border)' : '1px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: activeSheet === 'cutting' ? 'var(--bg-card)' : 'transparent',
              color: activeSheet === 'cutting' ? 'var(--brand-gold)' : 'var(--text-muted)',
              boxShadow: activeSheet === 'cutting' ? 'var(--shadow-subtle)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <Scissors size={15} />
            <span>2. Sheet Cutting (Potong Bahan)</span>
          </button>
        </div>

        {/* Global Save Button */}
        <button
          type="button"
          disabled={saving || loading || displayedOrders.length === 0}
          onClick={handleSaveAll}
          className="btn btn-primary"
          style={{
            fontSize: '0.85rem',
            padding: '8px 18px',
            borderRadius: '10px',
            gap: '8px',
            fontWeight: 700
          }}
        >
          <Save size={16} />
          <span>
            {saving ? 'Menyimpan...' : `Simpan Semua (${displayedOrders.length} SPK)`}
          </span>
        </button>
      </div>

      {/* 3. Filter Bar & Quick Tools */}
      <div
        style={{
          background: 'var(--bg-card-subtle)',
          borderBottom: '1px solid var(--border-default)',
          padding: '12px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* 1. Filter Warehouse (Jika vendor tampilkan warehouse sendiri; jika admin tampilkan pilihan warehouse) */}
          {isVendorRole ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>🏢 Warehouse:</span>
              <div
                style={{
                  fontSize: '0.82rem',
                  padding: '4px 10px',
                  height: '34px',
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  border: '1.5px solid var(--border-default)',
                  borderRadius: '8px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                title="Warehouse Akun Anda"
              >
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--status-emerald)' }}></span>
                {user?.vendor_name || 'Vendor Saya'}
              </div>
            </div>
          ) : vendors.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>🏢 Warehouse:</span>
              <select
                value={selectedVendor}
                onChange={(e) => {
                  const nextV = e.target.value;
                  setSelectedVendor(nextV);
                  setFilterSo('all');
                  loadSalesOrders(nextV, filterStatus);
                  loadOrders(searchQuery, filterStatus, nextV, 'all');
                }}
                style={{
                  fontSize: '0.82rem',
                  padding: '5px 10px',
                  height: '34px',
                  minWidth: '150px',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1.5px solid var(--border-default)',
                  borderRadius: '8px',
                  outline: 'none',
                  fontWeight: 600
                }}
              >
                <option value="" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
                  Semua Warehouse ({vendors.length})
                </option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
                    {v.code ? `[${v.code}] ` : ''}{v.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {/* 2. Filter Status (Sedang Proses / Sudah Selesai / Semua Status) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>📋 Status:</span>
            <select
              value={filterStatus}
              onChange={(e) => {
                const nextSt = e.target.value;
                setFilterStatus(nextSt);
                setFilterSo('all');
                loadSalesOrders(selectedVendor, nextSt);
                loadOrders(searchQuery, nextSt, selectedVendor, 'all');
              }}
              style={{
                fontSize: '0.82rem',
                padding: '5px 10px',
                height: '34px',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                border: '1.5px solid var(--border-default)',
                borderRadius: '8px',
                outline: 'none',
                fontWeight: 600
              }}
            >
              <option value="proses" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
                Sedang Proses (Default)
              </option>
              <option value="selesai" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
                Sudah Selesai
              </option>
              <option value="all" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
                Semua Status
              </option>
            </select>
          </div>

          {/* 3. Filter Sales Order (Daftar semua SO yang terkait dengan vendor & status terpilih) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>📦 Sales Order:</span>
            <select
              value={filterSo}
              disabled={loadingSos}
              onChange={(e) => {
                const nextSo = e.target.value;
                setFilterSo(nextSo);
                loadOrders(searchQuery, filterStatus, selectedVendor, nextSo);
              }}
              style={{
                fontSize: '0.82rem',
                padding: '5px 10px',
                height: '34px',
                minWidth: '180px',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                border: '1.5px solid var(--border-default)',
                borderRadius: '8px',
                outline: 'none',
                fontWeight: 600
              }}
            >
              <option value="all" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
                {loadingSos ? 'Memuat SO...' : `Semua Sales Order (${combinedSos.length})`}
              </option>
              {combinedSos.map((so) => (
                <option key={so} value={so} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
                  {so}
                </option>
              ))}
            </select>
          </div>

          {/* 4. Search box */}
          <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Cari No. SPK / Produk (Tekan Enter)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  loadOrders(e.target.value, filterStatus, selectedVendor, filterSo);
                }
              }}
              style={{
                paddingLeft: '32px',
                paddingRight: '10px',
                height: '34px',
                fontSize: '0.82rem',
                width: '100%',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                border: '1.5px solid var(--border-default)',
                borderRadius: '8px',
                outline: 'none',
                fontWeight: 600
              }}
            />
          </div>

          <button
            type="button"
            onClick={() => loadOrders(searchQuery, filterStatus, selectedVendor, filterSo)}
            className="btn btn-secondary"
            style={{ fontSize: '0.78rem', height: '34px', padding: '0 10px', gap: '4px' }}
            title="Cari ke Database"
          >
            <Search size={14} />
            <span>Cari</span>
          </button>

          <button
            type="button"
            onClick={() => {
              loadSalesOrders(selectedVendor, filterStatus);
              loadOrders(searchQuery, filterStatus, selectedVendor, filterSo);
            }}
            className="btn btn-secondary"
            style={{ fontSize: '0.78rem', height: '34px', padding: '0 10px', gap: '4px' }}
            title="Refresh Data"
          >
            <RotateCcw size={14} />
            <span>Segarkan</span>
          </button>
        </div>

        {/* Quick Batch Actions Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
            paddingTop: '6px',
            borderTop: '1px dashed var(--border-default)'
          }}
        >
          {activeSheet === 'kiriman' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Alat Cepat Kiriman:
              </span>

              {/* Global SJ input */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input
                  type="text"
                  placeholder="Isi No. Surat Jalan (misal: SFP/00894)..."
                  value={globalSj}
                  onChange={(e) => setGlobalSj(e.target.value)}
                  style={{
                    height: '30px',
                    fontSize: '0.78rem',
                    width: '240px',
                    padding: '4px 8px',
                    background: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    border: '1.5px solid var(--border-default)',
                    borderRadius: '6px',
                    outline: 'none',
                    fontWeight: 600
                  }}
                />
                <button
                  type="button"
                  onClick={handleApplyGlobalSj}
                  disabled={!globalSj.trim()}
                  className="btn btn-secondary"
                  style={{ height: '30px', fontSize: '0.75rem', padding: '0 10px', gap: '4px' }}
                >
                  <Truck size={13} />
                  <span>Terapkan ke Semua</span>
                </button>
              </div>

              {/* Samakan Target */}
              <button
                type="button"
                onClick={handleFillAllWithTarget}
                className="btn btn-secondary"
                style={{ height: '30px', fontSize: '0.75rem', padding: '0 10px', gap: '4px' }}
              >
                <Zap size={13} color="var(--brand-gold)" />
                <span>Samakan Semua Target</span>
              </button>

              <button
                type="button"
                onClick={handleResetGradeBZero}
                className="btn btn-secondary"
                style={{ height: '30px', fontSize: '0.75rem', padding: '0 8px' }}
              >
                Nolkan Grade B
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Alat Cepat Cutting:
              </span>

              <button
                type="button"
                onClick={handleFillAllCuttingEstimasi}
                className="btn btn-secondary"
                style={{ height: '30px', fontSize: '0.75rem', padding: '0 10px', gap: '4px' }}
              >
                <Zap size={13} color="var(--status-emerald)" />
                <span>Samakan dengan Estimasi SPB</span>
              </button>

              <button
                type="button"
                onClick={handleFillAllWithTarget}
                className="btn btn-secondary"
                style={{ height: '30px', fontSize: '0.75rem', padding: '0 10px', gap: '4px' }}
              >
                <CheckCheck size={13} />
                <span>Samakan dengan Target SPK</span>
              </button>
            </div>
          )}

          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Menampilkan <b>{displayedOrders.length}</b> SPK
          </div>
        </div>
      </div>

      {/* Feedback Toast Banner */}
      {feedback.text && (
        <div
          style={{
            margin: '10px 20px 0',
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '0.82rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background:
              feedback.type === 'error'
                ? 'var(--status-rose-bg)'
                : feedback.type === 'warning'
                ? 'var(--status-amber-bg)'
                : 'var(--status-emerald-bg)',
            color:
              feedback.type === 'error'
                ? 'var(--status-rose)'
                : feedback.type === 'warning'
                ? 'var(--status-amber)'
                : 'var(--status-emerald)',
            border: `1px solid ${
              feedback.type === 'error'
                ? 'var(--status-rose-border)'
                : feedback.type === 'warning'
                ? 'var(--status-amber-border)'
                : 'var(--status-emerald-border)'
            }`
          }}
        >
          {feedback.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* 4. SPREADSHEET GRID TABLE */}
      <div style={{ flex: 1, padding: '12px 20px', overflow: 'auto' }}>
        <div
          className="batch-spreadsheet-table-wrapper"
          style={{
            border: '1px solid var(--border-default)',
            borderRadius: '10px',
            background: 'var(--bg-card)',
            overflow: 'auto',
            maxHeight: 'calc(100vh - 280px)',
            boxShadow: 'var(--shadow-card)'
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.82rem',
              textAlign: 'left',
              color: 'var(--text-primary)'
            }}
          >
            {/* Table Header with High-Contrast Section Colors */}
            <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
              {/* Category Grouping Header */}
              <tr style={{ background: 'var(--bg-card-hover)', borderBottom: '1px solid var(--border-default)' }}>
                <th
                  colSpan={5}
                  style={{
                    padding: '7px 12px',
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    background: 'var(--bg-card-subtle)',
                    color: 'var(--text-secondary)',
                    borderRight: '2px solid var(--border-strong)'
                  }}
                >
                  📌 DATA SPK & PRODUKSI ODOO
                </th>
                <th
                  colSpan={activeSheet === 'kiriman' ? 4 : 4}
                  style={{
                    padding: '7px 12px',
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    background: activeSheet === 'kiriman' ? 'var(--status-emerald-bg)' : 'var(--status-amber-bg)',
                    color: activeSheet === 'kiriman' ? 'var(--status-emerald)' : 'var(--status-amber)'
                  }}
                >
                  ✏️ INPUT VENDOR (KLIK & KETIK LANGSUNG SEPERTI EXCEL)
                </th>
              </tr>

              {/* Column Titles */}
              <tr
                style={{
                  background: 'var(--bg-card)',
                  borderBottom: '2px solid var(--border-strong)',
                  color: 'var(--text-secondary)'
                }}
              >
                <th style={{ padding: '8px 10px', width: '42px', textAlign: 'center', borderRight: '1px solid var(--border-default)', background: 'var(--bg-card)' }}>
                  #
                </th>
                <th
                  style={{
                    padding: '8px 12px',
                    minWidth: '150px',
                    position: 'sticky',
                    left: 0,
                    background: 'var(--bg-card)',
                    zIndex: 2,
                    borderRight: '1px solid var(--border-default)',
                    color: 'var(--text-secondary)'
                  }}
                >
                  NO. SPK / MO
                </th>
                <th style={{ padding: '8px 12px', minWidth: '130px', borderRight: '1px solid var(--border-default)', background: 'var(--bg-card)' }}>
                  SALES ORDER
                </th>
                <th style={{ padding: '8px 12px', minWidth: '220px', borderRight: '1px solid var(--border-default)', background: 'var(--bg-card)' }}>
                  PRODUK & WARNA
                </th>
                <th
                  style={{
                    padding: '8px 12px',
                    width: '95px',
                    textAlign: 'right',
                    borderRight: '2px solid var(--border-strong)',
                    background: 'var(--bg-card-subtle)',
                    color: 'var(--text-secondary)'
                  }}
                >
                  TARGET
                </th>

                {/* Dynamic Columns based on Active Sheet */}
                {activeSheet === 'kiriman' ? (
                  <>
                    <th style={{ padding: '8px 12px', width: '95px', textAlign: 'right', borderRight: '1px solid var(--border-default)', background: 'var(--bg-card-subtle)', color: 'var(--text-secondary)' }}>
                      HASIL POTONG
                    </th>
                    <th
                      style={{
                        padding: '8px 12px',
                        width: '130px',
                        textAlign: 'right',
                        borderRight: '1px solid var(--border-default)',
                        background: 'var(--status-emerald-bg)',
                        color: 'var(--status-emerald)'
                      }}
                    >
                      GRADE A (PCS) *
                    </th>
                    <th
                      style={{
                        padding: '8px 12px',
                        width: '110px',
                        textAlign: 'right',
                        borderRight: '1px solid var(--border-default)',
                        background: 'var(--status-amber-bg)',
                        color: 'var(--status-amber)'
                      }}
                    >
                      GRADE B (PCS)
                    </th>
                    <th style={{ padding: '8px 12px', minWidth: '180px', background: 'var(--bg-card)' }}>
                      NO. SURAT JALAN (SFP)
                    </th>
                  </>
                ) : (
                  <>
                    <th style={{ padding: '8px 12px', width: '100px', textAlign: 'right', borderRight: '1px solid var(--border-default)', background: 'var(--bg-card-subtle)', color: 'var(--text-secondary)' }}>
                      EST. SPB
                    </th>
                    <th style={{ padding: '8px 12px', width: '100px', textAlign: 'right', borderRight: '1px solid var(--border-default)', background: 'var(--bg-card-subtle)', color: 'var(--text-secondary)' }}>
                      KAIN GUDANG
                    </th>
                    <th
                      style={{
                        padding: '8px 12px',
                        width: '150px',
                        textAlign: 'right',
                        borderRight: '1px solid var(--border-default)',
                        background: 'var(--status-amber-bg)',
                        color: 'var(--status-amber)'
                      }}
                    >
                      ACTUAL CUTTING (PCS) *
                    </th>
                    <th style={{ padding: '8px 12px', width: '120px', textAlign: 'right', background: 'var(--bg-card)' }}>
                      SELISIH
                    </th>
                  </>
                )}
              </tr>
            </thead>

            {/* Table Body */}
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Memuat data spreadsheet...
                  </td>
                </tr>
              ) : displayedOrders.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Tidak ada SPK yang sesuai dengan filter pencarian.
                  </td>
                </tr>
              ) : (
                displayedOrders.map((o, idx) => {
                  const inp = rowInputs[o.id] || {};
                  const isBackorder = Boolean(o.is_backorder);
                  const isDone = o.status_produksi?.toLowerCase() === 'selesai';
                  const parsedProduct = parseProductName(o.product_name);

                  // Calculate selisih cutting vs estimasi (dibulatkan ke integer pcs terdekat)
                  const estSpb = Math.round(Number(o.estimasi_dari_spb || o.qty_spk || 0));
                  const actCut = Math.round(Number(inp.actualCutting ?? o.actual_cutting ?? 0));
                  const selisihCut = Math.round(actCut - estSpb);

                  const rowBg = inp.isDirty
                    ? 'var(--brand-gold-light)'
                    : idx % 2 === 0
                    ? 'var(--bg-card)'
                    : 'var(--bg-card-subtle)';

                  return (
                    <tr
                      key={o.id}
                      style={{
                        borderBottom: '1px solid var(--border-default)',
                        background: rowBg,
                        transition: 'background 0.15s ease'
                      }}
                    >
                      {/* # Row Number */}
                      <td style={{ padding: '7px 10px', textAlign: 'center', color: 'var(--text-muted)', borderRight: '1px solid var(--border-default)', fontSize: '0.75rem' }}>
                        {idx + 1}
                      </td>

                      {/* NO SPK (Sticky Left) */}
                      <td
                        style={{
                          padding: '7px 12px',
                          fontWeight: 700,
                          position: 'sticky',
                          left: 0,
                          background: rowBg,
                          color: 'var(--text-primary)',
                          zIndex: 1,
                          borderRight: '1px solid var(--border-default)',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>{o.mo_name}</span>
                          {isBackorder && (
                            <span
                              style={{
                                fontSize: '0.62rem',
                                padding: '1px 5px',
                                borderRadius: '4px',
                                background: 'var(--status-indigo-bg)',
                                color: 'var(--status-indigo)',
                                border: '1px solid var(--status-indigo-border)',
                                fontWeight: 700
                              }}
                            >
                              BO
                            </span>
                          )}
                        </div>
                      </td>

                      {/* SALES ORDER */}
                      <td style={{ padding: '7px 12px', borderRight: '1px solid var(--border-default)', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                        {o.sales_order || '-'}
                      </td>

                      {/* PRODUK & WARNA */}
                      <td
                        style={{
                          padding: '6px 12px',
                          borderRight: '1px solid var(--border-default)',
                          minWidth: '220px',
                          maxWidth: '280px',
                          color: 'var(--text-primary)'
                        }}
                        title={o.product_name}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div
                            style={{
                              fontSize: '0.81rem',
                              fontWeight: 700,
                              color: 'var(--text-primary)',
                              lineHeight: 1.25,
                              wordBreak: 'break-word'
                            }}
                          >
                            {parsedProduct.name}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            {parsedProduct.color && (
                              <span
                                style={{
                                  fontSize: '0.67rem',
                                  fontWeight: 800,
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  background: 'var(--brand-gold-light)',
                                  color: 'var(--brand-gold)',
                                  border: '1px solid var(--brand-gold-border)',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.02em',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px'
                                }}
                              >
                                <span>🎨</span>
                                <span>{parsedProduct.color}</span>
                              </span>
                            )}
                            {parsedProduct.sku && (
                              <span
                                className="mono-num"
                                style={{
                                  fontSize: '0.65rem',
                                  color: 'var(--text-muted)',
                                  fontWeight: 600
                                }}
                              >
                                {parsedProduct.sku}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* TARGET SPK */}
                      <td
                        style={{
                          padding: '7px 12px',
                          textAlign: 'right',
                          fontWeight: 700,
                          borderRight: '2px solid var(--border-strong)',
                          background: inp.isDirty ? 'transparent' : 'var(--bg-card-subtle)',
                          color: 'var(--text-primary)'
                        }}
                      >
                        {Number(o.qty_spk || 0).toLocaleString('id-ID')}
                      </td>

                      {/* DYNAMIC EDITABLE CELLS */}
                      {activeSheet === 'kiriman' ? (
                        <>
                          {/* HASIL POTONG (Read-only reference) */}
                          <td
                            style={{
                              padding: '7px 12px',
                              textAlign: 'right',
                              borderRight: '1px solid var(--border-default)',
                              color: 'var(--text-secondary)',
                              background: inp.isDirty ? 'transparent' : 'var(--bg-card-subtle)'
                            }}
                          >
                            {Number(o.actual_cutting || 0).toLocaleString('id-ID')}
                          </td>

                          {/* INPUT GRADE A */}
                          <td style={{ padding: '4px 6px', textAlign: 'right', borderRight: '1px solid var(--border-default)' }}>
                            <input
                              ref={(el) => (inputRefs.current[`${idx}_gradeA`] = el)}
                              type="number"
                              min="0"
                              value={inp.qtyGradeA ?? ''}
                              onChange={(e) => handleCellChange(o.id, 'qtyGradeA', e.target.value)}
                              onFocus={(e) => e.target.select()}
                              onKeyDown={(e) => handleKeyDown(e, idx, 'gradeA')}
                              disabled={isDone && !user.role?.includes('admin')}
                              style={{
                                width: '100%',
                                textAlign: 'right',
                                fontWeight: 700,
                                padding: '6px 8px',
                                fontSize: '0.84rem',
                                borderRadius: '6px',
                                border: inp.isDirty ? '1.5px solid var(--status-emerald)' : '1px solid var(--border-default)',
                                background: 'var(--bg-input)',
                                color: 'var(--text-primary)',
                                outline: 'none',
                                opacity: (isDone && !user.role?.includes('admin')) ? 0.6 : 1,
                                cursor: (isDone && !user.role?.includes('admin')) ? 'not-allowed' : 'text'
                              }}
                            />
                          </td>

                          {/* INPUT GRADE B */}
                          <td style={{ padding: '4px 6px', textAlign: 'right', borderRight: '1px solid var(--border-default)' }}>
                            <input
                              ref={(el) => (inputRefs.current[`${idx}_gradeB`] = el)}
                              type="number"
                              min="0"
                              value={inp.qtyGradeB ?? ''}
                              onChange={(e) => handleCellChange(o.id, 'qtyGradeB', e.target.value)}
                              onFocus={(e) => e.target.select()}
                              onKeyDown={(e) => handleKeyDown(e, idx, 'gradeB')}
                              disabled={isDone && !user.role?.includes('admin')}
                              style={{
                                width: '100%',
                                textAlign: 'right',
                                padding: '6px 8px',
                                fontSize: '0.84rem',
                                borderRadius: '6px',
                                border: Number(inp.qtyGradeB || 0) > 0 ? '1.5px solid var(--status-amber)' : '1px solid var(--border-default)',
                                background: 'var(--bg-input)',
                                color: 'var(--text-primary)',
                                outline: 'none',
                                opacity: (isDone && !user.role?.includes('admin')) ? 0.6 : 1,
                                cursor: (isDone && !user.role?.includes('admin')) ? 'not-allowed' : 'text'
                              }}
                            />
                          </td>

                          {/* NO SURAT JALAN */}
                          <td style={{ padding: '4px 6px' }}>
                            <input
                              ref={(el) => (inputRefs.current[`${idx}_sj`] = el)}
                              type="text"
                              placeholder="No. SJ (misal: SFP/00894)"
                              value={inp.noSuratJalan ?? ''}
                              onChange={(e) => handleCellChange(o.id, 'noSuratJalan', e.target.value)}
                              onFocus={(e) => e.target.select()}
                              onKeyDown={(e) => handleKeyDown(e, idx, 'sj')}
                              style={{
                                width: '100%',
                                padding: '6px 8px',
                                fontSize: '0.84rem',
                                borderRadius: '6px',
                                border: inp.isDirty ? '1.5px solid var(--border-strong)' : '1px solid var(--border-default)',
                                background: 'var(--bg-input)',
                                color: 'var(--text-primary)',
                                outline: 'none'
                              }}
                            />
                          </td>
                        </>
                      ) : (
                        <>
                          {/* EST SPB */}
                          <td
                            style={{
                              padding: '7px 12px',
                              textAlign: 'right',
                              borderRight: '1px solid var(--border-default)',
                              color: 'var(--text-secondary)',
                              background: inp.isDirty ? 'transparent' : 'var(--bg-card-subtle)'
                            }}
                          >
                            {Math.round(Number(o.estimasi_dari_spb || 0)).toLocaleString('id-ID')}
                          </td>

                          {/* KAIN GUDANG */}
                          <td
                            style={{
                              padding: '7px 12px',
                              textAlign: 'right',
                              borderRight: '1px solid var(--border-default)',
                              color: 'var(--text-secondary)',
                              background: inp.isDirty ? 'transparent' : 'var(--bg-card-subtle)'
                            }}
                          >
                            {Number(o.kain_dari_gudang || 0).toLocaleString('id-ID')} {o.unit_kain || 'yd'}
                          </td>

                          {/* INPUT ACTUAL CUTTING */}
                          <td style={{ padding: '4px 6px', textAlign: 'right', borderRight: '1px solid var(--border-default)' }}>
                            <input
                              ref={(el) => (inputRefs.current[`${idx}_cutting`] = el)}
                              type="number"
                              min="0"
                              value={inp.actualCutting ?? ''}
                              onChange={(e) => handleCellChange(o.id, 'actualCutting', e.target.value)}
                              onFocus={(e) => e.target.select()}
                              onKeyDown={(e) => handleKeyDown(e, idx, 'cutting')}
                              style={{
                                width: '100%',
                                textAlign: 'right',
                                fontWeight: 700,
                                padding: '6px 8px',
                                fontSize: '0.84rem',
                                borderRadius: '6px',
                                border: inp.isDirty ? '1.5px solid var(--brand-gold)' : '1px solid var(--border-default)',
                                background: 'var(--bg-input)',
                                color: 'var(--text-primary)',
                                outline: 'none'
                              }}
                            />
                          </td>

                          {/* SELISIH VS ESTIMASI */}
                          <td
                            style={{
                              padding: '7px 12px',
                              textAlign: 'right',
                              fontWeight: 700,
                              color: selisihCut >= 0 ? 'var(--status-emerald)' : 'var(--status-rose)'
                            }}
                          >
                            {selisihCut > 0 ? `+${selisihCut.toLocaleString('id-ID')}` : selisihCut.toLocaleString('id-ID')} pcs
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Table Footer: Total Auto-Sum */}
            {displayedOrders.length > 0 && (
              <tfoot
                style={{
                  position: 'sticky',
                  bottom: 0,
                  background: 'var(--bg-card-elevated)',
                  color: 'var(--text-primary)',
                  borderTop: '2px solid var(--border-strong)',
                  fontWeight: 800,
                  fontSize: '0.84rem',
                  zIndex: 10,
                  boxShadow: '0 -2px 8px rgba(0,0,0,0.06)'
                }}
              >
                <tr>
                  <td colSpan={4} style={{ padding: '10px 12px', borderRight: '1px solid var(--border-default)' }}>
                    TOTAL REKAP ({totals.count} SPK DITAMPILKAN)
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', borderRight: '2px solid var(--border-strong)' }}>
                    {totals.totalTarget.toLocaleString('id-ID')}
                  </td>

                  {activeSheet === 'kiriman' ? (
                    <>
                      <td style={{ padding: '10px 12px', textAlign: 'right', borderRight: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
                        {totals.totalCutting.toLocaleString('id-ID')}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', borderRight: '1px solid var(--border-default)', color: 'var(--status-emerald)' }}>
                        {totals.totalGradeA.toLocaleString('id-ID')} pcs
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', borderRight: '1px solid var(--border-default)', color: 'var(--status-amber)' }}>
                        {totals.totalGradeB.toLocaleString('id-ID')} pcs
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <button
                          type="button"
                          onClick={handleSaveAll}
                          disabled={saving || loading}
                          className="btn btn-primary"
                          style={{ width: '100%', padding: '6px 12px', fontSize: '0.8rem', fontWeight: 700 }}
                        >
                          {saving ? 'Menyimpan...' : '💾 Simpan Kiriman Ini'}
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: '10px 12px', textAlign: 'right', borderRight: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
                        {totals.totalEstimasi.toLocaleString('id-ID')}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', borderRight: '1px solid var(--border-default)', color: 'var(--text-muted)' }}>
                        -
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', borderRight: '1px solid var(--border-default)', color: 'var(--brand-gold)' }}>
                        {totals.totalCutting.toLocaleString('id-ID')} pcs
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <button
                          type="button"
                          onClick={handleSaveAll}
                          disabled={saving || loading}
                          className="btn btn-primary"
                          style={{ width: '100%', padding: '6px 12px', fontSize: '0.8rem', fontWeight: 700 }}
                        >
                          {saving ? 'Menyimpan...' : '💾 Simpan Cutting'}
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
