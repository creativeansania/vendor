import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { wipService } from '@/lib/services/wipService';

export const maxDuration = 60;

export async function POST(req, { params }) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
    }

    const { id } = await params;
    const body = await req.json();

    const rollUpdates = Array.isArray(body.rollUpdates)
      ? body.rollUpdates
      : (Array.isArray(body.rolls) ? body.rolls : []);

    const actualCutting = body.actualCutting !== undefined ? body.actualCutting : body.actual_cutting;

    const result = await wipService.submitCuttingRolls({
      user: auth.user,
      orderId: Number(id),
      rollUpdates,
      actualCutting
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[API /orders/[id]/cutting] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 400 });
  }
}
