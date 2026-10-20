'use client';

import { Layers, Scissors, Lock, AlertTriangle, Flame, CheckCircle2 } from 'lucide-react';
import MetricTile from '@/components/common/MetricTile';

export default function DashboardMetricsGrid({ metrics, totalCount, status, onToggleStatus }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: '10px'
      }}
    >
      <MetricTile
        label="Semua SPK"
        value={metrics.total || totalCount || 0}
        subtext="Sinkron Odoo"
        icon={<Layers size={14} />}
        variant="default"
        active={status === 'all'}
        interactive
        onClick={() => onToggleStatus('all')}
      />

      <MetricTile
        label="Perlu Potong"
        value={metrics.cutting_pending ?? 0}
        subtext="Antrean Meja"
        icon={<Scissors size={14} />}
        variant="gold"
        active={status === 'cutting_pending'}
        interactive
        onClick={() => onToggleStatus('cutting_pending')}
      />

      <MetricTile
        label="Sedang Jahit"
        value={metrics.sewing_active ?? 0}
        subtext="Proses Sewing"
        icon={<Lock size={14} />}
        variant="sky"
        active={status === 'cutting_locked'}
        interactive
        onClick={() => onToggleStatus('cutting_locked')}
      />

      <MetricTile
        label="Kain Kurang"
        value={metrics.kain_kurang ?? 0}
        subtext="Perlu Solusi"
        icon={<AlertTriangle size={14} />}
        variant="rose"
        active={status === 'kain_kurang'}
        interactive
        onClick={() => onToggleStatus('kain_kurang')}
      />

      <MetricTile
        label="Lewat Batas"
        value={metrics.overdue ?? 0}
        subtext="Overdue SPK"
        icon={<Flame size={14} />}
        variant="amber"
        active={status === 'overdue'}
        interactive
        onClick={() => onToggleStatus('overdue')}
      />

      <MetricTile
        label="Selesai"
        value={metrics.result_locked ?? 0}
        subtext="SJ Terbit"
        icon={<CheckCircle2 size={14} />}
        variant="emerald"
        active={status === 'result_locked'}
        interactive
        onClick={() => onToggleStatus('result_locked')}
      />
    </div>
  );
}
