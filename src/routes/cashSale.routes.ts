import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getCart,
  addCartItem,
  updateCartItem,
  removeCartItem,
  submitSale,
  uploadReceipt,
  uploadReceiptMiddleware,
} from '../controllers/cashSale.controller';
import {
  addCartItemRules,
  submitSaleRules,
  validate,
} from '../middleware/validators';

const router = Router();

router.use(authenticate);

router.get('/cart', getCart);
router.post('/cart/items', addCartItemRules, validate, addCartItem);
router.patch('/cart/items/:itemId', updateCartItem);
router.delete('/cart/items/:itemId', removeCartItem);
router.post('/submit', submitSaleRules, validate, submitSale);
router.post('/:id/receipt', uploadReceiptMiddleware, uploadReceipt);

export default router;
