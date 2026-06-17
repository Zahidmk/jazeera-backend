import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getHome,
  getRoute,
  getDeliveries,
  getDeliveryById,
  getDeliveryNavigation,
  updateDeliveryStatus,
  getStockQueue,
  confirmStockLoad,
  rejectStockLoad,
  getVanInventory,
  adjustStock,
  addLead,
  startShift,
  endShift,
  getShiftSummary,
  searchCustomers,
} from '../controllers/driver.controller';
import {
  updateDeliveryStatusRules,
  addLeadRules,
  stockAdjustRules,
  validate,
} from '../middleware/validators';

const router = Router();

// All driver routes require authentication
router.use(authenticate);

// Home & Route
router.get('/home', getHome);
router.get('/route', getRoute);

// Deliveries
router.get('/deliveries', getDeliveries);
router.get('/deliveries/:id', getDeliveryById);
router.get('/deliveries/:id/navigate', getDeliveryNavigation);
router.patch('/deliveries/:id/status', updateDeliveryStatusRules, validate, updateDeliveryStatus);

// Stock
router.get('/stock/queue', getStockQueue);
router.post('/stock/confirm', confirmStockLoad);
router.post('/stock/reject', rejectStockLoad);
router.post('/stock/adjust', stockAdjustRules, validate, adjustStock);

// Van Inventory
router.get('/van/inventory', getVanInventory);

// Leads
router.post('/leads', addLeadRules, validate, addLead);

// Customers search (for cash sale customer picker)
router.get('/customers/search', searchCustomers);

// Shift
router.post('/shift/start', startShift);
router.get('/shift/summary', getShiftSummary);
router.post('/shift/end', endShift);

export default router;
