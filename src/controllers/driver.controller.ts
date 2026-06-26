import { Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../types';
import odoo from '../services/odoo/odoo.service';

// ─── GET /api/v1/driver/home ─────────────────────────────────────────────────
export const getHome = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const driverId = req.user!.userId;

    // Today's date range (midnight → midnight, local calendar day)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [driver, vanInventory, todaySales, todayDeliveredItems] = await Promise.all([
      // Driver profile + van plate
      prisma.user.findUnique({
        where: { id: driverId },
        select: { id: true, name: true, van: { select: { plateNumber: true } } },
      }),
      // Total stock units currently on van
      prisma.vanInventory.aggregate({
        where: { van: { driverId } },
        _sum: { quantity: true },
      }),
      // Today's cash sales summary
      prisma.cashSale.aggregate({
        where: {
          driverId,
          createdAt: { gte: todayStart, lte: todayEnd },
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
      // Today's collection: sum of (unitPrice × quantity) for all DELIVERED delivery items today
      prisma.deliveryItem.findMany({
        where: {
          delivery: {
            driverId,
            status: 'DELIVERED',
            deliveredAt: { gte: todayStart, lte: todayEnd },
          },
        },
        select: { unitPrice: true, quantity: true },
      }),
    ]);

    // Collection = sum of (unitPrice × qty) across all delivered items today
    const todayCollectionAmount = todayDeliveredItems.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0
    );

    res.json({
      success: true,
      data: {
        driver: {
          name: driver?.name,
          van: driver?.van?.plateNumber ?? 'Not Assigned',
        },
        stats: {
          totalStockItems: vanInventory._sum.quantity ?? 0,
        },
        todaySummary: {
          sales: {
            count: todaySales._count,
            totalAmount: parseFloat((todaySales._sum.totalAmount ?? 0).toFixed(2)),
          },
          collection: {
            totalAmount: parseFloat(todayCollectionAmount.toFixed(2)),
          },
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to get home data' });
  }
};

// ─── GET /api/v1/driver/route ─────────────────────────────────────────────────
export const getRoute = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const driverId = req.user!.userId;

    const deliveries = await prisma.delivery.findMany({
      where: { driverId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      include: {
        customer: { select: { id: true, name: true, phone: true, address: true, lat: true, lng: true } },
        items: { include: { product: { select: { name: true, sku: true } } } },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    res.json({
      success: true,
      data: {
        stops: deliveries.map((d, index) => ({
          stopNumber: index + 1,
          deliveryId: d.id,
          status: d.status,
          customer: d.customer,
          scheduledAt: d.scheduledAt,
          itemCount: d.items.length,
        })),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to get route data' });
  }
};

// ─── GET /api/v1/driver/deliveries ───────────────────────────────────────────
export const getDeliveries = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const driverId = req.user!.userId;
    const { status, date } = req.query;

    const where: Record<string, unknown> = { driverId };
    if (status) where.status = status;
    if (date) {
      const day = new Date(date as string);
      const nextDay = new Date(day);
      nextDay.setDate(day.getDate() + 1);
      where.scheduledAt = { gte: day, lt: nextDay };
    }

    const deliveries = await prisma.delivery.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true, address: true, lat: true, lng: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, unit: true } },
          },
        },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    res.json({ success: true, data: deliveries });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to get deliveries' });
  }
};

// ─── GET /api/v1/driver/deliveries/:id ───────────────────────────────────────
export const getDeliveryById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const driverId = req.user!.userId;

    const delivery = await prisma.delivery.findFirst({
      where: { id, driverId },
      include: {
        customer: true,
        items: { include: { product: true } },
        route: { select: { name: true, area: true } },
      },
    });

    if (!delivery) {
      res.status(404).json({ success: false, error: 'Delivery not found' });
      return;
    }

    res.json({ success: true, data: delivery });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to get delivery' });
  }
};

// ─── GET /api/v1/driver/deliveries/:id/navigate ──────────────────────────────
export const getDeliveryNavigation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const driverId = req.user!.userId;

    const delivery = await prisma.delivery.findFirst({
      where: { id, driverId },
      include: {
        customer: { select: { name: true, address: true, lat: true, lng: true, phone: true } },
      },
    });

    if (!delivery) {
      res.status(404).json({ success: false, error: 'Delivery not found' });
      return;
    }

    const { customer } = delivery;

    if (!customer.lat || !customer.lng) {
      res.status(404).json({
        success: false,
        error: 'No location data available for this customer. Contact admin to update the shop location in Odoo.',
      });
      return;
    }

    // Google Maps navigation URL — opens native Maps app on the device
    const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${customer.lat},${customer.lng}&travelmode=driving`;
    // Apple Maps fallback (iOS)
    const appleMapsUrl = `http://maps.apple.com/?daddr=${customer.lat},${customer.lng}&dirflg=d`;
    // Waze fallback
    const wazeUrl = `https://waze.com/ul?ll=${customer.lat},${customer.lng}&navigate=yes`;

    res.json({
      success: true,
      data: {
        customer: {
          name: customer.name,
          address: customer.address,
          phone: customer.phone,
          latitude: customer.lat,
          longitude: customer.lng,
        },
        navigationUrls: {
          googleMaps: googleMapsUrl,
          appleMaps: appleMapsUrl,
          waze: wazeUrl,
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to get navigation data' });
  }
};

// ─── PATCH /api/v1/driver/deliveries/:id/status ──────────────────────────────
export const updateDeliveryStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const driverId = req.user!.userId;
    const { status, notes, failReason } = req.body;

    const validStatuses = ['IN_PROGRESS', 'DELIVERED', 'FAILED', 'RETURNED'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ success: false, error: `Status must be one of: ${validStatuses.join(', ')}` });
      return;
    }

    const delivery = await prisma.delivery.findFirst({
      where: { id, driverId },
      include: { items: true },
    });
    if (!delivery) {
      res.status(404).json({ success: false, error: 'Delivery not found' });
      return;
    }

    // Only deduct van stock when transitioning TO DELIVERED (not on re-update)
    const isNewlyDelivered = status === 'DELIVERED' && delivery.status !== 'DELIVERED';

    let updated;
    if (isNewlyDelivered && delivery.items.length > 0) {
      // Get the driver's van
      const van = await prisma.van.findFirst({ where: { driverId } });

      updated = await prisma.$transaction(async (tx) => {
        const result = await tx.delivery.update({
          where: { id },
          data: {
            status,
            notes: notes ?? delivery.notes,
            failReason: failReason ?? delivery.failReason,
            deliveredAt: new Date(),
          },
        });

        // Deduct each delivered item from van inventory
        if (van) {
          for (const item of delivery.items) {
            await tx.vanInventory.updateMany({
              where: { vanId: van.id, productId: item.productId },
              data: { quantity: { decrement: item.quantity } },
            });
          }
          console.log(`📦 Van inventory updated: deducted ${delivery.items.length} product(s) for delivery ${id}`);
        }

        return result;
      });
    } else {
      updated = await prisma.delivery.update({
        where: { id },
        data: {
          status,
          notes: notes ?? delivery.notes,
          failReason: failReason ?? delivery.failReason,
          deliveredAt: status === 'DELIVERED' ? new Date() : delivery.deliveredAt,
        },
      });
    }

    // ── Push status to Odoo if linked to an Odoo order (fire-and-forget)
    if (delivery.odooOrderId && (status === 'DELIVERED' || status === 'FAILED')) {
      pushDeliveryStatusToOdoo(delivery.odooOrderId, status, notes).catch((err) =>
        console.error(`⚠️  Failed to update Odoo order ${delivery.odooOrderId}:`, err?.message)
      );
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to update delivery status' });
  }
};

/**
 * Push delivery status to Odoo:
 * - DELIVERED: validate the outgoing stock.picking (deducts van inventory in Odoo)
 * - FAILED:    cancel the sale order
 */
async function pushDeliveryStatusToOdoo(
  odooOrderId: number,
  status: string,
  notes?: string
): Promise<void> {
  if (status === 'DELIVERED') {
    // Validate the outgoing delivery picking — this deducts stock from Odoo
    await odoo.validateDeliveryForSaleOrder(odooOrderId);
    console.log(`✅ Odoo: Delivery picking validated for SO ${odooOrderId}`);
  } else if (status === 'FAILED') {
    // Cancel the sale order
    await odoo.updateSaleOrderStatus(odooOrderId, 'FAILED', notes);
    console.log(`✅ Odoo: SO ${odooOrderId} cancelled (delivery failed)`);
  }
}

// ─── GET /api/v1/driver/stock/queue ──────────────────────────────────────────
export const getStockQueue = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const driverId = req.user!.userId;

    const shift = await prisma.shift.findFirst({
      where: { driverId, status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
    });

    if (!shift) {
      res.json({ success: true, data: [] });
      return;
    }

    const queue = await prisma.stockLoadQueue.findMany({
      where: { vanId: shift.vanId, confirmed: false },
      include: { product: { select: { id: true, name: true, sku: true, unit: true, imageUrl: true } } },
    });

    res.json({ success: true, data: queue });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to get stock queue' });
  }
};

// ─── POST /api/v1/driver/stock/confirm ───────────────────────────────────────
export const confirmStockLoad = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const driverId = req.user!.userId;

    const shift = await prisma.shift.findFirst({
      where: { driverId, status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
      include: { van: true },
    });

    if (!shift || !shift.van) {
      res.status(400).json({ success: false, error: 'No active shift or van found' });
      return;
    }

    const queueItems = await prisma.stockLoadQueue.findMany({
      where: { vanId: shift.vanId, confirmed: false },
      include: { product: { select: { id: true, name: true, odooId: true } } },
    });

    if (queueItems.length === 0) {
      res.status(400).json({ success: false, error: 'No items in queue to confirm' });
      return;
    }

    // Upsert into van inventory and mark queue as confirmed
    await prisma.$transaction(async (tx) => {
      for (const item of queueItems) {
        await tx.vanInventory.upsert({
          where: { vanId_productId: { vanId: shift.vanId, productId: item.productId } },
          update: { quantity: { increment: item.quantity } },
          create: { vanId: shift.vanId, productId: item.productId, quantity: item.quantity },
        });
      }
      await tx.stockLoadQueue.updateMany({
        where: { vanId: shift.vanId, confirmed: false },
        data: { confirmed: true, status: 'ACCEPTED', shiftId: shift.id },
      });
    });

    res.json({ success: true, message: `${queueItems.length} items loaded into van successfully` });

    // ── Push to Odoo: create internal transfer warehouse → van location (fire-and-forget)
    pushVanLoadToOdoo(shift.van, queueItems).catch((err) =>
      console.error('⚠️  Odoo van stock transfer failed (non-blocking):', err?.message)
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to confirm stock load' });
  }
};

// ─── POST /api/v1/driver/stock/reject ────────────────────────────────────────
export const rejectStockLoad = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const driverId = req.user!.userId;
    const { notes } = req.body;

    const shift = await prisma.shift.findFirst({
      where: { driverId, status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
    });

    if (!shift) {
      res.status(400).json({ success: false, error: 'No active shift found' });
      return;
    }

    const queueItems = await prisma.stockLoadQueue.findMany({
      where: { vanId: shift.vanId, confirmed: false },
    });

    if (queueItems.length === 0) {
      res.status(400).json({ success: false, error: 'No pending items in queue to reject' });
      return;
    }

    await prisma.stockLoadQueue.updateMany({
      where: { vanId: shift.vanId, confirmed: false },
      data: {
        status: 'REJECTED',
        notes: notes || null,
      },
    });

    res.json({ success: true, message: 'Stock load rejected successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to reject stock load' });
  }
};

/**
 * Push van stock load to Odoo as an internal transfer:
 * Main Warehouse/Stock → Van Location
 * Also saves the van's Odoo location ID for future use.
 */
async function pushVanLoadToOdoo(
  van: { id: string; plateNumber: string; odooLocationId: number | null },
  items: { product: { odooId: number | null; name: string }; quantity: number }[]
): Promise<void> {
  // Filter to only items that have an Odoo product ID
  const odooItems = items.filter(i => i.product.odooId != null);
  if (odooItems.length === 0) {
    console.warn('⚠️  Odoo van load: no items have odooId — skipping transfer');
    return;
  }

  // 1. Ensure the van has a stock location in Odoo
  let vanLocationId = van.odooLocationId;
  if (!vanLocationId) {
    vanLocationId = await odoo.findOrCreateVanLocation(van.plateNumber);
    await prisma.van.update({
      where: { id: van.id },
      data: { odooLocationId: vanLocationId },
    });
  }

  // 2. Get the main warehouse stock location
  const warehouseLocationId = await odoo.getWarehouseStockLocationId();

  // 3. Create an internal transfer picking
  const pickingId = await odoo.createStockTransfer(
    warehouseLocationId,
    vanLocationId,
    odooItems.map(i => ({
      productOdooId: i.product.odooId!,
      quantity: i.quantity,
      productName: i.product.name,
    })),
    `Van load for ${van.plateNumber} — Jazeera mobile app`
  );

  // 4. Validate the picking (immediately transfer stock)
  await odoo.validateStockPicking(pickingId);

  console.log(`✅ Odoo: Van stock load completed — ${odooItems.length} product(s) transferred to van location ${vanLocationId}`);
}

// ─── GET /api/v1/driver/van/inventory ────────────────────────────────────────
export const getVanInventory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const driverId = req.user!.userId;

    const van = await prisma.van.findFirst({ where: { driverId } });
    if (!van) {
      res.status(404).json({ success: false, error: 'No van assigned to this driver' });
      return;
    }

    const inventory = await prisma.vanInventory.findMany({
      where: { vanId: van.id },
      include: {
        product: {
          select: { id: true, name: true, nameAr: true, sku: true, unit: true, category: true, priceRetail: true, imageUrl: true },
        },
      },
      orderBy: { product: { name: 'asc' } },
    });

    res.json({
      success: true,
      data: {
        van: { id: van.id, plateNumber: van.plateNumber },
        items: inventory.map(i => ({
          id: i.id,
          quantity: i.quantity,
          ...i.product,
        })),
        totalItems: inventory.length,
        totalUnits: inventory.reduce((sum, i) => sum + i.quantity, 0),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to get van inventory' });
  }
};

// ─── POST /api/v1/driver/stock/adjust ────────────────────────────────────────
export const adjustStock = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const driverId = req.user!.userId;
    const { productId, quantity, reason, notes } = req.body;

    const validReasons = ['DAMAGE', 'EXPIRY', 'THEFT', 'OTHER'];
    if (!validReasons.includes(reason)) {
      res.status(400).json({ success: false, error: `Reason must be one of: ${validReasons.join(', ')}` });
      return;
    }

    const van = await prisma.van.findFirst({ where: { driverId } });
    if (!van) {
      res.status(404).json({ success: false, error: 'No van assigned to this driver' });
      return;
    }

    const inventoryItem = await prisma.vanInventory.findUnique({
      where: { vanId_productId: { vanId: van.id, productId } },
    });

    if (!inventoryItem || inventoryItem.quantity < Math.abs(quantity)) {
      res.status(400).json({ success: false, error: 'Insufficient stock for this adjustment' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.vanInventory.update({
        where: { vanId_productId: { vanId: van.id, productId } },
        data: { quantity: { decrement: Math.abs(quantity) } },
      });
      await tx.stockAdjustment.create({
        data: { driverId, productId, quantity: -Math.abs(quantity), reason, notes },
      });
    });

    // ── Push stock adjustment to Odoo (fire-and-forget) — use van's Odoo location
    pushAdjustmentToOdoo(van, productId, Math.abs(quantity), reason, notes).catch((err) =>
      console.error('⚠️  Odoo stock adjustment push failed (non-blocking):', err?.message)
    );

    res.json({ success: true, message: 'Stock adjustment recorded successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to adjust stock' });
  }
};

// ─── GET /api/v1/driver/customers/search?q=xxx ───────────────────────────────
export const searchCustomers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const q = String(req.query.q || '').trim();

    const customers = await prisma.customer.findMany({
      where: q
        ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
            { address: { contains: q, mode: 'insensitive' } },
          ],
        }
        : undefined,
      select: { id: true, name: true, phone: true, address: true },
      orderBy: { name: 'asc' },
      take: 30,
    });

    res.json({ success: true, data: customers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to search customers' });
  }
};

// ─── POST /api/v1/driver/leads ───────────────────────────────────────────────
export const addLead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const driverId = req.user!.userId;
    const { name, address, notes, latitude, longitude } = req.body;

    // Accept phone as string OR number (Flutter may send it as a number)
    const phone = req.body.phone != null ? String(req.body.phone) : undefined;

    console.log('📝 addLead called with:', { driverId, name, phone, address, notes, latitude, longitude });

    if (!name) {
      console.error('❌ Missing customer name');
      res.status(400).json({ success: false, error: 'Customer name is required' });
      return;
    }

    try {
      const latVal = latitude != null ? parseFloat(String(latitude)) : null;
      const lngVal = longitude != null ? parseFloat(String(longitude)) : null;

      const lead = await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.create({
          data: {
            name,
            phone: phone || null,
            address: address || null,
            lat: latVal,
            lng: lngVal,
          },
        });

        return tx.lead.create({
          data: {
            id: customer.id,
            driverId,
            customerId: customer.id,
            name,
            phone: phone || null,
            address: address || null,
            notes: notes || null,
            lat: latVal,
            lng: lngVal,
          },
        });
      });

      console.log('✅ Lead and Customer created:', lead);

      // ── Push to Odoo CRM (fire-and-forget — DB save must not fail if Odoo is down)
      pushLeadToOdoo(lead.id, { name, phone, street: address, description: notes }).catch((err) =>
        console.error('⚠️  Odoo lead push failed (non-blocking):', err?.message)
      );

      res.status(201).json({ success: true, data: lead });
    } catch (dbErr: any) {
      console.error('❌ Prisma error creating lead:', dbErr?.message);
      console.error('❌ Prisma error code:', dbErr?.code);
      console.error('❌ Prisma error meta:', JSON.stringify(dbErr?.meta, null, 2));
      throw dbErr;
    }
  } catch (err: any) {
    console.error('❌ addLead error:', err?.message, err?.code);
    console.error('❌ Full error:', JSON.stringify(err, null, 2));
    res.status(500).json({ success: false, error: 'Failed to add lead', details: err?.message });
  }
};

// ─── Helper: push lead to Odoo CRM & save odooLeadId ─────────────────────────
async function pushLeadToOdoo(
  leadId: string,
  data: { name: string; phone?: string; street?: string; description?: string }
): Promise<void> {
  const odooLeadId = await odoo.createLead(data);

  await prisma.lead.update({
    where: { id: leadId },
    data: { odooLeadId },
  });

  console.log(`✅ Lead ${leadId} pushed to Odoo CRM — odooLeadId: ${odooLeadId}`);
}

// ─── GET /api/v1/driver/shift/summary ────────────────────────────────────────
export const getShiftSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const driverId = req.user!.userId;

    const shift = await prisma.shift.findFirst({
      where: { driverId, status: 'ACTIVE' },
    });

    if (!shift) {
      res.status(400).json({ success: false, error: 'No active shift found' });
      return;
    }

    const [deliveries, cashSales, van] = await Promise.all([
      prisma.delivery.groupBy({
        by: ['status'],
        where: { driverId },
        _count: { status: true },
      }),
      prisma.cashSale.aggregate({
        where: { driverId, createdAt: { gte: shift.startedAt } },
        _sum: { totalAmount: true },
        _count: true,
      }),
      prisma.vanInventory.findMany({
        where: { vanId: shift.vanId },
        include: { product: { select: { name: true, sku: true } } },
      }),
    ]);

    const deliverySummary = deliveries.reduce((acc, d) => {
      acc[d.status] = d._count.status;
      return acc;
    }, {} as Record<string, number>);

    res.json({
      success: true,
      data: {
        shiftId: shift.id,
        startedAt: shift.startedAt,
        deliveries: deliverySummary,
        cashSales: {
          count: cashSales._count,
          totalAmount: cashSales._sum.totalAmount ?? 0,
        },
        remainingInventory: van.map(v => ({
          product: v.product.name,
          sku: v.product.sku,
          quantity: v.quantity,
        })),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to get shift summary' });
  }
};

// ─── POST /api/v1/driver/shift/end ───────────────────────────────────────────
export const startShift = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const driverId = req.user!.userId;
    const { vanId } = req.body;

    if (!vanId) {
      res.status(400).json({ success: false, error: 'vanId is required' });
      return;
    }

    // Check if driver already has an active shift
    const existingShift = await prisma.shift.findFirst({
      where: { driverId, status: 'ACTIVE' },
    });

    if (existingShift) {
      res.status(400).json({ success: false, error: 'You already have an active shift. Please end it before starting a new one.' });
      return;
    }

    // Verify the van exists
    const van = await prisma.van.findUnique({ where: { id: vanId } });
    if (!van) {
      res.status(404).json({ success: false, error: 'Van not found' });
      return;
    }

    const shift = await prisma.shift.create({
      data: {
        driverId,
        vanId,
        status: 'ACTIVE',
        startedAt: new Date(),
      },
    });

    res.status(201).json({
      success: true,
      data: {
        shiftId: shift.id,
        vanId: shift.vanId,
        startedAt: shift.startedAt,
        status: shift.status,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to start shift' });
  }
};

export const endShift = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const driverId = req.user!.userId;
    const { notes } = req.body;

    const shift = await prisma.shift.findFirst({
      where: { driverId, status: 'ACTIVE' },
      include: {
        van: true,
        stockQueue: { include: { product: { select: { name: true } } } },
      },
    });

    if (!shift) {
      res.status(400).json({ success: false, error: 'No active shift to end' });
      return;
    }

    // Get end-of-shift summary
    const [deliveries, cashSales, van] = await Promise.all([
      prisma.delivery.groupBy({
        by: ['status'],
        where: { driverId },
        _count: { status: true },
      }),
      prisma.cashSale.aggregate({
        where: { driverId, createdAt: { gte: shift.startedAt } },
        _sum: { totalAmount: true },
        _count: true,
      }),
      prisma.vanInventory.findMany({
        where: { vanId: shift.vanId },
        include: { product: { select: { name: true, sku: true } } },
      }),
    ]);

    await prisma.shift.update({
      where: { id: shift.id },
      data: { status: 'ENDED', endedAt: new Date(), notes },
    });

    const deliverySummary = deliveries.reduce((acc, d) => {
      acc[d.status] = d._count.status;
      return acc;
    }, {} as Record<string, number>);

    res.json({
      success: true,
      data: {
        shiftId: shift.id,
        startedAt: shift.startedAt,
        endedAt: new Date(),
        deliveries: deliverySummary,
        cashSales: {
          count: cashSales._count,
          totalAmount: cashSales._sum.totalAmount ?? 0,
        },
        remainingInventory: van.map(v => ({
          product: v.product.name,
          sku: v.product.sku,
          quantity: v.quantity,
        })),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to end shift' });
  }
};

// ─── Helper: push stock adjustment to Odoo using van's Odoo location ──────────
async function pushAdjustmentToOdoo(
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
    console.warn(`⚠️  Product ${productId} has no odooId — skipping Odoo adjustment push`);
    return;
  }

  // Ensure the van has a stock location in Odoo
  let vanLocationId = van.odooLocationId;
  if (!vanLocationId) {
    vanLocationId = await odoo.findOrCreateVanLocation(van.plateNumber);
    await prisma.van.update({ where: { id: van.id }, data: { odooLocationId: vanLocationId } });
  }

  // Get current van quant quantity and adjust down
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
    console.warn(`⚠️  Odoo: No quant found for product ${product.odooId} in van location ${vanLocationId}`);
  }
}
