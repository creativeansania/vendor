const MONTHS_ID_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'
];

export const WIP_STAGES_CLIENT = [
  { key: 'persiapan_bahan', label: 'Persiapan Bahan', order: 1 },
  { key: 'celup_print', label: 'Celup / Print', order: 2 },
  { key: 'cutting', label: 'Cutting', order: 3 },
  { key: 'jahit', label: 'Jahit', order: 4 },
  { key: 'qc_packing', label: 'QC & Packing', order: 5 },
  { key: 'selesai', label: 'Selesai', order: 6 }
];

export const STATUS_LABELS = {
  selesai: 'Selesai',
  on_track: 'On Track',
  perlu_perhatian: 'Perlu Perhatian',
  terlambat: 'Terlambat'
};

export function formatIntId(val) {
  const num = Number(val || 0);
  if (!Number.isFinite(num)) return '0';
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(num);
}

export function formatPctId(val) {
  const num = Number(val || 0);
  if (!Number.isFinite(num)) return '0,0';
  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(num);
}

/**
 * Format YYYY-MM-DD -> '14 Okt 2026'
 */
export function formatDateId(dateStr) {
  if (!dateStr) return '—';
  const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(dateStr);
  const year = match[1];
  const monthIdx = Number(match[2]) - 1;
  const day = match[3];
  return `${day} ${MONTHS_ID_SHORT[monthIdx] || match[2]} ${year}`;
}

/**
 * Format Monday week key YYYY-MM-DD -> '23 Nov' (or '4 Jan 27' if year differs)
 */
export function formatWeekShortId(dateStr, showYear = false) {
  if (!dateStr) return '—';
  const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(dateStr);
  const day = Number(match[3]);
  const monthIdx = Number(match[2]) - 1;
  const base = `${day} ${MONTHS_ID_SHORT[monthIdx] || match[2]}`;
  return showYear ? `${base} '${match[1].slice(2)}` : base;
}

/**
 * Format ISO timestamp -> '27 Nov 2026, 15:20 GMT+7'
 */
export function formatSyncedAtWib(isoStr) {
  if (!isoStr) return '—';
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return String(isoStr);
  const wib = new Date(dt.getTime() + 7 * 60 * 60 * 1000);
  const day = wib.getUTCDate();
  const mon = MONTHS_ID_SHORT[wib.getUTCMonth()];
  const year = wib.getUTCFullYear();
  const hh = String(wib.getUTCHours()).padStart(2, '0');
  const mm = String(wib.getUTCMinutes()).padStart(2, '0');
  return `${day} ${mon} ${year}, ${hh}:${mm} GMT+7`;
}

function getMondayWeekKeyClient(dateStr) {
  if (!dateStr) return null;
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7)) - 1;
  const day = Number(dateStr.slice(8, 10));
  const dt = new Date(Date.UTC(y, m, day));
  if (Number.isNaN(dt.getTime())) return null;
  const dow = dt.getUTCDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + diffToMon);
  return dt.toISOString().slice(0, 10);
}

/**
 * Recompute KPIs, status pills, stages, weekly chart, and attention items dynamically
 * when the buyer filters by search, status, stage, or open-only toggle.
 */
export function computeClientAggregates(items) {
  let totalQtyPo = 0;
  let totalQtySfp = 0;
  let totalQtyDelivered = 0;
  let totalQtySelesai = 0;
  let totalQtySisa = 0;

  const distinctPoSet = new Set();
  const statusCounts = {
    selesai: 0,
    on_track: 0,
    perlu_perhatian: 0,
    terlambat: 0
  };

  const stageMap = new Map(
    WIP_STAGES_CLIENT.map((s) => [
      s.key,
      { key: s.key, label: s.label, order: s.order, qty_po: 0, item_count: 0, po_set: new Set() }
    ])
  );

  const weekMap = new Map();
  let unscheduledQty = 0;
  let unscheduledCount = 0;
  const attentionItems = [];

  for (const item of items) {
    totalQtyPo += Number(item.qty_po || 0);
    totalQtySfp += Number(item.qty_sfp || 0);
    totalQtyDelivered += Number(item.qty_delivered || 0);
    totalQtySelesai += Number(item.qty_selesai || 0);
    totalQtySisa += Number(item.qty_sisa || 0);
    distinctPoSet.add(item.no_po_kss);

    if (statusCounts[item.health_status] !== undefined) {
      statusCounts[item.health_status] += 1;
    }

    const st = stageMap.get(item.stage_key);
    if (st) {
      st.qty_po += Number(item.qty_po || 0);
      st.item_count += 1;
      st.po_set.add(item.no_po_kss);
    }

    if (item.health_status === 'terlambat' || item.health_status === 'perlu_perhatian') {
      attentionItems.push(item);
    }

    const weekKey = getMondayWeekKeyClient(item.plan_delivery);
    if (weekKey) {
      if (!weekMap.has(weekKey)) {
        weekMap.set(weekKey, {
          week_start: weekKey,
          qty_po: 0,
          qty_selesai_capped: 0,
          qty_selesai_actual: 0,
          qty_sisa: 0,
          item_count: 0
        });
      }
      const w = weekMap.get(weekKey);
      w.qty_po += Number(item.qty_po || 0);
      w.qty_selesai_actual += Number(item.qty_selesai || 0);
      w.qty_selesai_capped += Math.min(Number(item.qty_po || 0), Number(item.qty_selesai || 0));
      w.qty_sisa += Number(item.qty_sisa || 0);
      w.item_count += 1;
    } else {
      unscheduledQty += Number(item.qty_po || 0);
      unscheduledCount += 1;
    }
  }

  const pctFinish = totalQtyPo > 0 ? Math.round((totalQtySelesai / totalQtyPo) * 1000) / 10 : 0;

  const stages = Array.from(stageMap.values())
    .sort((a, b) => a.order - b.order)
    .map(({ po_set, ...rest }) => ({ ...rest, po_count: po_set.size }));

  const weekly = Array.from(weekMap.values()).sort((a, b) =>
    a.week_start.localeCompare(b.week_start)
  );

  attentionItems.sort((a, b) => {
    if (a.health_status !== b.health_status) {
      return a.health_status === 'terlambat' ? -1 : 1;
    }
    return (a.days_remaining ?? 9999) - (b.days_remaining ?? 9999);
  });

  return {
    summary: {
      total_items: items.length,
      total_po_docs: distinctPoSet.size,
      total_qty_po: Math.round(totalQtyPo * 100) / 100,
      total_qty_sfp: Math.round(totalQtySfp * 100) / 100,
      total_qty_delivered: Math.round(totalQtyDelivered * 100) / 100,
      total_qty_selesai: Math.round(totalQtySelesai * 100) / 100,
      total_qty_sisa: Math.round(totalQtySisa * 100) / 100,
      pct_finish: pctFinish,
      status_counts: statusCounts,
      unscheduled_qty: Math.round(unscheduledQty * 100) / 100,
      unscheduled_count: unscheduledCount
    },
    stages,
    weekly,
    attention_items: attentionItems
  };
}

function escapeCsvCell(val) {
  const s = String(val ?? '');
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportBuyerItemsToCsv(buyerName, items) {
  const headers = [
    'Tgl PO',
    'Plan Delivery',
    'No PO KSS',
    'No PO Buyer',
    'SKU',
    'Nama Artikel',
    'Warna',
    'Qty PO (pcs)',
    'Qty Siap Kirim / SFP (pcs)',
    'Qty Terkirim (pcs)',
    'Qty Selesai (pcs)',
    'Sisa Qty (pcs)',
    'Tahap WIP',
    'Status',
    '% Finish'
  ];

  const rows = items.map((item) => [
    item.tgl_po || '',
    item.plan_delivery || '',
    item.no_po_kss || '',
    item.no_po_buyer || '',
    item.sku || '',
    item.nama_artikel || '',
    item.warna || '',
    item.qty_po ?? 0,
    item.qty_sfp ?? 0,
    item.qty_delivered ?? 0,
    item.qty_selesai ?? 0,
    item.qty_sisa ?? 0,
    item.stage_label || '',
    STATUS_LABELS[item.health_status] || item.health_status || '',
    `${item.pct_finish ?? 0}%`
  ]);

  const csvLines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(','));
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = String(buyerName || 'buyer').replace(/[^a-zA-Z0-9_-]+/g, '_');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `WIP_Produksi_${safeName}_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
