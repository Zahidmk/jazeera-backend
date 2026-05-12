"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncProducts = syncProducts;
exports.syncCustomers = syncCustomers;
exports.syncOrders = syncOrders;
exports.syncAll = syncAll;
const odoo_service_1 = __importDefault(require("./odoo.service"));
const prisma_1 = __importDefault(require("../../utils/prisma"));
// ─── Sync Products from Odoo ────────────────────────────
async function syncProducts() {
    console.log('🔄 Syncing products from Odoo...');
    const odooProducts = await odoo_service_1.default.fetchProducts();
    let created = 0;
    let updated = 0;
    for (const op of odooProducts) {
        const sku = op.default_code || `ODOO-${op.id}`;
        const data = {
            odooId: op.id,
            name: op.name || 'Unknown Product',
            nameAr: null,
            sku,
            barcode: op.barcode || null,
            category: op.categ_id ? op.categ_id[1] : null,
            unit: op.uom_id ? op.uom_id[1] : 'pcs',
            priceRetail: op.list_price || 0,
            priceWhole: op.standard_price || 0,
            imageUrl: op.image_128 ? `data:image/png;base64,${op.image_128}` : null,
            isActive: op.active !== false,
        };
        // Upsert by odooId
        const existing = await prisma_1.default.product.findUnique({ where: { odooId: op.id } });
        if (existing) {
            await prisma_1.default.product.update({
                where: { odooId: op.id },
                data: { ...data, updatedAt: new Date() },
            });
            updated++;
        }
        else {
            // Check if SKU exists (from seed data)
            const bySku = await prisma_1.default.product.findUnique({ where: { sku } });
            if (bySku) {
                await prisma_1.default.product.update({
                    where: { sku },
                    data: { ...data, updatedAt: new Date() },
                });
                updated++;
            }
            else {
                await prisma_1.default.product.create({ data });
                created++;
            }
        }
    }
    console.log(`✅ Products synced — Created: ${created}, Updated: ${updated}, Total from Odoo: ${odooProducts.length}`);
    return { created, updated, total: odooProducts.length };
}
// ─── Sync Customers from Odoo ───────────────────────────
async function syncCustomers() {
    console.log('🔄 Syncing customers from Odoo...');
    const odooCustomers = await odoo_service_1.default.fetchCustomers();
    let created = 0;
    let updated = 0;
    for (const oc of odooCustomers) {
        const address = [oc.street, oc.street2, oc.city].filter(Boolean).join(', ');
        const phone = oc.mobile || oc.phone || null;
        const data = {
            odooId: oc.id,
            name: oc.name || 'Unknown Customer',
            phone,
            email: oc.email || null,
            address: address || null,
            lat: oc.partner_latitude || null,
            lng: oc.partner_longitude || null,
        };
        const existing = await prisma_1.default.customer.findUnique({ where: { odooId: oc.id } });
        if (existing) {
            await prisma_1.default.customer.update({
                where: { odooId: oc.id },
                data: { ...data, updatedAt: new Date() },
            });
            updated++;
        }
        else {
            await prisma_1.default.customer.create({ data });
            created++;
        }
    }
    console.log(`✅ Customers synced — Created: ${created}, Updated: ${updated}, Total from Odoo: ${odooCustomers.length}`);
    return { created, updated, total: odooCustomers.length };
}
// ─── Sync Sale Orders → Deliveries ──────────────────────
async function syncOrders(driverId) {
    console.log('🔄 Syncing orders from Odoo...');
    const odooOrders = await odoo_service_1.default.fetchSaleOrders();
    let created = 0;
    let skipped = 0;
    // Get a default route
    const route = await prisma_1.default.route.findFirst({ where: { isActive: true } });
    for (const order of odooOrders) {
        // Skip if already imported
        const existing = await prisma_1.default.delivery.findFirst({
            where: { odooOrderId: order.id },
        });
        if (existing) {
            skipped++;
            continue;
        }
        // Find or create customer by odooId
        const partnerId = order.partner_id[0];
        let customer = await prisma_1.default.customer.findUnique({ where: { odooId: partnerId } });
        if (!customer) {
            // Fetch this specific customer from Odoo
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
        if (!customer) {
            skipped++;
            continue;
        }
        // Fetch order lines
        let items = [];
        if (order.order_line && order.order_line.length > 0) {
            items = await odoo_service_1.default.fetchOrderLines(order.order_line);
        }
        // Create delivery with items
        const delivery = await prisma_1.default.delivery.create({
            data: {
                driverId,
                customerId: customer.id,
                routeId: route?.id || null,
                odooOrderId: order.id,
                status: 'PENDING',
                scheduledAt: new Date(order.date_order),
                items: {
                    create: await Promise.all(items
                        .filter((item) => item.product_id)
                        .map(async (item) => {
                        const productOdooId = item.product_id[0];
                        let product = await prisma_1.default.product.findUnique({ where: { odooId: productOdooId } });
                        if (!product) {
                            // Create a placeholder product
                            product = await prisma_1.default.product.create({
                                data: {
                                    odooId: productOdooId,
                                    name: item.product_id[1] || 'Unknown Product',
                                    sku: `ODOO-${productOdooId}`,
                                    priceRetail: item.price_unit || 0,
                                },
                            });
                        }
                        return {
                            productId: product.id,
                            quantity: Math.round(item.product_uom_qty || 0),
                            unitPrice: item.price_unit || 0,
                        };
                    })),
                },
            },
        });
        created++;
    }
    console.log(`✅ Orders synced — Created: ${created}, Skipped: ${skipped}, Total from Odoo: ${odooOrders.length}`);
    return { created, skipped, total: odooOrders.length };
}
// ─── Full Sync ──────────────────────────────────────────
async function syncAll(driverId) {
    const products = await syncProducts();
    const customers = await syncCustomers();
    let orders;
    if (driverId) {
        orders = await syncOrders(driverId);
    }
    return { products, customers, orders };
}
exports.default = { syncProducts, syncCustomers, syncOrders, syncAll };
//# sourceMappingURL=sync.service.js.map