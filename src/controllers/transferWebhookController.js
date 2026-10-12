import { odooAdminService } from '../services/odooService.js';
import { logger } from '../utils/logger.js';

// In-memory batch queue with rate-limit protection, debounce buffer, and deduplication
class TransferProcessingQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.inFlight = new Set();
    this.recentlyProcessed = new Map(); // id -> timestamp
    this.rateLimitedUntil = 0;
    this.debounceTimer = null;
  }

  enqueue(pickingId) {
    const id = Number(pickingId);
    if (!id || isNaN(id)) return;

    const now = Date.now();

    // 1. Debounce check: If processed in the last 60 seconds, ignore to prevent webhook feedback loops
    if (this.recentlyProcessed.has(id)) {
      const lastTime = this.recentlyProcessed.get(id);
      if (now - lastTime < 60000) {
        logger.info(`[Transfer Queue] Skipping transfer #${id} (already processed ${Math.round((now - lastTime)/1000)}s ago - debounce active)`);
        return;
      }
    }

    // 2. In-flight check: If already in queue or processing, don't duplicate
    if (this.inFlight.has(id)) {
      logger.info(`[Transfer Queue] Transfer #${id} is already in queue or currently processing.`);
      return;
    }

    this.inFlight.add(id);
    this.queue.push(id);
    logger.info(`[Transfer Queue] Enqueued transfer #${id}. Queue length: ${this.queue.length}`);

    // Buffer incoming webhooks for 500ms to accumulate simultaneous bursts (e.g. 16 - 50 MO confirms)
    if (!this.debounceTimer && !this.isProcessing) {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.processBatch();
      }, 500);
    }
  }

  async processBatch() {
    if (this.isProcessing) return;
    if (this.queue.length === 0) return;

    // Check rate limit cooldown
    const now = Date.now();
    if (now < this.rateLimitedUntil) {
      const waitSec = Math.round((this.rateLimitedUntil - now) / 1000);
      logger.warn(`[Transfer Queue] Cooldown active due to Odoo Rate Limit. Resuming in ${waitSec}s...`);
      setTimeout(() => this.processBatch(), 5000);
      return;
    }

    this.isProcessing = true;
    // Process up to 30 items per batch to keep XML-RPC calls minimal and fast
    const batchIds = this.queue.splice(0, 30);

    try {
      logger.info(`[Transfer Queue] Processing batch of ${batchIds.length} transfers: [${batchIds.join(', ')}] (Remaining in queue: ${this.queue.length})...`);
      const result = await odooAdminService.resolveTransferMoAndSo(batchIds);
      
      const finishTime = Date.now();
      for (const id of batchIds) {
        this.recentlyProcessed.set(id, finishTime);
        this.inFlight.delete(id);
      }

      // If auto-split created new pickings, mark them as recently processed so webhooks don't re-process them
      if (result && Array.isArray(result.createdPickingIds)) {
        for (const newId of result.createdPickingIds) {
          this.recentlyProcessed.set(newId, finishTime);
          logger.info(`[Transfer Queue] Registered auto-split created transfer #${newId} into debounce protection.`);
        }
      }

      // Clean old debounce records (> 5 minutes)
      for (const [key, timestamp] of this.recentlyProcessed.entries()) {
        if (finishTime - timestamp > 300000) {
          this.recentlyProcessed.delete(key);
        }
      }

      logger.info(`[Transfer Queue] Finished batch of ${batchIds.length} transfers successfully.`);
    } catch (err) {
      for (const id of batchIds) {
        this.inFlight.delete(id);
      }

      // Check if Odoo returned Rate Limit (HTTP 429 / tag TITLE)
      if (err.isRateLimit || (err.message && err.message.includes('Rate Limit'))) {
        this.rateLimitedUntil = Date.now() + 120000; // 2 minutes cooldown
        logger.error(`[Transfer Queue] ⚠️ Odoo Rate Limit (HTTP 429) hit! Pausing queue for 2 minutes. Re-enqueuing batch [${batchIds.join(', ')}].`);
        this.queue.unshift(...batchIds); // Re-queue to retry later
        batchIds.forEach(id => this.inFlight.add(id));
      } else {
        logger.error(`[Transfer Queue] Error processing batch [${batchIds.join(', ')}]: ${err.message}`);
      }
    } finally {
      this.isProcessing = false;
      // If more items remain in queue, process next batch after 500ms
      if (this.queue.length > 0) {
        setTimeout(() => this.processBatch(), 500);
      }
    }
  }
}

const transferQueue = new TransferProcessingQueue();

/**
 * Controller to handle Odoo "Send Webhook Notification" Server Action on Transfers (stock.picking)
 * Automatically resolves and links:
 * - Manufacturing Order (x_studio_manufacturing_order)
 * - Sales Order (sale_id)
 *
 * Targets transfers: PC (Pick Component), SFP (Store Finished Product), INT (Internal Transfer).
 */
export const handleTransferMoReferenceWebhook = async (req, res) => {
  const payload = req.body || {};
  const query = req.query || {};

  const rawIds =
    payload._id ||
    payload.id ||
    payload.res_id ||
    payload.picking_id ||
    payload.ids ||
    payload.record_ids ||
    query._id ||
    query.id ||
    query.ids;

  const model =
    payload._model ||
    payload.model ||
    payload.res_model ||
    query._model ||
    query.model ||
    'stock.picking';

  let ids = [];
  if (Array.isArray(rawIds)) {
    ids = rawIds.map(id => Number(id)).filter(id => !isNaN(id) && id > 0);
  } else if (typeof rawIds === 'string' && rawIds.includes(',')) {
    ids = rawIds.split(',').map(s => Number(s.trim())).filter(id => !isNaN(id) && id > 0);
  } else if (rawIds !== undefined && rawIds !== null && !isNaN(Number(rawIds))) {
    ids = [Number(rawIds)];
  }

  logger.info('[Transfer Webhook] Received webhook trigger from Odoo', {
    action: payload._action || query._action || 'manual',
    model,
    receivedIds: ids,
    sync: Boolean(payload.sync || query.sync)
  });

  if (ids.length === 0) {
    logger.warn('[Transfer Webhook] Request missing valid Transfer / Picking ID');
    return res.status(400).json({
      success: false,
      message: 'Transfer ID is required (e.g. { "_id": 12345, "_model": "stock.picking" })'
    });
  }

  // 1. Acknowledge Odoo immediately with 200 OK
  res.status(200).json({
    success: true,
    message: `Webhook received for ${model} (IDs: [${ids.join(', ')}]). Queued for safe background processing.`,
    targetIds: ids
  });

  // 2. Queue for paced, sequential background processing (anti-flood & anti-rate-limit)
  for (const id of ids) {
    transferQueue.enqueue(id);
  }
};
