import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { searchProducts } from '../controllers/product.controller';

const router = Router();

router.get('/search', authenticate, searchProducts);

export default router;
