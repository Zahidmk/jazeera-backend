"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadReceipt = exports.submitSale = exports.removeCartItem = exports.updateCartItem = exports.addCartItem = exports.getCart = exports.uploadReceiptMiddleware = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const uuid_1 = require("uuid");
const prisma_1 = __importDefault(require("../utils/prisma"));
const odoo_service_1 = __importDefault(require("../services/odoo/odoo.service"));
// ─── Multer config for receipt upload ────────────────────────────────────────
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, path_1.default.join(__dirname, '../../uploads/receipts')),
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname);
        cb(null, `receipt_${(0, uuid_1.v4)()}${ext}`);
    },
});
exports.uploadReceiptMiddleware = (0, multer_1.default)({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (_req, file, cb) => {
        const allowed = /jpeg|jpg|png|pdf/;
        const valid = allowed.test(path_1.default.extname(file.originalname).toLowerCase());
        cb(null, valid);
    },
}).single('receipt');
// In-memory cart store (per driver) — replace with Redis in production
const cartStore = {};
// ─── GET /api/v1/driver/sales/cart ───────────────────────────────────────────
const getCart = async (req, res) => {
    const driverId = req.user.userId;
    const cart = cartStore[driverId] || [];
    const total = cart.reduce((sum, item) => {
        const discounted = item.unitPrice * item.quantity * (1 - (item.discount || 0) / 100);
        return sum + discounted;
    }, 0);
    res.json({ success: true, data: { items: cart, totalAmount: parseFloat(total.toFixed(2)) } });
};
exports.getCart = getCart;
// ─── POST /api/v1/driver/sales/cart/items ────────────────────────────────────
const addCartItem = async (req, res) => {
    try {
        const driverId = req.user.userId;
        const { productId, quantity, discount = 0 } = req.body;
        if (!productId || !quantity) {
            res.status(400).json({ success: false, error: 'productId and quantity are required' });
            return;
        }
        const product = await prisma_1.default.product.findUnique({
            where: { id: productId },
            select: { id: true, name: true, sku: true, priceRetail: true, unit: true },
        });
        if (!product) {
            res.status(404).json({ success: false, error: 'Product not found' });
            return;
        }
        if (!cartStore[driverId])
            cartStore[driverId] = [];
        const existing = cartStore[driverId].find(i => i.productId === productId);
        if (existing) {
            existing.quantity += quantity;
            existing.discount = discount;
        }
        else {
            cartStore[driverId].push({
                id: (0, uuid_1.v4)(),
                productId,
                name: product.name,
                sku: product.sku,
                unit: product.unit,
                unitPrice: product.priceRetail,
                quantity,
                discount,
            });
        }
        res.json({ success: true, data: cartStore[driverId] });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Failed to add item to cart' });
    }
};
exports.addCartItem = addCartItem;
// ─── PATCH /api/v1/driver/sales/cart/items/:itemId ───────────────────────────
const updateCartItem = async (req, res) => {
    const driverId = req.user.userId;
    const { itemId } = req.params;
    const { quantity, discount } = req.body;
    const cart = cartStore[driverId] || [];
    const item = cart.find(i => i.id === itemId);
    if (!item) {
        res.status(404).json({ success: false, error: 'Cart item not found' });
        return;
    }
    if (quantity !== undefined)
        item.quantity = quantity;
    if (discount !== undefined)
        item.discount = discount;
    res.json({ success: true, data: cart });
};
exports.updateCartItem = updateCartItem;
// ─── DELETE /api/v1/driver/sales/cart/items/:itemId ──────────────────────────
const removeCartItem = async (req, res) => {
    const driverId = req.user.userId;
    const { itemId } = req.params;
    if (!cartStore[driverId]) {
        res.status(404).json({ success: false, error: 'Cart is empty' });
        return;
    }
    cartStore[driverId] = cartStore[driverId].filter(i => i.id !== itemId);
    res.json({ success: true, data: cartStore[driverId] });
};
exports.removeCartItem = removeCartItem;
// ─── POST /api/v1/driver/sales/submit ────────────────────────────────────────
const submitSale = async (req, res) => {
    try {
        const driverId = req.user.userId;
        const { customerId, saleType = 'CASH', customerName, latitude, longitude, items: bodyItems } = req.body;
        // Accept phone as string OR number (Flutter may send it as a number)
        const customerPhone = req.body.customerPhone != null ? String(req.body.customerPhone) : undefined;
        // Support two modes:
        // 1. In-memory cart (dashboard / web flow)
        // 2. Items sent directly in the body (Flutter mobile flow)
        let cart = cartStore[driverId] || [];
        if (bodyItems && Array.isArray(bodyItems) && bodyItems.length > 0) {
            // Flutter sends items directly — resolve price from DB for each product
            const resolved = [];
            for (const item of bodyItems) {
                if (!item.productId || !item.quantity || item.quantity < 1) {
                    res.status(400).json({ success: false, error: `Item missing productId or quantity` });
                    return;
                }
                const product = await prisma_1.default.product.findUnique({
                    where: { id: item.productId },
                    select: { id: true, name: true, sku: true, priceRetail: true, unit: true },
                });
                if (!product) {
                    res.status(404).json({ success: false, error: `Product ${item.productId} not found` });
                    return;
                }
                resolved.push({
                    id: (0, uuid_1.v4)(),
                    productId: item.productId,
                    name: product.name,
                    sku: product.sku,
                    unit: product.unit,
                    unitPrice: item.unitPrice ?? product.priceRetail,
                    quantity: item.quantity,
                    discount: item.discount ?? 0,
                });
            }
            cart = resolved;
        }
        if (cart.length === 0) {
            res.status(400).json({ success: false, error: 'Cart is empty. Either add items to the cart first, or include an "items" array in the request body.' });
            return;
        }
        let resolvedCustomerId = null;
        if (customerId) {
            // Verify the customerId actually exists — if not, check Lead table and convert on the fly
            let existingCustomer = await prisma_1.default.customer.findUnique({ where: { id: customerId }, select: { id: true } });
            if (!existingCustomer) {
                const leadExists = await prisma_1.default.lead.findUnique({ where: { id: customerId } });
                if (leadExists) {
                    existingCustomer = await prisma_1.default.customer.create({
                        data: {
                            id: leadExists.id,
                            name: leadExists.name,
                            phone: leadExists.phone,
                            address: leadExists.address,
                            lat: leadExists.lat,
                            lng: leadExists.lng,
                        },
                        select: { id: true },
                    });
                    await prisma_1.default.lead.update({
                        where: { id: leadExists.id },
                        data: { customerId: leadExists.id },
                    });
                }
            }
            if (existingCustomer) {
                resolvedCustomerId = customerId;
            }
        }
        // If no valid customerId, create a walk-in customer
        if (!resolvedCustomerId) {
            const walkIn = await prisma_1.default.customer.create({
                data: { name: customerName || 'Walk-in Customer', phone: customerPhone || null },
            });
            resolvedCustomerId = walkIn.id;
        }
        const van = await prisma_1.default.van.findFirst({ where: { driverId } });
        if (!van) {
            res.status(400).json({ success: false, error: 'No van assigned to this driver' });
            return;
        }
        const totalAmount = cart.reduce((sum, item) => {
            return sum + item.unitPrice * item.quantity * (1 - (item.discount || 0) / 100);
        }, 0);
        // Create cash sale + deduct from van inventory in a transaction
        const sale = await prisma_1.default.$transaction(async (tx) => {
            const newSale = await tx.cashSale.create({
                data: {
                    driverId,
                    customerId: resolvedCustomerId,
                    saleType,
                    totalAmount: parseFloat(totalAmount.toFixed(2)),
                    latitude: latitude ? parseFloat(latitude) : null,
                    longitude: longitude ? parseFloat(longitude) : null,
                    items: {
                        create: cart.map(item => ({
                            productId: item.productId,
                            quantity: item.quantity,
                            unitPrice: item.unitPrice,
                            discount: item.discount || 0,
                        })),
                    },
                },
                include: { items: true },
            });
            // Deduct from van inventory
            for (const item of cart) {
                await tx.vanInventory.updateMany({
                    where: { vanId: van.id, productId: item.productId },
                    data: { quantity: { decrement: item.quantity } },
                });
            }
            return newSale;
        });
        // Clear cart
        delete cartStore[driverId];
        // ── Push to Odoo (fire-and-forget — DB save must not fail if Odoo is down)
        if (resolvedCustomerId) {
            pushSaleToOdoo(sale.id, resolvedCustomerId, cart, van.id).catch((err) => console.error('⚠️  Odoo sale push failed (non-blocking):', err?.message));
        }
        res.status(201).json({ success: true, data: sale });
    }
    catch (err) {
        console.error('❌ submitSale error:', err?.message, err?.code, JSON.stringify(err?.meta));
        res.status(500).json({ success: false, error: 'Failed to submit sale' });
    }
};
exports.submitSale = submitSale;
// ─── Helper: push cash sale to Odoo — Full Flow ──────────────────────────────
// 1. Create sale order in Odoo
// 2. Confirm the sale order
// 3. Set van stock location as the delivery source (so Odoo deducts from van)
// 4. Validate the outgoing delivery picking (deducts from van inventory in Odoo)
async function pushSaleToOdoo(saleId, customerId, cart, vanId) {
    // Get the customer's odooId
    const customer = await prisma_1.default.customer.findUnique({
        where: { id: customerId },
        select: { odooId: true },
    });
    if (!customer?.odooId) {
        console.warn(`⚠️  Customer ${customerId} has no odooId — skipping Odoo sale push`);
        return;
    }
    // Build sale order lines with Odoo product IDs
    const lines = await Promise.all(cart.map(async (item) => {
        const product = await prisma_1.default.product.findUnique({
            where: { id: item.productId },
            select: { odooId: true },
        });
        return {
            productId: product?.odooId ?? 0,
            qty: item.quantity,
            price: item.unitPrice,
            discount: item.discount || 0,
        };
    }));
    const validLines = lines.filter((l) => l.productId > 0);
    if (validLines.length === 0) {
        console.warn('⚠️  No valid Odoo product IDs found — skipping sale push');
        return;
    }
    // 1. Create the sale order in Odoo
    const odooSaleId = await odoo_service_1.default.createSaleOrder(customer.odooId, validLines);
    await prisma_1.default.cashSale.update({ where: { id: saleId }, data: { odooSaleId } });
    console.log(`✅ Odoo: Cash sale ${saleId} → SO created with odooSaleId: ${odooSaleId}`);
    // 2. Get the van's Odoo stock location (find/create if needed)
    const van = await prisma_1.default.van.findUnique({
        where: { id: vanId },
        select: { id: true, plateNumber: true, odooLocationId: true },
    });
    let vanLocationId = van?.odooLocationId ?? null;
    if (van && !vanLocationId) {
        vanLocationId = await odoo_service_1.default.findOrCreateVanLocation(van.plateNumber);
        await prisma_1.default.van.update({ where: { id: van.id }, data: { odooLocationId: vanLocationId } });
    }
    // 3. Confirm the SO and set van as the source location for the delivery
    if (vanLocationId) {
        await odoo_service_1.default.confirmSaleOrderWithVanLocation(odooSaleId, vanLocationId);
    }
    else {
        // Confirm without location override
        try {
            await odoo_service_1.default.execute('sale.order', 'action_confirm', [[odooSaleId]]);
        }
        catch { /* already confirmed */ }
    }
    // 4. Validate the outgoing delivery picking (deducts stock from Odoo)
    await odoo_service_1.default.validateDeliveryForSaleOrder(odooSaleId);
    console.log(`✅ Odoo: Cash sale ${saleId} fully synced — SO ${odooSaleId} confirmed and delivery validated`);
}
// ─── POST /api/v1/driver/sales/:id/receipt ───────────────────────────────────
const uploadReceipt = async (req, res) => {
    try {
        const { id } = req.params;
        const driverId = req.user.userId;
        if (!req.file) {
            res.status(400).json({ success: false, error: 'No file uploaded' });
            return;
        }
        const sale = await prisma_1.default.cashSale.findFirst({ where: { id, driverId } });
        if (!sale) {
            res.status(404).json({ success: false, error: 'Sale not found' });
            return;
        }
        const receiptUrl = `/uploads/receipts/${req.file.filename}`;
        const updated = await prisma_1.default.cashSale.update({
            where: { id },
            data: { receiptUrl },
        });
        res.json({ success: true, data: { receiptUrl: updated.receiptUrl } });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Failed to upload receipt' });
    }
};
exports.uploadReceipt = uploadReceipt;
//# sourceMappingURL=cashSale.controller.js.map