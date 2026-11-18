import { Router } from 'express';
import { authenticate, requireCheckIn } from '../middleware/auth';
import { validate, customerPriceRules, customerPricesBatchRules } from '../middleware/validators';
import {
  searchProducts,
  getProductCustomerPrice,
  getProductCustomerPrices,
} from '../controllers/product.controller';

const router = Router();

// GET /api/v1/products/search?q=&category=&customerId=
router.get('/search', authenticate, requireCheckIn, searchProducts);

// POST /api/v1/products/prices  { customerId, productIds: [] }
router.post('/prices', authenticate, requireCheckIn, customerPricesBatchRules, validate, getProductCustomerPrices);

// GET /api/v1/products/:productId/price?customerId=
router.get('/:productId/price', authenticate, requireCheckIn, customerPriceRules, validate, getProductCustomerPrice);

export default router;
