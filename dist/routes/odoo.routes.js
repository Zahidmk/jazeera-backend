"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const odoo_controller_1 = require("../controllers/odoo.controller");
const router = (0, express_1.Router)();
// ─── Direct Odoo data (no DB sync required) ──────────────────────────────────
// These endpoints fetch live from Odoo XML-RPC — used by the admin dashboard
// GET /api/v1/odoo/products?limit=500
router.get('/products', odoo_controller_1.getOdooProducts);
// GET /api/v1/odoo/orders?limit=200
router.get('/orders', odoo_controller_1.getOdooOrders);
// GET /api/v1/odoo/customers?limit=500
router.get('/customers', odoo_controller_1.getOdooCustomers);
// GET /api/v1/odoo/stock?limit=1000
router.get('/stock', odoo_controller_1.getOdooStock);
exports.default = router;
//# sourceMappingURL=odoo.routes.js.map