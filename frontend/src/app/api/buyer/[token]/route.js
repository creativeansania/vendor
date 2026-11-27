import { NextResponse, after } from 'next/server';
import {
  getBuyerDashboardByToken,
  getBuyerSnapshot,
  saveBuyerSnapshot,
  isSnapshotStale,
  SNAPSHOT_TTL_MS
} from '@/lib/services/buyerDashboard/buyerDashboardRepo';
import { syncBuyerSnapshotFromOdoo } from '@/lib/services/buyerDashboard/buyerWipSyncService';
import {
  acquireDistributedWebhookLock,
  releaseDistributedWebhookLock
} from '@/lib/services/wip/distributedWebhookLock';

const PUBLIC_FORCE_COOLDOWN_MS = 2 * 60 * 1000; // 2 min cooldown against abuse

async function runLockedSync(config) {
  const lockKey = `buyer_sync:${config.token}`;
  const acquired = await acquireDistributedWebhookLock(lockKey, 60 * 1000);
  if (!acquired) {
    return null;
  }
  try {
    const fresh = await syncBuyerSnapshotFromOdoo(config);
    await saveBuyerSnapshot(config.token, fresh);
    return fresh;
  } catch (err) {
    console.error(`[BuyerSync] Failed for ${config.buyer_name}:`, err.message);
    return null;
  } finally {
    releaseDistributedWebhookLock(lockKey);
  }
}

export async function GET(req, context) {
  try {
    const params = await context.params;
    const token = String(params?.token || '').trim();
    if (!token || token.length < 10) {
      return NextResponse.json(
        { success: false, message: 'Link dashboard tidak valid.' },
        { status: 404 }
      );
    }

    const config = await getBuyerDashboardByToken(token);
    if (!config || !config.is_active) {
      return NextResponse.json(
        { success: false, message: 'Link dashboard tidak ditemukan atau sudah dinonaktifkan.' },
        { status: 404 }
      );
    }

    const url = new URL(req.url);
    const wantsForce = url.searchParams.get('refresh') === '1';

    const cached = await getBuyerSnapshot(config.token);

    // First-ever load: no cached snapshot yet -> sync synchronously once
    if (!cached || !cached.snapshot) {
      const fresh = await syncBuyerSnapshotFromOdoo(config);
      await saveBuyerSnapshot(config.token, fresh);
      return NextResponse.json(
        {
          success: true,
          data: fresh,
          cache: {
            status: 'miss',
            refreshing: false,
            ttl_minutes: Math.round(SNAPSHOT_TTL_MS / 60000)
          }
        },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    const syncedMs = new Date(cached.synced_at || 0).getTime();
    const ageMs = Number.isFinite(syncedMs) ? Date.now() - syncedMs : Infinity;
    const stale = isSnapshotStale(cached.synced_at, SNAPSHOT_TTL_MS);

    // Optional manual buyer refresh (rate-limited to once every 2 minutes)
    if (wantsForce && ageMs >= PUBLIC_FORCE_COOLDOWN_MS) {
      const fresh = await runLockedSync(config);
      if (fresh) {
        return NextResponse.json(
          {
            success: true,
            data: fresh,
            cache: {
              status: 'refreshed',
              refreshing: false,
              ttl_minutes: Math.round(SNAPSHOT_TTL_MS / 60000)
            }
          },
          { headers: { 'Cache-Control': 'no-store, max-age=0' } }
        );
      }
    }

    // Stale (> 15 minutes): serve cached immediately & refresh in background via Next.js after()
    let refreshing = false;
    if (stale) {
      refreshing = true;
      after(async () => {
        await runLockedSync(config);
      });
    }

    // Always reflect latest buyer_name from config in case Admin renamed it
    const payload = {
      ...cached.snapshot,
      buyer_name: config.buyer_name
    };

    return NextResponse.json(
      {
        success: true,
        data: payload,
        cache: {
          status: stale ? 'stale' : 'hit',
          refreshing,
          age_seconds: Math.max(0, Math.round(ageMs / 1000)),
          ttl_minutes: Math.round(SNAPSHOT_TTL_MS / 60000)
        }
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (err) {
    console.error('[API /buyer/[token] GET] error:', err);
    return NextResponse.json(
      { success: false, message: 'Gagal memuat data dashboard WIP: ' + err.message },
      { status: 500 }
    );
  }
}
