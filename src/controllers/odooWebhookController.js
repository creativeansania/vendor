import { odooBypassService } from '../services/odooService.js';
import { logger } from '../utils/logger.js';

/**
 * Controller for Odoo SO Confirm Webhook
 * Responds immediately with 200 OK to satisfy Odoo timeout, then processes delivery & invoice bypass asynchronously.
 */
export const handleOdooSOConfirmWebhook = async (req, res) => {
  const payload = req.body || {};
  const query = req.query || {};

  // Extract Sales Order identifier (ID or Name) from various possible payload formats
  // Note: Odoo native "Send Webhook Notification" sends "_id" and "_model" by default
  const soIdentifier =
    payload._id ||
    payload.id ||
    payload.order_id ||
    payload.so_id ||
    payload.sales_order_id ||
    payload.name ||
    payload.order_name ||
    query.id ||
    query.order_id ||
    query.so_id ||
    query.name;

  logger.info('[Odoo Webhook] Received SO confirmation webhook event', {
    headers: req.headers['content-type'],
    soIdentifier,
    body: payload
  });

  if (!soIdentifier) {
    logger.warn('[Odoo Webhook] Received request without Sales Order ID or Name');
    return res.status(400).json({
      success: false,
      message: 'Sales Order ID or Name is required (e.g. { "id": 123 } or { "order_id": 123 } or { "name": "SO001" })'
    });
  }

  // Immediately respond with 200 OK to prevent Odoo worker/UI from waiting
  res.status(200).json({
    success: true,
    message: `Webhook received for Sales Order "${soIdentifier}". Processing delivery and invoice bypass in background.`
  });

  // Asynchronous background processing
  setImmediate(async () => {
    try {
      logger.info(`[Odoo Webhook] Starting background bypass processing for Sales Order: ${soIdentifier}`);
      const result = await odooBypassService.processSOBypass(soIdentifier, payload);

      if (result.skipped) {
        logger.info(`[Odoo Webhook] ${result.reason || result.error}`);
      } else if (result.success) {
        const pickMsg = result.pickings && result.pickings.length > 0 ? ` | Delivery: ${result.pickings.join(', ')} (DONE)` : '';
        const invMsg = result.invoices && result.invoices.length > 0 ? ` | Invoice: ${result.invoices.join(', ')} (POSTED)` : '';
        logger.info(`[Odoo Webhook] Successfully processed bypass for ${result.soName} (ID: ${result.soId})${pickMsg}${invMsg}`);
      } else {
        logger.error(`[Odoo Webhook] Bypass failed for "${soIdentifier}": ${result.message || result.error}`);
      }
    } catch (err) {
      logger.error(`[Odoo Webhook] Unexpected error during bypass processing for "${soIdentifier}"`, err);
    }
  });
};
