import express from 'express';
import { handleLogin, handleGetMe } from './auth.controller.js';
import { authenticateJwt } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/login', handleLogin);
router.get('/me', authenticateJwt, handleGetMe);

export default router;
