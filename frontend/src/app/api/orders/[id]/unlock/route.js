import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { wipService } from '@/lib/services/wipService';

export async function POST(req, { params }) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
    }

    const { id } = await params;
    let body = {};
    try {
      body = await req.json();
    } catch {}

    const action = body.action || 'unlock'; // 'unlock' or 'relock'
    const reason = body.reason || 'Dibuka manual oleh Master Admin';

    let result;
    if (action === 'relock') {
      result = await wipService.adminRelockOrder({
        user: auth.user,
        orderId: Number(id)
      });
    } else {
      result = await wipService.adminUnlockOrder({
        user: auth.user,
        orderId: Number(id),
        reason
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[API /orders/[id]/unlock] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 400 });
  }
}
