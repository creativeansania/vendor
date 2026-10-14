import express from 'express';
import {
  handleGetOrders,
  handleGetOrderDetails,
  handleSubmitCuttingRolls,
  handleSubmitProductionResult,
  handleUnlockOrder,
  handleGetVendors
} from './pwa.controller.js';
import { authenticateJwt, requireRoles } from '../../middlewares/auth.middleware.js';

const router = express.Router();

// All PWA routes require authentication
router.use(authenticateJwt);

// 1. Dropdown vendors (internal, admin, master_admin)
router.get('/vendors', handleGetVendors);

// 2. Orders list & details (accessible by all 4 roles, filtered by role)
router.get('/orders', handleGetOrders);
router.get('/orders/:id', handleGetOrderDetails);

// 3. Operational submissions (accessible by master_admin, master_vendor, admin_vendor)
router.post('/orders/:id/cutting-rolls', requireRoles('master_admin', 'master_vendor', 'admin_vendor'), handleSubmitCuttingRolls);
router.post('/orders/:id/production-result', requireRoles('master_admin', 'master_vendor', 'admin_vendor'), handleSubmitProductionResult);

// 4. Unlock locked stages (Master Admin only!)
router.post('/orders/:id/unlock', requireRoles('master_admin'), handleUnlockOrder);

export default router;
