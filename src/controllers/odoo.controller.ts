import { Request, Response } from 'express';
import odoo from '../services/odoo/odoo.service';

// ─── GET /api/v1/odoo/products ─────────────────────────────────────────────
// Fetch all products directly from Odoo (no DB sync needed)
export const getOdooProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseInt((req.query.limit as string) || '500');
    const products = await odoo.fetchProducts(limit);

    const mapped = products.map((p: any) => ({
      id: p.id,
      name: p.name,
      sku: p.default_code || `ODOO-${p.id}`,
      barcode: p.barcode || null,
      category: p.categ_id ? p.categ_id[1] : null,
      unit: p.uom_id ? p.uom_id[1] : 'pcs',
      priceRetail: p.list_price || 0,
      priceWhole: p.standard_price || 0,
      qtyAvailable: p.qty_available || 0,
      imageUrl: p.image_128 ? `data:image/png;base64,${p.image_128}` : null,
      isActive: p.active !== false,
    }));

    res.json({
      success: true,
      data: mapped,
      meta: { total: mapped.length },
    });
  } catch (err: any) {
    console.error('Odoo products fetch error:', err);
    res.status(500).json({ success: false, error: `Failed to fetch products from Odoo: ${err.message}` });
  }
};

// ─── GET /api/v1/odoo/orders ───────────────────────────────────────────────
// Fetch sale orders directly from Odoo
export const getOdooOrders = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseInt((req.query.limit as string) || '200');
    const orders = await odoo.fetchSaleOrders(limit);

    // Fetch order lines for all orders in one batch
    const allLineIds = orders.flatMap((o: any) => o.order_line || []);
    let linesMap: Record<number, any[]> = {};

    if (allLineIds.length > 0) {
      const lines = await odoo.fetchOrderLines(allLineIds);
      for (const line of lines) {
        const orderId = line.order_id?.[0];
        if (orderId) {
          if (!linesMap[orderId]) linesMap[orderId] = [];
          linesMap[orderId].push(line);
        }
      }
      // If order_id not returned, group by order.order_line
      for (const order of orders) {
        linesMap[order.id] = lines.filter((l: any) => (order.order_line || []).includes(l.id));
      }
    }

    const mapped = orders.map((o: any) => {
      const lines = linesMap[o.id] || [];
      const items = lines.map((l: any) => ({
        productId: l.product_id?.[0] || null,
        productName: l.product_id?.[1] || 'Unknown',
        qty: l.product_uom_qty || 0,
        unitPrice: l.price_unit || 0,
        subtotal: l.price_subtotal || 0,
      }));

      return {
        id: o.id,
        orderNumber: o.name,
        customerName: o.partner_id?.[1] || 'Unknown Customer',
        customerId: o.partner_id?.[0] || null,
        dateOrder: o.date_order,
        state: o.state,
        totalAmount: o.amount_total || 0,
        items,
      };
    });

    res.json({
      success: true,
      data: mapped,
      meta: { total: mapped.length },
    });
  } catch (err: any) {
    console.error('Odoo orders fetch error:', err);
    res.status(500).json({ success: false, error: `Failed to fetch orders from Odoo: ${err.message}` });
  }
};

// ─── GET /api/v1/odoo/customers ────────────────────────────────────────────
// Fetch customers directly from Odoo
export const getOdooCustomers = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseInt((req.query.limit as string) || '500');
    const customers = await odoo.fetchCustomers(limit);

    const mapped = customers.map((c: any) => ({
      id: c.id,
      name: c.name,
      phone: c.mobile || c.phone || null,
      email: c.email || null,
      address: [c.street, c.street2, c.city].filter(Boolean).join(', ') || null,
      lat: c.partner_latitude || null,
      lng: c.partner_longitude || null,
    }));

    res.json({
      success: true,
      data: mapped,
      meta: { total: mapped.length },
    });
  } catch (err: any) {
    console.error('Odoo customers fetch error:', err);
    res.status(500).json({ success: false, error: `Failed to fetch customers from Odoo: ${err.message}` });
  }
};

// ─── GET /api/v1/odoo/stock ────────────────────────────────────────────────
// Fetch warehouse stock quants directly from Odoo
export const getOdooStock = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseInt((req.query.limit as string) || '1000');
    const quants = await odoo.fetchStockQuants(limit);

    // Aggregate per product
    const productMap: Record<number, { productName: string; totalQty: number; locations: any[] }> = {};

    for (const q of quants) {
      const productId = q.product_id?.[0];
      const productName = q.product_id?.[1] || 'Unknown';
      const locationName = q.location_id?.[1] || 'Unknown';
      const qty = q.quantity || 0;

      if (!productMap[productId]) {
        productMap[productId] = { productName, totalQty: 0, locations: [] };
      }
      productMap[productId].totalQty += qty;
      productMap[productId].locations.push({ location: locationName, qty });
    }

    const data = Object.entries(productMap).map(([productId, info]) => ({
      productId: parseInt(productId),
      productName: info.productName,
      totalQty: Math.round(info.totalQty),
      locations: info.locations,
    }));

    res.json({
      success: true,
      data,
      meta: { total: data.length },
    });
  } catch (err: any) {
    console.error('Odoo stock fetch error:', err);
    res.status(500).json({ success: false, error: `Failed to fetch stock from Odoo: ${err.message}` });
  }
};
