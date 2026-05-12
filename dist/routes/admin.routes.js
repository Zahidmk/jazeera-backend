"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const admin_controller_1 = require("../controllers/admin.controller");
const reports_controller_1 = require("../controllers/reports.controller");
const validators_1 = require("../middleware/validators");
const router = (0, express_1.Router)();
// All admin routes require authentication
router.use(auth_1.authenticate);
// GET /api/v1/admin/stats
router.get('/stats', admin_controller_1.getStats);
// GET /api/v1/admin/deliveries?date=&driverId=&status=&page=&limit=
router.get('/deliveries', admin_controller_1.getDeliveries);
// GET /api/v1/admin/sales?date=&driverId=&page=&limit=
router.get('/sales', admin_controller_1.getSales);
// GET /api/v1/admin/drivers
router.get('/drivers', admin_controller_1.getDrivers);
// GET /api/v1/admin/products?category=&search=&page=&limit=
router.get('/products', admin_controller_1.getProducts);
// GET /api/v1/admin/reports/daily?date=YYYY-MM-DD
router.get('/reports/daily', admin_controller_1.getDailyReport);
// GET /api/v1/admin/reports/export?type=csv|pdf&report=daily|deliveries|sales&date=YYYY-MM-DD
router.get('/reports/export', validators_1.exportRules, validators_1.validate, reports_controller_1.exportReport);
// ── Vans ──────────────────────────────────────────────────────────────────────
router.get('/vans', admin_controller_1.getVans);
router.get('/vans/:id/warehouse', admin_controller_1.getVanWarehouse);
router.post('/vans', admin_controller_1.createVan);
router.patch('/vans/:id', admin_controller_1.updateVan);
router.delete('/vans/:id', admin_controller_1.deleteVan);
// ── Users ─────────────────────────────────────────────────────────────────────
router.get('/users', admin_controller_1.getUsers);
router.post('/users', admin_controller_1.createUser);
router.patch('/users/:id', admin_controller_1.updateUser);
// ── Routes ────────────────────────────────────────────────────────────────────
router.get('/routes', admin_controller_1.getRoutes);
router.post('/routes', admin_controller_1.createRoute);
router.patch('/routes/:id', admin_controller_1.updateRoute);
// ── Customers ─────────────────────────────────────────────────────────────────
router.get('/customers', admin_controller_1.getCustomers);
router.patch('/customers/:id/location', admin_controller_1.updateCustomerLocation);
// ── Settings ──────────────────────────────────────────────────────────────────
router.get('/settings', admin_controller_1.getSettings);
router.patch('/settings', admin_controller_1.updateSettings);
exports.default = router;
//# sourceMappingURL=admin.routes.js.map