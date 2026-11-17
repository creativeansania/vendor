import { adminOdooClient } from '../odoo/odooClient.js';

const NO_TRACK_CTX = { tracking_disable: true, no_automation: true, mail_auto_delete: true };
const ODOO_BOT_USER_ID = 1;
const FALLBACK_SALES_INTERNAL_NAME = 'Sales Internal';
const FALLBACK_SALES_INTERNAL_ID = 8;

let cachedSaleOrderModelId = null;
let cachedTodoActivityTypeId = null;
let cachedSalesInternalId = null;

function formatQty(val) {
  const num = Number(val) || 0;
  return Number.isInteger(num)
    ? num.toLocaleString('id-ID')
    : num.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatWibDateOnly(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function formatWibDateTime(odooUtcStr) {
  if (!odooUtcStr) return '-';
  const iso = odooUtcStr.includes('T') ? odooUtcStr : `${odooUtcStr.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return odooUtcStr;
  return `${new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(d)} WIB`;
}

/**
 * Determine if a stock.picking record is a Done Vendor SFP transfer.
 */
export function isVendorSfpPicking(picking) {
  if (!picking || picking.state !== 'done') return false;
  const upperName = String(picking.name || '').trim().toUpperCase();
  const ptName = Array.isArray(picking.picking_type_id)
    ? String(picking.picking_type_id[1] || '').toUpperCase()
    : '';
  return upperName.includes('/SFP/') && (upperName.startsWith('VD') || ptName.includes('VENDOR'));
}

async function getSaleOrderModelId(odoo) {
  if (cachedSaleOrderModelId) return cachedSaleOrderModelId;
  const models = await odoo._callObject('ir.model', 'search_read', [
    [['model', '=', 'sale.order']]
  ], { fields: ['id'], limit: 1 });
  cachedSaleOrderModelId = models?.[0]?.id || 805;
  return cachedSaleOrderModelId;
}

async function getTodoActivityTypeId(odoo) {
  if (cachedTodoActivityTypeId) return cachedTodoActivityTypeId;
  const types = await odoo._callObject('mail.activity.type', 'search_read', [
    [['name', '=', 'To-Do']]
  ], { fields: ['id'], limit: 1 });
  cachedTodoActivityTypeId = types?.[0]?.id || 4;
  return cachedTodoActivityTypeId;
}

async function getSalesInternalUserId(odoo) {
  if (cachedSalesInternalId) return cachedSalesInternalId;
  const users = await odoo._callObject('res.users', 'search_read', [
    [['name', '=', FALLBACK_SALES_INTERNAL_NAME], ['active', '=', true]]
  ], { fields: ['id'], limit: 1 });
  cachedSalesInternalId = users?.[0]?.id || FALLBACK_SALES_INTERNAL_ID;
  return cachedSalesInternalId;
}

/**
 * Resolve responsible user ID on a Sales Order:
 * so.user_id -> so.create_uid (excluding OdooBot) -> Sales Internal fallback.
 */
async function resolveSoResponsibleUserId(odoo, so) {
  const candidates = [];
  if (Array.isArray(so.user_id) && so.user_id[0] && so.user_id[0] !== ODOO_BOT_USER_ID) {
    candidates.push(so.user_id[0]);
  }
  if (Array.isArray(so.create_uid) && so.create_uid[0] && so.create_uid[0] !== ODOO_BOT_USER_ID) {
    if (!candidates.includes(so.create_uid[0])) {
      candidates.push(so.create_uid[0]);
    }
  }

  if (candidates.length > 0) {
    const activeUsers = await odoo._callObject('res.users', 'search_read', [
      [['id', 'in', candidates], ['active', '=', true]]
    ], { fields: ['id'] });
    const activeSet = new Set((activeUsers || []).map((u) => u.id));
    for (const cid of candidates) {
      if (activeSet.has(cid)) return cid;
    }
  }

  return getSalesInternalUserId(odoo);
}

/**
 * Resolve linked Sales Order ID(s) from a stock.picking record, falling back
 * to MO references in case transfer-mo-reference hasn't written x_studio_sales_order yet.
 */
async function resolveSalesOrderIdsForPicking(odoo, picking) {
  const soIds = new Set();
  if (Array.isArray(picking.sale_id) && picking.sale_id[0]) {
    soIds.add(picking.sale_id[0]);
  }
  if (Array.isArray(picking.x_studio_sales_order) && picking.x_studio_sales_order[0]) {
    soIds.add(picking.x_studio_sales_order[0]);
  }
  if (soIds.size > 0) return Array.from(soIds);

  const moIds = new Set();
  if (Array.isArray(picking.x_studio_manufacturing_order) && picking.x_studio_manufacturing_order[0]) {
    moIds.add(picking.x_studio_manufacturing_order[0]);
  }

  if (moIds.size === 0 && picking.origin) {
    const moTokens = String(picking.origin)
      .split(/[,|]/)
      .map((s) => s.trim())
      .filter((s) => s.includes('/MO/'));
    if (moTokens.length > 0) {
      const mos = await odoo._callObject('mrp.production', 'search_read', [
        [['name', 'in', [...new Set(moTokens)]]]
      ], { fields: ['id'] });
      for (const m of mos || []) moIds.add(m.id);
    }
  }

  if (moIds.size === 0) return [];

  const mos = await odoo._callObject('mrp.production', 'read', [
    Array.from(moIds),
    ['id', 'x_studio_sales_order', 'sale_line_id', 'origin']
  ]);

  const saleLineIds = [];
  const originNames = [];

  for (const mo of mos || []) {
    if (Array.isArray(mo.x_studio_sales_order) && mo.x_studio_sales_order[0]) {
      soIds.add(mo.x_studio_sales_order[0]);
    } else if (Array.isArray(mo.sale_line_id) && mo.sale_line_id[0]) {
      saleLineIds.push(mo.sale_line_id[0]);
    } else if (mo.origin) {
      originNames.push(String(mo.origin).trim());
    }
  }

  if (saleLineIds.length > 0) {
    const sLines = await odoo._callObject('sale.order.line', 'read', [
      [...new Set(saleLineIds)],
      ['order_id']
    ]);
    for (const sl of sLines || []) {
      if (Array.isArray(sl.order_id) && sl.order_id[0]) {
        soIds.add(sl.order_id[0]);
      }
    }
  }

  if (soIds.size === 0 && originNames.length > 0) {
    const soDomain = [
      ['name', 'in', [...new Set(originNames)]],
      ['state', '!=', 'cancel']
    ];
    if (Array.isArray(picking.company_id) && picking.company_id[0]) {
      soDomain.push(['company_id', '=', picking.company_id[0]]);
    }
    const sos = await odoo._callObject('sale.order', 'search_read', [
      soDomain
    ], { fields: ['id'] });
    for (const s of sos || []) soIds.add(s.id);
  }

  return Array.from(soIds);
}

/**
 * Recalculate `x_studio_qty_sfp_done` for every product line of a Sales Order
 * by summing all Done Vendor SFPs linked to the SO.
 */
export async function recalculateSoSfpQuantities(odoo = adminOdooClient, soId, { extraPickingIds = [] } = {}) {
  const sos = await odoo._callObject('sale.order', 'read', [
    [soId],
    ['id', 'name', 'user_id', 'create_uid', 'order_line', 'company_id']
  ]);
  if (!sos || sos.length === 0) {
    throw new Error(`Sales Order #${soId} not found`);
  }
  const so = sos[0];
  const lineIds = so.order_line || [];

  const soLines = lineIds.length > 0
    ? await odoo._callObject('sale.order.line', 'read', [
        lineIds,
        ['id', 'product_id', 'product_uom_qty', 'product_uom_id', 'x_studio_qty_sfp_done', 'display_type', 'is_downpayment']
      ])
    : [];

  const linkedSfps = await odoo._callObject('stock.picking', 'search_read', [
    [
      ['state', '=', 'done'],
      ['name', '=like', 'VD%/SFP/%'],
      '|',
      ['x_studio_sales_order', '=', soId],
      ['sale_id', '=', soId]
    ]
  ], { fields: ['id', 'name'] });

  const sfpIdSet = new Set((linkedSfps || []).map((p) => p.id));
  for (const pid of extraPickingIds) {
    if (pid) sfpIdSet.add(pid);
  }
  const allSfpIds = Array.from(sfpIdSet);

  const qtyByProduct = new Map();
  if (allSfpIds.length > 0) {
    const doneMoves = await odoo._callObject('stock.move', 'search_read', [
      [
        ['picking_id', 'in', allSfpIds],
        ['state', '=', 'done']
      ]
    ], { fields: ['id', 'picking_id', 'product_id', 'quantity', 'product_uom_qty'] });

    for (const mv of doneMoves || []) {
      const prodId = Array.isArray(mv.product_id) ? mv.product_id[0] : null;
      if (!prodId) continue;
      const moveQty = Number(mv.quantity ?? mv.product_uom_qty ?? 0) || 0;
      if (moveQty <= 0) continue;
      qtyByProduct.set(prodId, (qtyByProduct.get(prodId) || 0) + moveQty);
    }
  }

  // Group eligible SO lines by product_id so even duplicate product lines never double-count
  const linesByProduct = new Map();
  for (const line of soLines) {
    if (line.display_type || line.is_downpayment) continue;
    const prodId = Array.isArray(line.product_id) ? line.product_id[0] : null;
    if (!prodId) continue;
    if (!linesByProduct.has(prodId)) linesByProduct.set(prodId, []);
    linesByProduct.get(prodId).push(line);
  }

  const lineUpdates = [];
  for (const [prodId, groupLines] of linesByProduct.entries()) {
    let remaining = qtyByProduct.get(prodId) || 0;
    for (let i = 0; i < groupLines.length; i++) {
      const line = groupLines[i];
      const isLast = i === groupLines.length - 1;
      const ordered = Number(line.product_uom_qty || 0);
      const assigned = isLast ? remaining : Math.min(remaining, Math.max(ordered, 0));
      remaining = Math.max(0, remaining - assigned);

      const currentVal = Number(line.x_studio_qty_sfp_done || 0);
      if (Math.abs(currentVal - assigned) > 1e-6) {
        lineUpdates.push({ id: line.id, qty: assigned });
      }
    }
  }

  for (const upd of lineUpdates) {
    await odoo._callObject('sale.order.line', 'write', [
      [upd.id],
      { x_studio_qty_sfp_done: upd.qty }
    ], { context: NO_TRACK_CTX });
  }

  return {
    so,
    soLines,
    sfpCount: allSfpIds.length,
    updatedLineCount: lineUpdates.length,
    qtyByProduct
  };
}

async function hasExistingActivityOrLogForSfp(odoo, soId, pickingName) {
  const existingActivities = await odoo._callObject('mail.activity', 'search_count', [
    [
      ['res_model', '=', 'sale.order'],
      ['res_id', '=', soId],
      ['summary', 'ilike', pickingName]
    ]
  ]);
  if (existingActivities > 0) return true;

  const existingMessages = await odoo._callObject('mail.message', 'search_count', [
    [
      ['model', '=', 'sale.order'],
      ['res_id', '=', soId],
      ['body', 'ilike', pickingName]
    ]
  ]);
  return existingMessages > 0;
}

async function createSfpActivityOnSo(odoo, { so, picking, matchedItems, totalByProduct }) {
  const pickingName = String(picking.name || '').trim();
  const alreadyExists = await hasExistingActivityOrLogForSfp(odoo, so.id, pickingName);
  if (alreadyExists) {
    return { created: false, reason: `Activity/log for ${pickingName} already exists on ${so.name}` };
  }

  const [resModelId, activityTypeId, responsibleUserId] = await Promise.all([
    getSaleOrderModelId(odoo),
    getTodoActivityTypeId(odoo),
    resolveSoResponsibleUserId(odoo, so)
  ]);

  const totalQtyThisSfp = matchedItems.reduce((sum, item) => sum + item.qty, 0);
  const summary = matchedItems.length === 1
    ? `SFP Done: ${pickingName} — ${matchedItems[0].productName} (${formatQty(matchedItems[0].qty)} ${matchedItems[0].uom})`
    : `SFP Done: ${pickingName} — ${matchedItems.length} Produk (${formatQty(totalQtyThisSfp)} pcs)`;

  const moRef = Array.isArray(picking.x_studio_manufacturing_order)
    ? picking.x_studio_manufacturing_order[1]
    : (picking.origin || '-');
  const sourceLabel = Array.isArray(picking.picking_type_id)
    ? picking.picking_type_id[1]
    : '-';

  const rowsHtml = matchedItems.map((item) => {
    const totalDone = totalByProduct.get(item.productId) || item.qty;
    return `<li><strong>${escapeHtml(item.productName)}</strong>: +${escapeHtml(formatQty(item.qty))} ${escapeHtml(item.uom)} (Total SFP Done: ${escapeHtml(formatQty(totalDone))} / Order: ${escapeHtml(formatQty(item.orderedQty))})</li>`;
  }).join('');

  const noteHtml = [
    `<p><strong>Barang Jadi Vendor Selesai (SFP Done)</strong></p>`,
    `<p>`,
    `<strong>No. SFP:</strong> ${escapeHtml(pickingName)}<br/>`,
    `<strong>No. MO:</strong> ${escapeHtml(moRef)}<br/>`,
    `<strong>Sumber / Vendor:</strong> ${escapeHtml(sourceLabel)}<br/>`,
    `<strong>Tanggal Done:</strong> ${escapeHtml(formatWibDateTime(picking.date_done))}`,
    `</p>`,
    `<ul>${rowsHtml}</ul>`
  ].join('');

  const activityId = await odoo._callObject('mail.activity', 'create', [{
    res_model_id: resModelId,
    res_id: so.id,
    activity_type_id: activityTypeId,
    user_id: responsibleUserId,
    date_deadline: formatWibDateOnly(),
    summary,
    note: noteHtml
  }]);

  return {
    created: true,
    activityId,
    responsibleUserId,
    summary
  };
}

/**
 * Main entry point when a Vendor SFP transfer reaches Done state.
 * 1. Filters to Done Vendor SFP transfers (VD.../SFP/...).
 * 2. Resolves linked Sales Order(s).
 * 3. Keeps only finished goods present on the SO's order_line.
 * 4. Recalculates `x_studio_qty_sfp_done` on matching SO lines.
 * 5. Creates an idempotent To-Do activity assigned to SO creator/salesperson (fallback Sales Internal).
 */
export async function handleVendorSfpDone(pickingId, {
  odoo = adminOdooClient,
  createActivity = true,
  updateLineQty = true
} = {}) {
  await odoo.authenticate();
  const id = Number(pickingId);
  if (!id || isNaN(id)) {
    throw new Error(`Invalid Picking ID: ${pickingId}`);
  }

  const pickings = await odoo._callObject('stock.picking', 'read', [
    [id],
    [
      'id', 'name', 'state', 'origin', 'date_done', 'picking_type_id', 'company_id',
      'sale_id', 'x_studio_sales_order', 'x_studio_manufacturing_order', 'move_ids'
    ]
  ]);

  if (!pickings || pickings.length === 0) {
    return { success: false, notFound: true, pickingId: id };
  }

  const picking = pickings[0];
  if (!isVendorSfpPicking(picking)) {
    return {
      success: true,
      skipped: true,
      reason: `Skipped non-Vendor or non-Done SFP (${picking.name}, state=${picking.state})`
    };
  }

  const soIds = await resolveSalesOrderIdsForPicking(odoo, picking);
  if (soIds.length === 0) {
    return {
      success: true,
      skipped: true,
      reason: `No linked Sales Order found for ${picking.name}`
    };
  }

  const moveIds = picking.move_ids || [];
  const pickingMoves = moveIds.length > 0
    ? await odoo._callObject('stock.move', 'read', [
        moveIds,
        ['id', 'product_id', 'quantity', 'product_uom_qty', 'product_uom', 'state']
      ])
    : [];

  const doneMoves = pickingMoves.filter((m) => m.state === 'done' && (Number(m.quantity ?? m.product_uom_qty ?? 0) > 0));
  if (doneMoves.length === 0) {
    return {
      success: true,
      skipped: true,
      reason: `No done moves with positive qty in ${picking.name}`
    };
  }

  const results = [];
  for (const soId of soIds) {
    const recalc = updateLineQty
      ? await recalculateSoSfpQuantities(odoo, soId, { extraPickingIds: [picking.id] })
      : await (async () => {
          const sos = await odoo._callObject('sale.order', 'read', [
            [soId],
            ['id', 'name', 'user_id', 'create_uid', 'order_line']
          ]);
          const so = sos[0];
          const soLines = so?.order_line?.length
            ? await odoo._callObject('sale.order.line', 'read', [
                so.order_line,
                ['id', 'product_id', 'product_uom_qty', 'product_uom_id', 'display_type', 'is_downpayment']
              ])
            : [];
          return { so, soLines, qtyByProduct: new Map(), updatedLineCount: 0 };
        })();

    const soProductMap = new Map();
    for (const line of recalc.soLines) {
      if (line.display_type || line.is_downpayment) continue;
      const prodId = Array.isArray(line.product_id) ? line.product_id[0] : null;
      if (!prodId) continue;
      if (!soProductMap.has(prodId)) {
        soProductMap.set(prodId, {
          orderedQty: Number(line.product_uom_qty || 0),
          uomName: Array.isArray(line.product_uom_id) ? line.product_uom_id[1] : 'pcs'
        });
      } else {
        soProductMap.get(prodId).orderedQty += Number(line.product_uom_qty || 0);
      }
    }

    // Group matched finished-good moves in this SFP by product_id
    const matchedByProduct = new Map();
    for (const mv of doneMoves) {
      const prodId = Array.isArray(mv.product_id) ? mv.product_id[0] : null;
      if (!prodId || !soProductMap.has(prodId)) continue;
      const qty = Number(mv.quantity ?? mv.product_uom_qty ?? 0) || 0;
      const uom = Array.isArray(mv.product_uom) ? mv.product_uom[1] : soProductMap.get(prodId).uomName;
      if (!matchedByProduct.has(prodId)) {
        matchedByProduct.set(prodId, {
          productId: prodId,
          productName: mv.product_id[1],
          qty: 0,
          uom,
          orderedQty: soProductMap.get(prodId).orderedQty
        });
      }
      matchedByProduct.get(prodId).qty += qty;
    }

    const matchedItems = Array.from(matchedByProduct.values());
    if (matchedItems.length === 0) {
      results.push({
        soId,
        soName: recalc.so.name,
        skippedActivity: true,
        reason: 'SFP contains only non-SO / WIP items (not finished goods on this SO)'
      });
      continue;
    }

    let activityResult = { created: false, skipped: true };
    if (createActivity) {
      activityResult = await createSfpActivityOnSo(odoo, {
        so: recalc.so,
        picking,
        matchedItems,
        totalByProduct: recalc.qtyByProduct
      });
    }

    results.push({
      soId,
      soName: recalc.so.name,
      matchedCount: matchedItems.length,
      updatedLineCount: recalc.updatedLineCount,
      activityResult
    });
  }

  return {
    success: true,
    pickingId: id,
    pickingName: picking.name,
    results
  };
}
