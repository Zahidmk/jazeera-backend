"use strict";
/**
 * cron.ts
 *
 * Safety-net polling jobs that run on a schedule.
 *
 * Why needed:
 *  Odoo webhooks have NO retry guarantee — if the server was down when
 *  Odoo fired a webhook, that event is lost forever.
 *  These cron jobs catch everything the webhook may have missed by
 *  querying Odoo for records modified since the last successful sync.
 *
 * Schedule:
 *  - Products:  every 5 minutes
 *  - Customers: every 5 minutes
 *  - Orders:    every 3 minutes (deliveries are time-sensitive)
 *
 * Each cron job:
 *  1. Reads `last_sync_at` from our DB (or falls back to 10 minutes ago)
 *  2. Fetches records from Odoo where write_date > last_sync_at
 *  3. Enqueues one job per changed record (deduped by jobId)
 *  4. Updates `last_sync_at` in DB
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startProductCron = startProductCron;
exports.startCustomerCron = startCustomerCron;
exports.startOrderCron = startOrderCron;
exports.startAllCronJobs = startAllCronJobs;
const node_cron_1 = __importDefault(require("node-cron"));
const odoo_service_1 = __importDefault(require("../services/odoo/odoo.service"));
const queue_1 = require("../utils/queue");
const prisma_1 = __importDefault(require("../utils/prisma"));
// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Get the last recorded sync time for a given sync type.
 *  Falls back to `fallbackMinutes` ago if no record exists. */
async function getLastSyncAt(type, fallbackMinutes = 10) {
    try {
        // We store sync metadata in a simple key-value style using SyncLog model
        const log = await prisma_1.default.syncLog?.findFirst({
            where: { syncType: type },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
        });
        if (log?.createdAt)
            return log.createdAt;
    }
    catch {
        // SyncLog table may not exist in schema — fall through
    }
    // Fallback: X minutes ago
    const fallback = new Date();
    fallback.setMinutes(fallback.getMinutes() - fallbackMinutes);
    return fallback;
}
/** Record that a cron sync ran successfully */
async function recordSyncRun(type, count) {
    try {
        await prisma_1.default.syncLog?.create({
            data: {
                syncType: type,
                status: 'success',
                recordsProcessed: count,
                message: `Cron poll: ${count} records enqueued`,
            },
        });
    }
    catch {
        // Non-critical — table may not exist yet
    }
}
// ─── Cron: Poll changed Products every 5 minutes ─────────────────────────────
function startProductCron() {
    node_cron_1.default.schedule('*/5 * * * *', async () => {
        try {
            const since = await getLastSyncAt('products:cron');
            console.log(`⏰ [cron:products] Polling Odoo for products modified since ${since.toISOString()}`);
            const changed = await odoo_service_1.default.fetchProductsModifiedSince(since);
            if (changed.length === 0) {
                console.log('⏰ [cron:products] No changes found');
                return;
            }
            console.log(`⏰ [cron:products] ${changed.length} changed product(s) found — enqueuing jobs`);
            for (const product of changed) {
                await (0, queue_1.enqueueProductSync)({ type: 'single_update', odooId: product.id, data: product });
            }
            await recordSyncRun('products:cron', changed.length);
        }
        catch (err) {
            console.error('❌ [cron:products] Error:', err.message);
        }
    });
    console.log('⏰ Product cron started (every 5 minutes)');
}
// ─── Cron: Poll changed Customers every 5 minutes ────────────────────────────
function startCustomerCron() {
    node_cron_1.default.schedule('*/5 * * * *', async () => {
        try {
            const since = await getLastSyncAt('customers:cron');
            console.log(`⏰ [cron:customers] Polling Odoo for customers modified since ${since.toISOString()}`);
            const changed = await odoo_service_1.default.fetchCustomersModifiedSince(since);
            if (changed.length === 0) {
                console.log('⏰ [cron:customers] No changes found');
                return;
            }
            console.log(`⏰ [cron:customers] ${changed.length} changed customer(s) found — enqueuing jobs`);
            for (const customer of changed) {
                await (0, queue_1.enqueueCustomerSync)({ type: 'single_upsert', odooId: customer.id, data: customer });
            }
            await recordSyncRun('customers:cron', changed.length);
        }
        catch (err) {
            console.error('❌ [cron:customers] Error:', err.message);
        }
    });
    console.log('⏰ Customer cron started (every 5 minutes)');
}
// ─── Cron: Poll changed Orders every 3 minutes ───────────────────────────────
function startOrderCron() {
    node_cron_1.default.schedule('*/3 * * * *', async () => {
        try {
            const since = await getLastSyncAt('orders:cron', 6);
            console.log(`⏰ [cron:orders] Polling Odoo for orders modified since ${since.toISOString()}`);
            const changed = await odoo_service_1.default.fetchOrdersModifiedSince(since);
            if (changed.length === 0) {
                console.log('⏰ [cron:orders] No changes found');
                return;
            }
            console.log(`⏰ [cron:orders] ${changed.length} changed order(s) found — enqueuing jobs`);
            for (const order of changed) {
                // Determine job type based on state
                if (order.state === 'cancel') {
                    await (0, queue_1.enqueueOrderSync)({ type: 'order_cancelled', odooId: order.id });
                }
                else {
                    // Check if it exists locally → update or create
                    const existing = await prisma_1.default.delivery.findFirst({ where: { odooOrderId: order.id } });
                    if (existing) {
                        await (0, queue_1.enqueueOrderSync)({ type: 'order_updated', odooId: order.id, data: order });
                    }
                    else {
                        await (0, queue_1.enqueueOrderSync)({ type: 'order_created', odooId: order.id, data: order });
                    }
                }
            }
            await recordSyncRun('orders:cron', changed.length);
        }
        catch (err) {
            console.error('❌ [cron:orders] Error:', err.message);
        }
    });
    console.log('⏰ Order cron started (every 3 minutes)');
}
// ─── Start All Cron Jobs ─────────────────────────────────────────────────────
function startAllCronJobs() {
    startProductCron();
    startCustomerCron();
    startOrderCron();
    console.log('✅ All cron polling jobs started');
}
//# sourceMappingURL=cron.js.map