import express from 'express';
import { handleJubelioInvoiceWebhook } from './jubelio.controller.js';
import { verifyJubelioSignature } from '../../middleware/jubelioSignature.js';

const router = express.Router();

// Supported routes:
// POST /api/webhooks/jubelio/invoice
// POST /api/webhooks/jubelio/
router.post('/invoice', verifyJubelioSignature, handleJubelioInvoiceWebhook);
router.post('/', verifyJubelioSignature, handleJubelioInvoiceWebhook);

export default router;
