import { Response } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../utils/prisma';
import { AuthRequest } from '../types';
import odoo from '../services/odoo/odoo.service';

// ─── Multer config for receipt upload ────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, '../../uploads/receipts')),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `receipt_${uuidv4()}${ext}`);
  },
});

export const uploadReceiptMiddleware = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|pdf/;
    const valid = allowed.test(path.extname(file.originalname).toLowerCase());
    cb(null, valid);
  },
}).single('receipt');

// In-memory cart store (per driver) — replace with Redis in production
const cartStore: Record<string, any[]> = {};

// ─── GET /api/v1/driver/sales/cart ───────────────────────────────────────────
export const getCart = async (req: AuthRequest, res: Response): Promise<void> => {
  const driverId = req.user!.userId;
  const cart = cartStore[driverId] || [];

  const total = cart.reduce((sum, item) => {
    const discounted = item.unitPrice * item.quantity * (1 - (item.discount || 0) / 100);
    return sum + discounted;
  }, 0);

  res.json({ success: true, data: { items: cart, totalAmount: parseFloat(total.toFixed(2)) } });
};

// ─── POST /api/v1/driver/sales/cart/items ────────────────────────────────────
export const addCartItem = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const driverId = req.user!.userId;
    const { productId, quantity, discount = 0 } = req.body;

    if (!productId || !quantity) {
      res.status(400).json({ success: false, error: 'productId and quantity are required' });
      return;
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, sku: true, priceRetail: true, unit: true },
    });

    if (!product) {
      res.status(404).json({ success: false, error: 'Product not found' });
      return;
    }

    if (!cartStore[driverId]) cartStore[driverId] = [];

    const existing = cartStore[driverId].find(i => i.productId === productId);
    if (existing) {
      existing.quantity += quantity;
      existing.discount = discount;
    } else {
      cartStore[driverId].push({
        id: uuidv4(),
        productId,
        name: product.name,
        sku: product.sku,
        unit: product.unit,
        unitPrice: product.priceRetail,
        quantity,
        discount,
      });
    }

    res.json({ success: true, data: cartStore[driverId] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to add item to cart' });
  }
};

// ─── PATCH /api/v1/driver/sales/cart/items/:itemId ───────────────────────────
export const updateCartItem = async (req: AuthRequest, res: Response): Promise<void> => {
  const driverId = req.user!.userId;
  const { itemId } = req.params;
  const { quantity, discount } = req.body;

  const cart = cartStore[driverId] || [];
  const item = cart.find(i => i.id === itemId);

  if (!item) {
    res.status(404).json({ success: false, error: 'Cart item not found' });
    return;
  }

  if (quantity !== undefined) item.quantity = quantity;
  if (discount !== undefined) item.discount = discount;

  res.json({ success: true, data: cart });
};

// ─── DELETE /api/v1/driver/sales/cart/items/:itemId ──────────────────────────
export const removeCartItem = async (req: AuthRequest, res: Response): Promise<void> => {
  const driverId = req.user!.userId;
  const { itemId } = req.params;

  if (!cartStore[driverId]) {
    res.status(404).json({ success: false, error: 'Cart is empty' });
    return;
  }

  cartStore[driverId] = cartStore[driverId].filter(i => i.id !== itemId);
  res.json({ success: true, data: cartStore[driverId] });
};

// ─── POST /api/v1/driver/sales/submit ────────────────────────────────────────
export const submitSale = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const driverId = req.user!.userId;
    const { customerId, saleType = 'CASH', customerName, latitude, longitude, items: bodyItems } = req.body;

    // Accept phone as string OR number (Flutter may send it as a number)
    const customerPhone = req.body.customerPhone != null ? String(req.body.customerPhone) : undefined;

    // Support two modes:
    // 1. In-memory cart (dashboard / web flow)
    // 2. Items sent directly in the body (Flutter mobile flow)
    let cart = cartStore[driverId] || [];

    if (bodyItems && Array.isArray(bodyItems) && bodyItems.length > 0) {
      // Flutter sends items directly — resolve price from DB for each product
      const resolved: any[] = [];
      for (const item of bodyItems) {
        if (!item.productId || !item.quantity || item.quantity < 1) {
          res.status(400).json({ success: false, error: `Item missing productId or quantity` });
          return;
        }
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
          select: { id: true, name: true, sku: true, priceRetail: true, unit: true },
        });
        if (!product) {
          res.status(404).json({ success: false, error: `Product ${item.productId} not found` });
          return;
        }
        resolved.push({
          id: uuidv4(),
          productId: item.productId,
          name: product.name,
          sku: product.sku,
          unit: product.unit,
          unitPrice: item.unitPrice ?? product.priceRetail,
          quantity: item.quantity,
          discount: item.discount ?? 0,
        });
      }
      cart = resolved;
    }

    if (cart.length === 0) {
      res.status(400).json({ success: false, error: 'Cart is empty. Either add items to the cart first, or include an "items" array in the request body.' });
      return;
    }

    let resolvedCustomerId: string | null = null;

    if (customerId) {
      // Verify the customerId actually exists — if not, check Lead table and convert on the fly
      let existingCustomer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
      if (!existingCustomer) {
        const leadExists = await prisma.lead.findUnique({ where: { id: customerId } });
        if (leadExists) {
          existingCustomer = await prisma.customer.create({
            data: {
              id: leadExists.id,
              name: leadExists.name,
              phone: leadExists.phone,
              address: leadExists.address,
              lat: leadExists.lat,
              lng: leadExists.lng,
            },
            select: { id: true },
          });
          await prisma.lead.update({
            where: { id: leadExists.id },
            data: { customerId: leadExists.id },
          });
        }
      }

      if (existingCustomer) {
        resolvedCustomerId = customerId;
      }
    }

    // If no valid customerId, create a walk-in customer
    if (!resolvedCustomerId) {
      const walkIn = await prisma.customer.create({
        data: { name: customerName || 'Walk-in Customer', phone: customerPhone || null },
      });
      resolvedCustomerId = walkIn.id;
    }

    const van = await prisma.van.findFirst({ where: { driverId } });
    if (!van) {
      res.status(400).json({ success: false, error: 'No van assigned to this driver' });
      return;
    }

    const totalAmount = cart.reduce((sum, item) => {
      return sum + item.unitPrice * item.quantity * (1 - (item.discount || 0) / 100);
    }, 0);

    // Create cash sale + deduct from van inventory in a transaction
    const sale = await prisma.$transaction(async (tx) => {
      const newSale = await tx.cashSale.create({
        data: {
          driverId,
          customerId: resolvedCustomerId,
          saleType,
          totalAmount: parseFloat(totalAmount.toFixed(2)),
          latitude: latitude ? parseFloat(latitude) : null,
          longitude: longitude ? parseFloat(longitude) : null,
          items: {
            create: cart.map(item => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: item.discount || 0,
            })),
          },
        },
        include: { items: true },
      });

      // Deduct from van inventory
      for (const item of cart) {
        await tx.vanInventory.updateMany({
          where: { vanId: van.id, productId: item.productId },
          data: { quantity: { decrement: item.quantity } },
        });
      }

      return newSale;
    });

    // Clear cart
    delete cartStore[driverId];

    // ── Push to Odoo (fire-and-forget — DB save must not fail if Odoo is down)
    if (resolvedCustomerId) {
      pushSaleToOdoo(sale.id, resolvedCustomerId, cart, van.id).catch((err) =>
        console.error('⚠️  Odoo sale push failed (non-blocking):', err?.message)
      );
    }

    res.status(201).json({ success: true, data: sale });
  } catch (err: any) {
    console.error('❌ submitSale error:', err?.message, err?.code, JSON.stringify(err?.meta));
    res.status(500).json({ success: false, error: 'Failed to submit sale' });
  }
};

// ─── Helper: push cash sale to Odoo — Full Flow ──────────────────────────────
// 1. Create sale order in Odoo
// 2. Confirm the sale order
// 3. Set van stock location as the delivery source (so Odoo deducts from van)
// 4. Validate the outgoing delivery picking (deducts from van inventory in Odoo)
async function pushSaleToOdoo(
  saleId: string,
  customerId: string,
  cart: any[],
  vanId: string
): Promise<void> {
  // Get the customer's odooId
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { odooId: true, name: true, phone: true, email: true, address: true },
  });

  if (!customer) {
    console.warn(`⚠️  Customer ${customerId} not found — skipping Odoo sale push`);
    return;
  }

  let partnerOdooId = customer.odooId;

  // If the customer has no Odoo ID locally, search Odoo or create them
  if (!partnerOdooId) {
    try {
      const customerName = customer.name;
      const customerPhone = customer.phone;

      // 1. Search Odoo by phone or name
      let odooPartners: number[] = [];
      if (customerPhone) {
        odooPartners = await odoo.search('res.partner', [
          ['phone', '=', customerPhone]
        ]);
      }
      if (odooPartners.length === 0) {
        odooPartners = await odoo.search('res.partner', [
          ['name', '=', customerName]
        ]);
      }

      if (odooPartners.length > 0) {
        partnerOdooId = odooPartners[0];
        console.log(`ℹ️ Odoo: Found existing partner in Odoo with ID ${partnerOdooId} for ${customerName}`);
      } else {
        // 2. Create a new partner in Odoo
        partnerOdooId = await odoo.create('res.partner', {
          name: customerName,
          phone: customerPhone || false,
          street: customer.address || false,
          email: customer.email || false,
          customer_rank: 1, // Marks them as a customer in Odoo
        });
        console.log(`✅ Odoo: Created new partner in Odoo with ID ${partnerOdooId} for ${customerName}`);
      }

      // Update our local customer record
      await prisma.customer.update({
        where: { id: customerId },
        data: { odooId: partnerOdooId },
      });
    } catch (err: any) {
      console.error(`⚠️ Odoo Partner Creation Failed for customer ${customerId}:`, err?.message);
      return; // Skip sync as we need a partner ID
    }
  }

  // Build sale order lines with Odoo product IDs
  const lines = await Promise.all(
    cart.map(async (item) => {
      const product = await prisma.product.findUnique({
        where: { id: item.productId },
        select: { odooId: true },
      });
      return {
        productId: product?.odooId ?? 0,
        qty: item.quantity,
        price: item.unitPrice,
        discount: item.discount || 0,
      };
    })
  );

  const validLines = lines.filter((l) => l.productId > 0);
  if (validLines.length === 0) {
    console.warn('⚠️  No valid Odoo product IDs found — skipping sale push');
    return;
  }

  // 1. Create the sale order in Odoo
  const saleRecord = await prisma.cashSale.findUnique({
    where: { id: saleId },
    include: { driver: true }
  });
  const employeeId = saleRecord?.driver?.odooEmployeeId || null;

  const odooSaleId = await odoo.createSaleOrder(partnerOdooId, validLines, employeeId);
  await prisma.cashSale.update({ where: { id: saleId }, data: { odooSaleId } });
  console.log(`✅ Odoo: Cash sale ${saleId} → SO created with odooSaleId: ${odooSaleId}`);

  // 2. Get the van's Odoo stock location (find/create if needed)
  const van = await prisma.van.findUnique({
    where: { id: vanId },
    select: { id: true, plateNumber: true, odooLocationId: true },
  });

  let vanLocationId = van?.odooLocationId ?? null;
  if (van && !vanLocationId) {
    vanLocationId = await odoo.findOrCreateVanLocation(van.plateNumber);
    await prisma.van.update({ where: { id: van.id }, data: { odooLocationId: vanLocationId } });
  }

  // 3. Confirm the SO and set van as the source location for the delivery
  if (vanLocationId) {
    await odoo.confirmSaleOrderWithVanLocation(odooSaleId, vanLocationId);
  } else {
    // Confirm without location override
    try { 
      await odoo.execute('sale.order', 'action_confirm', [[odooSaleId]]); 
    } catch (err: any) { 
      console.error(`⚠️ Failed to confirm Sale Order ${odooSaleId}:`, err?.message || err);
    }
  }

  // 4. Validate the outgoing delivery picking (deducts stock from Odoo)
  await odoo.validateDeliveryForSaleOrder(odooSaleId);
  console.log(`✅ Odoo: Cash sale ${saleId} fully synced — SO ${odooSaleId} confirmed and delivery validated`);
}

// ─── POST /api/v1/driver/sales/:id/receipt ───────────────────────────────────
export const uploadReceipt = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const driverId = req.user!.userId;

    if (!req.file) {
      res.status(400).json({ success: false, error: 'No file uploaded' });
      return;
    }

    const sale = await prisma.cashSale.findFirst({ where: { id, driverId } });
    if (!sale) {
      res.status(404).json({ success: false, error: 'Sale not found' });
      return;
    }

    const receiptUrl = `/uploads/receipts/${req.file.filename}`;

    const updated = await prisma.cashSale.update({
      where: { id },
      data: { receiptUrl },
    });

    res.json({ success: true, data: { receiptUrl: updated.receiptUrl } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to upload receipt' });
  }
};
