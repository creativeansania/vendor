import crypto from 'crypto';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Middleware to verify Jubelio Webhook Signature
 * Jubelio signature header: Sign / x-jubelio-signature
 */
export const verifyJubelioSignature = (req, res, next) => {
  const secret = config.jubelio.webhookSecret;
  
  if (!secret) {
    logger.debug('JUBELIO_WEBHOOK_SECRET is empty. Skipping signature verification.');
    return next();
  }

  const signatureHeader = req.headers['sign'] || req.headers['Sign'] || req.headers['x-jubelio-signature'] || req.headers['webhook-signature'] || req.headers['x-signature'];

  if (!signatureHeader) {
    logger.warn('Webhook request missing signature header');
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Missing signature header'
    });
  }

  try {
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const targetSig = signatureHeader.trim().toLowerCase();

    // Jubelio signature calculation possibilities:
    const hash1 = crypto.createHash('sha256').update(rawBody + secret).digest('hex').toLowerCase();
    const hash2 = crypto.createHash('sha256').update(secret + rawBody).digest('hex').toLowerCase();
    const hmac1 = crypto.createHmac('sha256', secret).update(rawBody).digest('hex').toLowerCase();
    const hmac2 = crypto.createHmac('sha256', secret).update(rawBody + secret).digest('hex').toLowerCase();

    const isValid = targetSig === hash1 || targetSig === hash2 || targetSig === hmac1 || targetSig === hmac2;

    if (!isValid) {
      logger.warn('Invalid Jubelio webhook signature', { received: signatureHeader, computed: { hash1, hmac1, hmac2 } });
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Invalid webhook signature'
      });
    }

    logger.info('Jubelio webhook signature verified successfully');
    next();
  } catch (error) {
    logger.error('Error verifying webhook signature', error);
    return res.status(500).json({
      success: false,
      message: 'Signature verification error'
    });
  }
};
