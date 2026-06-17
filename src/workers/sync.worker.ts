/**
 * sync.worker.ts
 *
 * BullMQ Workers — one per queue.
 * Each worker picks jobs off its queue and processes them.
 *
 * Worker behaviour:
 *  - Concurrency 2 per queue (processes 2 jobs in parallel)
 *  - On failure → BullMQ auto-retries up to 3x with exponential backoff
 *  - All errors are caught and thrown so BullMQ marks the job as failed
 */

import { Worker, Job } from 'bullmq';
import { redisConnection, ProductJobData, CustomerJobData, OrderJobData } from '../utils/queue';
import * as syncService from '../services/odoo/sync.service';
import odoo from '../services/odoo/odoo.service';
import prisma from '../utils/prisma';

const DISABLE_REDIS = process.env.DISABLE_REDIS === 'true';

// ─── Workers ──────────────────────────────────────────────────────────────────
export let productWorker: any = null;
export let customerWorker: any = null;
export let orderWorker: any = null;

if (!DISABLE_REDIS) {
  productWorker = new Worker<ProductJobData>(
    'sync-products',
    async (job: Job<ProductJobData>) => {
      const data = job.data;

      if (data.type === 'full_sync') {
        job.log('Starting full product sync from Odoo...');
        const result = await syncService.syncProducts();
        job.log(`Done: created=${result.created}, updated=${result.updated}, total=${result.total}`);
        return result;
      }

      if (data.type === 'single_update') {
        job.log(`Updating single product odooId=${data.odooId}`);
        // Re-fetch the full record from Odoo (don't trust webhook payload alone)
        const [freshProduct] = await odoo.read('product.product', [data.odooId], [
          'id', 'name', 'default_code', 'barcode', 'list_price',
          'standard_price', 'categ_id', 'uom_id', 'image_128',
          'type', 'active', 'qty_available',
        ]);

        if (!freshProduct) {
          throw new Error(`Product odooId=${data.odooId} not found in Odoo`);
        }

        const sku = freshProduct.default_code || `ODOO-${freshProduct.id}`;
        await prisma.product.upsert({
          where: { odooId: freshProduct.id },
          update: {
            name: freshProduct.name,
            sku,
            barcode: freshProduct.barcode || null,
            category: freshProduct.categ_id ? freshProduct.categ_id[1] : null,
            unit: freshProduct.uom_id ? freshProduct.uom_id[1] : 'pcs',
            priceRetail: freshProduct.list_price || 0,
            priceWhole: freshProduct.standard_price || 0,
            isActive: freshProduct.active !== false,
            updatedAt: new Date(),
          },
          create: {
            odooId: freshProduct.id,
            name: freshProduct.name || 'Unknown',
            sku,
            barcode: freshProduct.barcode || null,
            category: freshProduct.categ_id ? freshProduct.categ_id[1] : null,
            unit: freshProduct.uom_id ? freshProduct.uom_id[1] : 'pcs',
            priceRetail: freshProduct.list_price || 0,
            priceWhole: freshProduct.standard_price || 0,
            isActive: freshProduct.active !== false,
          },
        });

        job.log(`Product ${freshProduct.name} upserted`);
        return { odooId: data.odooId, name: freshProduct.name };
      }
    },
    {
      connection: redisConnection,
      concurrency: 2,
    }
  );

  customerWorker = new Worker<CustomerJobData>(
    'sync-customers',
    async (job: Job<CustomerJobData>) => {
      const data = job.data;

      if (data.type === 'full_sync') {
        job.log('Starting full customer sync from Odoo...');
        const result = await syncService.syncCustomers();
        job.log(`Done: created=${result.created}, updated=${result.updated}, total=${result.total}`);
        return result;
      }

      if (data.type === 'single_upsert') {
        job.log(`Upserting single customer odooId=${data.odooId}`);
        // Re-fetch full record from Odoo
        const [freshCustomer] = await odoo.read('res.partner', [data.odooId], [
          'id', 'name', 'phone', 'mobile', 'email',
          'street', 'street2', 'city', 'partner_latitude', 'partner_longitude',
        ]);

        if (!freshCustomer) {
          throw new Error(`Customer odooId=${data.odooId} not found in Odoo`);
        }

        const address = [freshCustomer.street, freshCustomer.street2, freshCustomer.city]
          .filter(Boolean).join(', ');

        await prisma.customer.upsert({
          where: { odooId: freshCustomer.id },
          update: {
            name: freshCustomer.name,
            phone: freshCustomer.mobile || freshCustomer.phone || null,
            email: freshCustomer.email || null,
            address: address || null,
            lat: freshCustomer.partner_latitude || null,
            lng: freshCustomer.partner_longitude || null,
            updatedAt: new Date(),
          },
          create: {
            odooId: freshCustomer.id,
            name: freshCustomer.name || `Customer #${freshCustomer.id}`,
            phone: freshCustomer.mobile || freshCustomer.phone || null,
            email: freshCustomer.email || null,
            address: address || null,
            lat: freshCustomer.partner_latitude || null,
            lng: freshCustomer.partner_longitude || null,
          },
        });

        job.log(`Customer ${freshCustomer.name} upserted`);
        return { odooId: data.odooId, name: freshCustomer.name };
      }
    },
    {
      connection: redisConnection,
      concurrency: 2,
    }
  );

  orderWorker = new Worker<OrderJobData>(
    'sync-orders',
    async (job: Job<OrderJobData>) => {
      const data = job.data;

      if (data.type === 'full_sync') {
        job.log('Starting full order sync from Odoo...');
        const driverId = data.driverId || await getDefaultDriverId();
        const result = await syncService.syncOrders(driverId);
        job.log(`Done: created=${result.created}, skipped=${result.skipped}, total=${result.total}`);
        return result;
      }

      if (data.type === 'order_created') {
        job.log(`Processing order_created for odooId=${data.odooId}`);
        // Re-fetch full order from Odoo
        const [freshOrder] = await odoo.read('sale.order', [data.odooId], [
          'id', 'name', 'partner_id', 'date_order', 'state', 'amount_total', 'order_line',
        ]);

        if (!freshOrder) throw new Error(`Order odooId=${data.odooId} not found in Odoo`);

        // Skip if delivery already exists
        const existing = await prisma.delivery.findFirst({ where: { odooOrderId: data.odooId } });
        if (existing) {
          job.log(`Delivery for order ${data.odooId} already exists — skipping`);
          return { skipped: true };
        }

        // Find or auto-create customer
        const partnerId = freshOrder.partner_id[0];
        let customer = await prisma.customer.findUnique({ where: { odooId: partnerId } });
        if (!customer) {
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

        if (!customer) throw new Error(`Cannot find or create customer for partner ${partnerId}`);

        const driverId = await getDefaultDriverId();
        const route = await prisma.route.findFirst({ where: { isActive: true } });

        // Fetch order lines
        const lines = freshOrder.order_line?.length
          ? await odoo.fetchOrderLines(freshOrder.order_line)
          : [];

        await prisma.delivery.create({
          data: {
            driverId,
            customerId: customer.id,
            routeId: route?.id || null,
            odooOrderId: data.odooId,
            status: 'PENDING',
            scheduledAt: new Date(freshOrder.date_order),
            items: {
              create: await Promise.all(
                lines
                  .filter((l: any) => l.product_id)
                  .map(async (l: any) => {
                    const pOdooId = l.product_id[0];
                    let product = await prisma.product.findUnique({ where: { odooId: pOdooId } });
                    if (!product) {
                      product = await prisma.product.create({
                        data: {
                          odooId: pOdooId,
                          name: l.product_id[1] || 'Unknown',
                          sku: `ODOO-${pOdooId}`,
                          priceRetail: l.price_unit || 0,
                        },
                      });
                    }
                    return {
                      productId: product.id,
                      quantity: Math.round(l.product_uom_qty || 0),
                      unitPrice: l.price_unit || 0,
                    };
                  })
              ),
            },
          },
        });

        job.log(`Created delivery for Odoo order ${data.odooId}`);
        return { created: true };
      }

      if (data.type === 'order_updated') {
        job.log(`Processing order_updated for odooId=${data.odooId}`);
        const delivery = await prisma.delivery.findFirst({ where: { odooOrderId: data.odooId } });
        if (!delivery) {
          job.log(`No delivery found for order ${data.odooId} — skipping`);
          return { skipped: true };
        }

        // Re-fetch from Odoo to get fresh state
        const [freshOrder] = await odoo.read('sale.order', [data.odooId], ['state', 'note']);
        const stateMap: Record<string, string> = {
          draft: 'PENDING', sent: 'PENDING', sale: 'PENDING', done: 'DELIVERED', cancel: 'FAILED',
        };
        const newStatus = freshOrder?.state ? stateMap[freshOrder.state] : null;

        if (newStatus && newStatus !== delivery.status) {
          await prisma.delivery.update({
            where: { id: delivery.id },
            data: { status: newStatus as any, notes: freshOrder.note || delivery.notes },
          });
          job.log(`Updated delivery ${delivery.id} → ${newStatus}`);
        }
        return { updated: true };
      }

      if (data.type === 'order_cancelled') {
        job.log(`Processing order_cancelled for odooId=${data.odooId}`);
        const delivery = await prisma.delivery.findFirst({ where: { odooOrderId: data.odooId } });
        if (!delivery) return { skipped: true };

        if (['PENDING', 'IN_PROGRESS'].includes(delivery.status)) {
          await prisma.delivery.update({
            where: { id: delivery.id },
            data: { status: 'FAILED', failReason: 'Cancelled in Odoo' },
          });
          job.log(`Delivery ${delivery.id} marked FAILED (cancelled in Odoo)`);
        }
        return { cancelled: true };
      }
    },
    {
      connection: redisConnection,
      concurrency: 2,
    }
  );

  // ─── Worker Error Handlers ───────────────────────────────────────────────────
  productWorker.on('failed', (job: any, err: any) => {
    console.error(`❌ [productWorker] Job ${job?.id} failed after retries:`, err.message);
  });
  customerWorker.on('failed', (job: any, err: any) => {
    console.error(`❌ [customerWorker] Job ${job?.id} failed after retries:`, err.message);
  });
  orderWorker.on('failed', (job: any, err: any) => {
    console.error(`❌ [orderWorker] Job ${job?.id} failed after retries:`, err.message);
  });
}

// ─── Utility ─────────────────────────────────────────────────────────────────
async function getDefaultDriverId(): Promise<string> {
  const driver = await prisma.user.findFirst({
    where: { role: 'DRIVER', isActive: true },
    select: { id: true },
  });
  if (!driver) throw new Error('No active driver found for order assignment');
  return driver.id;
}

export function startWorkers() {
  if (DISABLE_REDIS) {
    console.log('ℹ️ BullMQ workers disabled because DISABLE_REDIS=true');
    return;
  }
  console.log('🚀 BullMQ workers started (products, customers, orders)');
}
