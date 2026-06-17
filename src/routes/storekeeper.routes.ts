import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middleware/auth';
import { getVans, getVanQueue, assignVanLoad } from '../controllers/storekeeper.controller';
import { assignVanLoadRules, validate } from '../middleware/validators';

const router = Router();

// All storekeeper routes require authentication
router.use(authenticate);

// Restrict all routes to STORE_KEEPER, ADMIN, or MANAGER roles
router.use(authorizeRoles('STORE_KEEPER', 'ADMIN', 'MANAGER'));

router.get('/vans', getVans);
router.get('/vans/:vanId/queue', getVanQueue);
router.post('/vans/:vanId/load', assignVanLoadRules, validate, assignVanLoad);

export default router;
