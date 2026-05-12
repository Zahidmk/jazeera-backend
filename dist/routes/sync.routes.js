"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const sync_controller_1 = require("../controllers/sync.controller");
const webhook_controller_1 = require("../controllers/webhook.controller");
const router = (0, express_1.Router)();
// Test Odoo connection (no auth needed for testing)
router.get('/test', sync_controller_1.testConnection);
// Queue status — live Redis job counts (no auth for dashboard visibility)
router.get('/queue-status', sync_controller_1.queueStatus);
// Sync endpoints (auth required) — now enqueue jobs, respond instantly
router.post('/products', auth_1.authenticate, sync_controller_1.syncProducts);
router.post('/customers', auth_1.authenticate, sync_controller_1.syncCustomers);
router.post('/orders', auth_1.authenticate, sync_controller_1.syncOrders);
router.post('/all', auth_1.authenticate, sync_controller_1.syncAll);
// ─── Odoo Webhook (no JWT — Odoo pushes here; secured by X-Odoo-Webhook-Secret)
router.post('/webhook', webhook_controller_1.handleWebhook);
exports.default = router;
//# sourceMappingURL=sync.routes.js.map