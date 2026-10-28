import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middleware/auth';
import { MERCHANDISER_APP_ROLES } from '../constants/roles';
import { getTeamMap } from '../controllers/liveMap.controller';
import { selfieUpload } from '../utils/privateUpload';
import {
  getAttendanceStatus,
  checkIn,
  checkOut,
  getAttendanceHistory,
  getOwnSelfie,
  searchShops,
  getNearbyShops,
  getShopById,
  createShop,
  updateShop,
  startVisit,
  getCurrentVisit,
  addFeedback,
  endVisit,
  getVisits,
  getVisitById,
} from '../controllers/merchandiser.controller';

const router = Router();

// Merchandiser mobile app API — login required, MERCHANDISER role only
router.use(authenticate);
router.use(authorizeRoles(...MERCHANDISER_APP_ROLES));

// ── Attendance
router.get('/attendance/status', getAttendanceStatus);
router.post('/attendance/check-in', selfieUpload, checkIn);
router.post('/attendance/check-out', selfieUpload, checkOut);
router.get('/attendance', getAttendanceHistory);
router.get('/attendance/:id/selfie', getOwnSelfie);

// ── Shops (static paths before /:id)
router.get('/team-map', getTeamMap);
router.get('/shops/nearby', getNearbyShops);
router.get('/shops', searchShops);
router.post('/shops', createShop);
router.get('/shops/:id', getShopById);
router.patch('/shops/:id', updateShop);

// ── Visits & feedback (static paths before /:id)
router.post('/visits/start', startVisit);
router.get('/visits/current', getCurrentVisit);
router.get('/visits', getVisits);
router.get('/visits/:id', getVisitById);
router.post('/visits/:id/feedback', addFeedback);
router.post('/visits/:id/end', endVisit);

export default router;
