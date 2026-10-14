import express from 'express';
import {
  handleMoConfirmedWebhook,
  handleTransferDoneWebhook,
  handleSubmitProductionResult,
  handleUpdateCuttingRolls
} from './wip.controller.js';

const router = express.Router();

// Webhook endpoints for Odoo triggers
router.post('/mo-confirmed', handleMoConfirmedWebhook);
router.post('/transfer-done', handleTransferDoneWebhook);

// REST API endpoints (For Odoo Form Webhook or Future Vendor PWA)
router.post('/production-result', handleSubmitProductionResult);
router.post('/cutting-rolls', handleUpdateCuttingRolls);

export default router;
