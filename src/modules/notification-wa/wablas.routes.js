import express from 'express';
import { handleOdooWablasWebhook, handleStreamInvoicePdf } from './wablas.controller.js';

const router = express.Router();

// Supported routes:
// POST /api/webhooks/odoo/send-wa
// POST /api/webhooks/odoo/send-wa-invoice
// GET /api/reports/invoice/:id
router.post('/send-wa', handleOdooWablasWebhook);
router.post('/send-wa-invoice', handleOdooWablasWebhook);

export const reportRouter = express.Router();
reportRouter.get('/invoice/:id', handleStreamInvoicePdf);

export default router;
