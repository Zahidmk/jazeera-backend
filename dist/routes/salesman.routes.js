"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const salesman_controller_1 = require("../controllers/salesman.controller");
const validators_1 = require("../middleware/validators");
const router = (0, express_1.Router)();
// Require authentication for all salesman routes
router.use(auth_1.authenticate);
// Dashboard Stats
router.get('/dashboard', (0, auth_1.authorizeRoles)('SALESMAN', 'MANAGER', 'ADMIN'), salesman_controller_1.getDashboardStats);
// B2B Quotations Management
router.post('/quotations', (0, auth_1.authorizeRoles)('SALESMAN', 'MANAGER', 'ADMIN'), validators_1.createQuotationRules, validators_1.validate, salesman_controller_1.createQuotation);
router.get('/quotations', (0, auth_1.authorizeRoles)('SALESMAN', 'MANAGER', 'ADMIN'), salesman_controller_1.getQuotations);
router.get('/quotations/:id', (0, auth_1.authorizeRoles)('SALESMAN', 'MANAGER', 'ADMIN'), salesman_controller_1.getQuotationById);
router.put('/quotations/:id', (0, auth_1.authorizeRoles)('SALESMAN', 'MANAGER', 'ADMIN'), validators_1.updateQuotationRules, validators_1.validate, salesman_controller_1.updateQuotation);
router.post('/quotations/:id/submit', (0, auth_1.authorizeRoles)('SALESMAN', 'MANAGER', 'ADMIN'), salesman_controller_1.submitQuotation);
// Status update (Approve/Reject) is restricted to Managers and Admins
router.patch('/quotations/:id/status', (0, auth_1.authorizeRoles)('MANAGER', 'ADMIN'), validators_1.updateQuotationStatusRules, validators_1.validate, salesman_controller_1.updateQuotationStatus);
// Client Visits Tracking
router.post('/visits', (0, auth_1.authorizeRoles)('SALESMAN', 'MANAGER', 'ADMIN'), salesman_controller_1.logVisit);
router.get('/visits', (0, auth_1.authorizeRoles)('SALESMAN', 'MANAGER', 'ADMIN'), salesman_controller_1.getVisits);
// Customers & Products Listing
router.get('/customers', (0, auth_1.authorizeRoles)('SALESMAN', 'MANAGER', 'ADMIN'), salesman_controller_1.getCustomers);
router.get('/products', (0, auth_1.authorizeRoles)('SALESMAN', 'MANAGER', 'ADMIN'), salesman_controller_1.getProducts);
exports.default = router;
//# sourceMappingURL=salesman.routes.js.map