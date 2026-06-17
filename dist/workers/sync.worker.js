"use strict";
/**
 * sync.worker.ts
 *
 * BullMQ Workers — one per queue.
 * Each worker picks jobs off its queue and processes them.
 *
 * Worker behaviour:
 *  - Concurrency 2 per queue (processes 2 jobs in parallel)
 *  - On failure → BullMQ auto-retries up to 3x with exponential backoff
 *  - All errors are caught and thrown so BullMQ marks the job as failed
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderWorker = exports.customerWorker = exports.productWorker = void 0;
exports.startWorkers = startWorkers;
const bullmq_1 = require("bullmq");
const queue_1 = require("../utils/queue");
const syncService = __importStar(require("../services/odoo/sync.service"));
const odoo_service_1 = __importDefault(require("../services/odoo/odoo.service"));
const prisma_1 = __importDefault(require("../utils/prisma"));
const DISABLE_REDIS = process.env.DISABLE_REDIS === 'true';
// ─── Workers ──────────────────────────────────────────────────────────────────
exports.productWorker = null;
exports.customerWorker = null;
exports.orderWorker = null;
if (!DISABLE_REDIS) {
    exports.productWorker = new bullmq_1.Worker('sync-products', async (job) => {
        const data = job.data;
        if (data.type === 'full_sync') {
            job.log('Starting full product sync from Odoo...');
            const result = await syncService.syncProducts();
            job.log(`Done: created=${result.created}, updated=${result.updated}, total=${result.total}`);
            return result;
        }
        if (data.type === 'single_update') {
            job.log(`Updating single product odooId=${data.odooId}`);
            // Re-fetch the full record from Odoo (don't trust webhook payload alone)
            const [freshProduct] = await odoo_service_1.default.read('product.product', [data.odooId], [
                'id', 'name', 'default_code', 'barcode', 'list_price',
                'standard_price', 'categ_id', 'uom_id', 'image_128',
                'type', 'active', 'qty_available',
            ]);
            if (!freshProduct) {
                throw new Error(`Product odooId=${data.odooId} not found in Odoo`);
            }
            const sku = freshProduct.default_code || `ODOO-${freshProduct.id}`;
            await prisma_1.default.product.upsert({
                where: { odooId: freshProduct.id },
                update: {
                    name: freshProduct.name,
                    sku,
                    barcode: freshProduct.barcode || null,
                    category: freshProduct.categ_id ? freshProduct.categ_id[1] : null,
                    unit: freshProduct.uom_id ? freshProduct.uom_id[1] : 'pcs',
                    priceRetail: freshProduct.list_price || 0,
                    priceWhole: freshProduct.standard_price || 0,
                    isActive: freshProduct.active !== false,
                    updatedAt: new Date(),
                },
                create: {
                    odooId: freshProduct.id,
                    name: freshProduct.name || 'Unknown',
                    sku,
                    barcode: freshProduct.barcode || null,
                    category: freshProduct.categ_id ? freshProduct.categ_id[1] : null,
                    unit: freshProduct.uom_id ? freshProduct.uom_id[1] : 'pcs',
                    priceRetail: freshProduct.list_price || 0,
                    priceWhole: freshProduct.standard_price || 0,
                    isActive: freshProduct.active !== false,
                },
            });
            job.log(`Product ${freshProduct.name} upserted`);
            return { odooId: data.odooId, name: freshProduct.name };
        }
    }, {
        connection: queue_1.redisConnection,
        concurrency: 2,
    });
    exports.customerWorker = new bullmq_1.Worker('sync-customers', async (job) => {
        const data = job.data;
        if (data.type === 'full_sync') {
            job.log('Starting full customer sync from Odoo...');
            const result = await syncService.syncCustomers();
            job.log(`Done: created=${result.created}, updated=${result.updated}, total=${result.total}`);
            return result;
        }
        if (data.type === 'single_upsert') {
            job.log(`Upserting single customer odooId=${data.odooId}`);
            // Re-fetch full record from Odoo
            const [freshCustomer] = await odoo_service_1.default.read('res.partner', [data.odooId], [
                'id', 'name', 'phone', 'mobile', 'email',
                'street', 'street2', 'city', 'partner_latitude', 'partner_longitude',
            ]);
            if (!freshCustomer) {
                throw new Error(`Customer odooId=${data.odooId} not found in Odoo`);
            }
            const address = [freshCustomer.street, freshCustomer.street2, freshCustomer.city]
                .filter(Boolean).join(', ');
            const phone = freshCustomer.mobile || freshCustomer.phone || null;
            // Try to find if we already have this customer locally (with odooId: null) by phone or email
            let existingCustomer = await prisma_1.default.customer.findUnique({ where: { odooId: freshCustomer.id } });
            if (!existingCustomer && phone) {
                existingCustomer = await prisma_1.default.customer.findFirst({
                    where: { phone, odooId: null }
                });
            }
            if (!existingCustomer && freshCustomer.email) {
                existingCustomer = await prisma_1.default.customer.findFirst({
                    where: { email: freshCustomer.email, odooId: null }
                });
            }
            if (existingCustomer) {
                await prisma_1.default.customer.update({
                    where: { id: existingCustomer.id },
                    data: {
                        odooId: freshCustomer.id,
                        name: freshCustomer.name,
                        phone: phone || existingCustomer.phone,
                        email: freshCustomer.email || existingCustomer.email,
                        address: address || existingCustomer.address,
                        lat: freshCustomer.partner_latitude || existingCustomer.lat,
                        lng: freshCustomer.partner_longitude || existingCustomer.lng,
                        updatedAt: new Date(),
                    }
                });
                job.log(`Merged customer ${freshCustomer.name} with local ID ${existingCustomer.id}`);
            }
            else {
                await prisma_1.default.customer.upsert({
                    where: { odooId: freshCustomer.id },
                    update: {
                        name: freshCustomer.name,
                        phone,
                        email: freshCustomer.email || null,
                        address: address || null,
                        lat: freshCustomer.partner_latitude || null,
                        lng: freshCustomer.partner_longitude || null,
                        updatedAt: new Date(),
                    },
                    create: {
                        odooId: freshCustomer.id,
                        name: freshCustomer.name || `Customer #${freshCustomer.id}`,
                        phone,
                        email: freshCustomer.email || null,
                        address: address || null,
                        lat: freshCustomer.partner_latitude || null,
                        lng: freshCustomer.partner_longitude || null,
                    },
                });
            }
            job.log(`Customer ${freshCustomer.name} upserted`);
            return { odooId: data.odooId, name: freshCustomer.name };
        }
    }, {
        connection: queue_1.redisConnection,
        concurrency: 2,
    });
    exports.orderWorker = new bullmq_1.Worker('sync-orders', async (job) => {
        const data = job.data;
        if (data.type === 'full_sync') {
            job.log('Starting full order sync from Odoo...');
            const driverId = data.driverId || await getDefaultDriverId();
            const result = await syncService.syncOrders(driverId);
            job.log(`Done: created=${result.created}, skipped=${result.skipped}, total=${result.total}`);
            return result;
        }
        if (data.type === 'order_created') {
            job.log(`Processing order_created for odooId=${data.odooId}`);
            // Re-fetch full order from Odoo
            const [freshOrder] = await odoo_service_1.default.read('sale.order', [data.odooId], [
                'id', 'name', 'partner_id', 'date_order', 'state', 'amount_total', 'order_line',
            ]);
            if (!freshOrder)
                throw new Error(`Order odooId=${data.odooId} not found in Odoo`);
            // Skip if delivery already exists
            const existing = await prisma_1.default.delivery.findFirst({ where: { odooOrderId: data.odooId } });
            if (existing) {
                job.log(`Delivery for order ${data.odooId} already exists — skipping`);
                return { skipped: true };
            }
            // Find or auto-create customer
            const partnerId = freshOrder.partner_id[0];
            let customer = await prisma_1.default.customer.findUnique({ where: { odooId: partnerId } });
            if (!customer) {
                const [partnerData] = await odoo_service_1.default.read('res.partner', [partnerId], [
                    'name', 'phone', 'mobile', 'email', 'street', 'city',
                    'partner_latitude', 'partner_longitude',
                ]);
                if (partnerData) {
                    customer = await prisma_1.default.customer.create({
                        data: {
                            odooId: partnerId,
                            name: partnerData.name || 'Unknown',
                            phone: partnerData.mobile || partnerData.phone || null,
                            email: partnerData.email || null,
                            address: [partnerData.street, partnerData.city].filter(Boolean).join(', ') || null,
                            lat: partnerData.partner_latitude || null,
                            lng: partnerData.partner_longitude || null,
                        },
                    });
                }
            }
            if (!customer)
                throw new Error(`Cannot find or create customer for partner ${partnerId}`);
            const driverId = await getDefaultDriverId();
            const route = await prisma_1.default.route.findFirst({ where: { isActive: true } });
            // Fetch order lines
            const lines = freshOrder.order_line?.length
                ? await odoo_service_1.default.fetchOrderLines(freshOrder.order_line)
                : [];
            await prisma_1.default.delivery.create({
                data: {
                    driverId,
                    customerId: customer.id,
                    routeId: route?.id || null,
                    odooOrderId: data.odooId,
                    status: 'PENDING',
                    scheduledAt: new Date(freshOrder.date_order),
                    items: {
                        create: await Promise.all(lines
                            .filter((l) => l.product_id)
                            .map(async (l) => {
                            const pOdooId = l.product_id[0];
                            let product = await prisma_1.default.product.findUnique({ where: { odooId: pOdooId } });
                            if (!product) {
                                product = await prisma_1.default.product.create({
                                    data: {
                                        odooId: pOdooId,
                                        name: l.product_id[1] || 'Unknown',
                                        sku: `ODOO-${pOdooId}`,
                                        priceRetail: l.price_unit || 0,
                                    },
                                });
                            }
                            return {
                                productId: product.id,
                                quantity: Math.round(l.product_uom_qty || 0),
                                unitPrice: l.price_unit || 0,
                            };
                        })),
                    },
                },
            });
            job.log(`Created delivery for Odoo order ${data.odooId}`);
            return { created: true };
        }
        if (data.type === 'order_updated') {
            job.log(`Processing order_updated for odooId=${data.odooId}`);
            const delivery = await prisma_1.default.delivery.findFirst({ where: { odooOrderId: data.odooId } });
            if (!delivery) {
                job.log(`No delivery found for order ${data.odooId} — skipping`);
                return { skipped: true };
            }
            // Re-fetch from Odoo to get fresh state
            const [freshOrder] = await odoo_service_1.default.read('sale.order', [data.odooId], ['state', 'note']);
            const stateMap = {
                draft: 'PENDING', sent: 'PENDING', sale: 'PENDING', done: 'DELIVERED', cancel: 'FAILED',
            };
            const newStatus = freshOrder?.state ? stateMap[freshOrder.state] : null;
            if (newStatus && newStatus !== delivery.status) {
                await prisma_1.default.delivery.update({
                    where: { id: delivery.id },
                    data: { status: newStatus, notes: freshOrder.note || delivery.notes },
                });
                job.log(`Updated delivery ${delivery.id} → ${newStatus}`);
            }
            return { updated: true };
        }
        if (data.type === 'order_cancelled') {
            job.log(`Processing order_cancelled for odooId=${data.odooId}`);
            const delivery = await prisma_1.default.delivery.findFirst({ where: { odooOrderId: data.odooId } });
            if (!delivery)
                return { skipped: true };
            if (['PENDING', 'IN_PROGRESS'].includes(delivery.status)) {
                await prisma_1.default.delivery.update({
                    where: { id: delivery.id },
                    data: { status: 'FAILED', failReason: 'Cancelled in Odoo' },
                });
                job.log(`Delivery ${delivery.id} marked FAILED (cancelled in Odoo)`);
            }
            return { cancelled: true };
        }
    }, {
        connection: queue_1.redisConnection,
        concurrency: 2,
    });
    // ─── Worker Error Handlers ───────────────────────────────────────────────────
    exports.productWorker.on('failed', (job, err) => {
        console.error(`❌ [productWorker] Job ${job?.id} failed after retries:`, err.message);
    });
    exports.customerWorker.on('failed', (job, err) => {
        console.error(`❌ [customerWorker] Job ${job?.id} failed after retries:`, err.message);
    });
    exports.orderWorker.on('failed', (job, err) => {
        console.error(`❌ [orderWorker] Job ${job?.id} failed after retries:`, err.message);
    });
}
// ─── Utility ─────────────────────────────────────────────────────────────────
async function getDefaultDriverId() {
    const driver = await prisma_1.default.user.findFirst({
        where: { role: 'DRIVER', isActive: true },
        select: { id: true },
    });
    if (!driver)
        throw new Error('No active driver found for order assignment');
    return driver.id;
}
function startWorkers() {
    if (DISABLE_REDIS) {
        console.log('ℹ️ BullMQ workers disabled because DISABLE_REDIS=true');
        return;
    }
    console.log('🚀 BullMQ workers started (products, customers, orders)');
}
//# sourceMappingURL=sync.worker.js.map