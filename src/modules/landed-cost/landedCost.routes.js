import express from 'express';
import { handleDuplicateLandedCost } from './landedCost.controller.js';

const router = express.Router();

// Supported routes:
// POST /api/odoo/landed-cost/duplicate
// POST /api/webhooks/odoo/duplicate-landed-cost
router.post('/duplicate', handleDuplicateLandedCost);
router.post('/duplicate-landed-cost', handleDuplicateLandedCost);

export default router;
