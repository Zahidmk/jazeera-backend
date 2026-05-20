"use strict";
/**
 * queue.ts
 *
 * Central BullMQ queues + Redis connection.
 *
 * Queues:
 *  - sync:products  → full product sync or single product update
 *  - sync:customers → full customer sync or single customer upsert
 *  - sync:orders    → full order sync or single order create/update
 *
 * Each queue has:
 *  - 3 automatic retries with exponential backoff
 *  - Jobs kept for 24 h (completed) / 7 days (failed)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderQueueEvents = exports.customerQueueEvents = exports.productQueueEvents = exports.orderQueue = exports.customerQueue = exports.productQueue = exports.redisConnection = void 0;
exports.isRedisAvailable = isRedisAvailable;
exports.enqueueProductSync = enqueueProductSync;
exports.enqueueCustomerSync = enqueueCustomerSync;
exports.enqueueOrderSync = enqueueOrderSync;
exports.getQueueStats = getQueueStats;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
// ─── Redis Connection ────────────────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
exports.redisConnection = new ioredis_1.default(REDIS_URL, {
    maxRetriesPerRequest: null, // Required by BullMQ
    retryStrategy: (times) => Math.min(times * 50, 2000), // Exponential backoff, max 2s
    enableReadyCheck: false,
    enableOfflineQueue: false, // Don't queue commands when offline
    lazyConnect: true, // Don't connect immediately - let workers handle it
});
let isRedisConnected = false;
exports.redisConnection.on('connect', () => {
    console.log('✅ Redis connected');
    isRedisConnected = true;
});
exports.redisConnection.on('error', (err) => {
    console.error('⚠️  Redis connection error:', err.message);
    console.warn('⚠️  Queues may not work, but API will continue');
    isRedisConnected = false;
});
// Helper to check Redis status
function isRedisAvailable() {
    return isRedisConnected;
}
// Try to connect (non-blocking)
exports.redisConnection.connect().catch(() => {
    console.warn('⚠️  Could not connect to Redis on startup');
});
// ─── Default Job Options ─────────────────────────────────────────────────────
const defaultJobOptions = {
    attempts: 3,
    backoff: {
        type: 'exponential',
        delay: 5000, // 5s, 10s, 20s
    },
    removeOnComplete: { age: 24 * 60 * 60 }, // keep 24h
    removeOnFail: { age: 7 * 24 * 60 * 60 }, // keep 7 days
};
// ─── Queues ──────────────────────────────────────────────────────────────────
exports.productQueue = new bullmq_1.Queue('sync-products', {
    connection: exports.redisConnection,
    defaultJobOptions,
});
exports.customerQueue = new bullmq_1.Queue('sync-customers', {
    connection: exports.redisConnection,
    defaultJobOptions,
});
exports.orderQueue = new bullmq_1.Queue('sync-orders', {
    connection: exports.redisConnection,
    defaultJobOptions,
});
// ─── Queue Events (for logging) ──────────────────────────────────────────────
exports.productQueueEvents = new bullmq_1.QueueEvents('sync-products', { connection: exports.redisConnection });
exports.customerQueueEvents = new bullmq_1.QueueEvents('sync-customers', { connection: exports.redisConnection });
exports.orderQueueEvents = new bullmq_1.QueueEvents('sync-orders', { connection: exports.redisConnection });
exports.productQueueEvents.on('completed', ({ jobId }) => console.log(`✅ [products] Job ${jobId} completed`));
exports.productQueueEvents.on('failed', ({ jobId, failedReason }) => console.error(`❌ [products] Job ${jobId} failed: ${failedReason}`));
exports.customerQueueEvents.on('completed', ({ jobId }) => console.log(`✅ [customers] Job ${jobId} completed`));
exports.customerQueueEvents.on('failed', ({ jobId, failedReason }) => console.error(`❌ [customers] Job ${jobId} failed: ${failedReason}`));
exports.orderQueueEvents.on('completed', ({ jobId }) => console.log(`✅ [orders] Job ${jobId} completed`));
exports.orderQueueEvents.on('failed', ({ jobId, failedReason }) => console.error(`❌ [orders] Job ${jobId} failed: ${failedReason}`));
// ─── Helper: Add jobs ────────────────────────────────────────────────────────
async function enqueueProductSync(data) {
    const jobId = data.type === 'full_sync' ? 'full_sync_products' : `product_${data.odooId}`;
    return exports.productQueue.add(data.type, data, { jobId, priority: data.type === 'full_sync' ? 2 : 1 });
}
async function enqueueCustomerSync(data) {
    const jobId = data.type === 'full_sync' ? 'full_sync_customers' : `customer_${data.odooId}`;
    return exports.customerQueue.add(data.type, data, { jobId, priority: data.type === 'full_sync' ? 2 : 1 });
}
async function enqueueOrderSync(data) {
    const jobId = data.type === 'full_sync'
        ? 'full_sync_orders'
        : `order_${data.type}_${data.odooId}`;
    return exports.orderQueue.add(data.type, data, { jobId, priority: data.type === 'full_sync' ? 2 : 1 });
}
// ─── Queue Stats (for dashboard) ────────────────────────────────────────────
async function getQueueStats() {
    const [pWaiting, pActive, pCompleted, pFailed] = await Promise.all([
        exports.productQueue.getWaitingCount(),
        exports.productQueue.getActiveCount(),
        exports.productQueue.getCompletedCount(),
        exports.productQueue.getFailedCount(),
    ]);
    const [cWaiting, cActive, cCompleted, cFailed] = await Promise.all([
        exports.customerQueue.getWaitingCount(),
        exports.customerQueue.getActiveCount(),
        exports.customerQueue.getCompletedCount(),
        exports.customerQueue.getFailedCount(),
    ]);
    const [oWaiting, oActive, oCompleted, oFailed] = await Promise.all([
        exports.orderQueue.getWaitingCount(),
        exports.orderQueue.getActiveCount(),
        exports.orderQueue.getCompletedCount(),
        exports.orderQueue.getFailedCount(),
    ]);
    return {
        products: { waiting: pWaiting, active: pActive, completed: pCompleted, failed: pFailed },
        customers: { waiting: cWaiting, active: cActive, completed: cCompleted, failed: cFailed },
        orders: { waiting: oWaiting, active: oActive, completed: oCompleted, failed: oFailed },
        total: {
            waiting: pWaiting + cWaiting + oWaiting,
            active: pActive + cActive + oActive,
            completed: pCompleted + cCompleted + oCompleted,
            failed: pFailed + cFailed + oFailed,
        },
    };
}
//# sourceMappingURL=queue.js.map