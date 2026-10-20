import { wipVendorService } from './wip.service.js';
import { logger } from '../../utils/logger.js';

/**
 * Webhook: MO Confirmed
 */
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

/**
 * Webhook: Transfer Done (/PC/, /SPB/, /SFP/)
 */
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

/**
 * API / Webhook: Submit Production Results (Grade A, Grade B, Sisa Makloon)
 */
export const handleSubmitProductionResult = async (req, res) => {
  const payload = req.body || {};
  const wipId = payload.wipId || payload._id || payload.id;
  const qtyGradeA = payload.qtyGradeA !== undefined ? payload.qtyGradeA : payload.x_studio_qty_kirim_a_grade;
  const qtyGradeB = payload.qtyGradeB !== undefined ? payload.qtyGradeB : payload.x_studio_qty_kirim_b_grade;
  const sisaPotongPanjang = payload.sisaPotongPanjang !== undefined ? payload.sisaPotongPanjang : (payload.sisa_potong_panjang !== undefined ? payload.sisa_potong_panjang : payload.x_studio_sisa_potong_panjang);
  const sisaPotongSedang = payload.sisaPotongSedang !== undefined ? payload.sisaPotongSedang : (payload.sisa_potong_sedang !== undefined ? payload.sisa_potong_sedang : payload.x_studio_sisa_potong_sedang);
  const sisaPotongPendek = payload.sisaPotongPendek !== undefined ? payload.sisaPotongPendek : (payload.sisa_potong_pendek !== undefined ? payload.sisa_potong_pendek : payload.x_studio_sisa_potong_pendek);
  const sisaMakloonKg = payload.sisaMakloonKg !== undefined ? payload.sisaMakloonKg : (payload.sisa_makloon_kg !== undefined ? payload.sisa_makloon_kg : payload.x_studio_sisa_makloon_kg);

  if (!wipId) {
    return res.status(400).json({ success: false, message: 'WIP ID is required' });
  }

  try {
    const result = await wipVendorService.submitProductionResult({
      wipId,
      qtyGradeA: Number(qtyGradeA || 0),
      qtyGradeB: Number(qtyGradeB || 0),
      sisaPotongPanjang: sisaPotongPanjang !== undefined ? Number(sisaPotongPanjang) : undefined,
      sisaPotongSedang: sisaPotongSedang !== undefined ? Number(sisaPotongSedang) : undefined,
      sisaPotongPendek: sisaPotongPendek !== undefined ? Number(sisaPotongPendek) : undefined,
      sisaMakloonKg: Number(sisaMakloonKg || 0)
    });
    return res.status(200).json(result);
  } catch (err) {
    logger.error(`[WIP API] Error submitting production result for WIP #${wipId}: ${err.message}`, err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * API: Update Roll Cutting Weights from Vendor PWA
 */
export const handleUpdateCuttingRolls = async (req, res) => {
  const payload = req.body || {};
  const wipId = payload.wipId || payload.id;
  const rollUpdates = payload.rollUpdates || payload.lines || [];

  if (!wipId || !Array.isArray(rollUpdates)) {
    return res.status(400).json({ success: false, message: 'WIP ID and rollUpdates array are required' });
  }

  try {
    const result = await wipVendorService.updateCuttingRolls({ wipId, rollUpdates });
    return res.status(200).json(result);
  } catch (err) {
    logger.error(`[WIP API] Error updating roll cuttings for WIP #${wipId}: ${err.message}`, err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
