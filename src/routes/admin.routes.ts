import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middleware/auth';
import { BACKOFFICE_ROLES } from '../constants/roles';
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
import {
  getMerchandisers,
  getAttendance,
  getAttendanceById,
  getAttendanceSelfie,
  updateAttendance,
  getDevices,
  updateDevice,
  getShopVisits,
  getShopVisitById,
  getFeedback,
  reviewFeedback,
} from '../controllers/merchandiserAdmin.controller';
import { exportReport, getReportsSummary } from '../controllers/reports.controller';
import { retryOdooSync } from '../controllers/cashSale.controller';
import { exportRules, validate } from '../middleware/validators';

const router = Router();

// All admin routes require authentication AND a back-office role (ADMIN / MANAGER)
router.use(authenticate);
router.use(authorizeRoles(...BACKOFFICE_ROLES));

// GET /api/v1/admin/stats
router.get('/stats', getStats);

// GET /api/v1/admin/deliveries?date=&driverId=&status=&page=&limit=
router.get('/deliveries', getDeliveries);

// GET /api/v1/admin/sales?date=&driverId=&page=&limit=
router.get('/sales', getSales);

// POST /api/v1/admin/cash-sales/:id/retry-sync — retry a failed Odoo push
router.post('/cash-sales/:id/retry-sync', retryOdooSync);

// GET /api/v1/admin/drivers
router.get('/drivers', getDrivers);

// GET /api/v1/admin/products?category=&search=&page=&limit=
router.get('/products', getProducts);

// GET /api/v1/admin/reports/daily?date=YYYY-MM-DD
router.get('/reports/daily', getDailyReport);

// GET /api/v1/admin/reports/summary
router.get('/reports/summary', getReportsSummary);

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

// ── Merchandiser module (Phase 2) ─────────────────────────────────────────────
router.get('/merchandisers', getMerchandisers);
router.get('/attendance', getAttendance);
router.get('/attendance/:id', getAttendanceById);
router.get('/attendance/:id/selfie', getAttendanceSelfie);
router.patch('/attendance/:id', updateAttendance);
router.get('/devices', getDevices);
router.patch('/devices/:id', updateDevice);
router.get('/shop-visits', getShopVisits);
router.get('/shop-visits/:id', getShopVisitById);
router.get('/feedback', getFeedback);
router.patch('/feedback/:id', reviewFeedback);

// ── Settings ──────────────────────────────────────────────────────────────────
router.get('/settings', getSettings);
router.patch('/settings', updateSettings);

export default router;

