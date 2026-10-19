// Shared in-memory caches for Odoo BOM stock moves and transfers
export const rawMovesCache = new Map();
export const transfersCache = new Map();
export const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export function invalidateOrderCache(moId) {
  if (!moId) return;
  rawMovesCache.delete(moId);
  transfersCache.delete(moId);
}
