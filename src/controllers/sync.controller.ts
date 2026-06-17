import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import odoo from '../services/odoo/odoo.service';
import {
  enqueueProductSync,
  enqueueCustomerSync,
  enqueueOrderSync,
  getQueueStats,
} from '../utils/queue';

// ─── Test Odoo Connection ───────────────────────────────
export const testConnection = async (_req: Request, res: Response) => {
  try {
    const ver = await odoo.version();
    const uid = await odoo.authenticate();
    res.json({
      success: true,
      data: {
        connected: true,
        odooVersion: ver?.server_version || 'unknown',
        uid,
        url: process.env.ODOO_URL,
        db: process.env.ODOO_DB,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: `Odoo connection failed: ${error.message}`,
    });
  }
};

// ─── Sync Products ──────────────────────────────────────
// Enqueues a full product sync job and returns immediately.
// If Redis is disabled, it runs synchronously.
export const syncProducts = async (_req: Request, res: Response) => {
  try {
    if (process.env.DISABLE_REDIS === 'true') {
      const syncService = require('../services/odoo/sync.service');
      const result = await syncService.syncProducts();
      res.json({
        success: true,
        message: 'Products synced synchronously (Redis is disabled)',
        data: result,
      });
      return;
    }

    const job = await enqueueProductSync({ type: 'full_sync' });
    res.json({
      success: true,
      message: 'Product sync job queued',
      jobId: job.id,
      note: 'Check /api/v1/sync/queue-status for progress',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Failed to sync products: ${error.message}` });
  }
};

// ─── Sync Customers ─────────────────────────────────────
export const syncCustomers = async (_req: Request, res: Response) => {
  try {
    if (process.env.DISABLE_REDIS === 'true') {
      const syncService = require('../services/odoo/sync.service');
      const result = await syncService.syncCustomers();
      res.json({
        success: true,
        message: 'Customers synced synchronously (Redis is disabled)',
        data: result,
      });
      return;
    }

    const job = await enqueueCustomerSync({ type: 'full_sync' });
    res.json({
      success: true,
      message: 'Customer sync job queued',
      jobId: job.id,
      note: 'Check /api/v1/sync/queue-status for progress',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Failed to sync customers: ${error.message}` });
  }
};

// ─── Sync Orders → Deliveries ───────────────────────────
export const syncOrders = async (req: Request, res: Response) => {
  try {
    let driverId = (req as any).user?.userId;
    if (!driverId) {
      const driver = await prisma.user.findFirst({
        where: { role: 'DRIVER', isActive: true },
        select: { id: true },
      });
      driverId = driver?.id;
    }

    if (!driverId) {
      return res.status(400).json({ success: false, error: 'No active driver found for order sync assignment.' });
    }

    if (process.env.DISABLE_REDIS === 'true') {
      const syncService = require('../services/odoo/sync.service');
      const result = await syncService.syncOrders(driverId);
      res.json({
        success: true,
        message: 'Orders synced synchronously (Redis is disabled)',
        data: result,
      });
      return;
    }

    const job = await enqueueOrderSync({ type: 'full_sync', driverId });
    res.json({
      success: true,
      message: 'Order sync job queued',
      jobId: job.id,
      note: 'Check /api/v1/sync/queue-status for progress',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Failed to sync orders: ${error.message}` });
  }
};

// ─── Full Sync (all at once) ────────────────────────────
export const syncAll = async (req: Request, res: Response) => {
  try {
    let driverId = (req as any).user?.userId;
    if (!driverId) {
      const driver = await prisma.user.findFirst({
        where: { role: 'DRIVER', isActive: true },
        select: { id: true },
      });
      driverId = driver?.id;
    }

    if (!driverId) {
      return res.status(400).json({ success: false, error: 'No active driver found for order sync assignment.' });
    }

    if (process.env.DISABLE_REDIS === 'true') {
      const syncService = require('../services/odoo/sync.service');
      const result = await syncService.syncAll(driverId);
      res.json({
        success: true,
        message: 'Full sync executed synchronously (Redis is disabled)',
        data: result,
      });
      return;
    }

    const [pJob, cJob, oJob] = await Promise.all([
      enqueueProductSync({ type: 'full_sync' }),
      enqueueCustomerSync({ type: 'full_sync' }),
      enqueueOrderSync({ type: 'full_sync', driverId }),
    ]);
    res.json({
      success: true,
      message: 'Full sync queued (products + customers + orders)',
      jobs: { products: pJob.id, customers: cJob.id, orders: oJob.id },
      note: 'Check /api/v1/sync/queue-status for progress',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Failed to sync all: ${error.message}` });
  }
};

// ─── Queue Status ───────────────────────────────────────
// Returns live counts from Redis: waiting / active / completed / failed per queue
export const queueStatus = async (_req: Request, res: Response) => {
  try {
    const stats = await getQueueStats();
    res.json({ success: true, data: stats, timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Failed to get queue stats: ${error.message}` });
  }
};
