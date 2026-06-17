"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueStatus = exports.syncAll = exports.syncOrders = exports.syncCustomers = exports.syncProducts = exports.testConnection = void 0;
const prisma_1 = __importDefault(require("../utils/prisma"));
const odoo_service_1 = __importDefault(require("../services/odoo/odoo.service"));
const queue_1 = require("../utils/queue");
// ─── Test Odoo Connection ───────────────────────────────
const testConnection = async (_req, res) => {
    try {
        const ver = await odoo_service_1.default.version();
        const uid = await odoo_service_1.default.authenticate();
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
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: `Odoo connection failed: ${error.message}`,
        });
    }
};
exports.testConnection = testConnection;
// ─── Sync Products ──────────────────────────────────────
// Enqueues a full product sync job and returns immediately.
// If Redis is disabled, it runs synchronously.
const syncProducts = async (_req, res) => {
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
        const job = await (0, queue_1.enqueueProductSync)({ type: 'full_sync' });
        res.json({
            success: true,
            message: 'Product sync job queued',
            jobId: job.id,
            note: 'Check /api/v1/sync/queue-status for progress',
        });
    }
    catch (error) {
        res.status(500).json({ success: false, error: `Failed to sync products: ${error.message}` });
    }
};
exports.syncProducts = syncProducts;
// ─── Sync Customers ─────────────────────────────────────
const syncCustomers = async (_req, res) => {
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
        const job = await (0, queue_1.enqueueCustomerSync)({ type: 'full_sync' });
        res.json({
            success: true,
            message: 'Customer sync job queued',
            jobId: job.id,
            note: 'Check /api/v1/sync/queue-status for progress',
        });
    }
    catch (error) {
        res.status(500).json({ success: false, error: `Failed to sync customers: ${error.message}` });
    }
};
exports.syncCustomers = syncCustomers;
// ─── Sync Orders → Deliveries ───────────────────────────
const syncOrders = async (req, res) => {
    try {
        let driverId = req.user?.userId;
        if (!driverId) {
            const driver = await prisma_1.default.user.findFirst({
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
        const job = await (0, queue_1.enqueueOrderSync)({ type: 'full_sync', driverId });
        res.json({
            success: true,
            message: 'Order sync job queued',
            jobId: job.id,
            note: 'Check /api/v1/sync/queue-status for progress',
        });
    }
    catch (error) {
        res.status(500).json({ success: false, error: `Failed to sync orders: ${error.message}` });
    }
};
exports.syncOrders = syncOrders;
// ─── Full Sync (all at once) ────────────────────────────
const syncAll = async (req, res) => {
    try {
        let driverId = req.user?.userId;
        if (!driverId) {
            const driver = await prisma_1.default.user.findFirst({
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
            (0, queue_1.enqueueProductSync)({ type: 'full_sync' }),
            (0, queue_1.enqueueCustomerSync)({ type: 'full_sync' }),
            (0, queue_1.enqueueOrderSync)({ type: 'full_sync', driverId }),
        ]);
        res.json({
            success: true,
            message: 'Full sync queued (products + customers + orders)',
            jobs: { products: pJob.id, customers: cJob.id, orders: oJob.id },
            note: 'Check /api/v1/sync/queue-status for progress',
        });
    }
    catch (error) {
        res.status(500).json({ success: false, error: `Failed to sync all: ${error.message}` });
    }
};
exports.syncAll = syncAll;
// ─── Queue Status ───────────────────────────────────────
// Returns live counts from Redis: waiting / active / completed / failed per queue
const queueStatus = async (_req, res) => {
    try {
        const stats = await (0, queue_1.getQueueStats)();
        res.json({ success: true, data: stats, timestamp: new Date().toISOString() });
    }
    catch (error) {
        res.status(500).json({ success: false, error: `Failed to get queue stats: ${error.message}` });
    }
};
exports.queueStatus = queueStatus;
//# sourceMappingURL=sync.controller.js.map