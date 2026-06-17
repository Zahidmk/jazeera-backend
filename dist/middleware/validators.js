"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignVanLoadRules = exports.updateQuotationStatusRules = exports.updateQuotationRules = exports.createQuotationRules = exports.exportRules = exports.stockAdjustRules = exports.addLeadRules = exports.updateDeliveryStatusRules = exports.submitSaleRules = exports.addCartItemRules = exports.loginRules = exports.validate = void 0;
const express_validator_1 = require("express-validator");
// ─── Validation result handler middleware ─────────────────────────────────────
const validate = (req, res, next) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        res.status(422).json({
            success: false,
            error: 'Validation failed',
            details: errors.array().map((e) => ({ field: e.type === 'field' ? e.path : e.type, message: e.msg })),
        });
        return;
    }
    next();
};
exports.validate = validate;
// ─── Auth ─────────────────────────────────────────────────────────────────────
exports.loginRules = [
    (0, express_validator_1.body)('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    (0, express_validator_1.body)('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];
// ─── Cash Sale ────────────────────────────────────────────────────────────────
exports.addCartItemRules = [
    (0, express_validator_1.body)('productId').isUUID().withMessage('Valid productId (UUID) is required'),
    (0, express_validator_1.body)('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
    (0, express_validator_1.body)('discount').optional().isFloat({ min: 0, max: 100 }).withMessage('Discount must be 0-100'),
];
exports.submitSaleRules = [
    (0, express_validator_1.body)('saleType').optional().isIn(['CASH', 'CREDIT']).withMessage('saleType must be CASH or CREDIT'),
    (0, express_validator_1.body)('customerId').optional().isUUID().withMessage('customerId must be a valid UUID'),
    (0, express_validator_1.body)('customerName').optional().isLength({ min: 2 }).trim().escape(),
    (0, express_validator_1.body)('customerPhone').optional().isMobilePhone('any').withMessage('Invalid phone number'),
    // Flutter direct-submit: optional items array
    (0, express_validator_1.body)('items').optional().isArray({ min: 1 }).withMessage('items must be a non-empty array'),
    (0, express_validator_1.body)('items.*.productId').optional().isUUID().withMessage('Each item must have a valid productId UUID'),
    (0, express_validator_1.body)('items.*.quantity').optional().isInt({ min: 1 }).withMessage('Each item quantity must be at least 1'),
    (0, express_validator_1.body)('items.*.unitPrice').optional().isFloat({ min: 0 }).withMessage('unitPrice must be a positive number'),
    (0, express_validator_1.body)('items.*.discount').optional().isFloat({ min: 0, max: 100 }).withMessage('discount must be 0-100'),
];
// ─── Delivery ─────────────────────────────────────────────────────────────────
exports.updateDeliveryStatusRules = [
    (0, express_validator_1.param)('id').isUUID().withMessage('Delivery ID must be a UUID'),
    (0, express_validator_1.body)('status')
        .isIn(['IN_PROGRESS', 'DELIVERED', 'FAILED', 'RETURNED'])
        .withMessage('Invalid status value'),
    (0, express_validator_1.body)('notes').optional().isLength({ max: 500 }).trim().escape(),
    (0, express_validator_1.body)('failReason').optional().isLength({ max: 500 }).trim().escape(),
];
// ─── Lead ─────────────────────────────────────────────────────────────────────
exports.addLeadRules = [
    (0, express_validator_1.body)('name').notEmpty().isLength({ min: 2, max: 200 }).trim().escape().withMessage('Customer name is required'),
    (0, express_validator_1.body)('phone').optional().customSanitizer((v) => (v != null ? String(v) : v)),
    (0, express_validator_1.body)('address').optional().isLength({ max: 500 }).trim().escape(),
    (0, express_validator_1.body)('notes').optional().isLength({ max: 1000 }).trim().escape(),
];
// ─── Stock Adjustment ─────────────────────────────────────────────────────────
exports.stockAdjustRules = [
    (0, express_validator_1.body)('productId').isUUID().withMessage('Valid productId (UUID) is required'),
    (0, express_validator_1.body)('quantity').isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
    (0, express_validator_1.body)('reason').isIn(['DAMAGE', 'EXPIRY', 'THEFT', 'OTHER']).withMessage('Invalid adjustment reason'),
    (0, express_validator_1.body)('notes').optional().isLength({ max: 500 }).trim().escape(),
];
// ─── Admin report export ──────────────────────────────────────────────────────
exports.exportRules = [
    (0, express_validator_1.query)('type').optional().isIn(['csv', 'pdf']).withMessage('type must be csv or pdf'),
    (0, express_validator_1.query)('report').optional().isIn(['daily', 'deliveries', 'sales']).withMessage('report must be daily, deliveries, or sales'),
    (0, express_validator_1.query)('date').optional().isISO8601().withMessage('date must be ISO8601 format (YYYY-MM-DD)'),
];
// ─── Quotations ────────────────────────────────────────────────────────────────
exports.createQuotationRules = [
    (0, express_validator_1.body)('customerId').optional().isUUID().withMessage('customerId must be a valid UUID'),
    (0, express_validator_1.body)('remarks').optional().isLength({ max: 500 }).trim().escape(),
    (0, express_validator_1.body)('items').isArray({ min: 1 }).withMessage('items must be a non-empty array'),
    (0, express_validator_1.body)('items.*.productId').isUUID().withMessage('Each item must have a valid productId UUID'),
    (0, express_validator_1.body)('items.*.quantity').isInt({ min: 1 }).withMessage('Each item quantity must be at least 1'),
    (0, express_validator_1.body)('items.*.unitPrice').isFloat({ min: 0 }).withMessage('unitPrice must be a positive number'),
    (0, express_validator_1.body)('items.*.requestedPrice').optional().isFloat({ min: 0 }).withMessage('requestedPrice must be a positive number'),
    (0, express_validator_1.body)('items.*.discountPct').optional().isFloat({ min: 0, max: 100 }).withMessage('discountPct must be 0-100'),
    (0, express_validator_1.body)('items.*.suggestedMode').optional().isBoolean().withMessage('suggestedMode must be a boolean'),
];
exports.updateQuotationRules = [
    (0, express_validator_1.param)('id').isUUID().withMessage('Quotation ID must be a UUID'),
    (0, express_validator_1.body)('customerId').optional().isUUID().withMessage('customerId must be a valid UUID'),
    (0, express_validator_1.body)('remarks').optional().isLength({ max: 500 }).trim().escape(),
    (0, express_validator_1.body)('items').optional().isArray({ min: 1 }).withMessage('items must be a non-empty array'),
    (0, express_validator_1.body)('items.*.productId').optional().isUUID().withMessage('Each item must have a valid productId UUID'),
    (0, express_validator_1.body)('items.*.quantity').optional().isInt({ min: 1 }).withMessage('Each item quantity must be at least 1'),
    (0, express_validator_1.body)('items.*.unitPrice').optional().isFloat({ min: 0 }).withMessage('unitPrice must be a positive number'),
    (0, express_validator_1.body)('items.*.requestedPrice').optional().isFloat({ min: 0 }).withMessage('requestedPrice must be a positive number'),
    (0, express_validator_1.body)('items.*.discountPct').optional().isFloat({ min: 0, max: 100 }).withMessage('discountPct must be 0-100'),
    (0, express_validator_1.body)('items.*.suggestedMode').optional().isBoolean().withMessage('suggestedMode must be a boolean'),
];
exports.updateQuotationStatusRules = [
    (0, express_validator_1.param)('id').isUUID().withMessage('Quotation ID must be a UUID'),
    (0, express_validator_1.body)('status').isIn(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']).withMessage('Invalid status value'),
    (0, express_validator_1.body)('rejectionReason').optional().isLength({ max: 500 }).trim().escape(),
];
// ─── Storekeeper Stock Load ──────────────────────────────────────────────────
exports.assignVanLoadRules = [
    (0, express_validator_1.param)('vanId').isUUID().withMessage('Van ID must be a UUID'),
    (0, express_validator_1.body)('products').isArray({ min: 1 }).withMessage('products must be a non-empty array'),
    (0, express_validator_1.body)('products.*.productId').isUUID().withMessage('Each product must have a valid productId UUID'),
    (0, express_validator_1.body)('products.*.quantity').isInt({ min: 1 }).withMessage('Each product quantity must be at least 1'),
];
//# sourceMappingURL=validators.js.map