"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rejectLead = exports.approveLead = exports.getLeads = exports.updateCustomerLocation = exports.getCustomers = exports.updateSettings = exports.getVanWarehouse = exports.getSettings = exports.updateRoute = exports.createRoute = exports.getRoutes = exports.updateUser = exports.createUser = exports.getUsers = exports.deleteVan = exports.updateVan = exports.createVan = exports.getVans = exports.getDailyReport = exports.getProducts = exports.getDrivers = exports.getSales = exports.getDeliveries = exports.getStats = void 0;
const prisma_1 = __importDefault(require("../utils/prisma"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
// ─── GET /api/v1/admin/stats ──────────────────────────────────────────────────
const getStats = async (_req, res) => {
    try {
        const [totalDrivers, totalDeliveries, deliveredCount, failedCount, totalSalesRevenue, totalProducts, lowStockCount,] = await Promise.all([
            prisma_1.default.user.count({ where: { role: 'DRIVER', isActive: true } }),
            prisma_1.default.delivery.count(),
            prisma_1.default.delivery.count({ where: { status: 'DELIVERED' } }),
            prisma_1.default.delivery.count({ where: { status: 'FAILED' } }),
            prisma_1.default.cashSale.aggregate({ _sum: { totalAmount: true } }),
            prisma_1.default.product.count({ where: { isActive: true } }),
            prisma_1.default.vanInventory.count({ where: { quantity: { lt: 5 } } }),
        ]);
        res.json({
            success: true,
            data: {
                drivers: { total: totalDrivers },
                deliveries: {
                    total: totalDeliveries,
                    delivered: deliveredCount,
                    failed: failedCount,
                    successRate: totalDeliveries > 0
                        ? parseFloat(((deliveredCount / totalDeliveries) * 100).toFixed(1))
                        : 0,
                },
                sales: {
                    totalRevenue: parseFloat((totalSalesRevenue._sum.totalAmount ?? 0).toFixed(2)),
                },
                stock: {
                    totalProducts,
                    lowStockAlerts: lowStockCount,
                },
            },
        });
    }
    catch (err) {
        console.error("CRASH IN WAREHOUSE:", err);
        res.status(500).json({ success: false, error: 'Failed to get stats' });
    }
};
exports.getStats = getStats;
// ─── GET /api/v1/admin/deliveries ─────────────────────────────────────────────
const getDeliveries = async (req, res) => {
    try {
        const { date, driverId, status, page = '1', limit = '50' } = req.query;
        const where = {};
        if (status)
            where.status = status;
        if (driverId)
            where.driverId = driverId;
        if (date) {
            const day = new Date(date);
            const next = new Date(day);
            next.setDate(day.getDate() + 1);
            where.scheduledAt = { gte: day, lt: next };
        }
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;
        const [deliveries, total] = await Promise.all([
            prisma_1.default.delivery.findMany({
                where,
                include: {
                    driver: { select: { id: true, name: true } },
                    customer: { select: { id: true, name: true, phone: true, address: true } },
                    items: { include: { product: { select: { name: true, sku: true } } } },
                },
                orderBy: { scheduledAt: 'desc' },
                skip,
                take: limitNum,
            }),
            prisma_1.default.delivery.count({ where }),
        ]);
        res.json({
            success: true,
            data: deliveries,
            meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
        });
    }
    catch (err) {
        console.error("CRASH IN WAREHOUSE:", err);
        res.status(500).json({ success: false, error: 'Failed to get deliveries' });
    }
};
exports.getDeliveries = getDeliveries;
// ─── GET /api/v1/admin/sales ──────────────────────────────────────────────────
const getSales = async (req, res) => {
    try {
        const { date, driverId, page = '1', limit = '50' } = req.query;
        const where = {};
        if (driverId)
            where.driverId = driverId;
        if (date) {
            const day = new Date(date);
            const next = new Date(day);
            next.setDate(day.getDate() + 1);
            where.createdAt = { gte: day, lt: next };
        }
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const [sales, total, aggregate] = await Promise.all([
            prisma_1.default.cashSale.findMany({
                where,
                include: {
                    driver: { select: { id: true, name: true } },
                    customer: { select: { id: true, name: true } },
                    items: { include: { product: { select: { name: true, sku: true } } } },
                },
                orderBy: { createdAt: 'desc' },
                skip: (pageNum - 1) * limitNum,
                take: limitNum,
            }),
            prisma_1.default.cashSale.count({ where }),
            prisma_1.default.cashSale.aggregate({ where, _sum: { totalAmount: true } }),
        ]);
        res.json({
            success: true,
            data: sales,
            meta: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum),
                totalRevenue: parseFloat((aggregate._sum.totalAmount ?? 0).toFixed(2)),
            },
        });
    }
    catch (err) {
        console.error("CRASH IN WAREHOUSE:", err);
        res.status(500).json({ success: false, error: 'Failed to get sales' });
    }
};
exports.getSales = getSales;
// ─── GET /api/v1/admin/drivers ────────────────────────────────────────────────
const getDrivers = async (_req, res) => {
    try {
        const drivers = await prisma_1.default.user.findMany({
            where: { role: 'DRIVER' },
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                isActive: true,
                van: { select: { id: true, plateNumber: true } },
                shifts: {
                    where: { status: 'ACTIVE' },
                    select: { id: true, startedAt: true },
                    take: 1,
                },
                _count: {
                    select: {
                        deliveries: true,
                        cashSales: true,
                    },
                },
            },
            orderBy: { name: 'asc' },
        });
        res.json({
            success: true,
            data: drivers.map((d) => ({
                id: d.id,
                name: d.name,
                email: d.email,
                phone: d.phone,
                isActive: d.isActive,
                van: d.van,
                onShift: d.shifts.length > 0,
                shiftStartedAt: d.shifts[0]?.startedAt ?? null,
                stats: {
                    totalDeliveries: d._count.deliveries,
                    totalSales: d._count.cashSales,
                },
            })),
        });
    }
    catch (err) {
        console.error("CRASH IN WAREHOUSE:", err);
        res.status(500).json({ success: false, error: 'Failed to get drivers' });
    }
};
exports.getDrivers = getDrivers;
// ─── GET /api/v1/admin/products ───────────────────────────────────────────────
const getProducts = async (req, res) => {
    try {
        const { category, search, page = '1', limit = '50' } = req.query;
        const where = { isActive: true };
        if (category)
            where.category = category;
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { sku: { contains: search, mode: 'insensitive' } },
            ];
        }
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const [products, total] = await Promise.all([
            prisma_1.default.product.findMany({
                where,
                include: {
                    vanInventory: {
                        select: { quantity: true, van: { select: { plateNumber: true } } },
                    },
                },
                orderBy: { name: 'asc' },
                skip: (pageNum - 1) * limitNum,
                take: limitNum,
            }),
            prisma_1.default.product.count({ where }),
        ]);
        res.json({
            success: true,
            data: products.map((p) => ({
                id: p.id,
                odooId: p.odooId,
                sku: p.sku,
                name: p.name,
                nameAr: p.nameAr,
                category: p.category,
                unit: p.unit,
                priceRetail: p.priceRetail,
                priceWhole: p.priceWhole,
                imageUrl: p.imageUrl,
                totalStock: p.vanInventory.reduce((s, v) => s + v.quantity, 0),
                vanBreakdown: p.vanInventory.map((v) => ({
                    van: v.van.plateNumber,
                    qty: v.quantity,
                })),
            })),
            meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
        });
    }
    catch (err) {
        console.error("CRASH IN WAREHOUSE:", err);
        res.status(500).json({ success: false, error: 'Failed to get products' });
    }
};
exports.getProducts = getProducts;
// ─── GET /api/v1/admin/reports/daily ─────────────────────────────────────────
const getDailyReport = async (req, res) => {
    try {
        const dateStr = req.query.date || new Date().toISOString().split('T')[0];
        const day = new Date(dateStr);
        const nextDay = new Date(day);
        nextDay.setDate(day.getDate() + 1);
        const [deliveries, cashSales, adjustments, activeDrivers] = await Promise.all([
            prisma_1.default.delivery.groupBy({
                by: ['status'],
                where: { scheduledAt: { gte: day, lt: nextDay } },
                _count: { status: true },
            }),
            prisma_1.default.cashSale.aggregate({
                where: { createdAt: { gte: day, lt: nextDay } },
                _sum: { totalAmount: true },
                _count: true,
            }),
            prisma_1.default.stockAdjustment.groupBy({
                by: ['reason'],
                where: { createdAt: { gte: day, lt: nextDay } },
                _count: { reason: true },
                _sum: { quantity: true },
            }),
            prisma_1.default.shift.count({
                where: { startedAt: { gte: day, lt: nextDay } },
            }),
        ]);
        // Top selling products for the day
        const topProducts = await prisma_1.default.cashSaleItem.groupBy({
            by: ['productId'],
            where: { sale: { createdAt: { gte: day, lt: nextDay } } },
            _sum: { quantity: true },
            orderBy: { _sum: { quantity: 'desc' } },
            take: 5,
        });
        const topProductDetails = await Promise.all(topProducts.map(async (tp) => {
            const product = await prisma_1.default.product.findUnique({
                where: { id: tp.productId },
                select: { name: true, sku: true },
            });
            return { product: product?.name, sku: product?.sku, qtySold: tp._sum.quantity };
        }));
        const deliverySummary = deliveries.reduce((acc, d) => {
            acc[d.status] = d._count.status;
            return acc;
        }, {});
        res.json({
            success: true,
            data: {
                date: dateStr,
                activeDrivers,
                deliveries: {
                    ...deliverySummary,
                    total: deliveries.reduce((s, d) => s + d._count.status, 0),
                },
                cashSales: {
                    count: cashSales._count,
                    totalRevenue: parseFloat((cashSales._sum.totalAmount ?? 0).toFixed(2)),
                },
                stockAdjustments: adjustments.map((a) => ({
                    reason: a.reason,
                    count: a._count.reason,
                    totalQty: Math.abs(a._sum.quantity ?? 0),
                })),
                topSellingProducts: topProductDetails,
            },
        });
    }
    catch (err) {
        console.error("CRASH IN WAREHOUSE:", err);
        res.status(500).json({ success: false, error: 'Failed to generate daily report' });
    }
};
exports.getDailyReport = getDailyReport;
// ─── GET /api/v1/admin/reports/export ────────────────────────────────────────
// Handled in reports.controller.ts (Day 6) — imported directly in admin.routes.ts
// ══════════════════════════════════════════════════════════════════════════════
// VANS CRUD
// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/admin/vans
const getVans = async (_req, res) => {
    try {
        const vans = await prisma_1.default.van.findMany({
            include: {
                driver: { select: { id: true, name: true, email: true, phone: true, role: true, isActive: true } },
                inventory: { include: { product: { select: { id: true, name: true, sku: true } } } },
                _count: { select: { shifts: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ success: true, data: vans });
    }
    catch (err) {
        console.error("CRASH IN WAREHOUSE:", err);
        res.status(500).json({ success: false, error: 'Failed to get vans' });
    }
};
exports.getVans = getVans;
// POST /api/v1/admin/vans
const createVan = async (req, res) => {
    try {
        const { plateNumber, model, driverId } = req.body;
        if (!plateNumber) {
            res.status(400).json({ success: false, error: 'plateNumber is required' });
            return;
        }
        const van = await prisma_1.default.van.create({
            data: { plateNumber, model: model || null, driverId: driverId || null },
            include: { driver: { select: { id: true, name: true, email: true } } },
        });
        res.status(201).json({ success: true, data: van });
    }
    catch (err) {
        if (err.code === 'P2002') {
            res.status(409).json({ success: false, error: 'Plate number already exists' });
        }
        else {
            console.error("CRASH IN WAREHOUSE:", err);
            res.status(500).json({ success: false, error: 'Failed to create van' });
        }
    }
};
exports.createVan = createVan;
// PATCH /api/v1/admin/vans/:id
const updateVan = async (req, res) => {
    try {
        const { id } = req.params;
        const { plateNumber, model, driverId, isActive } = req.body;
        const van = await prisma_1.default.van.update({
            where: { id },
            data: {
                ...(plateNumber !== undefined && { plateNumber }),
                ...(model !== undefined && { model }),
                ...(driverId !== undefined && { driverId: driverId || null }),
                ...(isActive !== undefined && { isActive }),
            },
            include: { driver: { select: { id: true, name: true, email: true } } },
        });
        res.json({ success: true, data: van });
    }
    catch (err) {
        if (err.code === 'P2025') {
            res.status(404).json({ success: false, error: 'Van not found' });
        }
        else {
            console.error("CRASH IN WAREHOUSE:", err);
            res.status(500).json({ success: false, error: 'Failed to update van' });
        }
    }
};
exports.updateVan = updateVan;
// DELETE /api/v1/admin/vans/:id
const deleteVan = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma_1.default.van.update({ where: { id }, data: { isActive: false } });
        res.json({ success: true, message: 'Van deactivated' });
    }
    catch (err) {
        if (err.code === 'P2025') {
            res.status(404).json({ success: false, error: 'Van not found' });
        }
        else {
            console.error("CRASH IN WAREHOUSE:", err);
            res.status(500).json({ success: false, error: 'Failed to delete van' });
        }
    }
};
exports.deleteVan = deleteVan;
// ══════════════════════════════════════════════════════════════════════════════
// USERS CRUD
// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/admin/users
const getUsers = async (_req, res) => {
    try {
        const users = await prisma_1.default.user.findMany({
            select: {
                id: true, name: true, email: true, phone: true, role: true, isActive: true, createdAt: true,
                van: { select: { id: true, plateNumber: true, model: true } },
                _count: { select: { deliveries: true, shifts: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ success: true, data: users });
    }
    catch (err) {
        console.error("CRASH IN WAREHOUSE:", err);
        res.status(500).json({ success: false, error: 'Failed to get users' });
    }
};
exports.getUsers = getUsers;
// POST /api/v1/admin/users
const createUser = async (req, res) => {
    try {
        const { name, email, phone, password, role } = req.body;
        if (!name || !email || !password) {
            res.status(400).json({ success: false, error: 'name, email, and password are required' });
            return;
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 10);
        const user = await prisma_1.default.user.create({
            data: { name, email, phone: phone || null, passwordHash, role: role || 'DRIVER' },
            select: { id: true, name: true, email: true, phone: true, role: true, isActive: true, createdAt: true },
        });
        res.status(201).json({ success: true, data: user });
    }
    catch (err) {
        if (err.code === 'P2002') {
            res.status(409).json({ success: false, error: 'Email or phone already exists' });
        }
        else {
            console.error("CRASH IN WAREHOUSE:", err);
            res.status(500).json({ success: false, error: 'Failed to create user' });
        }
    }
};
exports.createUser = createUser;
// PATCH /api/v1/admin/users/:id
const updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, phone, role, isActive, password } = req.body;
        const data = {};
        if (name !== undefined)
            data.name = name;
        if (email !== undefined)
            data.email = email;
        if (phone !== undefined)
            data.phone = phone || null;
        if (role !== undefined)
            data.role = role;
        if (isActive !== undefined)
            data.isActive = isActive;
        if (password)
            data.passwordHash = await bcryptjs_1.default.hash(password, 10);
        const user = await prisma_1.default.user.update({
            where: { id },
            data,
            select: { id: true, name: true, email: true, phone: true, role: true, isActive: true, createdAt: true },
        });
        res.json({ success: true, data: user });
    }
    catch (err) {
        if (err.code === 'P2025') {
            res.status(404).json({ success: false, error: 'User not found' });
        }
        else {
            console.error("CRASH IN WAREHOUSE:", err);
            res.status(500).json({ success: false, error: 'Failed to update user' });
        }
    }
};
exports.updateUser = updateUser;
// ══════════════════════════════════════════════════════════════════════════════
// ROUTES CRUD
// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/admin/routes
const getRoutes = async (_req, res) => {
    try {
        const routes = await prisma_1.default.route.findMany({
            include: { _count: { select: { deliveries: true, shifts: true } } },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ success: true, data: routes });
    }
    catch (err) {
        console.error("CRASH IN WAREHOUSE:", err);
        res.status(500).json({ success: false, error: 'Failed to get routes' });
    }
};
exports.getRoutes = getRoutes;
// POST /api/v1/admin/routes
const createRoute = async (req, res) => {
    try {
        const { name, area, description } = req.body;
        if (!name) {
            res.status(400).json({ success: false, error: 'name is required' });
            return;
        }
        const route = await prisma_1.default.route.create({
            data: { name, area: area || null, description: description || null },
        });
        res.status(201).json({ success: true, data: route });
    }
    catch (err) {
        console.error("CRASH IN WAREHOUSE:", err);
        res.status(500).json({ success: false, error: 'Failed to create route' });
    }
};
exports.createRoute = createRoute;
// PATCH /api/v1/admin/routes/:id
const updateRoute = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, area, description, isActive } = req.body;
        const route = await prisma_1.default.route.update({
            where: { id },
            data: {
                ...(name !== undefined && { name }),
                ...(area !== undefined && { area }),
                ...(description !== undefined && { description }),
                ...(isActive !== undefined && { isActive }),
            },
        });
        res.json({ success: true, data: route });
    }
    catch (err) {
        if (err.code === 'P2025') {
            res.status(404).json({ success: false, error: 'Route not found' });
        }
        else {
            console.error("CRASH IN WAREHOUSE:", err);
            res.status(500).json({ success: false, error: 'Failed to update route' });
        }
    }
};
exports.updateRoute = updateRoute;
// ══════════════════════════════════════════════════════════════════════════════
// SETTINGS — runtime config
// ══════════════════════════════════════════════════════════════════════════════
let runtimePrefs = {
    syncInterval: parseInt(process.env.SYNC_INTERVAL || '300'),
    maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
    timeout: parseInt(process.env.TIMEOUT || '5000'),
    autoSync: true,
    emailNotifications: false,
    smsNotifications: false,
    pushNotifications: false,
    notificationEmail: '',
};
// GET /api/v1/admin/settings
const getSettings = async (_req, res) => {
    res.json({
        success: true,
        data: {
            odooUrl: process.env.ODOO_URL || '',
            odooDatabase: process.env.ODOO_DB || '',
            odooUsername: process.env.ODOO_USERNAME || '',
            environment: process.env.NODE_ENV || 'development',
            ...runtimePrefs,
        },
    });
};
exports.getSettings = getSettings;
// GET /api/v1/admin/vans/:id/warehouse?date=YYYY-MM-DD
const getVanWarehouse = async (req, res) => {
    try {
        const { id } = req.params;
        const dateParam = req.query.date;
        // Resolve the target date (default = today)
        const targetDate = dateParam ? new Date(dateParam) : new Date();
        const dayStart = new Date(targetDate);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(targetDate);
        dayEnd.setHours(23, 59, 59, 999);
        const van = await prisma_1.default.van.findUnique({
            where: { id },
            include: {
                driver: { select: { id: true, name: true, email: true, phone: true } },
                inventory: {
                    include: { product: { select: { id: true, name: true, sku: true, unit: true, priceRetail: true, category: true } } },
                },
            },
        });
        if (!van) {
            res.status(404).json({ success: false, error: 'Van not found' });
            return;
        }
        // ── Find shifts for this van on the target day:
        //    (1) shifts that STARTED on that day, OR
        //    (2) shifts that are still ACTIVE (may have started on a previous day)
        const shifts = await prisma_1.default.shift.findMany({
            where: {
                vanId: id,
                OR: [
                    { startedAt: { gte: dayStart, lte: dayEnd } }, // started on target day
                    { status: 'ACTIVE' }, // still running (may have started earlier)
                ],
            },
            include: {
                driver: { select: { id: true, name: true } },
                route: { select: { id: true, name: true, area: true } },
            },
            orderBy: { startedAt: 'desc' },
        });
        const shiftIds = shifts.map(s => s.id);
        // Stock loaded into the van at shift start (from StockLoadQueue confirmed)
        const loadedStock = shiftIds.length > 0
            ? await prisma_1.default.stockLoadQueue.findMany({
                where: { shiftId: { in: shiftIds }, confirmed: true },
                include: { product: { select: { id: true, name: true, sku: true, unit: true, priceRetail: true, category: true } } },
            })
            : [];
        // Cash sales made by van's driver on that day
        const driverIds = [...new Set(shifts.map(s => s.driverId))];
        const cashSales = driverIds.length > 0
            ? await prisma_1.default.cashSale.findMany({
                where: { driverId: { in: driverIds }, createdAt: { gte: dayStart, lte: dayEnd } },
                include: {
                    items: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
                },
            })
            : [];
        // Deliveries completed/failed on that day
        const deliveries = driverIds.length > 0
            ? await prisma_1.default.delivery.findMany({
                where: { driverId: { in: driverIds }, updatedAt: { gte: dayStart, lte: dayEnd } },
                select: { id: true, status: true, customer: { select: { name: true } } },
            })
            : [];
        // Damaged stock adjustments made by van's driver on that day
        const adjustments = driverIds.length > 0
            ? await prisma_1.default.stockAdjustment.findMany({
                where: { driverId: { in: driverIds }, reason: 'DAMAGE', createdAt: { gte: dayStart, lte: dayEnd } },
                select: { productId: true, quantity: true }, // explicit select — avoids missing imageUrl column crash
            })
            : [];
        // Build sold-per-product map from cash sales
        const soldMap = new Map();
        for (const sale of cashSales) {
            for (const item of sale.items) {
                const existing = soldMap.get(item.productId) ?? { productId: item.productId, name: item.product.name, sku: item.product.sku, unit: item.product.unit, soldQty: 0, revenue: 0 };
                existing.soldQty += item.quantity;
                existing.revenue += item.unitPrice * item.quantity;
                soldMap.set(item.productId, existing);
            }
        }
        // Build loaded-per-product map
        const loadedMap = new Map();
        for (const item of loadedStock) {
            loadedMap.set(item.productId, (loadedMap.get(item.productId) ?? 0) + item.quantity);
        }
        // Build damaged-per-product map
        const damagedMap = new Map();
        for (const adj of adjustments) {
            damagedMap.set(adj.productId, (damagedMap.get(adj.productId) ?? 0) + Math.abs(adj.quantity));
        }
        // Current van inventory (live remaining stock)
        const currentInventory = (van.inventory ?? []).map(inv => {
            const loaded = loadedMap.get(inv.productId) ?? inv.quantity;
            const sold = soldMap.get(inv.productId);
            const damaged = damagedMap.get(inv.productId) ?? 0;
            return {
                productId: inv.productId,
                name: inv.product.name,
                sku: inv.product.sku,
                unit: inv.product.unit,
                category: inv.product.category,
                priceRetail: inv.product.priceRetail,
                loadedQty: loaded,
                remainingQty: inv.quantity,
                soldQty: sold?.soldQty ?? (loaded - inv.quantity > 0 ? loaded - inv.quantity : 0),
                damagedQty: damaged,
                revenue: sold?.revenue ?? 0,
            };
        });
        const totalLoaded = currentInventory.reduce((s, i) => s + i.loadedQty, 0);
        const totalRemaining = currentInventory.reduce((s, i) => s + i.remainingQty, 0);
        const totalSold = currentInventory.reduce((s, i) => s + i.soldQty, 0);
        const totalDamaged = currentInventory.reduce((s, i) => s + i.damagedQty, 0);
        const totalRevenue = currentInventory.reduce((s, i) => s + i.revenue, 0);
        const deliverySummary = deliveries.reduce((acc, d) => {
            acc[d.status] = (acc[d.status] ?? 0) + 1;
            return acc;
        }, {});
        res.json({
            success: true,
            data: {
                van: { id: van.id, plateNumber: van.plateNumber, model: van.model, driver: van.driver },
                date: targetDate.toISOString().split('T')[0],
                shifts: shifts.map(s => ({
                    id: s.id,
                    driver: s.driver,
                    route: s.route,
                    status: s.status,
                    startedAt: s.startedAt,
                    endedAt: s.endedAt,
                })),
                summary: {
                    totalLoaded,
                    totalSold,
                    totalDamaged,
                    totalRemaining,
                    totalRevenue,
                    deliveries: deliverySummary,
                },
                inventory: currentInventory,
            },
        });
    }
    catch (err) {
        console.error("CRASH IN WAREHOUSE:", err);
        res.status(500).json({ success: false, error: 'Failed to get van warehouse data' });
    }
};
exports.getVanWarehouse = getVanWarehouse;
// PATCH /api/v1/admin/settings
const updateSettings = async (req, res) => {
    const allowed = ['syncInterval', 'maxRetries', 'timeout', 'autoSync', 'emailNotifications', 'smsNotifications', 'pushNotifications', 'notificationEmail'];
    const updates = {};
    for (const key of allowed) {
        if (req.body[key] !== undefined)
            updates[key] = req.body[key];
    }
    runtimePrefs = { ...runtimePrefs, ...updates };
    res.json({ success: true, data: { ...runtimePrefs }, message: 'Settings updated' });
};
exports.updateSettings = updateSettings;
// ─── GET /api/v1/admin/customers ─────────────────────────────────────────────
const getCustomers = async (req, res) => {
    try {
        const { search, hasLocation } = req.query;
        const where = {};
        if (search) {
            where.OR = [
                { name: { contains: String(search), mode: 'insensitive' } },
                { phone: { contains: String(search) } },
                { address: { contains: String(search), mode: 'insensitive' } },
            ];
        }
        if (hasLocation === 'true') {
            where.lat = { not: null };
            where.lng = { not: null };
        }
        if (hasLocation === 'false') {
            where.OR = [{ lat: null }, { lng: null }];
        }
        const [customers, total] = await Promise.all([
            prisma_1.default.customer.findMany({
                where,
                orderBy: { name: 'asc' },
                select: {
                    id: true,
                    odooId: true,
                    name: true,
                    phone: true,
                    email: true,
                    address: true,
                    lat: true,
                    lng: true,
                    updatedAt: true,
                },
            }),
            prisma_1.default.customer.count({ where }),
        ]);
        res.json({ success: true, data: customers, total });
    }
    catch (err) {
        console.error("CRASH IN WAREHOUSE:", err);
        res.status(500).json({ success: false, error: 'Failed to fetch customers' });
    }
};
exports.getCustomers = getCustomers;
// ─── PATCH /api/v1/admin/customers/:id/location ──────────────────────────────
const updateCustomerLocation = async (req, res) => {
    try {
        const { id } = req.params;
        const { lat, lng } = req.body;
        if (lat === undefined || lng === undefined) {
            res.status(400).json({ success: false, error: 'lat and lng are required' });
            return;
        }
        const latNum = parseFloat(lat);
        const lngNum = parseFloat(lng);
        if (isNaN(latNum) || isNaN(lngNum)) {
            res.status(400).json({ success: false, error: 'lat and lng must be valid numbers' });
            return;
        }
        const customer = await prisma_1.default.customer.update({
            where: { id },
            data: { lat: latNum, lng: lngNum, updatedAt: new Date() },
            select: { id: true, name: true, lat: true, lng: true },
        });
        res.json({ success: true, data: customer, message: 'Customer location updated' });
    }
    catch (err) {
        console.error("CRASH IN WAREHOUSE:", err);
        res.status(500).json({ success: false, error: 'Failed to update customer location' });
    }
};
exports.updateCustomerLocation = updateCustomerLocation;
// ─── GET /api/v1/admin/leads ──────────────────────────────────────────────────
const getLeads = async (req, res) => {
    try {
        const { status, driverId, page = '1', limit = '50' } = req.query;
        const where = {};
        if (status && status !== 'all')
            where.status = status.toUpperCase();
        if (driverId)
            where.driverId = driverId;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;
        const [leads, total] = await Promise.all([
            prisma_1.default.lead.findMany({
                where,
                skip,
                take: limitNum,
                orderBy: { createdAt: 'desc' },
                include: {
                    driver: { select: { id: true, name: true, email: true } },
                    customer: { select: { id: true, name: true } },
                },
            }),
            prisma_1.default.lead.count({ where }),
        ]);
        res.json({ success: true, data: leads, total, page: pageNum, limit: limitNum });
    }
    catch (err) {
        console.error("CRASH IN WAREHOUSE:", err);
        res.status(500).json({ success: false, error: 'Failed to get leads' });
    }
};
exports.getLeads = getLeads;
// ─── PATCH /api/v1/admin/leads/:id/approve ────────────────────────────────────
const approveLead = async (req, res) => {
    try {
        const { id } = req.params;
        const lead = await prisma_1.default.lead.update({
            where: { id },
            data: { status: 'APPROVED', approvedAt: new Date() },
        });
        res.json({ success: true, data: lead, message: 'Lead approved' });
    }
    catch (err) {
        console.error("CRASH IN WAREHOUSE:", err);
        res.status(500).json({ success: false, error: 'Failed to approve lead' });
    }
};
exports.approveLead = approveLead;
// ─── PATCH /api/v1/admin/leads/:id/reject ─────────────────────────────────────
const rejectLead = async (req, res) => {
    try {
        const { id } = req.params;
        const lead = await prisma_1.default.lead.update({
            where: { id },
            data: { status: 'REJECTED', rejectedAt: new Date() },
        });
        res.json({ success: true, data: lead, message: 'Lead rejected' });
    }
    catch (err) {
        console.error("CRASH IN WAREHOUSE:", err);
        res.status(500).json({ success: false, error: 'Failed to reject lead' });
    }
};
exports.rejectLead = rejectLead;
//# sourceMappingURL=admin.controller.js.map