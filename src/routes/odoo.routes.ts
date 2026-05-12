import { Router } from 'express';
import {
  getOdooProducts,
  getOdooOrders,
  getOdooCustomers,
  getOdooStock,
} from '../controllers/odoo.controller';

const router = Router();

// ─── Direct Odoo data (no DB sync required) ──────────────────────────────────
// These endpoints fetch live from Odoo XML-RPC — used by the admin dashboard

// GET /api/v1/odoo/products?limit=500
router.get('/products', getOdooProducts);

// GET /api/v1/odoo/orders?limit=200
router.get('/orders', getOdooOrders);

// GET /api/v1/odoo/customers?limit=500
router.get('/customers', getOdooCustomers);

// GET /api/v1/odoo/stock?limit=1000
router.get('/stock', getOdooStock);

export default router;
