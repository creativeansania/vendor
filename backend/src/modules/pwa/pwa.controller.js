import { pwaService } from './pwa.service.js';

export const handleGetOrders = async (req, res) => {
  try {
    const { search, status, vendorId, page, limit, sort, period, backorder } = req.query;
    const result = await pwaService.getOrders({
      user: req.user,
      search,
      status,
      vendorId,
      page,
      limit,
      sort,
      period,
      backorder
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

export const handleGetOrderDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pwaService.getOrderDetails({
      user: req.user,
      orderId: Number(id)
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

export const handleSubmitCuttingRolls = async (req, res) => {
  try {
    const { id } = req.params;
    const { rollUpdates, rolls, actualCutting, actual_cutting } = req.body || {};
    const updates = Array.isArray(rollUpdates) ? rollUpdates : (Array.isArray(rolls) ? rolls : []);
    const inputActual = actualCutting !== undefined ? actualCutting : actual_cutting;

    const result = await pwaService.submitCuttingRolls({
      user: req.user,
      orderId: Number(id),
      rollUpdates: updates,
      actualCutting: inputActual
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

export const handleSubmitProductionResult = async (req, res) => {
  try {
    const { id } = req.params;
    const { qtyGradeA, qtyGradeB, sisaMakloonKg, noSuratJalan } = req.body || {};
    const result = await pwaService.submitProductionResult({
      user: req.user,
      orderId: Number(id),
      qtyGradeA,
      qtyGradeB,
      sisaMakloonKg,
      noSuratJalan
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

export const handleUnlockOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { unlockType, reason } = req.body || {};
    const result = await pwaService.unlockOrder({
      user: req.user,
      orderId: Number(id),
      unlockType,
      reason
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

export const handleGetVendors = async (req, res) => {
  try {
    const vendors = await pwaService.getVendors();
    return res.status(200).json({ success: true, vendors });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

export const handleSyncOrderFromOdoo = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pwaService.syncOrderFromOdoo({
      user: req.user,
      orderId: Number(id)
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

