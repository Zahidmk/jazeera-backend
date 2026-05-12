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

// Sync endpoints (auth required) — now enqueue jobs, respond instantly
router.post('/products', authenticate, syncProducts);
router.post('/customers', authenticate, syncCustomers);
router.post('/orders', authenticate, syncOrders);
router.post('/all', authenticate, syncAll);

// ─── Odoo Webhook (no JWT — Odoo pushes here; secured by X-Odoo-Webhook-Secret)
router.post('/webhook', handleWebhook);

export default router;
