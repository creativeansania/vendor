const AUTH_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const STATIC_META_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_ENTRIES = 200;

const globalStore = globalThis.__odooStaticCacheStore || {
  auth: new Map(),
  bsklProducts: { data: null, expiresAt: 0 },
  whgbDestLoc: new Map(),
  warehouseMeta: new Map(),
  warehouseByName: new Map(),
  companyByName: new Map()
};
globalThis.__odooStaticCacheStore = globalStore;

function setBounded(map, key, value, ttlMs = STATIC_META_TTL_MS) {
  if (map.size >= MAX_ENTRIES && !map.has(key)) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
  map.set(key, { data: value, expiresAt: Date.now() + ttlMs });
}

function getFresh(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    map.delete(key);
    return null;
  }
  return entry.data;
}

export function getCachedAuthSession(cacheKey) {
  return getFresh(globalStore.auth, cacheKey);
}

export function setCachedAuthSession(cacheKey, sessionData) {
  setBounded(globalStore.auth, cacheKey, sessionData, AUTH_TTL_MS);
}

export function clearCachedAuthSession(cacheKey) {
  globalStore.auth.delete(cacheKey);
}

export function getCachedCompanyByName(name) {
  return getFresh(globalStore.companyByName, String(name || '').toLowerCase());
}

export function setCachedCompanyByName(name, id) {
  setBounded(globalStore.companyByName, String(name || '').toLowerCase(), id);
}

export function getCachedWarehouseByName(key) {
  return getFresh(globalStore.warehouseByName, String(key || '').toLowerCase());
}

export function setCachedWarehouseByName(key, id) {
  setBounded(globalStore.warehouseByName, String(key || '').toLowerCase(), id);
}

/**
 * Fetch and cache static BSKL products once per 2 hours instead of every BSKL save
 */
export async function getCachedBsklProducts(odooClient) {
  if (globalStore.bsklProducts.data && Date.now() < globalStore.bsklProducts.expiresAt) {
    return globalStore.bsklProducts.data;
  }

  const bsklProds = await odooClient._callObject('product.product', 'search_read', [
    [['name', 'in', ['BSKL PANJANG', 'BSKL SEDANG', 'BSKL PENDEK', 'BSKL']]]
  ], { fields: ['id', 'name', 'uom_id'] });

  const prodMap = {};
  for (const p of bsklProds || []) {
    prodMap[p.name] = p;
  }

  globalStore.bsklProducts = {
    data: prodMap,
    expiresAt: Date.now() + STATIC_META_TTL_MS
  };
  return prodMap;
}

/**
 * Fetch and cache WHGB/Stock destination location ID per company
 */
export async function getCachedWhgbDestLocationId(odooClient, companyId) {
  const key = String(companyId || 1);
  const cached = getFresh(globalStore.whgbDestLoc, key);
  if (cached) return cached;

  const destLocs = await odooClient._callObject('stock.location', 'search_read', [
    [
      ['complete_name', 'ilike', 'WHGB/Stock'],
      ['usage', '=', 'internal'],
      ['company_id', 'in', [Number(companyId || 1), false]]
    ]
  ], { fields: ['id'], limit: 1 });

  const destId = destLocs && destLocs[0] ? destLocs[0].id : null;
  if (destId) {
    setBounded(globalStore.whgbDestLoc, key, destId);
  }
  return destId;
}

/**
 * Fetch and cache warehouse lot_stock_id + internal picking_type_id
 */
export async function getCachedWarehouseInternalMeta(odooClient, whId, companyId) {
  const key = `${whId}_${companyId || 1}`;
  const cached = getFresh(globalStore.warehouseMeta, key);
  if (cached) return cached;

  const [warehouses, ptypes] = await Promise.all([
    odooClient._callObject('stock.warehouse', 'read', [[Number(whId)]], {
      fields: ['id', 'name', 'lot_stock_id']
    }),
    odooClient._callObject('stock.picking.type', 'search_read', [
      [
        ['code', '=', 'internal'],
        '|',
        ['warehouse_id', '=', Number(whId)],
        ['company_id', '=', Number(companyId || 1)]
      ]
    ], { fields: ['id', 'warehouse_id'], limit: 5 })
  ]);

  const wh = warehouses && warehouses[0] ? warehouses[0] : null;
  if (!wh || !wh.lot_stock_id) return null;

  const chosenPtype = (ptypes || []).find((p) => p.warehouse_id && p.warehouse_id[0] === wh.id) || (ptypes && ptypes[0]) || null;
  const meta = {
    whId: wh.id,
    whName: wh.name,
    lotStockId: wh.lot_stock_id[0],
    internalPickingTypeId: chosenPtype ? chosenPtype.id : null
  };

  setBounded(globalStore.warehouseMeta, key, meta);
  return meta;
}

