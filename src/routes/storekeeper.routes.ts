import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middleware/auth';
import {
  getVans,
  getVanQueue,
  assignVanLoad,
  getDashboard,
  getWarehouseStock,
  searchDrivers,
  getDamagedStock,
  reportDamagedStock,
  getReconciliation,
  submitReconciliation,
  getDriversList,
} from '../controllers/storekeeper.controller';
import { assignVanLoadRules, validate } from '../middleware/validators';

const router = Router();

// All storekeeper routes require authentication
router.use(authenticate);

// Restrict all routes to STORE_KEEPER, ADMIN, or MANAGER roles
router.use(authorizeRoles('STORE_KEEPER', 'ADMIN', 'MANAGER'));

router.get('/vans', getVans);
router.get('/vans/:vanId/queue', getVanQueue);
router.post('/vans/:vanId/load', assignVanLoadRules, validate, assignVanLoad);

// New endpoints
router.get('/dashboard', getDashboard);
router.get('/warehouse-stock', getWarehouseStock);
router.post('/drivers/search', searchDrivers);
router.get('/drivers', getDriversList);
router.get('/damaged-stock', getDamagedStock);
router.post('/damaged-stock', reportDamagedStock);
router.get('/vans/:vanId/reconciliation', getReconciliation);
router.post('/vans/:vanId/reconciliation', submitReconciliation);

export default router;
