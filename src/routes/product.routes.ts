import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate, customerPriceRules, customerPricesBatchRules } from '../middleware/validators';
import {
  searchProducts,
  getProductCustomerPrice,
  getProductCustomerPrices,
} from '../controllers/product.controller';

const router = Router();

// GET /api/v1/products/search?q=&category=&customerId=
router.get('/search', authenticate, searchProducts);

// POST /api/v1/products/prices  { customerId, productIds: [] }
router.post('/prices', authenticate, customerPricesBatchRules, validate, getProductCustomerPrices);

// GET /api/v1/products/:productId/price?customerId=
router.get('/:productId/price', authenticate, customerPriceRules, validate, getProductCustomerPrice);

export default router;
