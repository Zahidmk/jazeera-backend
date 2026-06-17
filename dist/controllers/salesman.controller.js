"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVisits = exports.logVisit = exports.updateQuotationStatus = exports.submitQuotation = exports.updateQuotation = exports.getQuotationById = exports.getQuotations = exports.createQuotation = void 0;
const prisma_1 = __importDefault(require("../utils/prisma"));
// ─── POST /api/v1/salesman/quotations ────────────────────────────────────────
const createQuotation = async (req, res) => {
    try {
        const salesmanId = req.user.userId;
        const { customerId, remarks, items, status = 'DRAFT' } = req.body;
        if (customerId) {
            const customerExists = await prisma_1.default.customer.findUnique({ where: { id: customerId } });
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
            const customerExists = await prisma_1.default.customer.findUnique({ where: { id: customerId } });
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
        const customerExists = await prisma_1.default.customer.findUnique({ where: { id: customerId } });
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
//# sourceMappingURL=salesman.controller.js.map