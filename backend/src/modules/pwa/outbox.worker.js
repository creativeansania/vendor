import { db } from '../../core/database/mysql.js';
import { wipVendorService } from '../wip-vendor/wip.service.js';
import { logger } from '../../utils/logger.js';

export class OutboxWorker {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
  }

  start(intervalMs = 5000) {
    if (this.intervalId) return;
    logger.info(`[Outbox Worker] Started background outbox sync worker (interval: ${intervalMs}ms)...`);
    this.intervalId = setInterval(() => this.processOutbox(), intervalMs);
    // Trigger immediately
    this.processOutbox().catch(err => logger.error(`[Outbox Worker] Immediate run error: ${err.message}`));
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('[Outbox Worker] Stopped outbox worker.');
    }
  }

  async processOutbox() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      // Find up to 5 pending or retryable failed items
      const [rows] = await db.query(
        `SELECT o.id, o.wip_order_id, o.action, o.payload, o.attempts, w.odoo_wip_id, w.mo_name
         FROM sync_outbox o
         JOIN wip_orders w ON w.id = o.wip_order_id
         WHERE o.status IN ('pending', 'failed') AND o.attempts < 5
         ORDER BY o.id ASC
         LIMIT 5`
      );

      for (const item of rows) {
        let payload;
        try {
          payload = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;
        } catch (e) {
          payload = {};
        }

        // Mark processing
        await db.query(
          'UPDATE sync_outbox SET status = "processing", attempts = attempts + 1 WHERE id = ?',
          [item.id]
        );

        try {
          logger.info(`[Outbox Worker] Processing outbox #${item.id} (${item.action}) for MO ${item.mo_name}...`);

          if (item.action === 'cutting_rolls') {
            await wipVendorService.updateCuttingRolls({
              wipId: item.odoo_wip_id,
              rollUpdates: payload.rollUpdates || [],
              actualCutting: payload.actualCutting
            });
          } else if (item.action === 'production_result') {
            await wipVendorService.submitProductionResult({
              wipId: item.odoo_wip_id,
              qtyGradeA: payload.qtyGradeA || 0,
              qtyGradeB: payload.qtyGradeB || 0,
              sisaMakloonKg: payload.sisaMakloonKg || 0
            });
          }

          // Mark synced
          await db.query(
            'UPDATE sync_outbox SET status = "synced", synced_at = NOW(), last_error = NULL WHERE id = ?',
            [item.id]
          );
          logger.info(`[Outbox Worker] ✅ Outbox #${item.id} successfully synced to Odoo!`);
        } catch (err) {
          logger.error(`[Outbox Worker] ❌ Outbox #${item.id} sync failed: ${err.message}`);
          await db.query(
            'UPDATE sync_outbox SET status = "failed", last_error = ? WHERE id = ?',
            [err.message.slice(0, 500), item.id]
          );
        }
      }
    } catch (err) {
      logger.error(`[Outbox Worker] Batch error: ${err.message}`);
    } finally {
      this.isRunning = false;
    }
  }
}

export const outboxWorker = new OutboxWorker();
