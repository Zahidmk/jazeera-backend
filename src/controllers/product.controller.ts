import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import pricing from '../services/pricing.service';

// ─── GET /api/v1/products/search ─────────────────────────────────────────────
// Pass ?customerId=<uuid|odooId> to get that shop's own price on every row.
export const searchProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const { q, category, customerId, page = '1', limit = '20' } = req.query;

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

    const data = await pricing.attachCustomerPrices(customerId as string | undefined, products);

    res.json({
      success: true,
      data,
      meta: {
        total,
        page: parseInt(page as string),
        limit: take,
        totalPages: Math.ceil(total / take),
        customerId: (customerId as string) || null,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to search products' });
  }
};

// ─── GET /api/v1/products/:productId/price?customerId= ───────────────────────
// The price this customer should be charged for one product.
export const getProductCustomerPrice = async (req: Request, res: Response): Promise<void> => {
  try {
    const { productId } = req.params;
    const { customerId } = req.query;

    if (!customerId) {
      res.status(400).json({ success: false, error: 'customerId query parameter is required' });
      return;
    }

    const resolved = await pricing.getCustomerPrice(customerId as string, String(productId));
    if (!resolved) {
      res.status(404).json({ success: false, error: 'Product not found' });
      return;
    }

    res.json({ success: true, data: resolved });
  } catch (err) {
    console.error('Get Customer Price Error:', err);
    res.status(500).json({ success: false, error: 'Failed to resolve customer price' });
  }
};

// ─── POST /api/v1/products/prices ────────────────────────────────────────────
// Batch variant — body: { customerId, productIds: [...] }. Use this when the
// app already has a cart/product list and needs all prices in one round-trip.
export const getProductCustomerPrices = async (req: Request, res: Response): Promise<void> => {
  try {
    const { customerId, productIds } = req.body;

    if (!customerId) {
      res.status(400).json({ success: false, error: 'customerId is required' });
      return;
    }
    if (!Array.isArray(productIds) || productIds.length === 0) {
      res.status(400).json({ success: false, error: 'productIds must be a non-empty array' });
      return;
    }

    const prices = await pricing.getCustomerPrices(customerId, productIds);

    res.json({
      success: true,
      data: [...prices.values()],
      meta: { customerId, requested: productIds.length, resolved: prices.size },
    });
  } catch (err) {
    console.error('Get Customer Prices Error:', err);
    res.status(500).json({ success: false, error: 'Failed to resolve customer prices' });
  }
};
