"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const product_controller_1 = require("../controllers/product.controller");
const router = (0, express_1.Router)();
router.get('/search', auth_1.authenticate, product_controller_1.searchProducts);
exports.default = router;
//# sourceMappingURL=product.routes.js.map