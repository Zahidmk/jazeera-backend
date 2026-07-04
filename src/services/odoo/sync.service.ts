import odoo from './odoo.service';
import prisma from '../../utils/prisma';

// ─── Sync Products from Odoo ────────────────────────────
export async function syncProducts(): Promise<{ created: number; updated: number; total: number }> {
  console.log('🔄 Syncing products from Odoo...');
  const odooProducts = await odoo.fetchProducts(10000);

  let created = 0;
  let updated = 0;

  for (const op of odooProducts) {
    const sku = op.default_code || `ODOO-${op.id}`;
    const data = {
      odooId: op.id,
      name: op.name || 'Unknown Product',
      nameAr: null as string | null,
      sku,
      barcode: op.barcode || null,
      category: op.categ_id ? op.categ_id[1] : null,
      unit: op.uom_id ? op.uom_id[1] : 'pcs',
      priceRetail: op.list_price || 0,
      priceWhole: op.standard_price || 0,
      imageUrl: op.image_128 ? `data:image/png;base64,${op.image_128}` : null,
      isActive: op.active !== false,
    };

    // Upsert by odooId
    const existing = await prisma.product.findUnique({ where: { odooId: op.id } });

    if (existing) {
      await prisma.product.update({
        where: { odooId: op.id },
        data: { ...data, updatedAt: new Date() },
      });
      updated++;
    } else {
      // Check if SKU exists (from seed data)
      const bySku = await prisma.product.findUnique({ where: { sku } });
      if (bySku) {
        await prisma.product.update({
          where: { sku },
          data: { ...data, updatedAt: new Date() },
        });
        updated++;
      } else {
        await prisma.product.create({ data });
        created++;
      }
    }
  }

  console.log(`✅ Products synced — Created: ${created}, Updated: ${updated}, Total from Odoo: ${odooProducts.length}`);
  return { created, updated, total: odooProducts.length };
}

// ─── Sync Customers from Odoo ───────────────────────────
export async function syncCustomers(): Promise<{ created: number; updated: number; total: number }> {
  console.log('🔄 Syncing customers from Odoo...');
  const odooCustomers = await odoo.fetchCustomers(10000);

  let created = 0;
  let updated = 0;

  for (const oc of odooCustomers) {
    const address = [oc.street, oc.street2, oc.city].filter(Boolean).join(', ');
    const phone = oc.mobile || oc.phone || null;

    const data = {
      odooId: oc.id,
      name: oc.name || 'Unknown Customer',
      phone,
      email: oc.email || null,
      address: address || null,
      street: oc.street || null,
      district: oc.street2 || null,
      city: oc.city || null,
      zip: oc.zip || null,
      buildingNumber: null, // Odoo doesn't have a standard field for this unless localization is used
      lat: oc.partner_latitude || null,
      lng: oc.partner_longitude || null,
    };

    // Deduplicate/merge with local customers that don't have an odooId yet
    let existing = await prisma.customer.findUnique({ where: { odooId: oc.id } });
    if (!existing && phone) {
      existing = await prisma.customer.findFirst({
        where: { phone, odooId: null }
      });
    }
    if (!existing && oc.email) {
      existing = await prisma.customer.findFirst({
        where: { email: oc.email, odooId: null }
      });
    }

    if (existing) {
      await prisma.customer.update({
        where: { id: existing.id },
        data: { ...data, odooId: oc.id, updatedAt: new Date() },
      });
      updated++;
    } else {
      await prisma.customer.create({ data });
      created++;
    }
  }

  console.log(`✅ Customers synced — Created: ${created}, Updated: ${updated}, Total from Odoo: ${odooCustomers.length}`);
  return { created, updated, total: odooCustomers.length };
}

// ─── Sync Sale Orders → Deliveries ──────────────────────
export async function syncOrders(driverId: string): Promise<{ created: number; skipped: number; total: number }> {
  console.log('🔄 Syncing orders from Odoo...');
  const odooOrders = await odoo.fetchSaleOrders();

  let created = 0;
  let skipped = 0;

  // Get a default route
  const route = await prisma.route.findFirst({ where: { isActive: true } });

  for (const order of odooOrders) {
    // Skip if already imported
    const existing = await prisma.delivery.findFirst({
      where: { odooOrderId: order.id },
    });

    if (existing) {
      skipped++;
      continue;
    }

    // Find or create customer by odooId
    const partnerId = order.partner_id[0];
    let customer = await prisma.customer.findUnique({ where: { odooId: partnerId } });

    if (!customer) {
      // Fetch this specific customer from Odoo
      const [partnerData] = await odoo.read('res.partner', [partnerId], [
        'name', 'phone', 'mobile', 'email', 'street', 'city',
        'partner_latitude', 'partner_longitude',
      ]);
      if (partnerData) {
        customer = await prisma.customer.create({
          data: {
            odooId: partnerId,
            name: partnerData.name || 'Unknown',
            phone: partnerData.mobile || partnerData.phone || null,
            email: partnerData.email || null,
            address: [partnerData.street, partnerData.city].filter(Boolean).join(', ') || null,
            lat: partnerData.partner_latitude || null,
            lng: partnerData.partner_longitude || null,
          },
        });
      }
    }

    if (!customer) {
      skipped++;
      continue;
    }

    // Fetch order lines
    let items: any[] = [];
    if (order.order_line && order.order_line.length > 0) {
      items = await odoo.fetchOrderLines(order.order_line);
    }

    // Create delivery with items
    const delivery = await prisma.delivery.create({
      data: {
        driverId,
        customerId: customer.id,
        routeId: route?.id || null,
        odooOrderId: order.id,
        status: 'PENDING',
        scheduledAt: new Date(order.date_order),
        items: {
          create: await Promise.all(
            items
              .filter((item: any) => item.product_id)
              .map(async (item: any) => {
                const productOdooId = item.product_id[0];
                let product = await prisma.product.findUnique({ where: { odooId: productOdooId } });

                if (!product) {
                  // Create a placeholder product
                  product = await prisma.product.create({
                    data: {
                      odooId: productOdooId,
                      name: item.product_id[1] || 'Unknown Product',
                      sku: `ODOO-${productOdooId}`,
                      priceRetail: item.price_unit || 0,
                    },
                  });
                }

                return {
                  productId: product.id,
                  quantity: Math.round(item.product_uom_qty || 0),
                  unitPrice: item.price_unit || 0,
                };
              })
          ),
        },
      },
    });

    created++;
  }

  console.log(`✅ Orders synced — Created: ${created}, Skipped: ${skipped}, Total from Odoo: ${odooOrders.length}`);
  return { created, skipped, total: odooOrders.length };
}

// ─── Full Sync ──────────────────────────────────────────
export async function syncAll(driverId?: string): Promise<{
  products: { created: number; updated: number; total: number };
  customers: { created: number; updated: number; total: number };
  orders?: { created: number; skipped: number; total: number };
}> {
  const products = await syncProducts();
  const customers = await syncCustomers();

  let orders;
  if (driverId) {
    orders = await syncOrders(driverId);
  }

  return { products, customers, orders };
}

export default { syncProducts, syncCustomers, syncOrders, syncAll };
