"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const sync_controller_1 = require("../controllers/sync.controller");
const webhook_controller_1 = require("../controllers/webhook.controller");
const router = (0, express_1.Router)();
// Test Odoo connection (no auth needed for testing)
router.get('/test', sync_controller_1.testConnection);
// Queue status — live Redis job counts (no auth for dashboard visibility)
router.get('/queue-status', sync_controller_1.queueStatus);
// Sync endpoints (no auth for easy dashboard integration)
router.post('/products', sync_controller_1.syncProducts);
router.post('/customers', sync_controller_1.syncCustomers);
router.post('/orders', sync_controller_1.syncOrders);
router.post('/all', sync_controller_1.syncAll);
// ─── Odoo Webhook (no JWT — Odoo pushes here; secured by X-Odoo-Webhook-Secret)
router.post('/webhook', webhook_controller_1.handleWebhook);
exports.default = router;
//# sourceMappingURL=sync.routes.js.map