import { Router } from 'express';
import { authenticate, authorizeRoles } from '../middleware/auth';
import { ATTENDANCE_ROLES } from '../constants/roles';
import { selfieUpload } from '../utils/privateUpload';
import {
  getAttendanceStatus,
  checkIn,
  checkOut,
  getAttendanceHistory,
  getOwnSelfie,
} from '../controllers/merchandiser.controller';

const router = Router();

// Attendance for every field role (merchandiser, salesman, driver). Each user only ever sees their own records.
router.use(authenticate);
router.use(authorizeRoles(...ATTENDANCE_ROLES));

router.get('/status', getAttendanceStatus);
router.post('/check-in', selfieUpload, checkIn);
router.post('/check-out', selfieUpload, checkOut);
router.get('/', getAttendanceHistory);
router.get('/:id/selfie', getOwnSelfie);

export default router;
