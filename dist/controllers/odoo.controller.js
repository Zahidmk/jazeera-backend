"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOdooStock = exports.getOdooCustomers = exports.getOdooOrders = exports.getOdooProducts = void 0;
const odoo_service_1 = __importDefault(require("../services/odoo/odoo.service"));
const prisma_1 = __importDefault(require("../utils/prisma"));
// ─── GET /api/v1/odoo/products ─────────────────────────────────────────────
// Fetch all products from local PostgreSQL database (synced from Odoo)
const getOdooProducts = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit || '500');
        const products = await prisma_1.default.product.findMany({
            take: limit,
            orderBy: { name: 'asc' },
        });
        const mapped = products.map((p) => ({
            id: p.odooId || 0, // Map to odooId for dashboard compatibility
            name: p.name,
            sku: p.sku,
            barcode: p.barcode || null,
            category: p.category || null,
            unit: p.unit || 'pcs',
            priceRetail: p.priceRetail || 0,
            priceWhole: p.priceWhole || 0,
            qtyAvailable: 0,
            imageUrl: p.imageUrl || null,
            isActive: p.isActive !== false,
        }));
        res.json({
            success: true,
            data: mapped,
            meta: { total: mapped.length },
        });
    }
    catch (err) {
        console.error('Local products fetch error:', err);
        res.status(500).json({ success: false, error: `Failed to fetch products: ${err.message}` });
    }
};
exports.getOdooProducts = getOdooProducts;
// ─── GET /api/v1/odoo/orders ───────────────────────────────────────────────
// Fetch sale orders directly from Odoo
const getOdooOrders = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit || '200');
        const orders = await odoo_service_1.default.fetchSaleOrders(limit);
        // Fetch order lines for all orders in one batch
        const allLineIds = orders.flatMap((o) => o.order_line || []);
        let linesMap = {};
        if (allLineIds.length > 0) {
            const lines = await odoo_service_1.default.fetchOrderLines(allLineIds);
            for (const line of lines) {
                const orderId = line.order_id?.[0];
                if (orderId) {
                    if (!linesMap[orderId])
                        linesMap[orderId] = [];
                    linesMap[orderId].push(line);
                }
            }
            // If order_id not returned, group by order.order_line
            for (const order of orders) {
                linesMap[order.id] = lines.filter((l) => (order.order_line || []).includes(l.id));
            }
        }
        const mapped = orders.map((o) => {
            const lines = linesMap[o.id] || [];
            const items = lines.map((l) => ({
                productId: l.product_id?.[0] || null,
                productName: l.product_id?.[1] || 'Unknown',
                qty: l.product_uom_qty || 0,
                unitPrice: l.price_unit || 0,
                subtotal: l.price_subtotal || 0,
            }));
            return {
                id: o.id,
                orderNumber: o.name,
                customerName: o.partner_id?.[1] || 'Unknown Customer',
                customerId: o.partner_id?.[0] || null,
                dateOrder: o.date_order,
                state: o.state,
                totalAmount: o.amount_total || 0,
                items,
            };
        });
        res.json({
            success: true,
            data: mapped,
            meta: { total: mapped.length },
        });
    }
    catch (err) {
        console.error('Odoo orders fetch error:', err);
        res.status(500).json({ success: false, error: `Failed to fetch orders from Odoo: ${err.message}` });
    }
};
exports.getOdooOrders = getOdooOrders;
// ─── GET /api/v1/odoo/customers ────────────────────────────────────────────
// Fetch customers directly from Odoo
const getOdooCustomers = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit || '500');
        const customers = await odoo_service_1.default.fetchCustomers(limit);
        const mapped = customers.map((c) => ({
            id: c.id,
            name: c.name,
            phone: c.mobile || c.phone || null,
            email: c.email || null,
            address: [c.street, c.street2, c.city].filter(Boolean).join(', ') || null,
            lat: c.partner_latitude || null,
            lng: c.partner_longitude || null,
        }));
        res.json({
            success: true,
            data: mapped,
            meta: { total: mapped.length },
        });
    }
    catch (err) {
        console.error('Odoo customers fetch error:', err);
        res.status(500).json({ success: false, error: `Failed to fetch customers from Odoo: ${err.message}` });
    }
};
exports.getOdooCustomers = getOdooCustomers;
// ─── GET /api/v1/odoo/stock ────────────────────────────────────────────────
// Fetch warehouse stock quants directly from Odoo
const getOdooStock = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit || '1000');
        const quants = await odoo_service_1.default.fetchStockQuants(limit);
        // Aggregate per product
        const productMap = {};
        for (const q of quants) {
            const productId = q.product_id?.[0];
            const productName = q.product_id?.[1] || 'Unknown';
            const locationName = q.location_id?.[1] || 'Unknown';
            const qty = q.quantity || 0;
            if (!productMap[productId]) {
                productMap[productId] = { productName, totalQty: 0, locations: [] };
            }
            productMap[productId].totalQty += qty;
            productMap[productId].locations.push({ location: locationName, qty });
        }
        const data = Object.entries(productMap).map(([productId, info]) => ({
            productId: parseInt(productId),
            productName: info.productName,
            totalQty: Math.round(info.totalQty),
            locations: info.locations,
        }));
        res.json({
            success: true,
            data,
            meta: { total: data.length },
        });
    }
    catch (err) {
        console.error('Odoo stock fetch error:', err);
        res.status(500).json({ success: false, error: `Failed to fetch stock from Odoo: ${err.message}` });
    }
};
exports.getOdooStock = getOdooStock;
//# sourceMappingURL=odoo.controller.js.map