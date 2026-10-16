import crypto from 'crypto';
import { config } from './config.js';

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
    // If secret is not configured, pass through
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

    const isValid = targetSig === hash1 || targetSig === hash2 || targetSig === hmac1 || targetSig === hmac2;
    if (!isValid) {
      console.warn('[Jubelio Signature] Invalid signature received:', signHeader);
    }
    return isValid;
  } catch (err) {
    console.error('[Jubelio Signature] Error verifying signature:', err.message);
    return false;
  }
}
