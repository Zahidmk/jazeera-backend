"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = require("../controllers/auth.controller");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.post('/login', auth_controller_1.login);
router.post('/forgot-password', auth_controller_1.forgotPassword);
router.get('/me', auth_1.authenticate, auth_controller_1.getMe);
exports.default = router;
//# sourceMappingURL=auth.routes.js.map