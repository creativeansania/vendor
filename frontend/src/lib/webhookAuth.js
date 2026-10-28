import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { authenticateRequest } from './auth.js';

let warnedMissingWebhookSecret = false;

function safeEqual(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify incoming Odoo / internal webhook requests.
 * Enforces ODOO_WEBHOOK_SECRET when configured (via X-Webhook-Secret, X-Odoo-Secret,
 * Authorization: Bearer <secret>, or ?secret=...), or a valid internal Admin JWT.
 */
export async function verifyOdooWebhook(req) {
  const expectedSecret = (process.env.ODOO_WEBHOOK_SECRET || '').trim();

  const { searchParams } = new URL(req.url);
  const authHeader = req.headers.get('authorization') || '';
  const bearerVal = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  const providedSecret =
    req.headers.get('x-webhook-secret') ||
    req.headers.get('x-odoo-secret') ||
    searchParams.get('secret') ||
    searchParams.get('webhook_secret') ||
    '';

  if (expectedSecret) {
    if (safeEqual(providedSecret, expectedSecret) || safeEqual(bearerVal, expectedSecret)) {
      return { authorized: true };
    }

    // Allow authenticated internal admin JWT as an alternative
    if (bearerVal) {
      const auth = await authenticateRequest(req);
      if (!auth.error && auth.user && ['master_admin', 'admin'].includes(auth.user.role)) {
        return { authorized: true, user: auth.user };
      }
    }

    return {
      authorized: false,
      response: NextResponse.json(
        { success: false, message: 'Unauthorized: invalid or missing webhook secret.' },
        { status: 401 }
      )
    };
  }

  if (!warnedMissingWebhookSecret) {
    warnedMissingWebhookSecret = true;
    console.warn(
      '[WebhookAuth] ODOO_WEBHOOK_SECRET belum dikonfigurasi di environment. Disarankan menyetel ODOO_WEBHOOK_SECRET untuk mengunci endpoint webhook Odoo.'
    );
  }

  return { authorized: true };
}

function getSigningSecret() {
  return process.env.JWT_SECRET || process.env.ODOO_WEBHOOK_SECRET || '';
}

export function signReportToken(recordId) {
  const secret = getSigningSecret();
  if (!secret || !recordId) return '';
  return crypto
    .createHmac('sha256', secret)
    .update(`report:invoice:${Number(recordId)}`)
    .digest('hex');
}

export function verifyReportToken(recordId, signature) {
  const expected = signReportToken(recordId);
  if (!expected || !signature) return false;
  return safeEqual(String(signature).trim().toLowerCase(), expected.toLowerCase());
}

