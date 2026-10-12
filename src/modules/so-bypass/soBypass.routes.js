import express from 'express';
import { handleOdooSOConfirmWebhook } from './soBypass.controller.js';

const router = express.Router();

// Supported routes:
// POST /api/webhooks/odoo/so-confirm
// POST /api/webhooks/odoo/bypass
router.post('/so-confirm', handleOdooSOConfirmWebhook);
router.post('/bypass', handleOdooSOConfirmWebhook);

export default router;
