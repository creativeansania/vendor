import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { wipService } from '@/lib/services/wipService';

export const maxDuration = 60;

export async function POST(req) {
  try {
    let payload = {};
    try {
      payload = await req.json();
    } catch {
      payload = {};
    }

    const { searchParams } = new URL(req.url);
    const pickingId = payload._id || payload.id || payload.picking_id || searchParams.get('id') || searchParams.get('picking_id');

    console.log('[WIP Webhook] Received Transfer Done event:', { pickingId, payload });

    if (!pickingId) {
      return NextResponse.json({ success: false, message: 'Picking ID is required' }, { status: 400 });
    }

    after(async () => {
      try {
        await wipService.onTransferDone(pickingId);
      } catch (err) {
        console.error(`[WIP Webhook] Error syncing WIP for Picking #${pickingId}:`, err.message);
      }
    });

    return NextResponse.json({
      success: true,
      message: `WIP sync triggered for Picking #${pickingId}`
    });
  } catch (err) {
    console.error('[WIP Webhook] Handler error:', err.message);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
