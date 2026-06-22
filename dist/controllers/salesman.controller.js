"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardStats = exports.getProducts = exports.getCustomers = exports.getVisits = exports.logVisit = exports.updateQuotationStatus = exports.submitQuotation = exports.updateQuotation = exports.getQuotationById = exports.getQuotations = exports.createQuotation = void 0;
const prisma_1 = __importDefault(require("../utils/prisma"));
const odoo_service_1 = __importDefault(require("../services/odoo/odoo.service"));
/**
 * Ensures that a customer exists in the Customer table.
 * If the customerId is not found in Customer, but is found in Lead,
 * it creates a Customer on the fly with the same ID and details,
 * and links the Lead to this Customer.
 */
async function ensureCustomerExists(customerId) {
    const customerExists = await prisma_1.default.customer.findUnique({ where: { id: customerId } });
    if (!customerExists) {
        const leadExists = await prisma_1.default.lead.findUnique({ where: { id: customerId } });
        if (leadExists) {
            await prisma_1.default.customer.create({
                data: {
                    id: leadExists.id,
                    name: leadExists.name,
                    phone: leadExists.phone,
                    address: leadExists.address,
                    lat: leadExists.lat,
                    lng: leadExists.lng,
                },
            });
            // Link the lead to the newly created customer
            await prisma_1.default.lead.update({
                where: { id: leadExists.id },
                data: { customerId: leadExists.id },
            });
            return true;
        }
        return false;
    }
    return true;
}
/**
 * Pushes an approved quotation to Odoo as a draft Sale Order.
 * Resolves or registers the customer in Odoo if needed.
 */
async function pushQuotationToOdoo(quotationId) {
    try {
        const quotation = await prisma_1.default.quotation.findUnique({
            where: { id: quotationId },
            include: {
                customer: true,
                items: {
                    include: {
                        product: { select: { odooId: true } },
                    },
                },
            },
        });
        if (!quotation) {
            console.warn(`⚠️ Odoo Quotation Push: Quotation ${quotationId} not found.`);
            return;
        }
        if (!quotation.customerId) {
            console.warn(`⚠️ Odoo Quotation Push: Quotation ${quotationId} has no customer linked.`);
            return;
        }
        let partnerOdooId = quotation.customer?.odooId ?? null;
        // If the customer has no Odoo ID locally, search Odoo or create them
        if (!partnerOdooId && quotation.customer) {
            const customerName = quotation.customer.name;
            const customerPhone = quotation.customer.phone;
            // 1. Search Odoo by phone or name
            let odooPartners = [];
            if (customerPhone) {
                odooPartners = await odoo_service_1.default.search('res.partner', [
                    ['phone', '=', customerPhone]
                ]);
            }
            if (odooPartners.length === 0) {
                odooPartners = await odoo_service_1.default.search('res.partner', [
                    ['name', '=', customerName]
                ]);
            }
            if (odooPartners.length > 0) {
                partnerOdooId = odooPartners[0];
                console.log(`ℹ️ Odoo: Found existing partner in Odoo with ID ${partnerOdooId} for ${customerName}`);
            }
            else {
                // 2. Create a new partner in Odoo
                partnerOdooId = await odoo_service_1.default.create('res.partner', {
                    name: customerName,
                    phone: customerPhone || false,
                    street: quotation.customer.address || false,
                    email: quotation.customer.email || false,
                    customer_rank: 1, // Marks them as a customer in Odoo
                });
                console.log(`✅ Odoo: Created new partner in Odoo with ID ${partnerOdooId} for ${customerName}`);
            }
            // Update our local customer record
            await prisma_1.default.customer.update({
                where: { id: quotation.customerId },
                data: { odooId: partnerOdooId },
            });
        }
        if (!partnerOdooId) {
            console.warn(`⚠️ Odoo Quotation Push: Could not resolve Odoo partner ID for customer ${quotation.customerId}`);
            return;
        }
        // Build sale order lines with Odoo product IDs
        const lines = quotation.items
            .filter(item => item.product.odooId != null)
            .map(item => {
            // requestedPrice overrides unitPrice if suggestedMode is active
            const price = (item.suggestedMode && item.requestedPrice !== null)
                ? item.requestedPrice
                : item.unitPrice;
            return {
                productId: item.product.odooId,
                qty: item.quantity,
                price,
                discount: item.discountPct,
            };
        });
        if (lines.length === 0) {
            console.warn(`⚠️ Odoo Quotation Push: No valid Odoo product IDs found in quotation ${quotationId}`);
            return;
        }
        // Pushing to Odoo as a draft Sale Order (represents a Quotation in Odoo)
        const odooQuotationId = await odoo_service_1.default.createSaleOrder(partnerOdooId, lines);
        // Update local quotation with the Odoo Sale Order ID
        await prisma_1.default.quotation.update({
            where: { id: quotationId },
            data: { odooQuotationId },
        });
        console.log(`✅ Odoo: Quotation ${quotationId} successfully synced to Odoo as draft SO ${odooQuotationId}`);
    }
    catch (err) {
        console.error(`❌ Odoo Quotation Push Error for quotation ${quotationId}:`, err?.message);
    }
}
// ─── POST /api/v1/salesman/quotations ────────────────────────────────────────
const createQuotation = async (req, res) => {
    try {
        const salesmanId = req.user.userId;
        const { customerId, remarks, items, status = 'DRAFT' } = req.body;
        if (customerId) {
            const customerExists = await ensureCustomerExists(customerId);
            if (!customerExists) {
                res.status(404).json({ success: false, error: 'Customer not found' });
                return;
            }
        }
        // Calculate total amount based on items
        let totalAmount = 0;
        const itemsData = items.map((item) => {
            const quantity = parseInt(item.quantity);
            const unitPrice = parseFloat(item.unitPrice);
            const requestedPrice = item.requestedPrice != null ? parseFloat(item.requestedPrice) : null;
            const discountPct = item.discountPct != null ? parseFloat(item.discountPct) : 0;
            const suggestedMode = !!item.suggestedMode;
            let itemPrice = unitPrice;
            if (suggestedMode && requestedPrice !== null) {
                itemPrice = requestedPrice;
            }
            else if (discountPct > 0) {
                itemPrice = unitPrice * (1 - discountPct / 100);
            }
            totalAmount += quantity * itemPrice;
            return {
                productId: item.productId,
                quantity,
                unitPrice,
                requestedPrice,
                discountPct,
                suggestedMode,
            };
        });
        const quotation = await prisma_1.default.quotation.create({
            data: {
                salesmanId,
                customerId: customerId || null,
                remarks,
                status,
                totalAmount: parseFloat(totalAmount.toFixed(2)),
                items: {
                    create: itemsData,
                },
            },
            include: {
                items: {
                    include: {
                        product: { select: { id: true, name: true, sku: true, unit: true } },
                    },
                },
                customer: { select: { id: true, name: true, phone: true, address: true } },
            },
        });
        res.status(201).json({ success: true, data: quotation });
    }
    catch (err) {
        console.error('Create Quotation Error:', err);
        res.status(500).json({ success: false, error: 'Failed to create quotation' });
    }
};
exports.createQuotation = createQuotation;
// ─── GET /api/v1/salesman/quotations ────────────────────────────────────────
const getQuotations = async (req, res) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        const { status, customerId } = req.query;
        const where = {};
        // Non-admins and non-managers can only see their own quotations
        if (userRole !== 'ADMIN' && userRole !== 'MANAGER') {
            where.salesmanId = userId;
        }
        if (status) {
            where.status = status;
        }
        if (customerId) {
            where.customerId = customerId;
        }
        const quotations = await prisma_1.default.quotation.findMany({
            where,
            include: {
                salesman: { select: { id: true, name: true, email: true } },
                customer: { select: { id: true, name: true, phone: true, address: true } },
                items: {
                    include: {
                        product: { select: { id: true, name: true, sku: true, unit: true, imageUrl: true } },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ success: true, data: quotations });
    }
    catch (err) {
        console.error('Get Quotations Error:', err);
        res.status(500).json({ success: false, error: 'Failed to retrieve quotations' });
    }
};
exports.getQuotations = getQuotations;
// ─── GET /api/v1/salesman/quotations/:id ─────────────────────────────────────
const getQuotationById = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;
        const userRole = req.user.role;
        const quotation = await prisma_1.default.quotation.findUnique({
            where: { id },
            include: {
                salesman: { select: { id: true, name: true, email: true } },
                customer: { select: { id: true, name: true, phone: true, address: true } },
                items: {
                    include: {
                        product: { select: { id: true, name: true, sku: true, unit: true, priceRetail: true, imageUrl: true } },
                    },
                },
            },
        });
        if (!quotation) {
            res.status(404).json({ success: false, error: 'Quotation not found' });
            return;
        }
        // Check permissions
        if (userRole !== 'ADMIN' && userRole !== 'MANAGER' && quotation.salesmanId !== userId) {
            res.status(403).json({ success: false, error: 'Forbidden: You do not have access to this quotation' });
            return;
        }
        res.json({ success: true, data: quotation });
    }
    catch (err) {
        console.error('Get Quotation ID Error:', err);
        res.status(500).json({ success: false, error: 'Failed to retrieve quotation' });
    }
};
exports.getQuotationById = getQuotationById;
// ─── PUT /api/v1/salesman/quotations/:id ─────────────────────────────────────
const updateQuotation = async (req, res) => {
    try {
        const { id } = req.params;
        const salesmanId = req.user.userId;
        const userRole = req.user.role;
        const { customerId, remarks, items } = req.body;
        const existingQuotation = await prisma_1.default.quotation.findUnique({
            where: { id },
            include: { items: true },
        });
        if (!existingQuotation) {
            res.status(404).json({ success: false, error: 'Quotation not found' });
            return;
        }
        // Role verification
        if (userRole !== 'ADMIN' && userRole !== 'MANAGER' && existingQuotation.salesmanId !== salesmanId) {
            res.status(403).json({ success: false, error: 'Forbidden: You do not own this quotation' });
            return;
        }
        // Can only edit DRAFT or REJECTED quotations
        if (userRole !== 'ADMIN' && userRole !== 'MANAGER' && !['DRAFT', 'REJECTED'].includes(existingQuotation.status)) {
            res.status(400).json({ success: false, error: `Cannot edit a quotation that is in ${existingQuotation.status} status` });
            return;
        }
        let updateData = { remarks };
        if (customerId) {
            const customerExists = await ensureCustomerExists(customerId);
            if (!customerExists) {
                res.status(404).json({ success: false, error: 'Customer not found' });
                return;
            }
            updateData.customerId = customerId;
        }
        // If items are provided, replace them and recalculate the total
        if (items && Array.isArray(items)) {
            let totalAmount = 0;
            const itemsData = items.map((item) => {
                const quantity = parseInt(item.quantity);
                const unitPrice = parseFloat(item.unitPrice);
                const requestedPrice = item.requestedPrice != null ? parseFloat(item.requestedPrice) : null;
                const discountPct = item.discountPct != null ? parseFloat(item.discountPct) : 0;
                const suggestedMode = !!item.suggestedMode;
                let itemPrice = unitPrice;
                if (suggestedMode && requestedPrice !== null) {
                    itemPrice = requestedPrice;
                }
                else if (discountPct > 0) {
                    itemPrice = unitPrice * (1 - discountPct / 100);
                }
                totalAmount += quantity * itemPrice;
                return {
                    productId: item.productId,
                    quantity,
                    unitPrice,
                    requestedPrice,
                    discountPct,
                    suggestedMode,
                };
            });
            updateData.totalAmount = parseFloat(totalAmount.toFixed(2));
            // Re-create items in a transaction
            const updated = await prisma_1.default.$transaction(async (tx) => {
                await tx.quotationItem.deleteMany({ where: { quotationId: id } });
                return tx.quotation.update({
                    where: { id },
                    data: {
                        ...updateData,
                        items: {
                            create: itemsData,
                        },
                    },
                    include: {
                        items: {
                            include: {
                                product: { select: { id: true, name: true, sku: true, unit: true } },
                            },
                        },
                        customer: true,
                    },
                });
            });
            res.json({ success: true, data: updated });
            return;
        }
        // If no items are updated, just update fields
        const updated = await prisma_1.default.quotation.update({
            where: { id },
            data: updateData,
            include: {
                items: {
                    include: {
                        product: { select: { id: true, name: true, sku: true, unit: true } },
                    },
                },
                customer: true,
            },
        });
        res.json({ success: true, data: updated });
    }
    catch (err) {
        console.error('Update Quotation Error:', err);
        res.status(500).json({ success: false, error: 'Failed to update quotation' });
    }
};
exports.updateQuotation = updateQuotation;
// ─── POST /api/v1/salesman/quotations/:id/submit ─────────────────────────────
const submitQuotation = async (req, res) => {
    try {
        const { id } = req.params;
        const salesmanId = req.user.userId;
        const userRole = req.user.role;
        const quotation = await prisma_1.default.quotation.findUnique({
            where: { id },
        });
        if (!quotation) {
            res.status(404).json({ success: false, error: 'Quotation not found' });
            return;
        }
        if (userRole !== 'ADMIN' && userRole !== 'MANAGER' && quotation.salesmanId !== salesmanId) {
            res.status(403).json({ success: false, error: 'Forbidden: You do not own this quotation' });
            return;
        }
        if (quotation.status !== 'DRAFT' && quotation.status !== 'REJECTED') {
            res.status(400).json({ success: false, error: `Only draft or rejected quotations can be submitted. Current status: ${quotation.status}` });
            return;
        }
        const updated = await prisma_1.default.quotation.update({
            where: { id },
            data: { status: 'SUBMITTED' },
        });
        res.json({ success: true, message: 'Quotation submitted successfully for manager approval', data: updated });
    }
    catch (err) {
        console.error('Submit Quotation Error:', err);
        res.status(500).json({ success: false, error: 'Failed to submit quotation' });
    }
};
exports.submitQuotation = submitQuotation;
// ─── PATCH /api/v1/salesman/quotations/:id/status ────────────────────────────
const updateQuotationStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, rejectionReason } = req.body;
        const quotation = await prisma_1.default.quotation.findUnique({
            where: { id },
        });
        if (!quotation) {
            res.status(404).json({ success: false, error: 'Quotation not found' });
            return;
        }
        const updateData = { status };
        if (status === 'REJECTED' && rejectionReason) {
            updateData.rejectionReason = rejectionReason;
        }
        else {
            updateData.rejectionReason = null; // Clear if approved
        }
        // Mock PDF generation if approved
        if (status === 'APPROVED') {
            updateData.pdfUrl = `/uploads/quotations/quotation_${id}.pdf`;
        }
        const updated = await prisma_1.default.quotation.update({
            where: { id },
            data: updateData,
        });
        // Sync to Odoo on approval (Option A)
        if (status === 'APPROVED') {
            pushQuotationToOdoo(id).catch((err) => console.error(`⚠️ Failed to sync approved quotation ${id} to Odoo:`, err?.message));
        }
        res.json({ success: true, message: `Quotation status updated to ${status}`, data: updated });
    }
    catch (err) {
        console.error('Update Quotation Status Error:', err);
        res.status(500).json({ success: false, error: 'Failed to update quotation status' });
    }
};
exports.updateQuotationStatus = updateQuotationStatus;
// ─── POST /api/v1/salesman/visits ────────────────────────────────────────────
const logVisit = async (req, res) => {
    try {
        const salesmanId = req.user.userId;
        const { customerId, notes, latitude, longitude } = req.body;
        if (!customerId) {
            res.status(400).json({ success: false, error: 'customerId is required' });
            return;
        }
        const customerExists = await ensureCustomerExists(customerId);
        if (!customerExists) {
            res.status(404).json({ success: false, error: 'Customer not found' });
            return;
        }
        const visit = await prisma_1.default.customerVisit.create({
            data: {
                salesmanId,
                customerId,
                notes,
                lat: latitude ? parseFloat(latitude) : null,
                lng: longitude ? parseFloat(longitude) : null,
            },
            include: {
                customer: { select: { id: true, name: true, phone: true } },
            },
        });
        res.status(201).json({ success: true, data: visit });
    }
    catch (err) {
        console.error('Log Visit Error:', err);
        res.status(500).json({ success: false, error: 'Failed to log customer visit' });
    }
};
exports.logVisit = logVisit;
// ─── GET /api/v1/salesman/visits ─────────────────────────────────────────────
const getVisits = async (req, res) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        const where = {};
        if (userRole !== 'ADMIN' && userRole !== 'MANAGER') {
            where.salesmanId = userId;
        }
        const visits = await prisma_1.default.customerVisit.findMany({
            where,
            include: {
                salesman: { select: { id: true, name: true } },
                customer: { select: { id: true, name: true, address: true, phone: true } },
            },
            orderBy: { visitedAt: 'desc' },
        });
        res.json({ success: true, data: visits });
    }
    catch (err) {
        console.error('Get Visits Error:', err);
        res.status(500).json({ success: false, error: 'Failed to retrieve visits' });
    }
};
exports.getVisits = getVisits;
// ─── GET /api/v1/salesman/customers ──────────────────────────────────────────
const getCustomers = async (req, res) => {
    try {
        const { q, search, page = '1', limit = '20' } = req.query;
        const searchQuery = String(q || search || '').trim();
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;
        const take = limitNum;
        const where = {};
        if (searchQuery) {
            where.OR = [
                { name: { contains: searchQuery, mode: 'insensitive' } },
                { phone: { contains: searchQuery, mode: 'insensitive' } },
                { address: { contains: searchQuery, mode: 'insensitive' } },
            ];
        }
        const [customers, total] = await Promise.all([
            prisma_1.default.customer.findMany({
                where,
                select: {
                    id: true,
                    odooId: true,
                    name: true,
                    phone: true,
                    email: true,
                    address: true,
                    lat: true,
                    lng: true,
                    createdAt: true,
                    updatedAt: true,
                },
                skip,
                take,
                orderBy: { name: 'asc' },
            }),
            prisma_1.default.customer.count({ where }),
        ]);
        res.json({
            success: true,
            data: customers,
            meta: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum),
            },
        });
    }
    catch (err) {
        console.error('Get Customers Error:', err);
        res.status(500).json({ success: false, error: 'Failed to retrieve customers' });
    }
};
exports.getCustomers = getCustomers;
// ─── GET /api/v1/salesman/products ───────────────────────────────────────────
const getProducts = async (req, res) => {
    try {
        const { q, search, category, page = '1', limit = '20' } = req.query;
        const searchQuery = String(q || search || '').trim();
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;
        const take = limitNum;
        const where = { isActive: true };
        if (searchQuery) {
            where.OR = [
                { name: { contains: searchQuery, mode: 'insensitive' } },
                { nameAr: { contains: searchQuery, mode: 'insensitive' } },
                { sku: { contains: searchQuery, mode: 'insensitive' } },
                { barcode: { contains: searchQuery } },
            ];
        }
        if (category) {
            where.category = category;
        }
        const [products, total] = await Promise.all([
            prisma_1.default.product.findMany({
                where,
                select: {
                    id: true,
                    odooId: true,
                    sku: true,
                    name: true,
                    nameAr: true,
                    category: true,
                    unit: true,
                    priceRetail: true,
                    priceWhole: true,
                    barcode: true,
                    imageUrl: true,
                    isActive: true,
                },
                skip,
                take,
                orderBy: { name: 'asc' },
            }),
            prisma_1.default.product.count({ where }),
        ]);
        res.json({
            success: true,
            data: products,
            meta: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum),
            },
        });
    }
    catch (err) {
        console.error('Get Products Error:', err);
        res.status(500).json({ success: false, error: 'Failed to retrieve products' });
    }
};
exports.getProducts = getProducts;
// ─── GET /api/v1/salesman/dashboard ──────────────────────────────────────────
const getDashboardStats = async (req, res) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        // Filter by the logged-in salesman, or allow admin/manager to filter by a specific salesmanId query param
        const targetSalesmanId = (userRole === 'ADMIN' || userRole === 'MANAGER') && req.query.salesmanId
            ? String(req.query.salesmanId)
            : userId;
        const [totalQuotations, pendingQuotations, draftQuotations, approvedQuotations, rejectedQuotations, customerVisits,] = await Promise.all([
            prisma_1.default.quotation.count({ where: { salesmanId: targetSalesmanId } }),
            prisma_1.default.quotation.count({ where: { salesmanId: targetSalesmanId, status: 'SUBMITTED' } }),
            prisma_1.default.quotation.count({ where: { salesmanId: targetSalesmanId, status: 'DRAFT' } }),
            prisma_1.default.quotation.count({ where: { salesmanId: targetSalesmanId, status: 'APPROVED' } }),
            prisma_1.default.quotation.count({ where: { salesmanId: targetSalesmanId, status: 'REJECTED' } }),
            prisma_1.default.customerVisit.count({ where: { salesmanId: targetSalesmanId } }),
        ]);
        res.json({
            success: true,
            data: {
                totalQuotations,
                pendingQuotations,
                draftQuotations,
                approvedQuotations,
                rejectedQuotations,
                customerVisits,
            },
        });
    }
    catch (err) {
        console.error('Get Salesman Dashboard Stats Error:', err);
        res.status(500).json({ success: false, error: 'Failed to retrieve dashboard stats' });
    }
};
exports.getDashboardStats = getDashboardStats;
//# sourceMappingURL=salesman.controller.js.map