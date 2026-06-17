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
const DISABLE_REDIS = process.env.DISABLE_REDIS === 'true';

export let redisConnection: any = null;
let isRedisConnected = false;

if (!DISABLE_REDIS) {
  redisConnection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null, // Required by BullMQ
    retryStrategy: (times) => Math.min(times * 50, 2000), // Exponential backoff, max 2s
    enableReadyCheck: false,
    enableOfflineQueue: false, // Don't queue commands when offline
    lazyConnect: true, // Don't connect immediately - let workers handle it
  });

  redisConnection.on('connect', () => {
    console.log('✅ Redis connected');
    isRedisConnected = true;
  });

  redisConnection.on('error', (err: any) => {
    console.error('⚠️  Redis connection error:', err.message);
    console.warn('⚠️  Queues may not work, but API will continue');
    isRedisConnected = false;
  });

  // Try to connect (non-blocking)
  redisConnection.connect().catch(() => {
    console.warn('⚠️  Could not connect to Redis on startup');
  });
} else {
  console.log('ℹ️ Redis is disabled via DISABLE_REDIS=true. Using mock queues.');
}

// Helper to check Redis status
export function isRedisAvailable(): boolean {
  return !DISABLE_REDIS && isRedisConnected;
}

// ─── Default Job Options & Mock Setup ────────────────────────────────────────
const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 5000,
  },
  removeOnComplete: { age: 24 * 60 * 60 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

const dummyQueue = {
  add: async (name: string, data: any, opts: any) => {
    console.log(`ℹ️ [Mock Queue] Job added: ${name} (Redis is disabled)`);
    return { id: `mock_${Date.now()}` };
  },
  getWaitingCount: async () => 0,
  getActiveCount: async () => 0,
  getCompletedCount: async () => 0,
  getFailedCount: async () => 0,
};

// ─── Queues ──────────────────────────────────────────────────────────────────
export const productQueue = !DISABLE_REDIS
  ? new Queue('sync-products', { connection: redisConnection, defaultJobOptions })
  : (dummyQueue as unknown as Queue);

export const customerQueue = !DISABLE_REDIS
  ? new Queue('sync-customers', { connection: redisConnection, defaultJobOptions })
  : (dummyQueue as unknown as Queue);

export const orderQueue = !DISABLE_REDIS
  ? new Queue('sync-orders', { connection: redisConnection, defaultJobOptions })
  : (dummyQueue as unknown as Queue);

// ─── Queue Events (for logging) ──────────────────────────────────────────────
export const productQueueEvents = !DISABLE_REDIS
  ? new QueueEvents('sync-products', { connection: redisConnection })
  : null;

export const customerQueueEvents = !DISABLE_REDIS
  ? new QueueEvents('sync-customers', { connection: redisConnection })
  : null;

export const orderQueueEvents = !DISABLE_REDIS
  ? new QueueEvents('sync-orders', { connection: redisConnection })
  : null;

if (productQueueEvents) {
  productQueueEvents.on('completed', ({ jobId }) => console.log(`✅ [products] Job ${jobId} completed`));
  productQueueEvents.on('failed', ({ jobId, failedReason }) => console.error(`❌ [products] Job ${jobId} failed: ${failedReason}`));
}

if (customerQueueEvents) {
  customerQueueEvents.on('completed', ({ jobId }) => console.log(`✅ [customers] Job ${jobId} completed`));
  customerQueueEvents.on('failed', ({ jobId, failedReason }) => console.error(`❌ [customers] Job ${jobId} failed: ${failedReason}`));
}

if (orderQueueEvents) {
  orderQueueEvents.on('completed', ({ jobId }) => console.log(`✅ [orders] Job ${jobId} completed`));
  orderQueueEvents.on('failed', ({ jobId, failedReason }) => console.error(`❌ [orders] Job ${jobId} failed: ${failedReason}`));
}

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
