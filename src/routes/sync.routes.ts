import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middleware/auth';
import { BACKOFFICE_ROLES } from '../constants/roles';
import {
  testConnection,
  syncProducts,
  syncCustomers,
  syncOrders,
  syncAll,
  queueStatus,
  syncLogs,
} from '../controllers/sync.controller';
import { handleWebhook } from '../controllers/webhook.controller';

const router = Router();

// ─── Odoo Webhook (no JWT — Odoo pushes here; secured by X-Odoo-Webhook-Secret)
// Must be registered BEFORE the JWT guard below.
router.post('/webhook', handleWebhook);

// Everything below requires a logged-in ADMIN / MANAGER
router.use(authenticate);
router.use(authorizeRoles(...BACKOFFICE_ROLES));

// Test Odoo connection
router.get('/test', testConnection);

// Queue status — live Redis job counts
router.get('/queue-status', queueStatus);

// Sync history
router.get('/logs', syncLogs);

// Manual sync triggers
router.post('/products', syncProducts);
router.post('/customers', syncCustomers);
router.post('/orders', syncOrders);
router.post('/all', syncAll);

export default router;
