import { NextResponse } from 'next/server';
import { transferService } from '@/lib/services/transferService';

export async function POST(req) {
  try {
    let payload = {};
    try {
      payload = await req.json();
    } catch (e) {
      payload = {};
    }

    const { searchParams } = new URL(req.url);

    const rawIds =
      payload._id ||
      payload.id ||
      payload.ids ||
      payload.res_id ||
      payload.picking_id ||
      payload.picking_ids ||
      payload.record_ids ||
      payload.records ||
      searchParams.get('_id') ||
      searchParams.get('id') ||
      searchParams.get('ids');

    let ids = [];
    if (Array.isArray(rawIds)) {
      ids = rawIds.map(id => Number(id)).filter(id => !isNaN(id) && id > 0);
    } else if (typeof rawIds === 'string' && rawIds.includes(',')) {
      ids = rawIds.split(',').map(s => Number(s.trim())).filter(id => !isNaN(id) && id > 0);
    } else if (rawIds !== undefined && rawIds !== null && !isNaN(Number(rawIds))) {
      ids = [Number(rawIds)];
    }

    console.log('[Transfer Webhook] Received request:', { ids });

    if (ids.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'Stock Picking ID is required (e.g. { "_id": 123, "_model": "stock.picking" })'
      }, { status: 400 });
    }

    const isSync = Boolean(payload.sync || searchParams.get('sync'));

    if (isSync) {
      const result = await transferService.resolveTransferMoAndSo(ids);
      return NextResponse.json({
        success: true,
        message: `Successfully resolved MO/SO for ${result.count} transfer(s)`,
        count: result.count,
        results: result.results
      });
    }

    // Default fast-ack + background execution
    setImmediate(async () => {
      try {
        console.log(`[Transfer Webhook] Processing transfers: [${ids.join(', ')}]`);
        await transferService.resolveTransferMoAndSo(ids);
        console.log(`[Transfer Webhook] Successfully processed transfers: [${ids.join(', ')}]`);
      } catch (err) {
        console.error(`[Transfer Webhook] Error resolving MO/SO for IDs [${ids.join(', ')}]:`, err.message);
      }
    });

    return NextResponse.json({
      success: true,
      message: `Webhook received for stock.picking (ID: [${ids.join(', ')}]). Enqueued for background processing.`,
      targetIds: ids
    });
  } catch (err) {
    console.error('[Transfer Webhook] Handler error:', err.message);
    return NextResponse.json({
      success: false,
      message: err.message
    }, { status: 500 });
  }
}
