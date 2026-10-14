import { landedCostService } from './landedCost.service.js';
import { logger } from '../../utils/logger.js';

export const handleDuplicateLandedCost = async (req, res) => {
  const payload = req.body || {};
  const query = req.query || {};

  const rawIds =
    payload._id ||
    payload.id ||
    payload.ids ||
    payload.res_id ||
    payload.record_ids ||
    payload.records ||
    query._id ||
    query.id ||
    query.ids;

  const model =
    payload._model ||
    payload.model ||
    payload.res_model ||
    query._model ||
    query.model ||
    'stock.landed.cost';

  let ids = [];
  if (Array.isArray(rawIds)) {
    ids = rawIds.map(id => Number(id)).filter(id => !isNaN(id) && id > 0);
  } else if (typeof rawIds === 'string' && rawIds.includes(',')) {
    ids = rawIds.split(',').map(s => Number(s.trim())).filter(id => !isNaN(id) && id > 0);
  } else if (rawIds !== undefined && rawIds !== null && !isNaN(Number(rawIds))) {
    ids = [Number(rawIds)];
  }

  logger.info('[Landed Cost Webhook] Received duplication request from Odoo', {
    action: payload._action || query._action || 'manual',
    model,
    receivedIds: ids,
    sync: Boolean(payload.sync || query.sync),
    body: payload
  });

  if (ids.length === 0) {
    logger.warn('[Landed Cost Webhook] Request missing valid Landed Cost ID');
    return res.status(400).json({
      success: false,
      message: 'Landed Cost ID is required (e.g. { "_id": 123, "_model": "stock.landed.cost" })'
    });
  }

  const isSync = Boolean(payload.sync || query.sync);

  if (isSync) {
    try {
      const result = await landedCostService.duplicateLandedCostWithMO(ids);
      return res.status(200).json({
        success: true,
        message: `Successfully duplicated ${result.count} Landed Cost record(s) with MOs`,
        count: result.count,
        newRecordIds: result.newRecordIds,
        records: result.createdRecords,
        errors: result.errors
      });
    } catch (err) {
      logger.error(`[Landed Cost Webhook] Sync duplication failed for IDs: [${ids.join(', ')}]`, err);
      return res.status(500).json({
        success: false,
        message: 'Failed to duplicate Landed Cost',
        error: err.message
      });
    }
  }

  // Default: Webhook mode (200 OK immediately)
  res.status(200).json({
    success: true,
    message: `Webhook received for ${model} (ID: [${ids.join(', ')}]). Processing duplication with MOs in background.`,
    targetIds: ids
  });

  // Background execution
  setImmediate(async () => {
    try {
      logger.info(`[Landed Cost Webhook] Starting background duplication for IDs: [${ids.join(', ')}]`);
      const result = await landedCostService.duplicateLandedCostWithMO(ids);

      if (result.success && result.createdRecords) {
        logger.info(`[Landed Cost Webhook] Successfully duplicated ${result.count} record(s). Posting chatter notes...`);

        for (const rec of result.createdRecords) {
          try {
            await landedCostService.postChatterNote(
              rec.originalId,
              `📋 <b>Duplikasi Berhasil:</b> Record ini telah diduplikasi menjadi <b>${rec.newName}</b> (ID: ${rec.newId}) dengan ${rec.mrpProductionCount} Manufacturing Order (MO).`
            );
            await landedCostService.postChatterNote(
              rec.newId,
              `📋 Record ini dibuat dari duplikasi <b>${rec.originalName}</b> (ID: ${rec.originalId}) beserta ${rec.mrpProductionCount} Manufacturing Order (MO).`
            );
          } catch (chatterErr) {
            logger.warn(`[Landed Cost Webhook] Could not post chatter note for LC #${rec.newId}: ${chatterErr.message}`);
          }
        }
      }

      logger.info(`[Landed Cost Webhook] Background process finished for IDs: [${ids.join(', ')}]`);
    } catch (err) {
      logger.error(`[Landed Cost Webhook] Background duplication failed for IDs: [${ids.join(', ')}]`, err);
    }
  });
};
