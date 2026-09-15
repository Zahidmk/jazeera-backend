import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import odoo from '../services/odoo/odoo.service';
import {
  enqueueProductSync,
  enqueueCustomerSync,
  enqueueOrderSync,
  getQueueStats,
} from '../utils/queue';

async function logSync(syncType: string, status: 'success' | 'failed' | 'queued', recordsProcessed: number, message?: string) {
  try {
    await prisma.syncLog.create({
      data: { syncType, source: 'manual', status, recordsProcessed, message },
    });
  } catch (err: any) {
    console.error(`⚠️  Failed to write sync log for ${syncType}:`, err.message);
  }
}

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
      await logSync('products', 'success', result.total, `${result.created} created, ${result.updated} updated`);
      res.json({
        success: true,
        message: 'Products synced synchronously (Redis is disabled)',
        data: result,
      });
      return;
    }

    const job = await enqueueProductSync({ type: 'full_sync' });
    await logSync('products', 'queued', 0, `Job ${job.id} queued`);
    res.json({
      success: true,
      message: 'Product sync job queued',
      jobId: job.id,
      note: 'Check /api/v1/sync/queue-status for progress',
    });
  } catch (error: any) {
    await logSync('products', 'failed', 0, error.message);
    res.status(500).json({ success: false, error: `Failed to sync products: ${error.message}` });
  }
};

// ─── Sync Customers ─────────────────────────────────────
export const syncCustomers = async (_req: Request, res: Response) => {
  try {
    if (process.env.DISABLE_REDIS === 'true') {
      const syncService = require('../services/odoo/sync.service');
      const result = await syncService.syncCustomers();
      await logSync('customers', 'success', result.total, `${result.created} created, ${result.updated} updated`);
      res.json({
        success: true,
        message: 'Customers synced synchronously (Redis is disabled)',
        data: result,
      });
      return;
    }

    const job = await enqueueCustomerSync({ type: 'full_sync' });
    await logSync('customers', 'queued', 0, `Job ${job.id} queued`);
    res.json({
      success: true,
      message: 'Customer sync job queued',
      jobId: job.id,
      note: 'Check /api/v1/sync/queue-status for progress',
    });
  } catch (error: any) {
    await logSync('customers', 'failed', 0, error.message);
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
      await logSync('orders', 'success', result.total, `${result.created} created, ${result.skipped} skipped`);
      res.json({
        success: true,
        message: 'Orders synced synchronously (Redis is disabled)',
        data: result,
      });
      return;
    }

    const job = await enqueueOrderSync({ type: 'full_sync', driverId });
    await logSync('orders', 'queued', 0, `Job ${job.id} queued`);
    res.json({
      success: true,
      message: 'Order sync job queued',
      jobId: job.id,
      note: 'Check /api/v1/sync/queue-status for progress',
    });
  } catch (error: any) {
    await logSync('orders', 'failed', 0, error.message);
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
      const total = (result.products?.total ?? 0) + (result.customers?.total ?? 0) + (result.orders?.total ?? 0);
      await logSync('all', 'success', total, 'Products + customers + orders synced');
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
    await logSync('all', 'queued', 0, `Jobs queued: ${pJob.id}, ${cJob.id}, ${oJob.id}`);
    res.json({
      success: true,
      message: 'Full sync queued (products + customers + orders)',
      jobs: { products: pJob.id, customers: cJob.id, orders: oJob.id },
      note: 'Check /api/v1/sync/queue-status for progress',
    });
  } catch (error: any) {
    await logSync('all', 'failed', 0, error.message);
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

// ─── Sync Logs ───────────────────────────────────────────
// History of manual + cron sync runs, most recent first
export const syncLogs = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
    const { status, syncType } = req.query;

    const logs = await prisma.syncLog.findMany({
      where: {
        ...(status ? { status: String(status) } : {}),
        ...(syncType ? { syncType: String(syncType) } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    res.json({ success: true, data: logs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Failed to get sync logs: ${error.message}` });
  }
};
