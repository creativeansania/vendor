import { adminOdooClient, defaultOdooClient } from '../../odoo/odooClient.js';

export const WIP_STAGES = [
  { key: 'persiapan_bahan', label: 'Persiapan Bahan', order: 1 },
  { key: 'celup_print', label: 'Celup / Print', order: 2 },
  { key: 'cutting', label: 'Cutting', order: 3 },
  { key: 'jahit', label: 'Jahit', order: 4 },
  { key: 'qc_packing', label: 'QC & Packing', order: 5 },
  { key: 'selesai', label: 'Selesai', order: 6 }
];

const STAGE_LABEL_BY_KEY = Object.fromEntries(WIP_STAGES.map((s) => [s.key, s.label]));

function getOdooClient() {
  if (process.env.ODOO_ADMIN_USERNAME && process.env.ODOO_ADMIN_PASSWORD) {
    return adminOdooClient;
  }
  return defaultOdooClient;
}

/**
 * Convert an Odoo UTC datetime/date string to YYYY-MM-DD in Asia/Jakarta (GMT+7).
 */
export function toWibDateStr(odooVal) {
  if (!odooVal || odooVal === false) return null;
  const raw = String(odooVal).trim();
  if (!raw) return null;
  // Pure date string YYYY-MM-DD (no time component)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  // Odoo datetime 'YYYY-MM-DD HH:mm:ss' is UTC
  const isoUtc = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) {
    return raw.slice(0, 10);
  }
  const wibMs = d.getTime() + 7 * 60 * 60 * 1000;
  return new Date(wibMs).toISOString().slice(0, 10);
}

/**
 * Current date in Asia/Jakarta (GMT+7) as YYYY-MM-DD.
 */
export function getTodayWibDateStr(nowDate = new Date()) {
  const wibMs = nowDate.getTime() + 7 * 60 * 60 * 1000;
  return new Date(wibMs).toISOString().slice(0, 10);
}

/**
 * Whole calendar day difference: targetDateStr - baseDateStr.
 * Positive => days remaining; 0 => due today; Negative => days overdue.
 */
export function diffCalendarDays(targetDateStr, baseDateStr) {
  if (!targetDateStr || !baseDateStr) return null;
  const t = Date.UTC(
    Number(targetDateStr.slice(0, 4)),
    Number(targetDateStr.slice(5, 7)) - 1,
    Number(targetDateStr.slice(8, 10))
  );
  const b = Date.UTC(
    Number(baseDateStr.slice(0, 4)),
    Number(baseDateStr.slice(5, 7)) - 1,
    Number(baseDateStr.slice(8, 10))
  );
  return Math.round((t - b) / (24 * 60 * 60 * 1000));
}

/**
 * Get Monday-start week key (YYYY-MM-DD) for a YYYY-MM-DD date string.
 */
export function getMondayWeekKey(dateStr) {
  if (!dateStr) return null;
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7)) - 1;
  const day = Number(dateStr.slice(8, 10));
  const dt = new Date(Date.UTC(y, m, day));
  const dow = dt.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + diffToMon);
  return dt.toISOString().slice(0, 10);
}

/**
 * Extract clean article name and fallback color from Odoo product display_name / template name.
 */
function parseProductPresentation(line, productRec) {
  const rawDisplay = productRec?.display_name || line.product_id?.[1] || line.name || '-';
  const sku = String(line.x_studio_sku || productRec?.default_code || '').trim();

  // Strip leading [SKU]
  let cleaned = rawDisplay.replace(/^\[[^\]]+\]\s*/, '').trim();

  // Extract trailing (...) variant segment if present
  let fallbackColor = '';
  const parenMatch = cleaned.match(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/);
  if (parenMatch) {
    const inside = parenMatch[1];
    cleaned = cleaned.slice(0, parenMatch.index).trim();
    // Remove grade markers like ", A (GRADE A)" or "GRADE A"
    const parts = inside
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p && !/^A\s*\(GRADE\s*A\)$/i.test(p) && !/^GRADE\s*[AB]$/i.test(p));
    fallbackColor = parts[0] || '';
  }

  const artikel = String(productRec?.name || cleaned || rawDisplay).trim();
  const warna = String(line.x_studio_warna_buyer || fallbackColor || '-').trim();

  return { sku: sku || '-', artikel, warna };
}

function isDyePrintWorkcenter(name = '') {
  return /DYE|DTEING|PRINT|PRESS|WEAV/i.test(name);
}

function isCuttingWorkcenter(name = '') {
  return /CUTT|LASER|BELAH/i.test(name);
}

function isSewingWorkcenter(name = '') {
  return /SEW|FINISH|SWAROWSKI|JAHIT/i.test(name);
}

function isQcPackingWorkcenter(name = '') {
  return /INSPECT|PACK|QC/i.test(name);
}

function isFabricOrPrintMo(mo) {
  const moName = String(mo.name || '');
  const prodName = String(mo.product_id?.[1] || '');
  const pickType = String(mo.picking_type_id?.[1] || '');
  if (/^WHDGP\//i.test(moName)) return true;
  if (/DYE|PRINT|PRESS|CELUP|DIGITAL/i.test(pickType)) return true;
  if (/^(\[[^\]]+\]\s*)?KAIN\b/i.test(prodName)) return true;
  return false;
}

/**
 * Automatic 6-stage WIP classifier for a single SO line.
 * Evaluated from highest completed stage downward so the true live stage is shown.
 */
function classifyLineStage({
  qtyPo,
  qtySfp,
  qtyDelivered,
  qtySelesai,
  lineMos,
  soFabricMos,
  wosByMoId,
  wipsByMoId
}) {
  // Stage 6: Selesai (100%+)
  if (qtyPo > 0 && qtySelesai >= qtyPo) {
    return 'selesai';
  }

  let hasQcPacking = qtySfp > 0 || qtyDelivered > 0;
  let hasJahit = false;
  let hasCutting = false;
  let hasCelupPrint = false;

  for (const mo of lineMos) {
    if (mo.state === 'cancel') continue;
    const isFabric = isFabricOrPrintMo(mo);
    const wos = wosByMoId.get(mo.id) || [];
    const wips = wipsByMoId.get(mo.id) || [];

    // 1. Check Vendor WIP records (richest signal for vendor-manufactured goods)
    for (const w of wips) {
      const gradeA = Number(w.x_studio_qty_kirim_a_grade || 0);
      const gradeB = Number(w.x_studio_qty_kirim_b_grade || 0);
      const qcPass = Number(w.x_studio_qty_qc_pass_1 || 0);
      const sfpIn = Number(w.x_studio_qty_masuk_sfp || 0);
      const actualCut = Number(w.x_studio_actual_cutting || 0);
      const kainRecv = Number(w.x_studio_kain_dari_gudang_qty || 0);
      const qcStatus = String(w.x_studio_qc_status || '').trim();

      if (sfpIn > 0 || qcPass > 0 || qcStatus || gradeA > 0 || gradeB > 0) {
        hasQcPacking = true;
      } else if (actualCut > 0) {
        // Cutting count submitted by vendor -> now in sewing/finishing
        hasJahit = true;
      } else if (kainRecv > 0) {
        // Fabric delivered to vendor -> in cutting stage
        hasCutting = true;
      }
    }

    // 2. Check Workorders (for in-house pabrik / digital printing / dyeing MOs)
    for (const wo of wos) {
      const active = wo.state === 'progress' || wo.state === 'done' || Number(wo.qty_produced || 0) > 0;
      if (!active) continue;
      const wcLabel = `${wo.workcenter_id?.[1] || ''} ${wo.name || ''}`;
      if (isQcPackingWorkcenter(wcLabel)) hasQcPacking = true;
      else if (isSewingWorkcenter(wcLabel)) hasJahit = true;
      else if (isCuttingWorkcenter(wcLabel)) hasCutting = true;
      else if (isDyePrintWorkcenter(wcLabel)) hasCelupPrint = true;
    }

    // 3. Fallback MO state signals
    if (isFabric) {
      if (['confirmed', 'progress', 'to_close', 'done'].includes(mo.state)) {
        hasCelupPrint = true;
      }
    } else {
      if (mo.state === 'done' || mo.state === 'to_close') {
        hasQcPacking = true;
      } else if (mo.state === 'progress' || Number(mo.qty_producing || 0) > 0) {
        hasJahit = true;
      }
    }
  }

  // Also check SO-level fabric/printing MOs (e.g. WHDGP/MO producing KAIN MOTIF for KRD MOTIF SO lines)
  if (!hasQcPacking && !hasJahit && !hasCutting && !hasCelupPrint && soFabricMos.length > 0) {
    for (const fmo of soFabricMos) {
      if (['confirmed', 'progress', 'to_close', 'done'].includes(fmo.state)) {
        hasCelupPrint = true;
        break;
      }
    }
  }

  if (hasQcPacking) return 'qc_packing';
  if (hasJahit) return 'jahit';
  if (hasCutting) return 'cutting';
  if (hasCelupPrint) return 'celup_print';
  return 'persiapan_bahan';
}

/**
 * Exact user-confirmed health status rule:
 * - Selesai: qty_po > 0 && qty_selesai >= qty_po (pct_finish >= 100)
 * - Terlambat: belum selesai && lewat Plan Delivery (daysRemaining < 0)
 * - Perlu Perhatian: belum selesai && belum lewat Plan Delivery (daysRemaining >= 0)
 *                    && daysRemaining <= 7 && pctFinish < 80
 * - On Track: semua kondisi lain yang belum selesai
 */
export function classifyHealthStatus({ qtyPo, qtySelesai, pctFinish, daysRemaining }) {
  if (qtyPo > 0 && qtySelesai >= qtyPo) {
    return 'selesai';
  }
  if (daysRemaining !== null && daysRemaining < 0) {
    return 'terlambat';
  }
  if (daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 7 && pctFinish < 80) {
    return 'perlu_perhatian';
  }
  return 'on_track';
}

/**
 * Build aggregate metrics (KPIs, status counts, stage breakdown, weekly delivery buckets, attention items)
 * from any filtered or full array of PO line items.
 */
export function computeDashboardAggregates(items) {
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
    WIP_STAGES.map((s) => [
      s.key,
      { key: s.key, label: s.label, order: s.order, qty_po: 0, item_count: 0, po_set: new Set() }
    ])
  );

  const weekMap = new Map();
  let unscheduledQty = 0;
  let unscheduledCount = 0;

  const attentionItems = [];

  for (const item of items) {
    totalQtyPo += item.qty_po;
    totalQtySfp += item.qty_sfp;
    totalQtyDelivered += item.qty_delivered;
    totalQtySelesai += item.qty_selesai;
    totalQtySisa += item.qty_sisa;
    distinctPoSet.add(item.no_po_kss);

    if (statusCounts[item.health_status] !== undefined) {
      statusCounts[item.health_status] += 1;
    }

    const st = stageMap.get(item.stage_key);
    if (st) {
      st.qty_po += item.qty_po;
      st.item_count += 1;
      st.po_set.add(item.no_po_kss);
    }

    if (item.health_status === 'terlambat' || item.health_status === 'perlu_perhatian') {
      attentionItems.push(item);
    }

    const weekKey = getMondayWeekKey(item.plan_delivery);
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
      w.qty_po += item.qty_po;
      w.qty_selesai_actual += item.qty_selesai;
      w.qty_selesai_capped += Math.min(item.qty_po, item.qty_selesai);
      w.qty_sisa += item.qty_sisa;
      w.item_count += 1;
    } else {
      unscheduledQty += item.qty_po;
      unscheduledCount += 1;
    }
  }

  const pctFinishOverall =
    totalQtyPo > 0 ? Math.round((totalQtySelesai / totalQtyPo) * 1000) / 10 : 0;

  const stages = Array.from(stageMap.values())
    .sort((a, b) => a.order - b.order)
    .map(({ po_set, ...rest }) => ({
      ...rest,
      po_count: po_set.size
    }));

  const weekly = Array.from(weekMap.values()).sort((a, b) =>
    a.week_start.localeCompare(b.week_start)
  );

  // Sort attention items: Terlambat first (most overdue first), then Perlu Perhatian (nearest deadline first)
  attentionItems.sort((a, b) => {
    if (a.health_status !== b.health_status) {
      return a.health_status === 'terlambat' ? -1 : 1;
    }
    const da = a.days_remaining ?? 9999;
    const db = b.days_remaining ?? 9999;
    return da - db;
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
      pct_finish: pctFinishOverall,
      status_counts: statusCounts,
      unscheduled_qty: Math.round(unscheduledQty * 100) / 100,
      unscheduled_count: unscheduledCount
    },
    stages,
    weekly,
    attention_items: attentionItems
  };
}

/**
 * Sync a single buyer's live External SO WIP snapshot from Odoo.
 * Lightweight: ~5-6 batched RPC calls total per buyer.
 */
export async function syncBuyerSnapshotFromOdoo(buyerConfig) {
  const startedAt = Date.now();
  const odoo = getOdooClient();
  const partnerIds = buyerConfig.odoo_partner_ids || [];

  if (partnerIds.length === 0) {
    throw new Error('Konfigurasi buyer belum memiliki Partner ID Odoo.');
  }

  // 1. Fetch confirmed External non-SAMPLE Sale Orders for this buyer's partner(s)
  const soDomain = [
    ['state', '=', 'sale'],
    ['x_studio_jenis_so', '=', 'Eksternal'],
    ['partner_id', 'in', partnerIds],
    ['name', 'not ilike', 'SAMPLE']
  ];

  const orders = await odoo.executeKw('sale.order', 'search_read', [soDomain], {
    fields: [
      'id',
      'name',
      'partner_id',
      'date_order',
      'x_studio_po_customer',
      'commitment_date',
      'x_studio_no_po_customer',
      'client_order_ref',
      'order_line'
    ],
    order: 'commitment_date asc, date_order desc',
    limit: 500
  });

  const startDateFilter = buyerConfig.start_date ? String(buyerConfig.start_date).trim() : '';

  if (!orders || orders.length === 0) {
    const emptyAgg = computeDashboardAggregates([]);
    return {
      buyer_name: buyerConfig.buyer_name,
      start_date: startDateFilter,
      synced_at: new Date().toISOString(),
      sync_duration_ms: Date.now() - startedAt,
      ...emptyAgg,
      items: []
    };
  }

  const orderById = new Map(orders.map((o) => [o.id, o]));
  const allLineIds = orders.flatMap((o) => o.order_line || []);

  // 2. Batch-read all Sale Order Lines
  const allLines = [];
  for (let i = 0; i < allLineIds.length; i += 300) {
    const chunk = allLineIds.slice(i, i + 300);
    const rows = await odoo.executeKw('sale.order.line', 'read', [chunk], {
      fields: [
        'id',
        'order_id',
        'display_type',
        'product_id',
        'name',
        'x_studio_sku',
        'x_studio_warna_buyer',
        'product_uom_qty',
        'x_studio_qty_sfp_done',
        'qty_delivered'
      ]
    });
    allLines.push(...(rows || []));
  }

  // Keep only real product lines with positive qty; apply start_date filter (keep open older POs!)
  const validLines = [];
  const relevantSoIds = new Set();
  const relevantSoNames = new Set();
  const productIdsSet = new Set();

  for (const line of allLines) {
    if (line.display_type) continue;
    const qtyPo = Number(line.product_uom_qty || 0);
    if (qtyPo <= 0 || !line.product_id) continue;

    const so = orderById.get(line.order_id?.[0]);
    if (!so) continue;

    const qtySfp = Number(line.x_studio_qty_sfp_done || 0);
    const qtyDelivered = Number(line.qty_delivered || 0);
    const qtySelesai = Math.max(qtySfp, qtyDelivered);
    const isCompleted = qtySelesai >= qtyPo;

    const tglPo = toWibDateStr(so.x_studio_po_customer) || toWibDateStr(so.date_order);
    const planDelivery = toWibDateStr(so.commitment_date);

    // Date scope: filter by Plan Delivery (fallback Tgl PO) >= start_date when configured
    if (startDateFilter) {
      const refDate = planDelivery || tglPo || '';
      if (refDate && refDate < startDateFilter) {
        continue;
      }
    }

    validLines.push({ line, so, tglPo, planDelivery, qtyPo, qtySfp, qtyDelivered, qtySelesai });
    relevantSoIds.add(so.id);
    relevantSoNames.add(so.name);
    productIdsSet.add(line.product_id[0]);
  }

  // 3. Parallel fetch: product.product metadata + linked mrp.production records
  const productIds = Array.from(productIdsSet);
  const soIdsArr = Array.from(relevantSoIds);
  const soNamesArr = Array.from(relevantSoNames);

  const [productRows, mos] = await Promise.all([
    (async () => {
      const out = [];
      for (let i = 0; i < productIds.length; i += 300) {
        const chunk = productIds.slice(i, i + 300);
        const rows = await odoo.executeKw('product.product', 'read', [chunk], {
          fields: ['id', 'default_code', 'name', 'display_name']
        });
        out.push(...(rows || []));
      }
      return out;
    })(),
    soIdsArr.length > 0
      ? (async () => {
          const moById = new Map();
          const CHUNK_SIZE = 35;
          const chunkPromises = [];
          for (let i = 0; i < soIdsArr.length; i += CHUNK_SIZE) {
            const subIds = soIdsArr.slice(i, i + CHUNK_SIZE);
            const subNames = subIds.map((id) => orderById.get(id)?.name).filter(Boolean);
            chunkPromises.push(
              odoo.executeKw(
                'mrp.production',
                'search_read',
                [
                  [
                    '&',
                    ['state', '!=', 'cancel'],
                    '|',
                    ['x_studio_sales_order', 'in', subIds],
                    ['origin', 'in', subNames]
                  ]
                ],
                {
                  fields: [
                    'id',
                    'name',
                    'product_id',
                    'state',
                    'product_qty',
                    'qty_producing',
                    'x_studio_sales_order',
                    'origin',
                    'picking_type_id',
                    'workorder_ids'
                  ],
                  order: 'id desc',
                  limit: 1500
                }
              )
            );
          }
          const results = await Promise.all(chunkPromises);
          for (const rows of results) {
            for (const m of rows || []) {
              moById.set(m.id, m);
            }
          }
          return Array.from(moById.values());
        })()
      : Promise.resolve([])
  ]);

  const productById = new Map(productRows.map((p) => [p.id, p]));

  // 4. Parallel fetch: workorders + vendor WIP records for discovered MOs
  const moIds = (mos || []).map((m) => m.id);
  const [workorders, wipRecords] =
    moIds.length > 0
      ? await Promise.all([
          (async () => {
            const out = [];
            for (let i = 0; i < moIds.length; i += 400) {
              const chunk = moIds.slice(i, i + 400);
              const rows = await odoo.executeKw(
                'mrp.workorder',
                'search_read',
                [[['production_id', 'in', chunk]]],
                {
                  fields: ['id', 'production_id', 'workcenter_id', 'state', 'name', 'qty_produced'],
                  limit: 2000
                }
              );
              out.push(...(rows || []));
            }
            return out;
          })(),
          (async () => {
            const out = [];
            for (let i = 0; i < moIds.length; i += 400) {
              const chunk = moIds.slice(i, i + 400);
              const rows = await odoo.executeKw(
                'x_monitoring_wip_vendo',
                'search_read',
                [[['x_studio_manufacturing_order', 'in', chunk]]],
                {
                  fields: [
                    'id',
                    'x_studio_manufacturing_order',
                    'x_studio_kain_dari_gudang_qty',
                    'x_studio_actual_cutting',
                    'x_studio_qty_kirim_a_grade',
                    'x_studio_qty_kirim_b_grade',
                    'x_studio_qty_qc_pass_1',
                    'x_studio_qc_status',
                    'x_studio_qty_masuk_sfp'
                  ],
                  limit: 2000
                }
              );
              out.push(...(rows || []));
            }
            return out;
          })()
        ])
      : [[], []];

  // Index workorders & WIPs by MO ID
  const wosByMoId = new Map();
  for (const wo of workorders || []) {
    const mid = wo.production_id?.[0];
    if (!mid) continue;
    if (!wosByMoId.has(mid)) wosByMoId.set(mid, []);
    wosByMoId.get(mid).push(wo);
  }

  const wipsByMoId = new Map();
  for (const w of wipRecords || []) {
    const mid = w.x_studio_manufacturing_order?.[0];
    if (!mid) continue;
    if (!wipsByMoId.has(mid)) wipsByMoId.set(mid, []);
    wipsByMoId.get(mid).push(w);
  }

  // Index MOs by (soKey + productId) and SO-level fabric MOs by soKey
  const mosBySoAndProduct = new Map();
  const fabricMosBySoKey = new Map();

  for (const mo of mos || []) {
    const soId = Array.isArray(mo.x_studio_sales_order) ? mo.x_studio_sales_order[0] : null;
    const soName = Array.isArray(mo.x_studio_sales_order)
      ? mo.x_studio_sales_order[1]
      : String(mo.origin || '').trim();
    const keys = [];
    if (soId) keys.push(`id:${soId}`);
    if (soName) keys.push(`name:${soName}`);

    const prodId = mo.product_id?.[0];
    const isFabric = isFabricOrPrintMo(mo);

    for (const k of keys) {
      if (prodId) {
        const pk = `${k}|p:${prodId}`;
        if (!mosBySoAndProduct.has(pk)) mosBySoAndProduct.set(pk, []);
        mosBySoAndProduct.get(pk).push(mo);
      }
      if (isFabric) {
        if (!fabricMosBySoKey.has(k)) fabricMosBySoKey.set(k, []);
        fabricMosBySoKey.get(k).push(mo);
      }
    }
  }

  const todayWib = getTodayWibDateStr();
  const items = [];

  for (const entry of validLines) {
    const { line, so, tglPo, planDelivery, qtyPo, qtySfp, qtyDelivered, qtySelesai } = entry;
    const prodId = line.product_id[0];
    const productRec = productById.get(prodId);
    const { sku, artikel, warna } = parseProductPresentation(line, productRec);

    // Deduplicate matched MOs across id & name keys
    const moSet = new Map();
    for (const m of mosBySoAndProduct.get(`id:${so.id}|p:${prodId}`) || []) moSet.set(m.id, m);
    for (const m of mosBySoAndProduct.get(`name:${so.name}|p:${prodId}`) || []) moSet.set(m.id, m);
    const lineMos = Array.from(moSet.values());

    const fabricMoSet = new Map();
    for (const m of fabricMosBySoKey.get(`id:${so.id}`) || []) fabricMoSet.set(m.id, m);
    for (const m of fabricMosBySoKey.get(`name:${so.name}`) || []) fabricMoSet.set(m.id, m);
    const soFabricMos = Array.from(fabricMoSet.values());

    const qtySisa = Math.max(0, Math.round((qtyPo - qtySelesai) * 100) / 100);
    const pctFinish = qtyPo > 0 ? Math.round((qtySelesai / qtyPo) * 1000) / 10 : 0;
    const daysRemaining = planDelivery ? diffCalendarDays(planDelivery, todayWib) : null;

    const stageKey = classifyLineStage({
      qtyPo,
      qtySfp,
      qtyDelivered,
      qtySelesai,
      lineMos,
      soFabricMos,
      wosByMoId,
      wipsByMoId
    });

    const healthStatus = classifyHealthStatus({
      qtyPo,
      qtySelesai,
      pctFinish,
      daysRemaining
    });

    items.push({
      id: line.id,
      so_id: so.id,
      tgl_po: tglPo,
      plan_delivery: planDelivery,
      no_po_kss: so.name,
      no_po_buyer: String(so.x_studio_no_po_customer || so.client_order_ref || '').trim() || '-',
      sku,
      nama_artikel: artikel,
      warna,
      qty_po: Math.round(qtyPo * 100) / 100,
      qty_sfp: Math.round(qtySfp * 100) / 100,
      qty_delivered: Math.round(qtyDelivered * 100) / 100,
      qty_selesai: Math.round(qtySelesai * 100) / 100,
      qty_sisa: qtySisa,
      pct_finish: pctFinish,
      stage_key: stageKey,
      stage_label: STAGE_LABEL_BY_KEY[stageKey] || 'Persiapan Bahan',
      health_status: healthStatus,
      days_remaining: daysRemaining,
      mo_count: lineMos.length
    });
  }

  // Sort by nearest Plan Delivery (unscheduled at end), then No PO KSS, then Artikel
  items.sort((a, b) => {
    const pa = a.plan_delivery || '9999-12-31';
    const pb = b.plan_delivery || '9999-12-31';
    if (pa !== pb) return pa.localeCompare(pb);
    if (a.no_po_kss !== b.no_po_kss) return a.no_po_kss.localeCompare(b.no_po_kss);
    return a.nama_artikel.localeCompare(b.nama_artikel);
  });

  const aggregates = computeDashboardAggregates(items);

  return {
    buyer_name: buyerConfig.buyer_name,
    start_date: startDateFilter,
    today_wib: todayWib,
    synced_at: new Date().toISOString(),
    sync_duration_ms: Date.now() - startedAt,
    ...aggregates,
    items
  };
}

/**
 * List distinct External Buyers from Odoo confirmed non-SAMPLE External SOs
 * so Admin can pick 1 or multiple partners cleanly when creating a buyer dashboard link.
 */
export async function listOdooExternalBuyers() {
  const odoo = getOdooClient();
  const sos = await odoo.executeKw(
    'sale.order',
    'search_read',
    [
      [
        ['state', '=', 'sale'],
        ['x_studio_jenis_so', '=', 'Eksternal'],
        ['name', 'not ilike', 'SAMPLE']
      ]
    ],
    {
      fields: ['id', 'partner_id', 'date_order', 'order_line'],
      order: 'date_order desc',
      limit: 1000
    }
  );

  const byPartner = new Map();
  for (const so of sos || []) {
    const pid = so.partner_id?.[0];
    const pname = so.partner_id?.[1];
    if (!pid || !pname) continue;
    if (!byPartner.has(pid)) {
      byPartner.set(pid, {
        partner_id: pid,
        partner_name: pname,
        so_count: 0,
        line_count: 0,
        latest_order_date: toWibDateStr(so.date_order)
      });
    }
    const rec = byPartner.get(pid);
    rec.so_count += 1;
    rec.line_count += (so.order_line || []).length;
  }

  return Array.from(byPartner.values()).sort((a, b) => b.so_count - a.so_count);
}
