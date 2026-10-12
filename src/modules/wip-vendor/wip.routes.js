import express from 'express';
import {
  handleMoConfirmedWebhook,
  handleTransferDoneWebhook,
  handleSubmitProductionResult
} from './wip.controller.js';

const router = express.Router();

// Webhook endpoints for Odoo triggers
router.post('/mo-confirmed', handleMoConfirmedWebhook);
router.post('/transfer-done', handleTransferDoneWebhook);

// REST API endpoint for Production Results (Callable from Odoo Form or Vendor PWA)
router.post('/production-result', handleSubmitProductionResult);

export default router;
