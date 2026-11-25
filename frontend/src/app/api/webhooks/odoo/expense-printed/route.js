import { NextResponse, after } from 'next/server';
import { adminOdooClient } from '@/lib/odoo/odooClient';
import { verifyOdooWebhook } from '@/lib/webhookAuth';
import { acquireDistributedWebhookLock } from '@/lib/services/wip/distributedWebhookLock';

export const maxDuration = 60;

const NO_TRACK_CTX = { tracking_disable: true, no_automation: true, mail_auto_delete: true };

// Valid 1x1 transparent PNG (68 bytes) returned immediately to wkhtmltopdf
const TRANSPARENT_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function parseIds(raw) {
  if (Array.isArray(raw)) {
    return raw.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0);
  }
  if (typeof raw === 'string' && raw.includes(',')) {
    return raw
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((v) => Number.isInteger(v) && v > 0);
  }
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? [n] : [];
}

async function markExpensesPrinted(expenseIds) {
  if (!expenseIds || expenseIds.length === 0) return { markedCount: 0, expenseIds: [] };

  await adminOdooClient.authenticate();

  const expenses = await adminOdooClient.executeKw('hr.expense', 'search_read', [
    [['id', 'in', expenseIds], ['x_studio_printed', '=', false]],
  ], {
    fields: ['id'],
    context: NO_TRACK_CTX,
  });

  const toMarkIds = (expenses || []).map((e) => e.id);
  if (toMarkIds.length > 0) {
    await adminOdooClient.executeKw('hr.expense', 'write', [
      toMarkIds,
      { x_studio_printed: true },
    ], { context: NO_TRACK_CTX });
  }

  return {
    expenseIds,
    markedCount: toMarkIds.length,
  };
}

function pngResponse() {
  return new NextResponse(TRANSPARENT_1X1_PNG, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(TRANSPARENT_1X1_PNG.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    },
  });
}

/**
 * GET handler invoked by the 1x1 invisible beacon inside Odoo's "Expenses Report Finish"
 * QWeb PDF template (`hr_expense.report_expense_sheet_copy_2`) whenever wkhtmltopdf renders
 * an unprinted hr.expense record. Returns a 1x1 transparent PNG immediately and marks
 * `hr.expense.x_studio_printed = True` asynchronously via Next.js `after()`.
 */
export async function GET(req) {
  try {
    const webhookAuth = await verifyOdooWebhook(req);
    if (!webhookAuth.authorized) return webhookAuth.response;

    const { searchParams } = new URL(req.url);
    const ids = parseIds(searchParams.get('ids') || searchParams.get('id'));
    const isSync = Boolean(searchParams.get('sync'));

    if (ids.length === 0) {
      return pngResponse();
    }

    const pendingIds = [];
    for (const id of ids) {
      const acquired = await acquireDistributedWebhookLock(`expense_printed:exp:${id}`, 5000);
      if (acquired) pendingIds.push(id);
    }

    if (pendingIds.length > 0) {
      if (isSync) {
        await markExpensesPrinted(pendingIds);
      } else {
        after(async () => {
          try {
            await markExpensesPrinted(pendingIds);
          } catch (err) {
            console.error('[Expense Printed GET] Error marking printed:', err.message);
          }
        });
      }
    }

    return pngResponse();
  } catch (err) {
    console.error('[Expense Printed GET] Handler error:', err.message);
    return pngResponse();
  }
}

/**
 * POST handler for direct/manual webhook invocation with `{ id }` or `{ ids }`.
 */
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
      payload.ids ||
      payload._id ||
      payload.id ||
      payload.res_id ||
      searchParams.get('ids') ||
      searchParams.get('id');

    const ids = parseIds(rawIds);
    if (ids.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Expense ID is required' },
        { status: 400 }
      );
    }

    const isSync = Boolean(payload.sync || searchParams.get('sync'));
    if (isSync) {
      const result = await markExpensesPrinted(ids);
      return NextResponse.json({ success: true, ...result });
    }

    after(async () => {
      try {
        await markExpensesPrinted(ids);
      } catch (err) {
        console.error('[Expense Printed POST] Error marking printed:', err.message);
      }
    });

    return NextResponse.json({
      success: true,
      message: `Expense printed marking enqueued for [${ids.join(', ')}]`,
    });
  } catch (err) {
    console.error('[Expense Printed POST] Handler error:', err.message);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
