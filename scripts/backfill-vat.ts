import prisma from '../src/utils/prisma';
import odoo from '../src/services/odoo/odoo.service';

async function main() {
  const sales = await prisma.cashSale.findMany({
    where: { odooSaleId: { not: null }, vatAmount: null },
    select: { id: true, odooSaleId: true, totalAmount: true },
  });

  console.log(`Found ${sales.length} synced sale(s) missing vatAmount`);

  for (const sale of sales) {
    try {
      const [amounts] = await odoo.read('sale.order', [sale.odooSaleId!], ['amount_untaxed', 'amount_tax']);
      if (!amounts) {
        console.warn(`  ⚠️  SO ${sale.odooSaleId} not found in Odoo — skipping`);
        continue;
      }
      await prisma.cashSale.update({
        where: { id: sale.id },
        data: { subtotalAmount: amounts.amount_untaxed, vatAmount: amounts.amount_tax },
      });
      console.log(`  ✅ ${sale.id} (SO ${sale.odooSaleId}): subtotal=${amounts.amount_untaxed}, vat=${amounts.amount_tax}`);
    } catch (err: any) {
      console.error(`  ❌ ${sale.id} (SO ${sale.odooSaleId}): ${err.message}`);
    }
  }

  process.exit(0);
}

main();
