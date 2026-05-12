import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getStats,
  getDeliveries,
  getSales,
  getDrivers,
  getProducts,
  getDailyReport,
  getVans,
  createVan,
  updateVan,
  deleteVan,
  getVanWarehouse,
  getUsers,
  createUser,
  updateUser,
  getRoutes,
  createRoute,
  updateRoute,
  getSettings,
  updateSettings,
  getCustomers,
  updateCustomerLocation,
  getLeads,
  approveLead,
  rejectLead,
} from '../controllers/admin.controller';
import { exportReport } from '../controllers/reports.controller';
import { exportRules, validate } from '../middleware/validators';

const router = Router();

// All admin routes require authentication
router.use(authenticate);

// GET /api/v1/admin/stats
router.get('/stats', getStats);

// GET /api/v1/admin/deliveries?date=&driverId=&status=&page=&limit=
router.get('/deliveries', getDeliveries);

// GET /api/v1/admin/sales?date=&driverId=&page=&limit=
router.get('/sales', getSales);

// GET /api/v1/admin/drivers
router.get('/drivers', getDrivers);

// GET /api/v1/admin/products?category=&search=&page=&limit=
router.get('/products', getProducts);

// GET /api/v1/admin/reports/daily?date=YYYY-MM-DD
router.get('/reports/daily', getDailyReport);

// GET /api/v1/admin/reports/export?type=csv|pdf&report=daily|deliveries|sales&date=YYYY-MM-DD
router.get('/reports/export', exportRules, validate, exportReport);

// ── Vans ──────────────────────────────────────────────────────────────────────
router.get('/vans', getVans);
router.get('/vans/:id/warehouse', getVanWarehouse);
router.post('/vans', createVan);
router.patch('/vans/:id', updateVan);
router.delete('/vans/:id', deleteVan);

// ── Users ─────────────────────────────────────────────────────────────────────
router.get('/users', getUsers);
router.post('/users', createUser);
router.patch('/users/:id', updateUser);

// ── Routes ────────────────────────────────────────────────────────────────────
router.get('/routes', getRoutes);
router.post('/routes', createRoute);
router.patch('/routes/:id', updateRoute);

// ── Customers ─────────────────────────────────────────────────────────────────
router.get('/customers', getCustomers);
router.patch('/customers/:id/location', updateCustomerLocation);

// ── Leads ─────────────────────────────────────────────────────────────────────
router.get('/leads', getLeads);
router.patch('/leads/:id/approve', approveLead);
router.patch('/leads/:id/reject', rejectLead);

// ── Settings ──────────────────────────────────────────────────────────────────
router.get('/settings', getSettings);
router.patch('/settings', updateSettings);

export default router;

