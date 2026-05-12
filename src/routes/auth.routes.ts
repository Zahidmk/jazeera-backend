import { Router } from 'express';
import { login, getMe, forgotPassword } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.get('/me', authenticate, getMe);

export default router;
