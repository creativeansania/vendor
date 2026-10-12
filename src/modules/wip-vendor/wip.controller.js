import { wipVendorService } from './wip.service.js';
import { logger } from '../../utils/logger.js';

export const handleMoConfirmedWebhook = async (req, res) => {
  const payload = req.body || {};
  const query = req.query || {};
  const moId = payload._id || payload.id || payload.mo_id || query.id || query.mo_id;

  logger.info('[WIP Webhook] Received MO Confirmed event', { moId, payload });

  if (!moId) {
    return res.status(400).json({ success: false, message: 'MO ID is required' });
  }

  res.status(200).json({ success: true, message: `WIP creation triggered for MO #${moId}` });

  setImmediate(async () => {
    try {
      await wipVendorService.onMoConfirmed(moId);
    } catch (err) {
      logger.error(`[WIP Webhook] Error creating WIP for MO #${moId}: ${err.message}`, err);
    }
  });
};

export const handleTransferDoneWebhook = async (req, res) => {
  const payload = req.body || {};
  const query = req.query || {};
  const pickingId = payload._id || payload.id || payload.picking_id || query.id || query.picking_id;

  logger.info('[WIP Webhook] Received Transfer Done event', { pickingId, payload });

  if (!pickingId) {
    return res.status(400).json({ success: false, message: 'Picking ID is required' });
  }

  res.status(200).json({ success: true, message: `WIP sync triggered for Picking #${pickingId}` });

  setImmediate(async () => {
    try {
      await wipVendorService.onTransferDone(pickingId);
    } catch (err) {
      logger.error(`[WIP Webhook] Error syncing WIP for Picking #${pickingId}: ${err.message}`, err);
    }
  });
};

export const handleSubmitProductionResult = async (req, res) => {
  const { wipId, qtyGradeA, qtyGradeB, sisaMakloonKg } = req.body || {};

  if (!wipId) {
    return res.status(400).json({ success: false, message: 'WIP ID is required' });
  }

  try {
    const result = await wipVendorService.submitProductionResult({
      wipId,
      qtyGradeA: Number(qtyGradeA || 0),
      qtyGradeB: Number(qtyGradeB || 0),
      sisaMakloonKg: Number(sisaMakloonKg || 0)
    });
    return res.status(200).json(result);
  } catch (err) {
    logger.error(`[WIP API] Error submitting production result for WIP #${wipId}: ${err.message}`, err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
