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
    const { unlockType, reason } = await req.json();

    const result = await wipService.unlockOrder({
      user: auth.user,
      orderId: Number(id),
      unlockType,
      reason
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[API /orders/[id]/unlock] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 400 });
  }
}
