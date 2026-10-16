/**
 * Customer-specific pricing check — verifies the Odoo integration end to end.
 *
 *   npx ts-node scripts/test-pricing.ts          (no API server needed)
 *
 * Read-only: it picks a real customer/product pair out of Odoo's confirmed sale
 * orders, resolves prices through pricing.service, and prints the catalogue
 * price next to the customer's own price. Also exercises the cache, the local
 * UUID path, and the "no customer -> list price" fallback.
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import prisma from '../src/utils/prisma';
import pricing from '../src/services/pricing.service';
import odoo from '../src/services/odoo/odoo.service';

async function main() {
  // Real (customer, product) pairs straight from Odoo's confirmed orders
  const lines: any[] = await odoo.searchRead(
    'sale.order.line',
    [['state', 'in', ['sale', 'done']]],
    ['order_partner_id', 'product_id', 'price_unit'],
    { limit: 60, order: 'id desc' }
  );

  const byCustomer = new Map<number, number[]>();
  for (const l of lines) {
    const customerOdooId = l.order_partner_id?.[0];
    const productOdooId = l.product_id?.[0];
    if (!customerOdooId || !productOdooId) continue;
    if (!byCustomer.has(customerOdooId)) byCustomer.set(customerOdooId, []);
    byCustomer.get(customerOdooId)!.push(productOdooId);
  }

  for (const [customerOdooId, productOdooIds] of byCustomer) {
    const products = await prisma.product.findMany({
      where: { odooId: { in: [...new Set(productOdooIds)] } },
      select: { id: true, name: true, odooId: true, priceRetail: true },
      take: 5,
    });
    if (products.length === 0) continue; // not synced locally — try the next customer

    console.log(`\n── Odoo customer ${customerOdooId} · ${products.length} synced product(s) ──`);
    const ids = products.map((p) => p.id);

    const coldStart = Date.now();
    const prices = await pricing.getCustomerPrices(customerOdooId, ids);
    console.log(`cold lookup: ${Date.now() - coldStart} ms`);

    for (const p of products) {
      const r = prices.get(p.id)!;
      console.log(
        `  ${p.name.replace(/\s+/g, ' ').slice(0, 40).padEnd(42)}` +
          ` list=${r.listPrice.toFixed(2).padStart(9)}` +
          ` customer=${r.price.toFixed(2).padStart(9)}` +
          `  [${r.priceSource}] ${r.lastSaleDate || ''}`
      );
    }

    const warmStart = Date.now();
    await pricing.getCustomerPrices(customerOdooId, ids);
    console.log(`warm lookup (cached): ${Date.now() - warmStart} ms`);

    // Local customer UUID path — what the mobile apps actually send
    const localCustomer = await prisma.customer.findFirst({
      where: { odooId: customerOdooId },
      select: { id: true, name: true },
    });
    if (localCustomer) {
      const viaUuid = await pricing.getCustomerPrice(localCustomer.id, ids[0]);
      console.log(`  via local UUID (${localCustomer.name}): ${viaUuid?.price} [${viaUuid?.priceSource}]`);
    } else {
      console.log('  (partner not in the local Customer table — UUID path not exercised)');
    }

    // Fallback: no customer must still return the catalogue price
    const fallback = (await pricing.getCustomerPrices(null, [ids[0]])).get(ids[0])!;
    console.log(
      `  no-customer fallback: ${fallback.price} [${fallback.priceSource}]` +
        ` (expected LIST = ${fallback.listPrice}) → ${fallback.priceSource === 'LIST' && fallback.price === fallback.listPrice ? 'OK' : 'MISMATCH'}`
    );

    // Cache invalidation
    pricing.invalidateCustomerPriceCache(customerOdooId);
    const afterInvalidate = Date.now();
    await pricing.getCustomerPrices(customerOdooId, ids);
    console.log(`after invalidation (refetched): ${Date.now() - afterInvalidate} ms`);

    await prisma.$disconnect();
    return;
  }

  console.log('No Odoo order line matched a locally synced product — run a product sync first.');
  await prisma.$disconnect();
}

main().catch(async (err: any) => {
  console.error('FAILED:', err?.message || err);
  await prisma.$disconnect();
  process.exit(1);
});
