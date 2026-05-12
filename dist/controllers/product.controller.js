"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchProducts = void 0;
const prisma_1 = __importDefault(require("../utils/prisma"));
// ─── GET /api/v1/products/search ─────────────────────────────────────────────
const searchProducts = async (req, res) => {
    try {
        const { q, category, page = '1', limit = '20' } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);
        const where = { isActive: true };
        if (q) {
            where.OR = [
                { name: { contains: q, mode: 'insensitive' } },
                { nameAr: { contains: q, mode: 'insensitive' } },
                { sku: { contains: q, mode: 'insensitive' } },
                { barcode: { contains: q } },
            ];
        }
        if (category)
            where.category = category;
        const [products, total] = await Promise.all([
            prisma_1.default.product.findMany({
                where,
                select: {
                    id: true, name: true, nameAr: true, sku: true, barcode: true,
                    category: true, unit: true, priceRetail: true, priceWhole: true, imageUrl: true,
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
                page: parseInt(page),
                limit: take,
                totalPages: Math.ceil(total / take),
            },
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Failed to search products' });
    }
};
exports.searchProducts = searchProducts;
//# sourceMappingURL=product.controller.js.map