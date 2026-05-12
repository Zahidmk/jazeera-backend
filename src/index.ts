import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import rateLimit from 'express-rate-limit';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth.routes';
import driverRoutes from './routes/driver.routes';
import productRoutes from './routes/product.routes';
import cashSaleRoutes from './routes/cashSale.routes';
import syncRoutes from './routes/sync.routes';
import adminRoutes from './routes/admin.routes';
import odooRoutes from './routes/odoo.routes';

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || 'http://localhost:3001').split(','),
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  message: { success: false, error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 120,
  message: { success: false, error: 'Webhook rate limit exceeded.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { success: false, error: 'API rate limit exceeded.' },
});

app.use('/api/v1/auth', authLimiter);
app.use('/api/v1/sync/webhook', webhookLimiter);
app.use('/api/', apiLimiter);

// Static uploads
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ─── Health Check ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ success: true, message: 'Jazeera API is running 🚀', timestamp: new Date() });
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/driver', driverRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/driver/sales', cashSaleRoutes);
app.use('/api/v1/sync', syncRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/odoo', odooRoutes);

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// ─── Global Error Handler ────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📋 Health: http://localhost:${PORT}/health`);

  // ── Start BullMQ workers (background job processors)
  const { startWorkers } = require('./workers/sync.worker');
  startWorkers();

  // ── Start cron polling jobs (safety-net fallback)
  const { startAllCronJobs } = require('./jobs/cron');
  startAllCronJobs();
});

export default app;
