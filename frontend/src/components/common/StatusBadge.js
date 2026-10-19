'use client';

import { Scissors, Lock, CheckCircle2, AlertTriangle, Clock, RefreshCw, Check, XCircle } from 'lucide-react';

/**
 * Universal StatusBadge component for consistent status indicators across the entire app.
 * Supports:
 * - User roles: 'master_admin', 'admin', 'master_vendor', 'admin_vendor'
 * - SPK process: 'cutting_pending', 'cutting_locked', 'result_locked', 'overdue', 'backorder'
 * - Kain status: 'Kurang', 'Cukup'
 * - Transfer / Picking state: 'done', 'assigned', 'waiting', 'confirmed', 'draft', 'cancel'
 */
export default function StatusBadge({ type, value, label, size = 'sm', icon = true, className = '', style = {} }) {
  const fontSize = size === 'xs' ? '0.64rem' : size === 'sm' ? '0.7rem' : '0.78rem';
  const iconSize = size === 'xs' ? 10 : size === 'sm' ? 12 : 14;

  // 1. User Roles
  if (type === 'role') {
    switch (value) {
      case 'master_admin':
        return <span className={`badge badge-purple ${className}`} style={{ fontSize, ...style }}>Master Admin</span>;
      case 'admin':
        return <span className={`badge badge-sky ${className}`} style={{ fontSize, ...style }}>Admin Internal</span>;
      case 'master_vendor':
        return <span className={`badge badge-emerald ${className}`} style={{ fontSize, ...style }}>Master Vendor</span>;
      case 'admin_vendor':
        return <span className={`badge badge-amber ${className}`} style={{ fontSize, ...style }}>Admin Vendor</span>;
      default:
        return <span className={`badge badge-slate ${className}`} style={{ fontSize, ...style }}>{value || 'User'}</span>;
    }
  }

  // 2. Order Process Stage
  if (type === 'order_stage') {
    if (value === 'result_locked' || value === 'Selesai') {
      return (
        <span className={`badge badge-emerald ${className}`} style={{ fontSize, ...style }}>
          {icon && <CheckCircle2 size={iconSize} />}
          <span>{label || 'Selesai'}</span>
        </span>
      );
    }
    if (value === 'cutting_locked' || value === 'Jahit') {
      return (
        <span className={`badge badge-sky ${className}`} style={{ fontSize, ...style }}>
          {icon && <Lock size={iconSize} />}
          <span>{label || 'Jahit'}</span>
        </span>
      );
    }
    return (
      <span className={`badge badge-amber ${className}`} style={{ fontSize, ...style }}>
        {icon && <Scissors size={iconSize} />}
        <span>{label || 'Potong'}</span>
      </span>
    );
  }

  // 3. Kain Status
  if (type === 'kain') {
    const isKurang = value === 'Kurang' || (typeof value === 'string' && value.toLowerCase().includes('kurang'));
    if (isKurang) {
      return (
        <span
          className={`badge ${className}`}
          style={{
            fontSize,
            background: 'var(--status-rose-bg)',
            color: 'var(--status-rose)',
            border: '1px solid var(--status-rose-border)',
            fontWeight: 800,
            ...style
          }}
        >
          {icon && <AlertTriangle size={iconSize} />}
          <span>{label || '⚠️ Kurang'}</span>
        </span>
      );
    }
    return (
      <span className={`badge badge-emerald ${className}`} style={{ fontSize, ...style }}>
        <span>{label || value || 'Cukup'}</span>
      </span>
    );
  }

  // 4. Odoo Transfer / Picking State
  if (type === 'transfer_state') {
    switch (value) {
      case 'done':
        return (
          <span className={`badge badge-emerald ${className}`} style={{ fontSize, ...style }}>
            {icon && <Check size={iconSize} />}
            <span>{label || 'Done'}</span>
          </span>
        );
      case 'assigned':
        return (
          <span className={`badge badge-sky ${className}`} style={{ fontSize, ...style }}>
            {icon && <Clock size={iconSize} />}
            <span>{label || 'Ready'}</span>
          </span>
        );
      case 'waiting':
      case 'confirmed':
        return (
          <span className={`badge badge-amber ${className}`} style={{ fontSize, ...style }}>
            {icon && <Clock size={iconSize} />}
            <span>{label || 'Waiting'}</span>
          </span>
        );
      case 'cancel':
        return (
          <span className={`badge ${className}`} style={{ fontSize, background: 'var(--status-rose-bg)', color: 'var(--status-rose)', border: '1px solid var(--status-rose-border)', ...style }}>
            {icon && <XCircle size={iconSize} />}
            <span>{label || 'Cancelled'}</span>
          </span>
        );
      default:
        return (
          <span className={`badge badge-slate ${className}`} style={{ fontSize, ...style }}>
            <span>{label || value || 'Draft'}</span>
          </span>
        );
    }
  }

  // Fallback generic badge
  return (
    <span className={`badge badge-slate ${className}`} style={{ fontSize, ...style }}>
      {label || value}
    </span>
  );
}
