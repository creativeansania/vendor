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
    const moId = payload._id || payload.id || payload.mo_id || searchParams.get('id') || searchParams.get('mo_id');

    console.log('[WIP Webhook] Received MO Confirmed event:', { moId, payload });

    if (!moId) {
      return NextResponse.json({ success: false, message: 'MO ID is required' }, { status: 400 });
    }

    after(async () => {
      try {
        await wipService.onMoConfirmed(moId);
      } catch (err) {
        console.error(`[WIP Webhook] Error creating WIP for MO #${moId}:`, err.message);
      }
    });

    return NextResponse.json({
      success: true,
      message: `WIP creation triggered for MO #${moId}`
    });
  } catch (err) {
    console.error('[WIP Webhook] Handler error:', err.message);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
