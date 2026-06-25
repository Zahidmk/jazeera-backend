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
        reason: 'DAMAGE',
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
        reason: 'DAMAGE',
        createdAt: {
          gte: start,
          lt: end,
        },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            imageUrl: true,
          },
        },
        driver: {
          select: {
            id: true,
            name: true,
            van: {
              select: {
                plateNumber: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const totalDamageCount = adjustments.reduce((sum, adj) => sum + Math.abs(adj.quantity), 0);

    const items = adjustments.map((adj) => ({
      adjustmentId: adj.id,
      productId: adj.product.id,
      productName: adj.product.name,
      sku: adj.product.sku,
      productImage: adj.product.imageUrl,
      proofImage: adj.imageUrl,
      quantity: Math.abs(adj.quantity),
      vanNumber: adj.driver.van?.plateNumber || 'No Van',
      driverName: adj.driver.name,
      uploadedAt: adj.createdAt,
      reason: adj.notes || 'Damage reported',
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

    const validReasons = ['DAMAGE', 'EXPIRY', 'THEFT', 'OTHER'];
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
          productId,
          quantity: -quantity,
          reason: reason as any,
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

// ─── GET /api/v1/storekeeper/vans/:vanId/reconciliation ──────────────────────
export const getReconciliation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { vanId } = req.params;

    const shift = await prisma.shift.findFirst({
      where: { vanId, status: 'ACTIVE' },
      include: { driver: true },
      orderBy: { startedAt: 'desc' },
    });

    if (!shift) {
      res.status(400).json({
        success: false,
        error: 'No active shift found for this van. Please have the driver start their shift first.',
      });
      return;
    }

    const driverId = shift.driverId;

    const loadedQueue = await prisma.stockLoadQueue.findMany({
      where: { shiftId: shift.id, confirmed: true },
      select: { productId: true, quantity: true },
    });

    const cashSales = await prisma.cashSale.findMany({
      where: { driverId, createdAt: { gte: shift.startedAt } },
      include: { items: true },
    });

    const adjustments = await prisma.stockAdjustment.findMany({
      where: { driverId, reason: 'DAMAGE', createdAt: { gte: shift.startedAt } },
      select: { productId: true, quantity: true },
    });

    const inventory = await prisma.vanInventory.findMany({
      where: { vanId },
      include: {
        product: {
          select: { id: true, name: true, sku: true, imageUrl: true },
        },
      },
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

    const damagedMap = new Map<string, number>();
    for (const adj of adjustments) {
      damagedMap.set(adj.productId, (damagedMap.get(adj.productId) ?? 0) + Math.abs(adj.quantity));
    }

    const productDetailsList = inventory.map((inv) => {
      const p = inv.product;
      const loaded = loadedMap.get(p.id) ?? 0;
      const sold = soldMap.get(p.id) ?? 0;
      const damaged = damagedMap.get(p.id) ?? 0;
      const balance = inv.quantity;

      return {
        productId: p.id,
        productName: p.name,
        sku: p.sku,
        imageUrl: p.imageUrl,
        loadedStock: loaded,
        soldStock: sold,
        damagedStock: damaged,
        balanceStock: balance,
      };
    });

    const totalLoaded = productDetailsList.reduce((sum, item) => sum + item.loadedStock, 0);
    const totalSold = productDetailsList.reduce((sum, item) => sum + item.soldStock, 0);
    const totalDamaged = productDetailsList.reduce((sum, item) => sum + item.damagedStock, 0);
    const totalBalance = productDetailsList.reduce((sum, item) => sum + item.balanceStock, 0);

    res.json({
      success: true,
      data: {
        summary: {
          loadedStock: totalLoaded,
          soldStock: totalSold,
          damagedStock: totalDamaged,
          balanceStock: totalBalance,
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
export const submitReconciliation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { vanId } = req.params;
    const { productId, soldQuantity = 0, damagedQuantity = 0 } = req.body;

    if (!productId) {
      res.status(400).json({ success: false, error: 'productId is required' });
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

    const shift = await prisma.shift.findFirst({
      where: { vanId, status: 'ACTIVE' },
      include: { van: true },
      orderBy: { startedAt: 'desc' },
    });

    if (!shift) {
      res.status(400).json({
        success: false,
        error: 'No active shift found for this van. Please have the driver start their shift first.',
      });
      return;
    }

    const driverId = shift.driverId;

    const inventoryItem = await prisma.vanInventory.findUnique({
      where: { vanId_productId: { vanId, productId } },
      include: { product: true },
    });

    if (!inventoryItem || inventoryItem.quantity < totalToDeduct) {
      res.status(400).json({ success: false, error: 'Insufficient stock in van inventory for this reconciliation' });
      return;
    }

    const product = inventoryItem.product;

    await prisma.$transaction(async (tx) => {
      await tx.vanInventory.update({
        where: { vanId_productId: { vanId, productId } },
        data: { quantity: { decrement: totalToDeduct } },
      });

      if (soldQuantity > 0) {
        await tx.cashSale.create({
          data: {
            driverId,
            customerId: null,
            saleType: 'CASH',
            totalAmount: parseFloat((soldQuantity * product.priceRetail).toFixed(2)),
            items: {
              create: [
                {
                  productId,
                  quantity: soldQuantity,
                  unitPrice: product.priceRetail,
                },
              ],
            },
          },
        });
      }

      if (damagedQuantity > 0) {
        await tx.stockAdjustment.create({
          data: {
            driverId,
            productId,
            quantity: -damagedQuantity,
            reason: 'DAMAGE',
            notes: 'Reconciled by storekeeper',
          },
        });
      }
    });

    if (damagedQuantity > 0) {
      pushAdjustmentToOdooBackground(shift.van, productId, damagedQuantity, 'DAMAGE', 'Reconciled by storekeeper').catch((err) =>
        console.error('⚠️ Background Odoo reconciliation adjustment push failed:', err?.message)
      );
    }

    res.json({ success: true, message: 'Stock updated successfully' });
  } catch (err) {
    console.error('Error submitting reconciliation for storekeeper:', err);
    res.status(500).json({ success: false, error: 'Failed to update stock reconciliation' });
  }
};

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

