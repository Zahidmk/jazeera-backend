import { body, param, query, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';

// ─── Validation result handler middleware ─────────────────────────────────────
export const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({
      success: false,
      error: 'Validation failed',
      details: errors.array().map((e) => ({ field: e.type === 'field' ? (e as any).path : e.type, message: e.msg })),
    });
    return;
  }
  next();
};

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const loginRules = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];

// ─── Cash Sale ────────────────────────────────────────────────────────────────
export const addCartItemRules = [
  body('productId').isUUID().withMessage('Valid productId (UUID) is required'),
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('discount').optional().isFloat({ min: 0, max: 100 }).withMessage('Discount must be 0-100'),
];

export const submitSaleRules = [
  body('saleType').optional().isIn(['CASH', 'CREDIT']).withMessage('saleType must be CASH or CREDIT'),
  body('customerId').optional().isUUID().withMessage('customerId must be a valid UUID'),
  body('customerName').optional().isLength({ min: 2 }).trim().escape(),
  body('customerPhone').optional().isMobilePhone('any').withMessage('Invalid phone number'),
  // Flutter direct-submit: optional items array
  body('items').optional().isArray({ min: 1 }).withMessage('items must be a non-empty array'),
  body('items.*.productId').optional().isUUID().withMessage('Each item must have a valid productId UUID'),
  body('items.*.quantity').optional().isInt({ min: 1 }).withMessage('Each item quantity must be at least 1'),
  body('items.*.unitPrice').optional().isFloat({ min: 0 }).withMessage('unitPrice must be a positive number'),
  body('items.*.discount').optional().isFloat({ min: 0, max: 100 }).withMessage('discount must be 0-100'),
];

// ─── Delivery ─────────────────────────────────────────────────────────────────
export const updateDeliveryStatusRules = [
  param('id').isUUID().withMessage('Delivery ID must be a UUID'),
  body('status')
    .isIn(['IN_PROGRESS', 'DELIVERED', 'FAILED', 'RETURNED'])
    .withMessage('Invalid status value'),
  body('notes').optional().isLength({ max: 500 }).trim().escape(),
  body('failReason').optional().isLength({ max: 500 }).trim().escape(),
];

// ─── Lead ─────────────────────────────────────────────────────────────────────
export const addLeadRules = [
  body('name').notEmpty().isLength({ min: 2, max: 200 }).trim().escape().withMessage('Customer name is required'),
  body('phone').optional().customSanitizer((v) => (v != null ? String(v) : v)),
  body('address').optional().isLength({ max: 500 }).trim().escape(),
  body('notes').optional().isLength({ max: 1000 }).trim().escape(),
];

// ─── Stock Adjustment ─────────────────────────────────────────────────────────
export const stockAdjustRules = [
  body('productId').isUUID().withMessage('Valid productId (UUID) is required'),
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
  body('reason').isIn(['DAMAGE', 'EXPIRY', 'THEFT', 'OTHER']).withMessage('Invalid adjustment reason'),
  body('notes').optional().isLength({ max: 500 }).trim().escape(),
];

// ─── Admin report export ──────────────────────────────────────────────────────
export const exportRules = [
  query('type').optional().isIn(['csv', 'pdf']).withMessage('type must be csv or pdf'),
  query('report').optional().isIn(['daily', 'deliveries', 'sales']).withMessage('report must be daily, deliveries, or sales'),
  query('date').optional().isISO8601().withMessage('date must be ISO8601 format (YYYY-MM-DD)'),
];

// ─── Quotations ────────────────────────────────────────────────────────────────
export const createQuotationRules = [
  body('customerId').optional().isUUID().withMessage('customerId must be a valid UUID'),
  body('remarks').optional().isLength({ max: 500 }).trim().escape(),
  body('items').isArray({ min: 1 }).withMessage('items must be a non-empty array'),
  body('items.*.productId').isUUID().withMessage('Each item must have a valid productId UUID'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Each item quantity must be at least 1'),
  body('items.*.unitPrice').isFloat({ min: 0 }).withMessage('unitPrice must be a positive number'),
  body('items.*.requestedPrice').optional().isFloat({ min: 0 }).withMessage('requestedPrice must be a positive number'),
  body('items.*.discountPct').optional().isFloat({ min: 0, max: 100 }).withMessage('discountPct must be 0-100'),
  body('items.*.suggestedMode').optional().isBoolean().withMessage('suggestedMode must be a boolean'),
];

export const updateQuotationRules = [
  param('id').isUUID().withMessage('Quotation ID must be a UUID'),
  body('customerId').optional().isUUID().withMessage('customerId must be a valid UUID'),
  body('remarks').optional().isLength({ max: 500 }).trim().escape(),
  body('items').optional().isArray({ min: 1 }).withMessage('items must be a non-empty array'),
  body('items.*.productId').optional().isUUID().withMessage('Each item must have a valid productId UUID'),
  body('items.*.quantity').optional().isInt({ min: 1 }).withMessage('Each item quantity must be at least 1'),
  body('items.*.unitPrice').optional().isFloat({ min: 0 }).withMessage('unitPrice must be a positive number'),
  body('items.*.requestedPrice').optional().isFloat({ min: 0 }).withMessage('requestedPrice must be a positive number'),
  body('items.*.discountPct').optional().isFloat({ min: 0, max: 100 }).withMessage('discountPct must be 0-100'),
  body('items.*.suggestedMode').optional().isBoolean().withMessage('suggestedMode must be a boolean'),
];

export const updateQuotationStatusRules = [
  param('id').isUUID().withMessage('Quotation ID must be a UUID'),
  body('status').isIn(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']).withMessage('Invalid status value'),
  body('rejectionReason').optional().isLength({ max: 500 }).trim().escape(),
];

// ─── Storekeeper Stock Load ──────────────────────────────────────────────────
export const assignVanLoadRules = [
  param('vanId').isUUID().withMessage('Van ID must be a UUID'),
  body('products').isArray({ min: 1 }).withMessage('products must be a non-empty array'),
  body('products.*.productId').isUUID().withMessage('Each product must have a valid productId UUID'),
  body('products.*.quantity').isInt({ min: 1 }).withMessage('Each product quantity must be at least 1'),
];


