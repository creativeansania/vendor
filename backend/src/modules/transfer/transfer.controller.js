import { transferService } from './transfer.service.js';
import { logger } from '../../utils/logger.js';

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

    // 1. Debounce check: If processed in the last 60 seconds, ignore
    if (this.recentlyProcessed.has(id)) {
      const lastTime = this.recentlyProcessed.get(id);
      if (now - lastTime < 60000) {
        logger.info(`[Transfer Queue] Skipping transfer #${id} (already processed ${Math.round((now - lastTime)/1000)}s ago - debounce active)`);
        return;
      }
    }

    // 2. In-flight check
    if (this.inFlight.has(id)) {
      logger.info(`[Transfer Queue] Transfer #${id} is already in queue or currently processing.`);
      return;
    }

    this.inFlight.add(id);
    this.queue.push(id);
    logger.info(`[Transfer Queue] Enqueued transfer #${id}. Queue length: ${this.queue.length}`);

    // Buffer incoming webhooks for 500ms
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
    const batchIds = this.queue.splice(0, 30);

    try {
      logger.info(`[Transfer Queue] Processing batch of ${batchIds.length} transfers: [${batchIds.join(', ')}] (Remaining in queue: ${this.queue.length})...`);
      const result = await transferService.resolveTransferMoAndSo(batchIds);
      
      const finishTime = Date.now();
      for (const id of batchIds) {
        this.recentlyProcessed.set(id, finishTime);
        this.inFlight.delete(id);
      }

      if (result && Array.isArray(result.createdPickingIds)) {
        for (const newId of result.createdPickingIds) {
          this.recentlyProcessed.set(newId, finishTime);
          logger.info(`[Transfer Queue] Registered auto-split created transfer #${newId} into debounce protection.`);
        }
      }

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

      if (err.isRateLimit || (err.message && err.message.includes('Rate Limit'))) {
        this.rateLimitedUntil = Date.now() + 120000;
        logger.error(`[Transfer Queue] ⚠️ Odoo Rate Limit (HTTP 429) hit! Pausing queue for 2 minutes. Re-enqueuing batch [${batchIds.join(', ')}].`);
        this.queue.unshift(...batchIds);
      } else {
        logger.error(`[Transfer Queue] Error processing batch [${batchIds.join(', ')}]: ${err.message}`, err);
      }
    } finally {
      this.isProcessing = false;
      if (this.queue.length > 0) {
        setTimeout(() => this.processBatch(), 1000);
      }
    }
  }
}

const transferQueue = new TransferProcessingQueue();

export const handleTransferMoReferenceWebhook = async (req, res) => {
  const payload = req.body || {};
  const query = req.query || {};

  const rawIds =
    payload._id ||
    payload.id ||
    payload.ids ||
    payload.res_id ||
    payload.picking_id ||
    payload.picking_ids ||
    payload.record_ids ||
    payload.records ||
    query._id ||
    query.id ||
    query.ids;

  let ids = [];
  if (Array.isArray(rawIds)) {
    ids = rawIds.map(id => Number(id)).filter(id => !isNaN(id) && id > 0);
  } else if (typeof rawIds === 'string' && rawIds.includes(',')) {
    ids = rawIds.split(',').map(s => Number(s.trim())).filter(id => !isNaN(id) && id > 0);
  } else if (rawIds !== undefined && rawIds !== null && !isNaN(Number(rawIds))) {
    ids = [Number(rawIds)];
  }

  logger.info('[Transfer Webhook] Received transfer MO/SO resolution request', {
    action: payload._action || query._action || 'manual',
    receivedIds: ids,
    sync: Boolean(payload.sync || query.sync),
    body: payload
  });

  if (ids.length === 0) {
    logger.warn('[Transfer Webhook] Request missing valid stock.picking ID');
    return res.status(400).json({
      success: false,
      message: 'Stock Picking ID is required (e.g. { "_id": 123, "_model": "stock.picking" })'
    });
  }

  const isSync = Boolean(payload.sync || query.sync);

  if (isSync) {
    try {
      const result = await transferService.resolveTransferMoAndSo(ids);
      return res.status(200).json({
        success: true,
        message: `Successfully resolved MO/SO for ${result.count} transfer(s)`,
        count: result.count,
        results: result.results
      });
    } catch (err) {
      logger.error(`[Transfer Webhook] Sync resolution failed for IDs: [${ids.join(', ')}]`, err);
      return res.status(500).json({
        success: false,
        message: 'Failed to resolve MO/SO references on transfers',
        error: err.message
      });
    }
  }

  // Webhook async mode
  res.status(200).json({
    success: true,
    message: `Webhook received for stock.picking (ID: [${ids.join(', ')}]). Enqueued for background processing.`,
    targetIds: ids
  });

  // Enqueue for batch debounced processing
  for (const id of ids) {
    transferQueue.enqueue(id);
  }
};
