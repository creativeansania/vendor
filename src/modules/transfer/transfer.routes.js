import express from 'express';
import { handleTransferMoReferenceWebhook } from './transfer.controller.js';

const router = express.Router();

// Supported routes:
// POST /api/webhooks/odoo/transfer-mo-reference
// POST /api/webhooks/odoo/transfer
// POST /api/odoo/transfer/resolve-mo-so
router.post('/transfer-mo-reference', handleTransferMoReferenceWebhook);
router.post('/transfer', handleTransferMoReferenceWebhook);
router.post('/resolve-mo-so', handleTransferMoReferenceWebhook);

export default router;
