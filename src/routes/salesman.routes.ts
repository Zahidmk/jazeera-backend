import { Router } from 'express';
import { authenticate, authorizeRoles, requireCheckIn } from '../middleware/auth';
import {
  createQuotation,
  getQuotations,
  getQuotationById,
  updateQuotation,
  submitQuotation,
  updateQuotationStatus,
  logVisit,
  getVisits,
  getCustomers,
  getProducts,
  getDashboardStats,
} from '../controllers/salesman.controller';
import {
  createQuotationRules,
  updateQuotationRules,
  updateQuotationStatusRules,
  validate,
} from '../middleware/validators';

const router = Router();

// Require authentication for all salesman routes. Salesmen must also be checked in (requireCheckIn),
// except on /dashboard (the home screen with the attendance card).
router.use(authenticate);

// Dashboard Stats
router.get('/dashboard', authorizeRoles('SALESMAN', 'MANAGER', 'ADMIN'), getDashboardStats);

// B2B Quotations Management
router.post('/quotations', authorizeRoles('SALESMAN', 'MANAGER', 'ADMIN'), requireCheckIn, createQuotationRules, validate, createQuotation);
router.get('/quotations', authorizeRoles('SALESMAN', 'MANAGER', 'ADMIN'), requireCheckIn, getQuotations);
router.get('/quotations/:id', authorizeRoles('SALESMAN', 'MANAGER', 'ADMIN'), requireCheckIn, getQuotationById);
router.put('/quotations/:id', authorizeRoles('SALESMAN', 'MANAGER', 'ADMIN'), requireCheckIn, updateQuotationRules, validate, updateQuotation);
router.post('/quotations/:id/submit', authorizeRoles('SALESMAN', 'MANAGER', 'ADMIN'), requireCheckIn, submitQuotation);

// Status update (Approve/Reject) is restricted to Managers and Admins
router.patch('/quotations/:id/status', authorizeRoles('MANAGER', 'ADMIN'), updateQuotationStatusRules, validate, updateQuotationStatus);

// Client Visits Tracking
router.post('/visits', authorizeRoles('SALESMAN', 'MANAGER', 'ADMIN'), requireCheckIn, logVisit);
router.get('/visits', authorizeRoles('SALESMAN', 'MANAGER', 'ADMIN'), requireCheckIn, getVisits);

// Customers & Products Listing
router.get('/customers', authorizeRoles('SALESMAN', 'MANAGER', 'ADMIN'), requireCheckIn, getCustomers);
router.get('/products', authorizeRoles('SALESMAN', 'MANAGER', 'ADMIN'), requireCheckIn, getProducts);

export default router;
