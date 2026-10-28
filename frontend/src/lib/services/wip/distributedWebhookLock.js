import { supabaseServer } from '../../supabaseServer.js';

const localLocks = new Map();
let lastPruneAt = 0;
const PRUNE_INTERVAL_MS = 5 * 60 * 1000; // Prune every 5 mins max

/**
 * 2-tier distributed webhook deduplication lock (L1 Memory + L2 Supabase across Serverless instances).
 * Uses existing `audit_logs` table (user_id = 0, action = 'webhook_lock') so zero SQL migration is required,
 * and auto-prunes lock entries older than 10 minutes.
 *
 * @param {string} lockKey - Unique event key, e.g. `mo_confirmed:1234` or `transfer_ref:5678`
 * @param {number} ttlMs - Cooldown window in milliseconds (default 20s)
 * @returns {Promise<boolean>} true if lock acquired, false if already locked within cooldown
 */
export async function acquireDistributedWebhookLock(lockKey, ttlMs = 20000) {
  const now = Date.now();

  // Cleanup expired L1 locks
  for (const [k, exp] of localLocks.entries()) {
    if (now > exp) localLocks.delete(k);
  }

  // L1 Fast-path check (0ms inside warm instance)
  const localExp = localLocks.get(lockKey);
  if (localExp && now < localExp) {
    return false;
  }
  localLocks.set(lockKey, now + ttlMs);

  // L2 Cross-instance check via Supabase
  try {
    const cutoffIso = new Date(now - ttlMs).toISOString();
    const { data: recent } = await supabaseServer
      .from('audit_logs')
      .select('id')
      .eq('user_id', 0)
      .eq('action', 'webhook_lock')
      .eq('reason', lockKey)
      .gte('created_at', cutoffIso)
      .limit(1);

    if (recent && recent.length > 0) {
      return false;
    }

    await supabaseServer.from('audit_logs').insert({
      user_id: 0,
      action: 'webhook_lock',
      reason: lockKey
    });

    // Opportunistic non-blocking prune of old webhook_lock rows (>10 mins old)
    if (now - lastPruneAt > PRUNE_INTERVAL_MS) {
      lastPruneAt = now;
      const tenMinsAgoIso = new Date(now - 10 * 60 * 1000).toISOString();
      supabaseServer
        .from('audit_logs')
        .delete()
        .eq('user_id', 0)
        .eq('action', 'webhook_lock')
        .lt('created_at', tenMinsAgoIso)
        .then(() => {})
        .catch(() => {});
    }

    return true;
  } catch {
    // Graceful fallback to L1 memory lock if DB check fails
    return true;
  }
}

export function releaseDistributedWebhookLock(lockKey) {
  localLocks.delete(lockKey);
}

