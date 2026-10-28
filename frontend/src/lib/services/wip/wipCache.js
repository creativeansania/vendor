// Shared in-memory caches for Odoo BOM stock moves, transfers, and lazy-sync cooldowns
export const rawMovesCache = new Map();
export const transfersCache = new Map();
export const lazyFieldsCache = new Map();
export const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE_ENTRIES = 500;

export function setBoundedCache(map, key, value) {
  if (!key) return;
  if (map.size >= MAX_CACHE_ENTRIES && !map.has(key)) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
  map.set(key, value);
}

export function invalidateOrderCache(moId, orderId = null) {
  if (moId) {
    rawMovesCache.delete(moId);
    transfersCache.delete(moId);
  }
  if (orderId) {
    lazyFieldsCache.delete(orderId);
  }
}
