import express from 'express';
import jubelioRoutes from '../modules/jubelio/jubelio.routes.js';
import soBypassRoutes from '../modules/so-bypass/soBypass.routes.js';
import landedCostRoutes from '../modules/landed-cost/landedCost.routes.js';
import transferRoutes from '../modules/transfer/transfer.routes.js';
import wablasRoutes, { reportRouter } from '../modules/notification-wa/wablas.routes.js';
import wipRoutes from '../modules/wip-vendor/wip.routes.js';

const router = express.Router();

// 1. Jubelio Webhook Routes
router.use('/webhooks/jubelio', jubelioRoutes);

// 2. Odoo Webhook Routes
router.use('/webhooks/odoo', soBypassRoutes);
router.use('/webhooks/odoo', landedCostRoutes);
router.use('/webhooks/odoo', transferRoutes);
router.use('/webhooks/odoo', wablasRoutes);
router.use('/webhooks/odoo/wip', wipRoutes);

// 3. Alternative Odoo API Routes (Backward Compatibility Aliases)
router.use('/odoo/landed-cost', landedCostRoutes);
router.use('/odoo/transfer', transferRoutes);

// 4. Reports & Documents Streaming Routes
router.use('/reports', reportRouter);

// 5. WIP Vendor API Routes (For Future Vendor PWA)
router.use('/wip', wipRoutes);

export default router;
