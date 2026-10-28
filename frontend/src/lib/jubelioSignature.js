import crypto from 'crypto';
import { config } from './config.js';

function safeEqualHex(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify Jubelio Webhook Signature
 * Headers: sign, x-jubelio-signature, webhook-signature, x-signature
 * @param {Request} req Next.js Request
 * @param {string} rawBody Raw body string
 * @returns {boolean}
 */
export function verifyJubelioSignature(req, rawBody) {
  const secret = config.jubelio.webhookSecret;
  if (!secret) {
    if (process.env.NODE_ENV === 'production' && process.env.JUBELIO_ALLOW_UNSIGNED !== 'true') {
      console.error('[Jubelio Signature] JUBELIO_WEBHOOK_SECRET belum dikonfigurasi di production.');
      return false;
    }
    return true;
  }

  const signHeader =
    req.headers.get('sign') ||
    req.headers.get('Sign') ||
    req.headers.get('x-jubelio-signature') ||
    req.headers.get('webhook-signature') ||
    req.headers.get('x-signature');

  if (!signHeader) {
    console.warn('[Jubelio Signature] Missing signature header');
    return false;
  }

  try {
    const targetSig = signHeader.trim().toLowerCase();

    // Jubelio signature calculation possibilities:
    const hash1 = crypto.createHash('sha256').update(rawBody + secret).digest('hex').toLowerCase();
    const hash2 = crypto.createHash('sha256').update(secret + rawBody).digest('hex').toLowerCase();
    const hmac1 = crypto.createHmac('sha256', secret).update(rawBody).digest('hex').toLowerCase();
    const hmac2 = crypto.createHmac('sha256', secret).update(rawBody + secret).digest('hex').toLowerCase();

    const isValid =
      safeEqualHex(targetSig, hash1) ||
      safeEqualHex(targetSig, hash2) ||
      safeEqualHex(targetSig, hmac1) ||
      safeEqualHex(targetSig, hmac2);

    if (!isValid) {
      console.warn('[Jubelio Signature] Invalid signature received');
    }
    return isValid;
  } catch (err) {
    console.error('[Jubelio Signature] Error verifying signature:', err.message);
    return false;
  }
}
