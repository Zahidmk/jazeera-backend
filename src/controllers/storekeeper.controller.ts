import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../utils/prisma';
import { AuthRequest } from '../types';
import odoo from '../services/odoo/odoo.service';

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

    const van = await prisma.van.findUnique({
      where: { id: vanId },
      include: {
        driver: {
          select: { id: true, name: true },
        },
        shifts: {
          where: { status: 'ACTIVE' },
          include: {
            driver: { select: { id: true, name: true } },
          },
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!van) {
      res.status(404).json({ success: false, error: 'Van not found' });
      return;
    }

    const activeShift = van.shifts[0];

    const queue = await prisma.stockLoadQueue.findMany({
      where: {
        vanId,
        OR: [
          { confirmed: false },
          activeShift ? { shiftId: activeShift.id, confirmed: true } : { id: 'no-match' }
        ]
      },
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
        driver: activeShift ? activeShift.driver : (van.driver || null),
        shiftId: activeShift ? activeShift.id : null,
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
    
    const shift = await prisma.shift.findFirst({
      where: { vanId, status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
    });

    if (shift) {
      const existingConfirmed = await prisma.stockLoadQueue.findMany({
        where: {
          shiftId: shift.id,
          productId: { in: productIds },
          confirmed: true,
        },
        include: {
          product: {
            select: { name: true },
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
    }

    // Transactionally update the stock load queue
    await prisma.$transaction(async (tx) => {
      // Delete existing unconfirmed (PENDING or REJECTED) queue items for this van
      await tx.stockLoadQueue.deleteMany({
        where: {
          vanId,
          confirmed: false,
        },
      });

      // Insert new load queue items
      if (products.length > 0) {
        await tx.stockLoadQueue.createMany({
          data: products.map((item) => ({
            id: uuidv4(),
            vanId,
            shiftId: null,
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

// ─── GET /api/v1/storekeeper/dashboard ─────────────────────────────────────────
export const getDashboard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    let warehouseStockCount = 0;
    try {
      const warehouseLocationId = await odoo.getWarehouseStockLocationId();
      const quants = await odoo.searchRead(
        'stock.quant',
        [['location_id', '=', warehouseLocationId]],
        ['quantity']
      );
      warehouseStockCount = Math.round(
        quants.reduce((sum: number, q: any) => sum + (q.quantity || 0), 0)
      );
    } catch (err) {
      console.error('⚠️ Failed to fetch warehouse stock count from Odoo:', err);
    }

    const activeShifts = await prisma.shift.findMany({
      where: { status: 'ACTIVE' },
      include: {
        stockQueue: true,
      },
    });

    const waitingVanCount = activeShifts.filter((shift) => {
      if (shift.stockQueue.length === 0) return true;
      return shift.stockQueue.some((item) => !item.confirmed);
    }).length;

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);

    const damagedAdjustments = await prisma.stockAdjustment.aggregate({
      where: {
        reason: { in: ['DAMAGE', 'EXPIRY', 'RETURN', 'OTHER'] },
        createdAt: {
          gte: start,
          lt: end,
        },
      },
      _sum: {
        quantity: true,
      },
    });
    const damagedStockCount = Math.abs(damagedAdjustments._sum.quantity || 0);

    res.json({
      success: true,
      data: {
        warehouseStockCount,
        waitingVanCount,
        damagedStockCount,
      },
    });
  } catch (err) {
    console.error('Error fetching dashboard statistics for storekeeper:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch dashboard data' });
  }
};

// ─── GET /api/v1/storekeeper/warehouse-stock ───────────────────────────────────
export const getWarehouseStock = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { q, page = '1', limit = '20', lowStockThreshold = '10' } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;
    const threshold = parseInt(lowStockThreshold as string);

    const products = await prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        sku: true,
        imageUrl: true,
        odooId: true,
      },
    });

    let warehouseLocationId = 8;
    let quants: any[] = [];
    try {
      warehouseLocationId = await odoo.getWarehouseStockLocationId();
      quants = await odoo.searchRead(
        'stock.quant',
        [['location_id', '=', warehouseLocationId]],
        ['product_id', 'quantity']
      );
    } catch (err) {
      console.error('⚠️ Failed to fetch quants from Odoo:', err);
    }

    const odooStockMap: Record<number, number> = {};
    for (const q of quants) {
      const odooProductId = q.product_id?.[0];
      if (odooProductId) {
        odooStockMap[odooProductId] = (odooStockMap[odooProductId] || 0) + (q.quantity || 0);
      }
    }

    let productList = products.map((p) => {
      const qty = p.odooId ? odooStockMap[p.odooId] || 0 : 0;
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        imageUrl: p.imageUrl,
        totalStock: Math.round(qty),
      };
    });

    if (q) {
      const queryStr = String(q).toLowerCase();
      productList = productList.filter(
        (p) =>
          p.name.toLowerCase().includes(queryStr) ||
          p.sku.toLowerCase().includes(queryStr)
      );
    }

    const totalSkuCount = productList.length;
    const outOfStockCount = productList.filter((p) => p.totalStock === 0).length;
    const lowStockCount = productList.filter((p) => p.totalStock > 0 && p.totalStock < threshold).length;

    const paginatedProducts = productList.slice(skip, skip + limitNum);

    res.json({
      success: true,
      data: {
        totalSkuCount,
        lowStockCount,
        outOfStockCount,
        products: paginatedProducts,
      },
      meta: {
        total: totalSkuCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalSkuCount / limitNum),
      },
    });
  } catch (err) {
    console.error('Error fetching warehouse stock for storekeeper:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch warehouse stock' });
  }
};

// ─── POST /api/v1/storekeeper/drivers/search ──────────────────────────────────
export const searchDrivers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const queryStr = String(req.body.q || req.body.searchQuery || '').trim();

    const drivers = await prisma.user.findMany({
      where: {
        role: 'DRIVER',
        isActive: true,
        OR: queryStr
          ? [
              { name: { contains: queryStr, mode: 'insensitive' } },
              {
                van: {
                  plateNumber: { contains: queryStr, mode: 'insensitive' },
                },
              },
            ]
          : undefined,
      },
      include: {
        van: {
          include: {
            stockQueue: { where: { confirmed: false } }
          }
        },
        shifts: {
          where: { status: 'ACTIVE' },
          include: {
            stockQueue: { where: { confirmed: true } }
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const data = drivers.map((driver) => {
      const activeShift = driver.shifts[0];
      const vanNumber = driver.van?.plateNumber || 'No Van';
      const unconfirmedQueue = driver.van?.stockQueue || [];
      const confirmedQueue = activeShift?.stockQueue || [];
      const queueItems = [...unconfirmedQueue, ...confirmedQueue];

      if (!activeShift && unconfirmedQueue.length === 0) {
        return {
          driverId: driver.id,
          driverName: driver.name,
          vanNumber,
          assignedDate: null,
          totalLoadedItems: 0,
          status: 'NONE',
        };
      }

      const totalLoadedItems = queueItems.reduce((sum, item) => sum + item.quantity, 0);

      let status = 'PENDING';
      if (queueItems.length > 0) {
        if (queueItems.some((item) => item.status === 'REJECTED')) {
          status = 'REJECTED';
        } else if (queueItems.every((item) => item.status === 'ACCEPTED')) {
          status = 'ACCEPTED';
        } else {
          status = 'PENDING';
        }
      } else {
        status = 'PENDING';
      }

      return {
        driverId: driver.id,
        driverName: driver.name,
        vanNumber,
        assignedDate: activeShift?.startedAt || null,
        totalLoadedItems,
        status,
      };
    });

    res.json({ success: true, data });
  } catch (err) {
    console.error('Error searching drivers for storekeeper:', err);
    res.status(500).json({ success: false, error: 'Failed to search drivers' });
  }
};

// ─── GET /api/v1/storekeeper/damaged-stock ────────────────────────────────────
export const getDamagedStock = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const dateStr = req.query.date as string;
    let start = new Date();
    start.setHours(0, 0, 0, 0);
    if (dateStr) {
      start = new Date(dateStr);
      start.setHours(0, 0, 0, 0);
    }
    const end = new Date(start);
    end.setDate(start.getDate() + 1);

    const adjustments = await prisma.stockAdjustment.findMany({
      where: {
        reason: { in: ['DAMAGE', 'EXPIRY', 'RETURN', 'OTHER'] },
        OR: [
          { createdAt: { gte: start, lt: end } },
          // Always list warehouse returns still waiting for an admin, whatever their date.
          { reason: 'RETURN', status: 'PENDING', notes: { startsWith: WAREHOUSE_RETURN_TAG } },
        ],
      },
      select: {
        id: true,
        quantity: true,
        notes: true,
        createdAt: true,
        status: true,
        imageUrl: true,
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            imageUrl: true,
          },
        },
        van: {
          select: {
            plateNumber: true,
          }
        },
        driver: {
          select: {
            id: true,
            name: true,
            van: {
              select: {
                plateNumber: true,
              }
            }
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const totalDamageCount = adjustments.reduce((sum, adj) => sum + Math.abs(adj.quantity || 0), 0);

    const items = adjustments.map((adj) => ({
      adjustmentId: adj.id,
      productId: adj.product?.id || 'Unknown',
      productName: adj.product?.name || 'Unknown',
      sku: adj.product?.sku || 'Unknown',
      productImage: adj.product?.imageUrl || null,
      proofImage: adj.imageUrl,
      quantity: Math.abs(adj.quantity || 0),
      vanNumber: adj.van?.plateNumber || adj.driver?.van?.plateNumber || 'No Van',
      driverName: adj.driver?.name || 'Unknown',
      uploadedAt: adj.createdAt,
      reason: adj.notes || 'Damage reported',
      status: adj.status,
    }));

    res.json({
      success: true,
      data: {
        reportDate: start.toISOString().split('T')[0],
        totalDamageProductCount: totalDamageCount,
        items,
      },
    });
  } catch (err) {
    console.error('Error fetching damaged stock report for storekeeper:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch damaged stock report' });
  }
};

// ─── POST /api/v1/storekeeper/damaged-stock ───────────────────────────────────
export const reportDamagedStock = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productId, vanId, quantity, reason = 'DAMAGE', notes, imageUrl } = req.body;

    if (!productId || !vanId || !quantity || quantity <= 0) {
      res.status(400).json({ success: false, error: 'productId, vanId, and a positive quantity are required' });
      return;
    }

    const validReasons = ['DAMAGE', 'EXPIRY', 'RETURN', 'OTHER'];
    if (!validReasons.includes(reason)) {
      res.status(400).json({ success: false, error: `Reason must be one of: ${validReasons.join(', ')}` });
      return;
    }

    const van = await prisma.van.findUnique({
      where: { id: vanId },
      include: {
        driver: true,
        shifts: {
          where: { status: 'ACTIVE' },
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!van) {
      res.status(404).json({ success: false, error: 'Van not found' });
      return;
    }

    const driverId = van.shifts[0]?.driverId || van.driverId;
    if (!driverId) {
      res.status(400).json({ success: false, error: 'No active driver or default driver assigned to this van' });
      return;
    }

    const inventoryItem = await prisma.vanInventory.findUnique({
      where: { vanId_productId: { vanId, productId } },
    });

    if (!inventoryItem || inventoryItem.quantity < quantity) {
      res.status(400).json({ success: false, error: 'Insufficient stock in van inventory for this adjustment' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.vanInventory.update({
        where: { vanId_productId: { vanId, productId } },
        data: { quantity: { decrement: quantity } },
      });

      await tx.stockAdjustment.create({
        data: {
          driverId,
          vanId,
          productId,
          quantity: -quantity,
          reason: reason as any,
          status: 'APPROVED',
          notes: notes || 'Damage reported by storekeeper',
          imageUrl: imageUrl || null,
        },
      });
    });

    pushAdjustmentToOdooBackground(van, productId, quantity, reason, notes).catch((err) =>
      console.error('⚠️ Background Odoo stock adjustment push failed:', err?.message)
    );

    res.json({ success: true, message: 'Report submitted successfully' });
  } catch (err) {
    console.error('Error reporting damaged stock for storekeeper:', err);
    res.status(500).json({ success: false, error: 'Failed to report damaged stock' });
  }
};

// ─── POST /api/v1/storekeeper/damaged-stock/:id/resolve ────────────────────────
export const resolveDamagedStock = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { action, notes } = req.body; // 'APPROVE' or 'REJECT'

    if (!['APPROVE', 'REJECT'].includes(action)) {
      res.status(400).json({ success: false, error: 'Invalid action. Must be APPROVE or REJECT' });
      return;
    }

    const adjustment = await prisma.stockAdjustment.findUnique({
      where: { id },
      include: {
        van: true,
      },
    });

    if (!adjustment) {
      res.status(404).json({ success: false, error: 'Stock adjustment not found' });
      return;
    }

    if (adjustment.status !== 'PENDING') {
      res.status(400).json({ success: false, error: `Adjustment is already ${adjustment.status}` });
      return;
    }

    if (isWarehouseReturn(adjustment.reason, adjustment.notes)) {
      await resolveWarehouseReturn(req, res, adjustment, action, notes);
      return;
    }

    await prisma.$transaction(async (tx) => {
      if (action === 'REJECT') {
        // Return stock to van
        if (adjustment.vanId) {
          await tx.vanInventory.upsert({
            where: { vanId_productId: { vanId: adjustment.vanId, productId: adjustment.productId } },
            update: { quantity: { increment: Math.abs(adjustment.quantity) } },
            create: { vanId: adjustment.vanId, productId: adjustment.productId, quantity: Math.abs(adjustment.quantity) },
          });
        }
        await tx.stockAdjustment.update({
          where: { id },
          data: { status: 'REJECTED', notes: notes || adjustment.notes },
        });
      } else if (action === 'APPROVE') {
        await tx.stockAdjustment.update({
          where: { id },
          data: { status: 'APPROVED', notes: notes || adjustment.notes },
        });
      }
    });

    if (action === 'APPROVE' && adjustment.van) {
      pushAdjustmentToOdooBackground(
        adjustment.van, 
        adjustment.productId, 
        Math.abs(adjustment.quantity), 
        adjustment.reason, 
        notes || adjustment.notes || ''
      ).catch((err) =>
        console.error('⚠️ Background Odoo stock adjustment push failed:', err?.message)
      );
    }

    res.json({ success: true, message: `Damaged stock ${action.toLowerCase()}d successfully` });
  } catch (err) {
    console.error('Error resolving damaged stock for storekeeper:', err);
    res.status(500).json({ success: false, error: 'Failed to resolve damaged stock' });
  }
};

// Reconciliation works on the van's active shift, or on the latest ended one so it
// can still be done after the driver has closed the shift.
async function findReconciliationShift(vanId: string) {
  const active = await prisma.shift.findFirst({
    where: { vanId, status: 'ACTIVE' },
    include: { driver: true, van: true },
    orderBy: { startedAt: 'desc' },
  });
  if (active) return active;
  return prisma.shift.findFirst({
    where: { vanId },
    include: { driver: true, van: true },
    orderBy: { startedAt: 'desc' },
  });
}

// ─── GET /api/v1/storekeeper/vans/:vanId/reconciliation ──────────────────────
export const getReconciliation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { vanId } = req.params;

    const shift = await findReconciliationShift(vanId);

    if (!shift) {
      res.status(400).json({
        success: false,
        error: 'No shift found for this van. Please have the driver start their shift first.',
      });
      return;
    }

    const driverId = shift.driverId;

    // Records made while reconciling after the shift ended are created after
    // endedAt, so the window stays open until the van's or driver's next shift.
    const [nextVanShift, nextDriverShift] = await Promise.all([
      prisma.shift.findFirst({
        where: { vanId, startedAt: { gt: shift.startedAt } },
        orderBy: { startedAt: 'asc' },
        select: { startedAt: true },
      }),
      prisma.shift.findFirst({
        where: { driverId, startedAt: { gt: shift.startedAt } },
        orderBy: { startedAt: 'asc' },
        select: { startedAt: true },
      }),
    ]);
    const windowEnd = [nextVanShift?.startedAt, nextDriverShift?.startedAt]
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const inWindow = windowEnd ? { gte: shift.startedAt, lt: windowEnd } : { gte: shift.startedAt };

    const loadedQueue = await prisma.stockLoadQueue.findMany({
      where: { shiftId: shift.id, confirmed: true },
      select: { productId: true, quantity: true },
    });

    const cashSales = await prisma.cashSale.findMany({
      where: { driverId, createdAt: inWindow },
      include: { items: true },
    });

    // Rejected adjustments were returned to the van, so they are not damage.
    const adjustments = await prisma.stockAdjustment.findMany({
      where: {
        vanId,
        reason: { in: ['DAMAGE', 'EXPIRY', 'RETURN', 'OTHER'] },
        status: { not: 'REJECTED' },
        createdAt: inWindow,
      },
      select: { productId: true, quantity: true, reason: true },
    });

    const inventory = await prisma.vanInventory.findMany({
      where: { vanId },
      select: { productId: true, quantity: true },
    });

    const loadedMap = new Map<string, number>();
    for (const item of loadedQueue) {
      loadedMap.set(item.productId, (loadedMap.get(item.productId) ?? 0) + item.quantity);
    }

    const soldMap = new Map<string, number>();
    for (const sale of cashSales) {
      for (const item of sale.items) {
        soldMap.set(item.productId, (soldMap.get(item.productId) ?? 0) + item.quantity);
      }
    }

    // Units sent back to the warehouse are tracked apart from damage.
    const damagedMap = new Map<string, number>();
    const returnedMap = new Map<string, number>();
    for (const adj of adjustments) {
      const target = adj.reason === 'RETURN' ? returnedMap : damagedMap;
      target.set(adj.productId, (target.get(adj.productId) ?? 0) + Math.abs(adj.quantity));
    }

    const balanceMap = new Map<string, number>();
    for (const inv of inventory) balanceMap.set(inv.productId, inv.quantity);

    // Include every product that moved this shift, even if its inventory row is empty.
    const productIds = new Set<string>([
      ...loadedMap.keys(),
      ...soldMap.keys(),
      ...damagedMap.keys(),
      ...returnedMap.keys(),
      ...balanceMap.keys(),
    ]);

    const products = await prisma.product.findMany({
      where: { id: { in: [...productIds] } },
      select: { id: true, name: true, sku: true, imageUrl: true },
      orderBy: { name: 'asc' },
    });

    const productDetailsList = products.map((p) => {
      const loaded = loadedMap.get(p.id) ?? 0;
      const sold = soldMap.get(p.id) ?? 0;
      const damaged = damagedMap.get(p.id) ?? 0;
      const returned = returnedMap.get(p.id) ?? 0;
      const balance = balanceMap.get(p.id) ?? 0;

      return {
        productId: p.id,
        productName: p.name,
        sku: p.sku,
        imageUrl: p.imageUrl,
        loadedStock: loaded,
        soldStock: sold,
        damagedStock: damaged,
        returnedStock: returned,
        balanceStock: balance,
        // Stock the van already held before this shift's loads. Negative means
        // units loaded this shift are unaccounted for (missing).
        openingStock: balance + sold + damaged + returned - loaded,
      };
    });

    const sum = (
      key: 'loadedStock' | 'soldStock' | 'damagedStock' | 'returnedStock' | 'balanceStock' | 'openingStock'
    ) =>
      productDetailsList.reduce((total, item) => total + item[key], 0);

    res.json({
      success: true,
      data: {
        shiftStatus: shift.status,
        summary: {
          loadedStock: sum('loadedStock'),
          soldStock: sum('soldStock'),
          damagedStock: sum('damagedStock'),
          returnedStock: sum('returnedStock'),
          balanceStock: sum('balanceStock'),
          openingStock: sum('openingStock'),
        },
        products: productDetailsList,
      },
    });
  } catch (err) {
    console.error('Error fetching reconciliation data for storekeeper:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch reconciliation data' });
  }
};

// ─── POST /api/v1/storekeeper/vans/:vanId/reconciliation ─────────────────────
// soldQuantity / damagedQuantity are ADDITIONAL units to record, not running totals.
export const submitReconciliation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { vanId } = req.params;
    const { productId } = req.body;
    const soldQuantity = req.body.soldQuantity ?? 0;
    const damagedQuantity = req.body.damagedQuantity ?? 0;

    if (!productId || typeof productId !== 'string') {
      res.status(400).json({ success: false, error: 'productId is required' });
      return;
    }

    if (!Number.isInteger(soldQuantity) || !Number.isInteger(damagedQuantity)) {
      res.status(400).json({ success: false, error: 'Quantities must be whole numbers' });
      return;
    }

    if (soldQuantity < 0 || damagedQuantity < 0) {
      res.status(400).json({ success: false, error: 'Quantities must be non-negative' });
      return;
    }

    const totalToDeduct = soldQuantity + damagedQuantity;
    if (totalToDeduct === 0) {
      res.status(400).json({ success: false, error: 'Either soldQuantity or damagedQuantity must be greater than 0' });
      return;
    }

    const shift = await findReconciliationShift(vanId);

    if (!shift) {
      res.status(400).json({
        success: false,
        error: 'No shift found for this van. Please have the driver start their shift first.',
      });
      return;
    }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      res.status(404).json({ success: false, error: 'Product not found' });
      return;
    }

    const storekeeperNote = `Reconciled by storekeeper ${req.user?.userId ?? ''}`.trim();

    const deducted = await prisma.$transaction(async (tx) => {
      // Conditional decrement keeps the stock check and the update atomic.
      const result = await tx.vanInventory.updateMany({
        where: { vanId, productId, quantity: { gte: totalToDeduct } },
        data: { quantity: { decrement: totalToDeduct } },
      });
      if (result.count === 0) return false;

      if (soldQuantity > 0) {
        await tx.cashSale.create({
          data: {
            driverId: shift.driverId,
            customerId: null,
            saleType: 'CASH',
            totalAmount: parseFloat((soldQuantity * product.priceRetail).toFixed(2)),
            items: {
              create: [{ productId, quantity: soldQuantity, unitPrice: product.priceRetail }],
            },
          },
        });
      }

      if (damagedQuantity > 0) {
        await tx.stockAdjustment.create({
          data: {
            driverId: shift.driverId,
            vanId,
            productId,
            quantity: -damagedQuantity,
            reason: 'DAMAGE',
            status: 'APPROVED',
            notes: `${storekeeperNote} (shortage treated as damage/loss)`,
          },
        });
      }
      return true;
    });

    if (!deducted) {
      res.status(400).json({ success: false, error: 'Insufficient stock in van inventory for this reconciliation' });
      return;
    }

    if (damagedQuantity > 0) {
      pushAdjustmentToOdooBackground(shift.van, productId, damagedQuantity, 'DAMAGE', storekeeperNote).catch((err) =>
        console.error('⚠️ Background Odoo reconciliation adjustment push failed:', err?.message)
      );
    }

    res.json({ success: true, message: 'Stock updated successfully' });
  } catch (err) {
    console.error('Error submitting reconciliation for storekeeper:', err);
    res.status(500).json({ success: false, error: 'Failed to update stock reconciliation' });
  }
};

// ─── Warehouse returns (van → main warehouse) ────────────────────────────────
// Stored as RETURN stock adjustments tagged in `notes`. Units leave the van as soon
// as the request is made (so they can't be sold meanwhile); the Odoo transfer is
// created when an admin or manager approves it, and a rejection restores the stock.
const WAREHOUSE_RETURN_TAG = 'Warehouse return';
const RETURN_CONDITIONS = ['GOOD', 'DAMAGED'];

function isWarehouseReturn(reason: string, notes: string | null): boolean {
  return reason === 'RETURN' && !!notes && notes.startsWith(WAREHOUSE_RETURN_TAG);
}

class ReturnStockError extends Error {
  constructor(public productId: string) {
    super('Insufficient stock');
  }
}

// ─── GET /api/v1/storekeeper/vans/:vanId/inventory ───────────────────────────
export const getVanInventory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { vanId } = req.params;

    const items = await prisma.vanInventory.findMany({
      where: { vanId, quantity: { gt: 0 } },
      include: { product: { select: { id: true, name: true, sku: true, imageUrl: true } } },
      orderBy: { product: { name: 'asc' } },
    });

    res.json({
      success: true,
      data: items.map((i) => ({
        productId: i.productId,
        productName: i.product.name,
        sku: i.product.sku,
        imageUrl: i.product.imageUrl,
        quantity: i.quantity,
      })),
    });
  } catch (err) {
    console.error('Error fetching van inventory for storekeeper:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch van inventory' });
  }
};

// ─── POST /api/v1/storekeeper/vans/:vanId/returns ────────────────────────────
// body: { items: [{ productId, quantity, condition: 'GOOD' | 'DAMAGED' }], notes? }
export const createWarehouseReturn = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { vanId } = req.params;
    const { items, notes } = req.body;

    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      res.status(400).json({ success: false, error: 'items must be a list of 1 to 50 products' });
      return;
    }

    for (const item of items) {
      if (
        !item ||
        typeof item.productId !== 'string' ||
        !Number.isInteger(item.quantity) ||
        item.quantity <= 0 ||
        !RETURN_CONDITIONS.includes(item.condition)
      ) {
        res.status(400).json({
          success: false,
          error: 'Each item needs a productId, a whole quantity above 0 and a condition of GOOD or DAMAGED',
        });
        return;
      }
    }

    const van = await prisma.van.findUnique({
      where: { id: vanId },
      include: { shifts: { orderBy: { startedAt: 'desc' }, take: 1 } },
    });

    if (!van) {
      res.status(404).json({ success: false, error: 'Van not found' });
      return;
    }

    const driverId = van.shifts[0]?.driverId || van.driverId;
    if (!driverId) {
      res.status(400).json({ success: false, error: 'No driver is assigned to this van' });
      return;
    }

    const userNotes = typeof notes === 'string' ? notes.trim().slice(0, 500) : '';

    try {
      await prisma.$transaction(async (tx) => {
        for (const item of items) {
          // Conditional decrement keeps the stock check and the update atomic.
          const result = await tx.vanInventory.updateMany({
            where: { vanId, productId: item.productId, quantity: { gte: item.quantity } },
            data: { quantity: { decrement: item.quantity } },
          });
          if (result.count === 0) throw new ReturnStockError(item.productId);

          await tx.stockAdjustment.create({
            data: {
              driverId,
              vanId,
              productId: item.productId,
              quantity: -item.quantity,
              reason: 'RETURN',
              status: 'PENDING',
              notes: `${WAREHOUSE_RETURN_TAG} (${item.condition})${userNotes ? ` - ${userNotes}` : ''}`,
            },
          });
        }
      });
    } catch (err) {
      if (err instanceof ReturnStockError) {
        const product = await prisma.product.findUnique({
          where: { id: err.productId },
          select: { name: true },
        });
        res.status(400).json({
          success: false,
          error: `Insufficient stock in the van for ${product?.name ?? 'a selected product'}`,
        });
        return;
      }
      throw err;
    }

    res.status(201).json({
      success: true,
      message: 'Return request submitted. Stock moves to the warehouse once an admin approves it.',
    });
  } catch (err) {
    console.error('Error creating warehouse return:', err);
    res.status(500).json({ success: false, error: 'Failed to submit warehouse return' });
  }
};

// ─── GET /api/v1/storekeeper/returns ─────────────────────────────────────────
export const getWarehouseReturns = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rows = await prisma.stockAdjustment.findMany({
      where: { reason: 'RETURN', notes: { startsWith: WAREHOUSE_RETURN_TAG } },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        van: { select: { plateNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        productId: r.productId,
        productName: r.product.name,
        sku: r.product.sku,
        quantity: Math.abs(r.quantity),
        condition: r.notes?.includes('(DAMAGED)') ? 'DAMAGED' : 'GOOD',
        vanNumber: r.van?.plateNumber ?? 'No Van',
        status: r.status,
        notes: r.notes,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    console.error('Error fetching warehouse returns:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch warehouse returns' });
  }
};

type PendingReturn = {
  id: string;
  vanId: string | null;
  productId: string;
  quantity: number;
  notes: string | null;
  van: { id: string; plateNumber: string; odooLocationId: number | null } | null;
};

// Approve/reject a warehouse return. Only admins and managers may resolve one.
async function resolveWarehouseReturn(
  req: AuthRequest,
  res: Response,
  adj: PendingReturn,
  action: string,
  adminNotes?: string
): Promise<void> {
  const role = req.user?.role;
  if (role !== 'ADMIN' && role !== 'MANAGER') {
    res.status(403).json({ success: false, error: 'Only an admin or manager can approve or reject warehouse returns' });
    return;
  }

  const qty = Math.abs(adj.quantity);
  const finalNotes =
    typeof adminNotes === 'string' && adminNotes.trim()
      ? `${adj.notes} | ${role}: ${adminNotes.trim().slice(0, 300)}`
      : adj.notes;

  if (action === 'REJECT') {
    const done = await prisma.$transaction(async (tx) => {
      const claimed = await tx.stockAdjustment.updateMany({
        where: { id: adj.id, status: 'PENDING' },
        data: { status: 'REJECTED', notes: finalNotes },
      });
      if (claimed.count === 0) return false;
      if (adj.vanId) {
        await tx.vanInventory.upsert({
          where: { vanId_productId: { vanId: adj.vanId, productId: adj.productId } },
          update: { quantity: { increment: qty } },
          create: { vanId: adj.vanId, productId: adj.productId, quantity: qty },
        });
      }
      return true;
    });

    if (!done) {
      res.status(400).json({ success: false, error: 'This request was already resolved' });
      return;
    }
    res.json({ success: true, message: 'Warehouse return rejected. Stock restored to the van.' });
    return;
  }

  if (!adj.van) {
    res.status(400).json({ success: false, error: 'Return has no van, cannot create the warehouse transfer' });
    return;
  }

  // Claim the request first so a double tap can't create two Odoo transfers.
  const claimed = await prisma.stockAdjustment.updateMany({
    where: { id: adj.id, status: 'PENDING' },
    data: { status: 'APPROVED', notes: finalNotes },
  });
  if (claimed.count === 0) {
    res.status(400).json({ success: false, error: 'This request was already resolved' });
    return;
  }

  try {
    await pushReturnToWarehouseOdoo(adj.van, adj.productId, qty, adj.id);
  } catch (err: any) {
    // Leave it pending so it can be approved again once Odoo is reachable.
    await prisma.stockAdjustment.updateMany({
      where: { id: adj.id },
      data: { status: 'PENDING', notes: adj.notes },
    });
    console.error('❌ Odoo warehouse return transfer failed:', err?.message);
    res.status(502).json({
      success: false,
      error: `Odoo transfer failed, the request is still pending: ${err?.message ?? 'unknown error'}`,
    });
    return;
  }

  res.json({ success: true, message: 'Warehouse return approved. Stock moved to the main warehouse.' });
}

// Internal transfer van location → main warehouse, validated immediately.
async function pushReturnToWarehouseOdoo(
  van: { id: string; plateNumber: string; odooLocationId: number | null },
  productId: string,
  qty: number,
  adjustmentId: string
): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { odooId: true, name: true },
  });

  if (!product?.odooId) {
    console.warn(`⚠️ Product ${productId} has no odooId — skipping Odoo warehouse return`);
    return;
  }

  let vanLocationId = van.odooLocationId;
  if (!vanLocationId) {
    vanLocationId = await odoo.findOrCreateVanLocation(van.plateNumber);
    await prisma.van.update({ where: { id: van.id }, data: { odooLocationId: vanLocationId } });
  }

  const warehouseLocationId = await odoo.getWarehouseStockLocationId();

  const pickingId = await odoo.createStockTransfer(
    vanLocationId,
    warehouseLocationId,
    [{ productOdooId: product.odooId, quantity: qty, productName: product.name }],
    `Return to warehouse from ${van.plateNumber} — Jazeera mobile app (${adjustmentId})`,
    'VAN-RETURN'
  );

  await odoo.validateStockPicking(pickingId);

  // button_validate can open a wizard instead of failing, so confirm it really completed.
  const [picking] = await odoo.searchRead('stock.picking', [['id', '=', pickingId]], ['state']);
  if (picking?.state !== 'done') {
    throw new Error(`transfer ${pickingId} was created in Odoo but is in state "${picking?.state ?? 'unknown'}"`);
  }

  console.log(`✅ Odoo: ${qty} × ${product.name} returned from ${van.plateNumber} to the warehouse (picking ${pickingId})`);
}

// ─── Helper: push stock adjustment to Odoo using van's Odoo location ──────────
async function pushAdjustmentToOdooBackground(
  van: { id: string; plateNumber: string; odooLocationId: number | null },
  productId: string,
  qty: number,
  reason: string,
  notes?: string
): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { odooId: true, name: true },
  });

  if (!product?.odooId) {
    console.warn(`⚠️ Product ${productId} has no odooId — skipping Odoo adjustment push`);
    return;
  }

  let vanLocationId = van.odooLocationId;
  if (!vanLocationId) {
    vanLocationId = await odoo.findOrCreateVanLocation(van.plateNumber);
    await prisma.van.update({ where: { id: van.id }, data: { odooLocationId: vanLocationId } });
  }

  const quants: any[] = await odoo.searchRead(
    'stock.quant',
    [['product_id', '=', product.odooId], ['location_id', '=', vanLocationId]],
    ['id', 'quantity'],
    { limit: 1 }
  );

  if (quants.length > 0) {
    const currentQty = quants[0].quantity ?? 0;
    const newQty = Math.max(0, currentQty - qty);
    await odoo.createInventoryAdjustment(product.odooId, vanLocationId, newQty, reason);
    console.log(`✅ Odoo: Stock adjustment for ${product.name} in van location ${vanLocationId} — ${currentQty} → ${newQty} (reason: ${reason})`);
  } else {
    console.warn(`⚠️ Odoo: No quant found for product ${product.odooId} in van location ${vanLocationId}`);
  }

  // If this is a return, we also need to add the stock back to the main warehouse
  if (reason === 'RETURN') {
    const warehouseLocationId = await odoo.getWarehouseStockLocationId();
    const warehouseQuants: any[] = await odoo.searchRead(
      'stock.quant',
      [['product_id', '=', product.odooId], ['location_id', '=', warehouseLocationId]],
      ['id', 'quantity'],
      { limit: 1 }
    );
    
    const warehouseCurrentQty = warehouseQuants.length > 0 ? (warehouseQuants[0].quantity ?? 0) : 0;
    const warehouseNewQty = warehouseCurrentQty + qty;
    
    await odoo.createInventoryAdjustment(product.odooId, warehouseLocationId, warehouseNewQty, reason);
    console.log(`✅ Odoo: Stock returned to warehouse ${warehouseLocationId} for ${product.name} — ${warehouseCurrentQty} → ${warehouseNewQty}`);
  }
}

// ─── GET /api/v1/storekeeper/drivers ──────────────────────────────────────────
export const getDriversList = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const drivers = await prisma.user.findMany({
      where: {
        role: 'DRIVER',
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        van: {
          select: {
            id: true,
            plateNumber: true,
            model: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: drivers });
  } catch (err) {
    console.error('Error fetching drivers list for storekeeper:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch drivers list' });
  }
};

