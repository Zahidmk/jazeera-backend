"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const driver_controller_1 = require("../controllers/driver.controller");
const validators_1 = require("../middleware/validators");
const router = (0, express_1.Router)();
// All driver routes require authentication
router.use(auth_1.authenticate);
// Home & Route
router.get('/home', driver_controller_1.getHome);
router.get('/route', driver_controller_1.getRoute);
// Deliveries
router.get('/deliveries', driver_controller_1.getDeliveries);
router.get('/deliveries/:id', driver_controller_1.getDeliveryById);
router.get('/deliveries/:id/navigate', driver_controller_1.getDeliveryNavigation);
router.patch('/deliveries/:id/status', validators_1.updateDeliveryStatusRules, validators_1.validate, driver_controller_1.updateDeliveryStatus);
// Stock
router.get('/stock/queue', driver_controller_1.getStockQueue);
router.post('/stock/confirm', driver_controller_1.confirmStockLoad);
router.post('/stock/reject', driver_controller_1.rejectStockLoad);
router.post('/stock/adjust', validators_1.stockAdjustRules, validators_1.validate, driver_controller_1.adjustStock);
// Van Inventory
router.get('/van/inventory', driver_controller_1.getVanInventory);
// Leads
router.post('/leads', validators_1.addLeadRules, validators_1.validate, driver_controller_1.addLead);
// Customers search (for cash sale customer picker)
router.get('/customers/search', driver_controller_1.searchCustomers);
// Shift
router.post('/shift/start', driver_controller_1.startShift);
router.get('/shift/summary', driver_controller_1.getShiftSummary);
router.post('/shift/end', driver_controller_1.endShift);
exports.default = router;
//# sourceMappingURL=driver.routes.js.map