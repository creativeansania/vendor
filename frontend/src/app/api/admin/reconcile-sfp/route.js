import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { reconcileWipSfpAndRecap } from '@/lib/services/wip/sync/sfpReconcileService';

export const maxDuration = 60;

async function authorizeReconcileTrigger(req) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') || '';
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { authorized: true, isCron: true };
  }

  // Also support Vercel's internal cron header if present
  if (req.headers.get('x-vercel-cron')) {
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
    const check = await authorizeReconcileTrigger(req);
    if (!check.authorized) {
      return NextResponse.json({ success: false, message: check.message }, { status: check.status });
    }

    const { searchParams } = new URL(req.url);
    const full = searchParams.get('full') === 'true';
    const dryRun = searchParams.get('dryRun') === 'true';
    const days = parseInt(searchParams.get('days') || '60', 10);

    const result = await reconcileWipSfpAndRecap({ full, days, dryRun });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[API /api/admin/reconcile-sfp] Error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  return GET(req);
}
