import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  testConnection,
  syncProducts,
  syncCustomers,
  syncOrders,
  syncAll,
  queueStatus,
} from '../controllers/sync.controller';
import { handleWebhook } from '../controllers/webhook.controller';

const router = Router();

// Test Odoo connection (no auth needed for testing)
router.get('/test', testConnection);

// Queue status — live Redis job counts (no auth for dashboard visibility)
router.get('/queue-status', queueStatus);

// Sync endpoints (no auth for easy dashboard integration)
router.post('/products', syncProducts);
router.post('/customers', syncCustomers);
router.post('/orders', syncOrders);
router.post('/all', syncAll);

// ─── Odoo Webhook (no JWT — Odoo pushes here; secured by X-Odoo-Webhook-Secret)
router.post('/webhook', handleWebhook);

export default router;
