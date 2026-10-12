import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { verifyJubelioSignature } from './middleware/jubelioSignature.js';
import { handleJubelioInvoiceWebhook } from './controllers/webhookController.js';
import { handleOdooSOConfirmWebhook } from './controllers/odooWebhookController.js';
import { handleOdooWablasWebhook, handleStreamInvoicePdf } from './controllers/wablasWebhookController.js';
import { handleDuplicateLandedCost } from './controllers/landedCostController.js';
import { handleTransferMoReferenceWebhook } from './controllers/transferWebhookController.js';
import { odooService } from './services/odooService.js';

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
    const uid = await odooService.authenticate();
    companyId = await odooService.getCompanyId();
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

// Jubelio Webhook Invoice Route (supports both / and /api/webhooks/jubelio/invoice)
app.post('/api/webhooks/jubelio/invoice', verifyJubelioSignature, handleJubelioInvoiceWebhook);
app.post('/', verifyJubelioSignature, handleJubelioInvoiceWebhook);

// Odoo Webhook Route: Auto Bypass Delivery & Invoice on SO Confirm
app.post('/api/webhooks/odoo/so-confirm', handleOdooSOConfirmWebhook);
app.post('/api/webhooks/odoo/bypass', handleOdooSOConfirmWebhook);

// Odoo Webhook Route: Send Document PDF via Wablas WhatsApp
app.post('/api/webhooks/odoo/send-wa', handleOdooWablasWebhook);
app.post('/api/webhooks/odoo/send-wa-invoice', handleOdooWablasWebhook);

// Odoo Route: Duplicate Landed Cost with MOs
app.post('/api/odoo/landed-cost/duplicate', handleDuplicateLandedCost);
app.post('/api/webhooks/odoo/duplicate-landed-cost', handleDuplicateLandedCost);

// Odoo Webhook Route: Resolve MO & SO references on Transfers (PC, SFP, INT)
app.post('/api/webhooks/odoo/transfer-mo-reference', handleTransferMoReferenceWebhook);
app.post('/api/webhooks/odoo/transfer', handleTransferMoReferenceWebhook);
app.post('/api/odoo/transfer/resolve-mo-so', handleTransferMoReferenceWebhook);

// Public Invoice PDF streaming endpoint (for direct WhatsApp download links)
app.get('/api/reports/invoice/:id', handleStreamInvoicePdf);

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
  logger.info(`🚀 Webhook Jubelio -> Odoo Service Started`);
  logger.info(`Listening on http://localhost:${config.port}`);
  logger.info(`Target Company Odoo: ${config.odoo.companyName}`);
  logger.info(`Health check: http://localhost:${config.port}/health`);
  logger.info(`Jubelio Webhook: POST http://localhost:${config.port}/api/webhooks/jubelio/invoice`);
  logger.info(`Odoo SO Bypass:  POST http://localhost:${config.port}/api/webhooks/odoo/so-confirm`);
  logger.info(`Odoo Wablas WA:  POST http://localhost:${config.port}/api/webhooks/odoo/send-wa`);
  logger.info(`Odoo LandedCost: POST http://localhost:${config.port}/api/odoo/landed-cost/duplicate`);
  logger.info(`Odoo Transfer:   POST http://localhost:${config.port}/api/webhooks/odoo/transfer-mo-reference`);
  logger.info(`=======================================================`);
});
