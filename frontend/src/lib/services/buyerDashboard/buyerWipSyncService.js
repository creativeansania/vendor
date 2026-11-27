import { adminOdooClient, defaultOdooClient } from '../../odoo/odooClient.js';

export const WIP_STAGES = [
  { key: 'persiapan_bahan', label: 'Persiapan Bahan', order: 1 },
  { key: 'dyeing', label: 'Dyeing / Celup', order: 2 },
  { key: 'digital_printing', label: 'Digital Printing', order: 3 },
  { key: 'cutting_sewing_finishing', label: 'Cutting, Sewing & Finishing', order: 4 },
  { key: 'selesai', label: 'Close / Selesai', order: 5 }
];

const STAGE_LABEL_BY_KEY = Object.fromEntries(WIP_STAGES.map((s) => [s.key, s.label]));

const ACTIVE_MO_STATES = new Set(['confirmed', 'progress', 'to_close']);
const OPEN_MO_STATES = new Set(['draft', 'confirmed', 'progress', 'to_close']);

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
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
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
  const dow = dt.getUTCDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + diffToMon);
  return dt.toISOString().slice(0, 10);
}

function normalizeToken(val) {
  return String(val || '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const NON_COLOR_VARIANT_RE =
  /^(A\s*\(GRADE\s*A\)|B\s*\(GRADE\s*B\)|GRADE\s*[AB]|PACKING\s*ROLL|ZIPLOCK|PLASTIK\s*SATUAN|POUCH|HARD\s*BOX|SOFT\s*BOX|JAHIT\s*TEPI.*|LASERCUT|NECI.*|SONIC|RAWIS|STIK|PICOT|EYELASH|OVERDECK|DOUBLE\s*STIK|SINGLE\s*STIK)$/i;

/**
 * Extract normalized color/variant tokens from Odoo product display name `... (COLOR, ...)`.
 */
function extractVariantColorTokens(displayName) {
  const cleaned = String(displayName || '').replace(/^\[[^\]]+\]\s*/, '').trim();
  const parenMatch = cleaned.match(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/);
  if (!parenMatch) return [];

  const tokens = [];
  for (const rawPart of parenMatch[1].split(',')) {
    const part = normalizeToken(rawPart);
    if (!part || NON_COLOR_VARIANT_RE.test(part)) continue;
    tokens.push(part);
  }
  return tokens;
}

/**
 * Extract clean article name, SKU, buyer color, and internal color tokens.
 */
function parseProductPresentation(line, productRec) {
  const rawDisplay = productRec?.display_name || line.product_id?.[1] || line.name || '-';
  const sku = String(line.x_studio_sku || productRec?.default_code || '').trim();

  let cleaned = rawDisplay.replace(/^\[[^\]]+\]\s*/, '').trim();
  const internalColors = extractVariantColorTokens(rawDisplay);

  const parenMatch = cleaned.match(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/);
  if (parenMatch) {
    cleaned = cleaned.slice(0, parenMatch.index).trim();
  }

  const artikel = String(productRec?.name || cleaned || rawDisplay).trim();
  const warna = String(line.x_studio_warna_buyer || internalColors[0] || '-').trim();

  const matchColors = new Set(internalColors);
  if (line.x_studio_warna_buyer) {
    const wb = normalizeToken(line.x_studio_warna_buyer);
    if (wb && wb !== '-') matchColors.add(wb);
  }

  return { sku: sku || '-', artikel, warna, matchColors };
}

function isPbMo(mo) {
  return /^PB/i.test(String(mo.name || '').trim());
}

function isWhdgpMo(mo) {
  return /^WHDGP/i.test(String(mo.name || '').trim());
}

function isVdMo(mo) {
  return /^VD/i.test(String(mo.name || '').trim());
}

function resolveEffectiveCategory(so, soMos) {
  const explicit = normalizeToken(so.x_studio_category);
  if (explicit === 'POLOS') return 'POLOS';
  if (explicit === 'DIGITAL PRINT') return 'DIGITAL PRINT';

  // Fallback when x_studio_category is still empty on historical SOs
  if (soMos.some((m) => isWhdgpMo(m))) return 'DIGITAL PRINT';
  if (/DIGITAL/i.test(String(so.x_studio_jenis_produk || ''))) return 'DIGITAL PRINT';
  return 'POLOS';
}

/**
 * Match MOs belonging to the same SO to a specific SO line ("untuk warna tsb"):
 * 1) Exact product_id match (always authoritative for VD*, WHGB*, and direct WHDGP* MOs).
 * 2) Internal variant color / buyer color token match (bridges KAIN/PB/WHDGP MOs to KRD SO lines).
 */
function getLineMatchedMos(soMos, lineProdId, lineMatchColors) {
  const matched = [];
  for (const mo of soMos) {
    if (mo.state === 'cancel') continue;
    const moProdId = mo.product_id?.[0];
    if (moProdId && moProdId === lineProdId) {
      matched.push(mo);
      continue;
    }
    if (lineMatchColors.size > 0 && mo._colorTokens && mo._colorTokens.length > 0) {
      if (mo._colorTokens.some((tok) => lineMatchColors.has(tok))) {
        matched.push(mo);
      }
    }
  }
  return matched;
}

/**
 * Factory-confirmed WIP stage classifier based on `sale.order.x_studio_category` + MO prefix/state:
 *
 * POLOS:
 * - Persiapan Bahan           : semua MO statusnya draft (atau belum ada MO)
 * - Dyeing / Celup            : ada MO kode PB* berstatus confirmed/progress untuk warna tsb
 * - Cutting, Sewing & Finishing: ada MO kode VD* (atau in-house non-PB/WHDGP) berstatus confirmed/progress untuk warna tsb
 * - Close / Selesai           : % Finish >= 100% ATAU sudah ada MO & tidak ada lagi MO berstatus draft/confirmed/progress
 *
 * DIGITAL PRINT:
 * - Persiapan Bahan           : semua MO statusnya draft (atau belum ada MO)
 * - Dyeing / Celup            : ada MO kode PB* berstatus confirmed/progress untuk SO tsb
 * - Digital Printing          : ada MO kode WHDGP* berstatus confirmed/progress untuk warna tsb
 * - Cutting, Sewing & Finishing: ada MO kode VD* berstatus confirmed/progress untuk warna tsb
 * - Close / Selesai           : % Finish >= 100% ATAU sudah ada MO & tidak ada lagi MO berstatus draft/confirmed/progress
 */
function classifyLineStage({
  category,
  qtyPo,
  qtySelesai,
  lineMos,
  soPbMos
}) {
  // 1. Close / Selesai by completed quantity (>= 100%)
  if (qtyPo > 0 && qtySelesai >= qtyPo) {
    return 'selesai';
  }

  // Relevant MOs for determining whether any MO is still open (draft/confirmed/progress/to_close)
  const relevantMap = new Map();
  for (const m of lineMos) relevantMap.set(m.id, m);
  if (category === 'DIGITAL PRINT') {
    for (const m of soPbMos) relevantMap.set(m.id, m);
  }
  const relevantMos = Array.from(relevantMap.values());

  // 2. Close / Selesai by MO completion: minimal ada 1 MO & tidak ada lagi draft/confirmed/progress/to_close
  if (relevantMos.length > 0) {
    const hasAnyOpenMo = relevantMos.some((m) => OPEN_MO_STATES.has(m.state));
    if (!hasAnyOpenMo) {
      return 'selesai';
    }
  }

  // 3. Cutting, Sewing & Finishing: VD* active (or in-house FG non-PB/non-WHDGP active) for this color
  const hasActiveVd = lineMos.some(
    (m) =>
      ACTIVE_MO_STATES.has(m.state) &&
      (isVdMo(m) || (!isPbMo(m) && !isWhdgpMo(m)))
  );
  if (hasActiveVd) {
    return 'cutting_sewing_finishing';
  }

  // 4. Digital Printing (DIGITAL PRINT only): WHDGP* active for this color
  if (category === 'DIGITAL PRINT') {
    const hasActiveWhdgp = lineMos.some((m) => isWhdgpMo(m) && ACTIVE_MO_STATES.has(m.state));
    if (hasActiveWhdgp) {
      return 'digital_printing';
    }
  }

  // 5. Dyeing / Celup:
  //    - POLOS        -> PB* active for this color
  //    - DIGITAL PRINT -> PB* active for this SO
  const pbPool = category === 'DIGITAL PRINT' ? soPbMos : lineMos.filter(isPbMo);
  const hasActivePb = pbPool.some((m) => ACTIVE_MO_STATES.has(m.state));
  if (hasActivePb) {
    return 'dyeing';
  }

  // Transition handoff preservation: if upstream stage is already 'done' while downstream MO is still 'draft',
  // reflect the furthest completed stage rather than reverting to Persiapan Bahan.
  if (lineMos.some((m) => isVdMo(m) && m.state === 'done')) {
    return 'cutting_sewing_finishing';
  }
  if (category === 'DIGITAL PRINT' && lineMos.some((m) => isWhdgpMo(m) && m.state === 'done')) {
    return 'digital_printing';
  }
  if (pbPool.some((m) => m.state === 'done')) {
    return 'dyeing';
  }

  // 6. Default: Persiapan Bahan (all MOs draft or no MOs created yet)
  return 'persiapan_bahan';
}

/**
 * Health status rule:
 * - Selesai: qty_selesai >= qty_po OR WIP stage is Close / Selesai (no open MOs left)
 * - Terlambat: belum selesai && lewat Plan Delivery (daysRemaining < 0)
 * - Perlu Perhatian: belum selesai && belum lewat Plan Delivery && daysRemaining <= 7 && pctFinish < 80
 * - On Track: semua kondisi lain yang belum selesai
 */
export function classifyHealthStatus({ qtyPo, qtySelesai, pctFinish, daysRemaining, stageKey }) {
  if ((qtyPo > 0 && qtySelesai >= qtyPo) || stageKey === 'selesai') {
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
 * Build aggregate metrics (KPIs, status counts, stage breakdown, weekly delivery buckets, attention items).
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
 * Super lightweight: ~3-4 batched RPC calls total per buyer (no workorder/wip_vendo fetch needed).
 */
export async function syncBuyerSnapshotFromOdoo(buyerConfig) {
  const startedAt = Date.now();
  const odoo = getOdooClient();
  const partnerIds = buyerConfig.odoo_partner_ids || [];

  if (partnerIds.length === 0) {
    throw new Error('Konfigurasi buyer belum memiliki Partner ID Odoo.');
  }

  // 1. Fetch confirmed External non-SAMPLE Sale Orders (including x_studio_category & x_studio_jenis_produk)
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
      'x_studio_category',
      'x_studio_jenis_produk',
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

  const validLines = [];
  const relevantSoIds = new Set();
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

    const tglPo = toWibDateStr(so.x_studio_po_customer) || toWibDateStr(so.date_order);
    const planDelivery = toWibDateStr(so.commitment_date);

    if (startDateFilter) {
      const refDate = planDelivery || tglPo || '';
      if (refDate && refDate < startDateFilter) {
        continue;
      }
    }

    validLines.push({ line, so, tglPo, planDelivery, qtyPo, qtySfp, qtyDelivered, qtySelesai });
    relevantSoIds.add(so.id);
    productIdsSet.add(line.product_id[0]);
  }

  // 3. Parallel fetch: product.product metadata + chunked mrp.production records
  const productIds = Array.from(productIdsSet);
  const soIdsArr = Array.from(relevantSoIds);

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
                    'x_studio_sales_order',
                    'origin'
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

  // Pre-extract color tokens on each MO and index MOs by SO key
  const mosBySoKey = new Map();
  for (const mo of mos || []) {
    mo._colorTokens = extractVariantColorTokens(mo.product_id?.[1]);
    const soId = Array.isArray(mo.x_studio_sales_order) ? mo.x_studio_sales_order[0] : null;
    const soName = Array.isArray(mo.x_studio_sales_order)
      ? mo.x_studio_sales_order[1]
      : String(mo.origin || '').trim();
    const keys = [];
    if (soId) keys.push(`id:${soId}`);
    if (soName) keys.push(`name:${soName}`);

    for (const k of keys) {
      if (!mosBySoKey.has(k)) mosBySoKey.set(k, new Map());
      mosBySoKey.get(k).set(mo.id, mo);
    }
  }

  // Pre-compute deduplicated SO MOs & effective category per SO
  const soContextMap = new Map();
  for (const soId of relevantSoIds) {
    const so = orderById.get(soId);
    const moMap = new Map();
    for (const [mid, m] of mosBySoKey.get(`id:${so.id}`) || []) moMap.set(mid, m);
    for (const [mid, m] of mosBySoKey.get(`name:${so.name}`) || []) moMap.set(mid, m);
    const soMos = Array.from(moMap.values());
    const soPbMos = soMos.filter(isPbMo);
    const category = resolveEffectiveCategory(so, soMos);
    soContextMap.set(soId, { soMos, soPbMos, category });
  }

  const todayWib = getTodayWibDateStr();
  const items = [];

  for (const entry of validLines) {
    const { line, so, tglPo, planDelivery, qtyPo, qtySfp, qtyDelivered, qtySelesai } = entry;
    const prodId = line.product_id[0];
    const productRec = productById.get(prodId);
    const { sku, artikel, warna, matchColors } = parseProductPresentation(line, productRec);

    const { soMos, soPbMos, category } = soContextMap.get(so.id) || {
      soMos: [],
      soPbMos: [],
      category: 'POLOS'
    };

    const lineMos = getLineMatchedMos(soMos, prodId, matchColors);

    const qtySisa = Math.max(0, Math.round((qtyPo - qtySelesai) * 100) / 100);
    const pctFinish = qtyPo > 0 ? Math.round((qtySelesai / qtyPo) * 1000) / 10 : 0;
    const daysRemaining = planDelivery ? diffCalendarDays(planDelivery, todayWib) : null;

    const stageKey = classifyLineStage({
      category,
      qtyPo,
      qtySelesai,
      lineMos,
      soPbMos
    });

    const healthStatus = classifyHealthStatus({
      qtyPo,
      qtySelesai,
      pctFinish,
      daysRemaining,
      stageKey
    });

    items.push({
      id: line.id,
      so_id: so.id,
      so_category: category,
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
 * List distinct External Buyers from Odoo confirmed non-SAMPLE External SOs.
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
