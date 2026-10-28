// Shared in-memory caches for Odoo BOM stock moves, transfers, lazy-sync cooldowns, and dashboard KPI metrics
export const rawMovesCache = new Map();
export const transfersCache = new Map();
export const lazyFieldsCache = new Map();
export const metricsCache = new Map();
export const metricsInFlight = new Map();

export const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
export const METRICS_CACHE_TTL = 20 * 1000; // 20 seconds short-TTL for dashboard KPI counts
const MAX_CACHE_ENTRIES = 500;

export function setBoundedCache(map, key, value) {
  if (!key) return;
  if (map.size >= MAX_CACHE_ENTRIES && !map.has(key)) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
  map.set(key, value);
}

export function invalidateMetricsCache() {
  metricsCache.clear();
}

export function invalidateOrderCache(moId, orderId = null) {
  if (moId) {
    rawMovesCache.delete(moId);
    transfersCache.delete(moId);
  }
  if (orderId) {
    lazyFieldsCache.delete(orderId);
  }
  metricsCache.clear();
}
