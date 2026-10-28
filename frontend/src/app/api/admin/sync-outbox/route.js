import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { processPendingOutbox, getOutboxSummary } from '@/lib/services/wip/outboxService';

export const maxDuration = 60;

async function authorizeOutboxTrigger(req) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') || '';
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { authorized: true, isCron: true };
  }

  const auth = await authenticateRequest(req);
  if (auth.error) {
    return { authorized: false, status: auth.status || 401, message: auth.error };
  }
  if (!['master_admin', 'admin'].includes(auth.user.role)) {
    return { authorized: false, status: 403, message: 'Akses khusus Admin.' };
  }
  return { authorized: true, user: auth.user };
}

export async function GET(req) {
  try {
    const check = await authorizeOutboxTrigger(req);
    if (!check.authorized) {
      return NextResponse.json({ success: false, message: check.message }, { status: check.status });
    }

    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode');

    if (mode === 'summary') {
      const summary = await getOutboxSummary(12);
      return NextResponse.json({
        success: true,
        ...summary
      });
    }

    // Default GET handler: invoked by Vercel Cron (`vercel.json`) to sweep pending/failed outbox jobs
    const stats = await processPendingOutbox(25);
    return NextResponse.json({
      success: true,
      message: `Antrean sync_outbox diproses (${stats.synced} berhasil, ${stats.failed} tertunda).`,
      ...stats
    });
  } catch (err) {
    if (err.digest === 'NEXT_PRERENDER_INTERRUPTED') throw err;
    console.error('[API GET /admin/sync-outbox] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const check = await authorizeOutboxTrigger(req);
    if (!check.authorized) {
      return NextResponse.json({ success: false, message: check.message }, { status: check.status });
    }

    let body = {};
    try {
      body = await req.json();
    } catch {}

    const orderId = body?.orderId ? Number(body.orderId) : null;
    const outboxId = body?.outboxId ? Number(body.outboxId) : null;
    const limit = Math.min(50, Math.max(1, Number(body?.limit) || 25));

    const stats = await processPendingOutbox(limit, {
      forceRetryFailed: true,
      orderId,
      outboxId
    });

    const summary = await getOutboxSummary(12);

    return NextResponse.json({
      success: true,
      message:
        stats.processed === 0
          ? 'Tidak ada antrean tertunda yang perlu dikirim ulang.'
          : stats.failed > 0
          ? `${stats.synced} berhasil dikirim, ${stats.failed} masih gagal (${stats.lastError || 'cek koneksi Odoo'}).`
          : `Berhasil menyinkronkan ${stats.synced} antrean ke Odoo!`,
      ...stats,
      ...summary
    });
  } catch (err) {
    console.error('[API POST /admin/sync-outbox] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
