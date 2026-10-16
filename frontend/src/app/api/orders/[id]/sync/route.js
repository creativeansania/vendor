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
    const result = await wipService.syncOrderFromOdoo({
      user: auth.user,
      orderId: Number(id)
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[API /orders/[id]/sync] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 400 });
  }
}
