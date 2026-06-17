"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const storekeeper_controller_1 = require("../controllers/storekeeper.controller");
const validators_1 = require("../middleware/validators");
const router = (0, express_1.Router)();
// All storekeeper routes require authentication
router.use(auth_1.authenticate);
// Restrict all routes to STORE_KEEPER, ADMIN, or MANAGER roles
router.use((0, auth_1.authorizeRoles)('STORE_KEEPER', 'ADMIN', 'MANAGER'));
router.get('/vans', storekeeper_controller_1.getVans);
router.get('/vans/:vanId/queue', storekeeper_controller_1.getVanQueue);
router.post('/vans/:vanId/load', validators_1.assignVanLoadRules, validators_1.validate, storekeeper_controller_1.assignVanLoad);
exports.default = router;
//# sourceMappingURL=storekeeper.routes.js.map