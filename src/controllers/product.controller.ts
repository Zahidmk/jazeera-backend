import { Request, Response } from 'express';
import prisma from '../utils/prisma';

// ─── GET /api/v1/products/search ─────────────────────────────────────────────
export const searchProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const { q, category, page = '1', limit = '20' } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const where: any = { isActive: true };
    if (q) {
      where.OR = [
        { name: { contains: q as string, mode: 'insensitive' } },
        { nameAr: { contains: q as string, mode: 'insensitive' } },
        { sku: { contains: q as string, mode: 'insensitive' } },
        { barcode: { contains: q as string } },
      ];
    }
    if (category) where.category = category;

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select: {
          id: true, name: true, nameAr: true, sku: true, barcode: true,
          category: true, unit: true, priceRetail: true, priceWhole: true, imageUrl: true,
        },
        skip,
        take,
        orderBy: { name: 'asc' },
      }),
      prisma.product.count({ where }),
    ]);

    res.json({
      success: true,
      data: products,
      meta: {
        total,
        page: parseInt(page as string),
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to search products' });
  }
};
