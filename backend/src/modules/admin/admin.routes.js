import express from 'express';
import { handleGetUsers, handleCreateUser, handleUpdateUser } from './admin.controller.js';
import { authenticateJwt, requireRoles } from '../../middlewares/auth.middleware.js';

const router = express.Router();

// Only master_admin can manage users
router.use(authenticateJwt, requireRoles('master_admin'));

router.get('/users', handleGetUsers);
router.post('/users', handleCreateUser);
router.put('/users/:id', handleUpdateUser);

export default router;
