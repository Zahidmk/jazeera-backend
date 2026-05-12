"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const cashSale_controller_1 = require("../controllers/cashSale.controller");
const validators_1 = require("../middleware/validators");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.get('/cart', cashSale_controller_1.getCart);
router.post('/cart/items', validators_1.addCartItemRules, validators_1.validate, cashSale_controller_1.addCartItem);
router.patch('/cart/items/:itemId', cashSale_controller_1.updateCartItem);
router.delete('/cart/items/:itemId', cashSale_controller_1.removeCartItem);
router.post('/submit', validators_1.submitSaleRules, validators_1.validate, cashSale_controller_1.submitSale);
router.post('/:id/receipt', cashSale_controller_1.uploadReceiptMiddleware, cashSale_controller_1.uploadReceipt);
exports.default = router;
//# sourceMappingURL=cashSale.routes.js.map