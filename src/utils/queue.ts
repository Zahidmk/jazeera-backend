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

import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

// ─── Redis Connection ────────────────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const redisConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ
  retryStrategy: (times) => Math.min(times * 50, 2000), // Exponential backoff, max 2s
  enableReadyCheck: false,
  enableOfflineQueue: false, // Don't queue commands when offline
  lazyConnect: true, // Don't connect immediately - let workers handle it
});

let isRedisConnected = false;

redisConnection.on('connect', () => {
  console.log('✅ Redis connected');
  isRedisConnected = true;
});

redisConnection.on('error', (err) => {
  console.error('⚠️  Redis connection error:', err.message);
  console.warn('⚠️  Queues may not work, but API will continue');
  isRedisConnected = false;
});

// Helper to check Redis status
export function isRedisAvailable(): boolean {
  return isRedisConnected;
}

// Try to connect (non-blocking)
redisConnection.connect().catch(() => {
  console.warn('⚠️  Could not connect to Redis on startup');
});

// ─── Default Job Options ─────────────────────────────────────────────────────
const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 5000, // 5s, 10s, 20s
  },
  removeOnComplete: { age: 24 * 60 * 60 }, // keep 24h
  removeOnFail: { age: 7 * 24 * 60 * 60 }, // keep 7 days
};

// ─── Queues ──────────────────────────────────────────────────────────────────
export const productQueue = new Queue('sync-products', {
  connection: redisConnection,
  defaultJobOptions,
});

export const customerQueue = new Queue('sync-customers', {
  connection: redisConnection,
  defaultJobOptions,
});

export const orderQueue = new Queue('sync-orders', {
  connection: redisConnection,
  defaultJobOptions,
});

// ─── Queue Events (for logging) ──────────────────────────────────────────────
export const productQueueEvents = new QueueEvents('sync-products', { connection: redisConnection });
export const customerQueueEvents = new QueueEvents('sync-customers', { connection: redisConnection });
export const orderQueueEvents = new QueueEvents('sync-orders', { connection: redisConnection });

productQueueEvents.on('completed', ({ jobId }) => console.log(`✅ [products] Job ${jobId} completed`));
productQueueEvents.on('failed', ({ jobId, failedReason }) => console.error(`❌ [products] Job ${jobId} failed: ${failedReason}`));

customerQueueEvents.on('completed', ({ jobId }) => console.log(`✅ [customers] Job ${jobId} completed`));
customerQueueEvents.on('failed', ({ jobId, failedReason }) => console.error(`❌ [customers] Job ${jobId} failed: ${failedReason}`));

orderQueueEvents.on('completed', ({ jobId }) => console.log(`✅ [orders] Job ${jobId} completed`));
orderQueueEvents.on('failed', ({ jobId, failedReason }) => console.error(`❌ [orders] Job ${jobId} failed: ${failedReason}`));

// ─── Job Type Definitions ────────────────────────────────────────────────────

/** Full sync of all products from Odoo into DB */
export type ProductJobData =
  | { type: 'full_sync' }
  | { type: 'single_update'; odooId: number; data: Record<string, any> };

/** Full sync of all customers from Odoo into DB */
export type CustomerJobData =
  | { type: 'full_sync' }
  | { type: 'single_upsert'; odooId: number; data: Record<string, any> };

/** Full sync of all orders, or process a single webhook event */
export type OrderJobData =
  | { type: 'full_sync'; driverId?: string }
  | { type: 'order_created'; odooId: number; data: Record<string, any> }
  | { type: 'order_updated'; odooId: number; data: Record<string, any> }
  | { type: 'order_cancelled'; odooId: number };

// ─── Helper: Add jobs ────────────────────────────────────────────────────────

export async function enqueueProductSync(data: ProductJobData) {
  const jobId = data.type === 'full_sync' ? 'full_sync_products' : `product_${data.odooId}`;
  return productQueue.add(data.type, data, { jobId, priority: data.type === 'full_sync' ? 2 : 1 });
}

export async function enqueueCustomerSync(data: CustomerJobData) {
  const jobId = data.type === 'full_sync' ? 'full_sync_customers' : `customer_${data.odooId}`;
  return customerQueue.add(data.type, data, { jobId, priority: data.type === 'full_sync' ? 2 : 1 });
}

export async function enqueueOrderSync(data: OrderJobData) {
  const jobId =
    data.type === 'full_sync'
      ? 'full_sync_orders'
      : `order_${data.type}_${(data as any).odooId}`;
  return orderQueue.add(data.type, data, { jobId, priority: data.type === 'full_sync' ? 2 : 1 });
}

// ─── Queue Stats (for dashboard) ────────────────────────────────────────────
export async function getQueueStats() {
  const [pWaiting, pActive, pCompleted, pFailed] = await Promise.all([
    productQueue.getWaitingCount(),
    productQueue.getActiveCount(),
    productQueue.getCompletedCount(),
    productQueue.getFailedCount(),
  ]);
  const [cWaiting, cActive, cCompleted, cFailed] = await Promise.all([
    customerQueue.getWaitingCount(),
    customerQueue.getActiveCount(),
    customerQueue.getCompletedCount(),
    customerQueue.getFailedCount(),
  ]);
  const [oWaiting, oActive, oCompleted, oFailed] = await Promise.all([
    orderQueue.getWaitingCount(),
    orderQueue.getActiveCount(),
    orderQueue.getCompletedCount(),
    orderQueue.getFailedCount(),
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
