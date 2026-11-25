import { NextResponse, after } from 'next/server';
import { adminOdooClient } from '@/lib/odoo/odooClient';
import { verifyOdooWebhook } from '@/lib/webhookAuth';
import { acquireDistributedWebhookLock } from '@/lib/services/wip/distributedWebhookLock';

export const maxDuration = 60;

const PRINT_MARKER_PREFIX = '[EXPENSE_PRINT_LOG]_';
const PRINT_MARKER_REGEX = /^\[EXPENSE_PRINT_LOG\]_(\d+)\.pdf$/;
const NO_TRACK_CTX = { tracking_disable: true, no_automation: true, mail_auto_delete: true };
const RETRY_DELAYS_MS = [0, 1500, 3000, 5000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function extractExpenseIdFromMarker(att) {
  const resId = Number(att?.res_id);
  if (Number.isInteger(resId) && resId > 0) return resId;
  const match = typeof att?.name === 'string' ? att.name.match(PRINT_MARKER_REGEX) : null;
  return match ? Number(match[1]) : 0;
}

/**
 * Given attachment IDs (or direct payload metadata) from Odoo's ir.attachment on_create webhook:
 * 1. Waits/retries cleanly in case Odoo's PDF rendering transaction commits right after webhook returns 200 OK.
 * 2. Finds all committed `[EXPENSE_PRINT_LOG]_` marker attachments on `hr.expense` (including a self-healing sweep).
 * 3. Marks the corresponding `hr.expense.x_studio_printed = True`.
 * 4. Immediately deletes ONLY the temporary `[EXPENSE_PRINT_LOG]_` marker attachments so `nb_attachment`
 *    and the Receipt Preview pane remain completely clean.
 */
async function processExpensePrintMarkers({ attachmentIds, fallbackExpenseId, fallbackName, fallbackModel }) {
  await adminOdooClient.authenticate();

  const markerAttachmentMap = new Map();
  const expenseIdsSet = new Set();

  if (
    fallbackModel === 'hr.expense' &&
    typeof fallbackName === 'string' &&
    fallbackName.startsWith(PRINT_MARKER_PREFIX)
  ) {
    const expId = extractExpenseIdFromMarker({ res_id: fallbackExpenseId, name: fallbackName });
    if (expId > 0) expenseIdsSet.add(expId);
  }

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    if (RETRY_DELAYS_MS[attempt] > 0) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }

    const attachments = await adminOdooClient.executeKw('ir.attachment', 'search_read', [
      [
        ['res_model', '=', 'hr.expense'],
        ['name', '=like', `${PRINT_MARKER_PREFIX}%`],
      ],
    ], {
      fields: ['id', 'name', 'res_model', 'res_id'],
      limit: 200,
      context: NO_TRACK_CTX,
    });

    for (const att of attachments || []) {
      if (att.res_model === 'hr.expense' && typeof att.name === 'string' && att.name.startsWith(PRINT_MARKER_PREFIX)) {
        markerAttachmentMap.set(att.id, att);
        const expId = extractExpenseIdFromMarker(att);
        if (expId > 0) expenseIdsSet.add(expId);
      }
    }

    // Stop retrying once all expected attachment IDs are visible (or if no specific IDs were given and we found markers)
    const allExpectedFound = attachmentIds.length > 0
      ? attachmentIds.every((id) => markerAttachmentMap.has(id))
      : markerAttachmentMap.size > 0;
    if (allExpectedFound) break;
  }

  const markerAttachmentIds = Array.from(markerAttachmentMap.keys());
  const expenseIds = Array.from(expenseIdsSet);
  let markedCount = 0;

  if (expenseIds.length > 0) {
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
      markedCount = toMarkIds.length;
    }
  }

  let deletedAttachments = 0;
  if (markerAttachmentIds.length > 0) {
    // Re-check still-existing IDs right before unlink to avoid race with concurrent batch webhooks
    const existingIds = await adminOdooClient.executeKw('ir.attachment', 'search', [
      [
        ['id', 'in', markerAttachmentIds],
        ['res_model', '=', 'hr.expense'],
        ['name', '=like', `${PRINT_MARKER_PREFIX}%`],
      ],
    ], { context: NO_TRACK_CTX });

    if (existingIds && existingIds.length > 0) {
      await adminOdooClient.executeKw('ir.attachment', 'unlink', [
        existingIds,
      ], { context: NO_TRACK_CTX });
      deletedAttachments = existingIds.length;
    }
  }

  return {
    expenseIds,
    markedCount,
    deletedAttachments,
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

    // Fast-ignore non-marker attachments at webhook edge (zero Odoo RPCs)
    const payloadModel = payload.res_model || '';
    const payloadName = payload.name || '';
    if (payloadModel && payloadModel !== 'hr.expense') {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: `Ignored non-expense attachment model "${payloadModel}"`,
      });
    }
    if (payloadName && !String(payloadName).startsWith(PRINT_MARKER_PREFIX)) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: 'Ignored regular receipt attachment (not a print marker)',
      });
    }

    const rawAttIds =
      payload._ids ||
      payload.active_ids ||
      payload._id ||
      payload.id ||
      searchParams.get('_ids') ||
      searchParams.get('_id') ||
      searchParams.get('id');

    const attachmentIds = parseIds(rawAttIds);
    const fallbackExpenseId = Number(payload.res_id || searchParams.get('expense_id') || 0);

    if (attachmentIds.length === 0 && !(Number.isInteger(fallbackExpenseId) && fallbackExpenseId > 0)) {
      return NextResponse.json(
        { success: false, message: 'Attachment ID or Expense res_id is required' },
        { status: 400 }
      );
    }

    const lockKey = attachmentIds.length > 0
      ? `expense_printed:att:${attachmentIds.join(',')}`
      : `expense_printed:exp:${fallbackExpenseId}`;

    const acquired = await acquireDistributedWebhookLock(lockKey, 10000);
    if (!acquired) {
      return NextResponse.json({
        success: true,
        deduplicated: true,
        attachmentIds,
      });
    }

    const jobArgs = {
      attachmentIds,
      fallbackExpenseId,
      fallbackName: payloadName,
      fallbackModel: payloadModel,
    };

    const isSync = Boolean(payload.sync || searchParams.get('sync'));
    if (isSync) {
      const result = await processExpensePrintMarkers(jobArgs);
      return NextResponse.json({ success: true, ...result });
    }

    after(async () => {
      try {
        await processExpensePrintMarkers(jobArgs);
      } catch (err) {
        console.error('[Expense Printed Webhook] Error:', err.message);
      }
    });

    return NextResponse.json({
      success: true,
      message: `Expense print marker processing enqueued for attachment [${attachmentIds.join(', ')}]`,
    });
  } catch (err) {
    console.error('[Expense Printed Webhook] Handler error:', err.message);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
