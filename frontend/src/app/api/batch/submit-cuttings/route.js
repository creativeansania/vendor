import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { wipService } from '@/lib/services/wipService';

export const maxDuration = 60;

export async function POST(req) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
    }

    const body = await req.json();
    const items = Array.isArray(body.items) ? body.items : [];

    if (items.length === 0) {
      return NextResponse.json({ success: false, message: 'Tidak ada item yang dipilih untuk cutting.' }, { status: 400 });
    }

    const results = [];
    const errors = [];

    for (const item of items) {
      const orderId = Number(item.orderId);
      if (!orderId || isNaN(orderId)) continue;

      const actualCutting = Number(item.actualCutting || 0);

      try {
        const res = await wipService.submitCuttingRolls({
          user: auth.user,
          orderId,
          rollUpdates: [],
          actualCutting
        });

        results.push({
          orderId,
          success: true,
          result: res
        });
      } catch (errItem) {
        console.error(`[Batch Cuttings] Error order #${orderId}:`, errItem.message);
        errors.push({ orderId, error: errItem.message });
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      totalRequested: items.length,
      successCount: results.length,
      errorCount: errors.length,
      results,
      errors
    });
  } catch (err) {
    console.error('[Batch Cuttings] Server error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
