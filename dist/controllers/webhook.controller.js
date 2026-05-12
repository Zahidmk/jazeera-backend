"use strict";
/**
 * webhook.controller.ts
 *
 * POST /api/v1/sync/webhook
 *
 * Professional pattern:
 *  1. Verify secret header immediately
 *  2. Validate payload shape
 *  3. Enqueue a job — respond 200 OK in < 50ms
 *  4. The BullMQ worker handles all heavy processing asynchronously
 *
 * This means Odoo never times out waiting for a response, and if
 * processing fails the job is automatically retried up to 3 times
 * with exponential backoff.
 *
 * Supported events:
 *  order.created    → enqueue order_created job
 *  order.updated    → enqueue order_updated job
 *  order.cancelled  → enqueue order_cancelled job
 *  product.updated  → enqueue single_update job
 *  customer.created → enqueue single_upsert job
 *  customer.updated → enqueue single_upsert job
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleWebhook = void 0;
const queue_1 = require("../utils/queue");
// ─── Webhook Handler ─────────────────────────────────────────────────────────
const handleWebhook = async (req, res) => {
    const start = Date.now();
    // ── 1. Verify webhook secret ───────────────────────────────────────────────
    const secret = req.headers['x-odoo-webhook-secret'];
    const expectedSecret = process.env.ODOO_WEBHOOK_SECRET || '';
    if (expectedSecret && secret !== expectedSecret) {
        res.status(401).json({ success: false, error: 'Invalid webhook secret' });
        return;
    }
    // ── 2. Validate payload ────────────────────────────────────────────────────
    const { event, id: odooId, data } = req.body;
    if (!event || !odooId) {
        res.status(400).json({ success: false, error: 'Missing required fields: event, id' });
        return;
    }
    const numericId = Number(odooId);
    if (isNaN(numericId)) {
        res.status(400).json({ success: false, error: 'Field "id" must be a number' });
        return;
    }
    console.log(`📥 Webhook received: event=${event}, odooId=${numericId}`);
    // ── 3. Enqueue job based on event type ─────────────────────────────────────
    try {
        switch (event) {
            case 'order.created':
                await (0, queue_1.enqueueOrderSync)({ type: 'order_created', odooId: numericId, data: data || {} });
                break;
            case 'order.updated':
                await (0, queue_1.enqueueOrderSync)({ type: 'order_updated', odooId: numericId, data: data || {} });
                break;
            case 'order.cancelled':
                await (0, queue_1.enqueueOrderSync)({ type: 'order_cancelled', odooId: numericId });
                break;
            case 'product.updated':
                await (0, queue_1.enqueueProductSync)({ type: 'single_update', odooId: numericId, data: data || {} });
                break;
            case 'customer.created':
            case 'customer.updated':
                await (0, queue_1.enqueueCustomerSync)({ type: 'single_upsert', odooId: numericId, data: data || {} });
                break;
            default:
                console.warn(`⚠️  Unknown webhook event: ${event} — ignoring`);
                res.status(200).json({ success: true, message: `Event '${event}' acknowledged but not handled` });
                return;
        }
        const elapsed = Date.now() - start;
        console.log(`✅ Webhook enqueued: event=${event}, odooId=${numericId} (${elapsed}ms)`);
        // ── 4. Respond immediately — job runs in background ────────────────────
        res.json({
            success: true,
            message: `Event '${event}' queued for processing`,
            odooId: numericId,
            queuedAt: new Date().toISOString(),
        });
    }
    catch (err) {
        console.error('❌ Failed to enqueue webhook job:', err.message);
        // Still return 200 to Odoo — we don't want Odoo to keep retrying
        // (the cron job will catch this record in the next poll cycle)
        res.status(200).json({
            success: false,
            message: 'Event received but failed to queue — will retry via cron',
            error: err.message,
        });
    }
};
exports.handleWebhook = handleWebhook;
//# sourceMappingURL=webhook.controller.js.map