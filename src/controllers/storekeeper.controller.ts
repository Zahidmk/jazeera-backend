import { Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../types';

// ─── GET /api/v1/storekeeper/vans ──────────────────────────────────────────
export const getVans = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const vans = await prisma.van.findMany({
      where: { isActive: true },
      include: {
        driver: {
          select: {
            id: true,
            name: true,
          },
        },
        shifts: {
          where: { status: 'ACTIVE' },
          include: {
            driver: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { plateNumber: 'asc' },
    });

    const data = vans.map((van) => {
      const activeShift = van.shifts[0] || null;
      return {
        id: van.id,
        plateNumber: van.plateNumber,
        model: van.model,
        isActive: van.isActive,
        activeDriver: activeShift
          ? {
              id: activeShift.driver.id,
              name: activeShift.driver.name,
            }
          : van.driver
          ? {
              id: van.driver.id,
              name: van.driver.name,
            }
          : null,
        activeShift: activeShift
          ? {
              id: activeShift.id,
              startedAt: activeShift.startedAt,
            }
          : null,
      };
    });

    res.json({ success: true, data });
  } catch (err) {
    console.error('Error fetching vans for storekeeper:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch vans' });
  }
};

// ─── GET /api/v1/storekeeper/vans/:vanId/queue ─────────────────────────────
export const getVanQueue = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { vanId } = req.params;

    const shift = await prisma.shift.findFirst({
      where: { vanId, status: 'ACTIVE' },
      include: {
        driver: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { startedAt: 'desc' },
    });

    if (!shift) {
      res.status(400).json({
        success: false,
        error: 'No active shift found for this van. Please have the driver start their shift first.',
      });
      return;
    }

    const queue = await prisma.stockLoadQueue.findMany({
      where: { shiftId: shift.id },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            unit: true,
            imageUrl: true,
          },
        },
      },
      orderBy: { scannedAt: 'asc' },
    });

    res.json({
      success: true,
      data: queue,
      meta: {
        driver: {
          id: shift.driver.id,
          name: shift.driver.name,
        },
        shiftId: shift.id,
      },
    });
  } catch (err) {
    console.error('Error fetching van queue:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch van queue' });
  }
};

// ─── POST /api/v1/storekeeper/vans/:vanId/load ──────────────────────────────
export const assignVanLoad = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { vanId } = req.params;
    const { products } = req.body; // Array of { productId, quantity }

    if (!products || !Array.isArray(products)) {
      res.status(400).json({ success: false, error: 'Products list is required' });
      return;
    }

    // Find the active shift
    const shift = await prisma.shift.findFirst({
      where: { vanId, status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
    });

    if (!shift) {
      res.status(400).json({
        success: false,
        error: 'No active shift found for this van. Please have the driver start their shift first.',
      });
      return;
    }

    // Validate products list
    for (const item of products) {
      if (!item.productId || typeof item.quantity !== 'number' || item.quantity <= 0) {
        res.status(400).json({
          success: false,
          error: 'Each product must have a valid productId and a quantity greater than 0',
        });
        return;
      }
    }

    // Check if any of these products are already accepted (confirmed: true) in the active shift
    const productIds = products.map((p) => p.productId);
    const existingConfirmed = await prisma.stockLoadQueue.findMany({
      where: {
        shiftId: shift.id,
        productId: { in: productIds },
        confirmed: true,
      },
      include: {
        product: {
          select: {
            name: true,
          },
        },
      },
    });

    if (existingConfirmed.length > 0) {
      const names = existingConfirmed.map((item) => item.product.name).join(', ');
      res.status(400).json({
        success: false,
        error: `The following products have already been loaded and accepted in this shift: ${names}.`,
      });
      return;
    }

    // Transactionally update the stock load queue
    await prisma.$transaction(async (tx) => {
      // Delete existing unconfirmed (PENDING or REJECTED) queue items for this shift
      await tx.stockLoadQueue.deleteMany({
        where: {
          shiftId: shift.id,
          confirmed: false,
        },
      });

      // Insert new load queue items
      if (products.length > 0) {
        await tx.stockLoadQueue.createMany({
          data: products.map((item) => ({
            shiftId: shift.id,
            productId: item.productId,
            quantity: item.quantity,
            confirmed: false,
            status: 'PENDING',
          })),
        });
      }
    });

    res.json({ success: true, message: 'Stock load assigned successfully' });
  } catch (err) {
    console.error('Error assigning van load:', err);
    res.status(500).json({ success: false, error: 'Failed to assign stock load' });
  }
};
