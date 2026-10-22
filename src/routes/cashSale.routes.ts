import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middleware/auth';
import { DRIVER_APP_ROLES } from '../constants/roles';
import {
  getCart,
  addCartItem,
  updateCartItem,
  removeCartItem,
  submitSale,
  uploadReceipt,
  uploadReceiptMiddleware,
  getInvoice,
  getInvoicePdf,
} from '../controllers/cashSale.controller';
import {
  addCartItemRules,
  submitSaleRules,
  validate,
} from '../middleware/validators';

const router = Router();

router.use(authenticate);
router.use(authorizeRoles(...DRIVER_APP_ROLES));

router.get('/cart', getCart);
router.post('/cart/items', addCartItemRules, validate, addCartItem);
router.patch('/cart/items/:itemId', updateCartItem);
router.delete('/cart/items/:itemId', removeCartItem);
router.post('/submit', submitSaleRules, validate, submitSale);
router.post('/:id/receipt', uploadReceiptMiddleware, uploadReceipt);
router.get('/:id/invoice', getInvoice);
router.get('/:id/invoice/pdf', getInvoicePdf);

export default router;
