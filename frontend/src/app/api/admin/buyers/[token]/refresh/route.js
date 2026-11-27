import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import {
  getBuyerDashboardByToken,
  saveBuyerSnapshot
} from '@/lib/services/buyerDashboard/buyerDashboardRepo';
import { syncBuyerSnapshotFromOdoo } from '@/lib/services/buyerDashboard/buyerWipSyncService';

export async function POST(req, context) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
    }
    if (!['master_admin', 'admin'].includes(auth.user.role)) {
      return NextResponse.json(
        { success: false, message: 'Hanya Admin / Master Admin yang dapat memicu sinkronisasi manual.' },
        { status: 403 }
      );
    }

    const params = await context.params;
    const token = String(params?.token || '').trim();
    const config = await getBuyerDashboardByToken(token);
    if (!config) {
      return NextResponse.json(
        { success: false, message: 'Dashboard buyer tidak ditemukan.' },
        { status: 404 }
      );
    }

    const fresh = await syncBuyerSnapshotFromOdoo(config);
    await saveBuyerSnapshot(config.token, fresh);

    return NextResponse.json({
      success: true,
      synced_at: fresh.synced_at,
      sync_duration_ms: fresh.sync_duration_ms,
      summary: fresh.summary
    });
  } catch (err) {
    console.error('[API /admin/buyers/[token]/refresh POST] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
