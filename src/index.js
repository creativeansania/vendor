import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { verifyJubelioSignature } from './middleware/jubelioSignature.js';
import { handleJubelioInvoiceWebhook } from './modules/jubelio/jubelio.controller.js';
import { defaultOdooClient } from './core/odoo/odooClient.js';
import { outboxWorker } from './modules/pwa/outbox.worker.js';
import apiRouter from './routes/index.js';

const app = express();

// Capture raw body for webhook signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Health Check Endpoint
app.get('/health', async (req, res) => {
  let odooStatus = 'unknown';
  let companyName = config.odoo.companyName;
  let companyId = null;

  try {
    const uid = await defaultOdooClient.authenticate();
    companyId = await defaultOdooClient.getCompanyId();
    odooStatus = uid ? 'connected' : 'auth_failed';
  } catch (err) {
    odooStatus = `error: ${err.message}`;
  }

  res.json({
    status: 'online',
    service: 'Webhook Jubelio -> Odoo (Ansania)',
    timestamp: new Date().toISOString(),
    env: config.nodeEnv,
    odoo: {
      url: config.odoo.url,
      db: config.odoo.db,
      status: odooStatus,
      targetCompany: companyName,
      companyId: companyId
    }
  });
});

// Root Route: Jubelio Legacy Webhook Fallback
app.post('/', verifyJubelioSignature, handleJubelioInvoiceWebhook);

// Mount Modular API Routes
app.use('/api', apiRouter);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Endpoint ${req.method} ${req.path} not found`
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  logger.error('Unhandled server error', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: err.message
  });
});

// Start Server
app.listen(config.port, () => {
  logger.info(`=======================================================`);
  logger.info(`🚀 Webhook Jubelio -> Odoo Service Started (Modular Architecture)`);
  logger.info(`Listening on http://localhost:${config.port}`);
  logger.info(`Target Company Odoo: ${config.odoo.companyName}`);
  logger.info(`Health check: http://localhost:${config.port}/health`);
  logger.info(`Jubelio Webhook: POST http://localhost:${config.port}/api/webhooks/jubelio/invoice`);
  logger.info(`Odoo SO Bypass:  POST http://localhost:${config.port}/api/webhooks/odoo/so-confirm`);
  logger.info(`Odoo Wablas WA:  POST http://localhost:${config.port}/api/webhooks/odoo/send-wa`);
  logger.info(`Odoo LandedCost: POST http://localhost:${config.port}/api/odoo/landed-cost/duplicate`);
  logger.info(`Odoo Transfer:   POST http://localhost:${config.port}/api/webhooks/odoo/transfer-mo-reference`);
  logger.info(`WIP Vendor:      POST http://localhost:${config.port}/api/webhooks/odoo/wip/mo-confirmed`);
  logger.info(`=======================================================`);

  // Start background outbox worker for PWA
  outboxWorker.start(10000);
});
