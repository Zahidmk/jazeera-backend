import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middleware/auth';
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

// Require authentication for all salesman routes
router.use(authenticate);

// Dashboard Stats
router.get('/dashboard', authorizeRoles('SALESMAN', 'MANAGER', 'ADMIN'), getDashboardStats);

// B2B Quotations Management
router.post('/quotations', authorizeRoles('SALESMAN', 'MANAGER', 'ADMIN'), createQuotationRules, validate, createQuotation);
router.get('/quotations', authorizeRoles('SALESMAN', 'MANAGER', 'ADMIN'), getQuotations);
router.get('/quotations/:id', authorizeRoles('SALESMAN', 'MANAGER', 'ADMIN'), getQuotationById);
router.put('/quotations/:id', authorizeRoles('SALESMAN', 'MANAGER', 'ADMIN'), updateQuotationRules, validate, updateQuotation);
router.post('/quotations/:id/submit', authorizeRoles('SALESMAN', 'MANAGER', 'ADMIN'), submitQuotation);

// Status update (Approve/Reject) is restricted to Managers and Admins
router.patch('/quotations/:id/status', authorizeRoles('MANAGER', 'ADMIN'), updateQuotationStatusRules, validate, updateQuotationStatus);

// Client Visits Tracking
router.post('/visits', authorizeRoles('SALESMAN', 'MANAGER', 'ADMIN'), logVisit);
router.get('/visits', authorizeRoles('SALESMAN', 'MANAGER', 'ADMIN'), getVisits);

// Customers & Products Listing
router.get('/customers', authorizeRoles('SALESMAN', 'MANAGER', 'ADMIN'), getCustomers);
router.get('/products', authorizeRoles('SALESMAN', 'MANAGER', 'ADMIN'), getProducts);

export default router;
