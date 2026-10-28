import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { landedCostService } from '@/lib/services/landedCostService';
import { verifyOdooWebhook } from '@/lib/webhookAuth';

export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({
    service: 'Odoo Landed Cost Duplication Webhook',
    status: 'online',
    description: 'Duplicates stock.landed.cost record(s) and preserves all linked Manufacturing Orders (mrp_production_ids).',
    usage: {
      method: 'POST',
      body: {
        _id: 123,
        _model: 'stock.landed.cost'
      }
    }
  });
}

export async function POST(req) {
  try {
    const webhookAuth = await verifyOdooWebhook(req);
    if (!webhookAuth.authorized) return webhookAuth.response;

    let payload = {};
    try {
      const contentType = req.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        payload = await req.json();
      } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
        const formData = await req.formData();
        payload = Object.fromEntries(formData.entries());
      } else {
        payload = await req.json();
      }
    } catch {
      payload = {};
    }

    const { searchParams } = new URL(req.url);

    const rawIds =
      payload._ids ||
      payload.active_ids ||
      payload._id ||
      payload.id ||
      payload.ids ||
      payload.res_id ||
      payload.res_ids ||
      payload.record_ids ||
      payload.records ||
      searchParams.get('_ids') ||
      searchParams.get('active_ids') ||
      searchParams.get('_id') ||
      searchParams.get('id') ||
      searchParams.get('ids');

    const model =
      payload._model ||
      payload.model ||
      payload.res_model ||
      searchParams.get('_model') ||
      searchParams.get('model') ||
      'stock.landed.cost';

    let ids = [];
    if (Array.isArray(rawIds)) {
      ids = rawIds.map(id => Number(id)).filter(id => !isNaN(id) && id > 0);
    } else if (typeof rawIds === 'string' && rawIds.includes(',')) {
      ids = rawIds.split(',').map(s => Number(s.trim())).filter(id => !isNaN(id) && id > 0);
    } else if (rawIds !== undefined && rawIds !== null && !isNaN(Number(rawIds))) {
      ids = [Number(rawIds)];
    }

    console.log('[Landed Cost Webhook] Received request:', { model, ids });

    if (ids.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'Landed Cost ID is required (e.g. { "_id": 123, "_model": "stock.landed.cost" })'
      }, { status: 400 });
    }

    const isAsync = Boolean(payload.async || searchParams.get('async'));

    if (isAsync) {
      after(async () => {
        try {
          console.log(`[Landed Cost Webhook] Starting background duplication for IDs: [${ids.join(', ')}]`);
          const result = await landedCostService.duplicateLandedCostWithMO(ids);

          if (result.success && result.createdRecords) {
            for (const rec of result.createdRecords) {
              try {
                await landedCostService.postChatterNote(
                  rec.originalId,
                  `📋 <b>Duplikasi Berhasil:</b> Record ini telah diduplikasi menjadi <b>${rec.newName}</b> (ID: ${rec.newId}) dengan ${rec.mrpProductionCount} Manufacturing Order (MO).`
                );
                await landedCostService.postChatterNote(
                  rec.newId,
                  `📋 Record ini dibuat dari duplikasi <b>${rec.originalName}</b> (ID: ${rec.originalId}) beserta ${rec.mrpProductionCount} Manufacturing Order (MO).`
                );
              } catch (chatterErr) {
                console.warn(`[Landed Cost Webhook] Chatter note warning for LC #${rec.newId}: ${chatterErr.message}`);
              }
            }
          }
          console.log(`[Landed Cost Webhook] Background process finished for IDs: [${ids.join(', ')}]`);
        } catch (err) {
          console.error(`[Landed Cost Webhook] Background duplication failed for IDs: [${ids.join(', ')}]:`, err.message);
        }
      });

      return NextResponse.json({
        success: true,
        message: `Webhook received for ${model} (ID: [${ids.join(', ')}]). Processing duplication with MOs in background.`,
        targetIds: ids
      });
    }

    // Default: Synchronous execution so Odoo and user get the immediate result and new record IDs!
    const result = await landedCostService.duplicateLandedCostWithMO(ids);

    // Post chatter notes
    if (result.success && result.createdRecords) {
      for (const rec of result.createdRecords) {
        try {
          await landedCostService.postChatterNote(
            rec.originalId,
            `📋 <b>Duplikasi Berhasil:</b> Record ini telah diduplikasi menjadi <b>${rec.newName}</b> (ID: ${rec.newId}) dengan ${rec.mrpProductionCount} Manufacturing Order (MO).`
          );
          await landedCostService.postChatterNote(
            rec.newId,
            `📋 Record ini dibuat dari duplikasi <b>${rec.originalName}</b> (ID: ${rec.originalId}) beserta ${rec.mrpProductionCount} Manufacturing Order (MO).`
          );
        } catch (chatterErr) {
          console.warn(`[Landed Cost Webhook] Chatter note warning for LC #${rec.newId}: ${chatterErr.message}`);
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Successfully duplicated ${result.count} Landed Cost record(s) with MOs`,
      count: result.count,
      newRecordIds: result.newRecordIds,
      records: result.createdRecords,
      errors: result.errors
    });
  } catch (err) {
    console.error('[Landed Cost Webhook] Handler error:', err.message);
    return NextResponse.json({
      success: false,
      message: err.message
    }, { status: 500 });
  }
}
