import { NextResponse, after } from 'next/server';
import { adminOdooClient } from '@/lib/odoo/odooClient';
import { verifyOdooWebhook } from '@/lib/webhookAuth';
import { acquireDistributedWebhookLock } from '@/lib/services/wip/distributedWebhookLock';

export const maxDuration = 60;

const PRODUCT_UNIT_PRECISION_ID = 6;

async function syncBomLinesPrecision(lineIds) {
  if (!lineIds || lineIds.length === 0) return { updated: 0 };

  await adminOdooClient.authenticate();

  const lines = await adminOdooClient.executeKw('mrp.bom.line', 'read', [
    lineIds,
    ['id', 'product_qty', 'x_studio_qty_presisi']
  ]);

  const toUpdateProductQty = [];
  const toUpdatePresisi = [];

  for (const line of lines) {
    const presisi = Number(line.x_studio_qty_presisi || 0);
    const stdQty = Number(line.product_qty || 0);

    if (presisi > 0 && Math.abs(stdQty - presisi) > 1e-14) {
      toUpdateProductQty.push({ id: line.id, qty: presisi });
    } else if (presisi === 0 && stdQty > 0) {
      toUpdatePresisi.push({ id: line.id, qty: stdQty });
    }
  }

  for (const item of toUpdatePresisi) {
    await adminOdooClient.executeKw('mrp.bom.line', 'write', [
      [item.id],
      { x_studio_qty_presisi: item.qty }
    ]);
  }

  if (toUpdateProductQty.length > 0) {
    const prec = await adminOdooClient.executeKw('decimal.precision', 'read', [
      [PRODUCT_UNIT_PRECISION_ID],
      ['digits']
    ]);
    const oldDigits = prec?.[0]?.digits ?? 2;

    try {
      if (oldDigits < 14) {
        await adminOdooClient.executeKw('decimal.precision', 'write', [
          [PRODUCT_UNIT_PRECISION_ID],
          { digits: 14 }
        ]);
      }

      for (const item of toUpdateProductQty) {
        await adminOdooClient.executeKw('mrp.bom.line', 'write', [
          [item.id],
          { product_qty: item.qty }
        ]);
      }
    } finally {
      if (oldDigits < 14) {
        await adminOdooClient.executeKw('decimal.precision', 'write', [
          [PRODUCT_UNIT_PRECISION_ID],
          { digits: oldDigits }
        ]);
      }
    }
  }

  return {
    updatedProductQty: toUpdateProductQty.length,
    updatedPresisi: toUpdatePresisi.length
  };
}

export async function POST(req) {
  try {
    const webhookAuth = await verifyOdooWebhook(req);
    if (!webhookAuth.authorized) return webhookAuth.response;

    let payload = {};
    try {
      payload = await req.json();
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
      searchParams.get('_ids') ||
      searchParams.get('_id') ||
      searchParams.get('id');

    let ids = [];
    if (Array.isArray(rawIds)) {
      ids = rawIds.map((id) => Number(id)).filter((id) => !isNaN(id) && id > 0);
    } else if (typeof rawIds === 'string' && rawIds.includes(',')) {
      ids = rawIds.split(',').map((s) => Number(s.trim())).filter((id) => !isNaN(id) && id > 0);
    } else if (rawIds !== undefined && rawIds !== null && !isNaN(Number(rawIds))) {
      ids = [Number(rawIds)];
    }

    if (ids.length === 0) {
      return NextResponse.json(
        { success: false, message: 'BoM Line ID is required' },
        { status: 400 }
      );
    }

    const lockResults = await Promise.all(
      ids.map(async (id) => ({
        id,
        acquired: await acquireDistributedWebhookLock(`bom_line_prec:${id}`, 10000)
      }))
    );

    const pendingIds = lockResults.filter((r) => r.acquired).map((r) => r.id);
    if (pendingIds.length === 0) {
      return NextResponse.json({
        success: true,
        deduplicated: true,
        skippedIds: ids
      });
    }

    after(async () => {
      try {
        await syncBomLinesPrecision(pendingIds);
      } catch (err) {
        console.error('[BoM Precision Webhook] Error syncing precision:', err.message);
      }
    });

    return NextResponse.json({
      success: true,
      message: `BoM line precision sync enqueued for [${pendingIds.join(', ')}]`
    });
  } catch (err) {
    console.error('[BoM Precision Webhook] Handler error:', err.message);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
