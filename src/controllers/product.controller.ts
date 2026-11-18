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
    // A brand / top-level category also matches its sub-categories ("SWEET HOME" -> "SWEET HOME / KITCHEN TOOLS")
    if (category) {
      where.AND = [{ OR: [{ category: category as string }, { category: { startsWith: `${category} / ` } }] }];
    }

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

// ─── GET /api/v1/products/categories ─────────────────────────────────────────
// Top-level categories (brands) with product counts, for the app's filter chips.
// Odoo categories look like "SWEET HOME / KITCHEN TOOLS"; the part before the first " / " is the group.
export const getProductCategories = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.product.groupBy({ by: ['category'], where: { isActive: true }, _count: { _all: true } });
    const groups = new Map<string, number>();
    for (const r of rows) {
      const top = (r.category || '').split(' / ')[0].trim();
      if (!top) continue;
      groups.set(top, (groups.get(top) ?? 0) + r._count._all);
    }
    const data = [...groups.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to load categories' });
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
// Batch variant — body: { customerId, productIds } or { customerId, productOdooIds }.
// Use this when the caller already has a cart/product list and needs all prices
// in one round-trip. Mobile apps hold local UUIDs; the dashboard holds Odoo ids,
// so either identifier is accepted and every row carries both back.
export const getProductCustomerPrices = async (req: Request, res: Response): Promise<void> => {
  try {
    const { customerId, productIds, productOdooIds } = req.body;

    if (!customerId) {
      res.status(400).json({ success: false, error: 'customerId is required' });
      return;
    }

    const hasUuids = Array.isArray(productIds) && productIds.length > 0;
    const hasOdooIds = Array.isArray(productOdooIds) && productOdooIds.length > 0;

    if (!hasUuids && !hasOdooIds) {
      res.status(400).json({
        success: false,
        error: 'Provide a non-empty productIds (UUIDs) or productOdooIds (Odoo product ids) array',
      });
      return;
    }

    const prices = hasUuids
      ? await pricing.getCustomerPrices(customerId, productIds)
      : await pricing.getCustomerPricesByOdooIds(
          customerId,
          productOdooIds.map((id: any) => Number(id))
        );

    res.json({
      success: true,
      data: [...prices.values()],
      meta: {
        customerId,
        requested: hasUuids ? productIds.length : productOdooIds.length,
        resolved: prices.size,
        keyedBy: hasUuids ? 'productId' : 'odooId',
      },
    });
  } catch (err) {
    console.error('Get Customer Prices Error:', err);
    res.status(500).json({ success: false, error: 'Failed to resolve customer prices' });
  }
};
