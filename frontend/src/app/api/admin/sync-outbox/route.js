import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { processPendingOutbox } from '@/lib/services/wip/outboxService';

export const maxDuration = 60;

async function authorizeOutboxTrigger(req) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') || '';
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { authorized: true };
  }

  const auth = await authenticateRequest(req);
  if (auth.error) {
    return { authorized: false, status: auth.status || 401, message: auth.error };
  }
  if (!['master_admin', 'admin'].includes(auth.user.role)) {
    return { authorized: false, status: 403, message: 'Akses khusus Admin.' };
  }
  return { authorized: true };
}

export async function POST(req) {
  try {
    const check = await authorizeOutboxTrigger(req);
    if (!check.authorized) {
      return NextResponse.json({ success: false, message: check.message }, { status: check.status });
    }

    const stats = await processPendingOutbox(25);
    return NextResponse.json({
      success: true,
      message: `Antrean sync_outbox diproses (${stats.synced} berhasil, ${stats.failed} tertunda).`,
      ...stats
    });
  } catch (err) {
    console.error('[API /admin/sync-outbox] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export const GET = POST;

