import prisma from './src/utils/prisma';
import odoo from './src/services/odoo/odoo.service';

async function testConfirm() {
  try {
    console.log("Connecting to Odoo...");
    await odoo.authenticate();

    // Find a customer
    const customers = await odoo.searchRead('res.partner', [['customer_rank', '>', 0]], ['id', 'name'], { limit: 1 });
    if (customers.length === 0) {
      console.error("No customers found in Odoo");
      return;
    }
    const partnerId = customers[0].id;
    console.log(`Found Customer: ${customers[0].name} (ID: ${partnerId})`);

    // Find a product
    const products = await odoo.searchRead('product.product', [['sale_ok', '=', true]], ['id', 'name'], { limit: 1 });
    if (products.length === 0) {
      console.error("No products found in Odoo");
      return;
    }
    const productId = products[0].id;
    console.log(`Found Product: ${products[0].name} (ID: ${productId})`);

    // Create Sale Order
    console.log("Creating Sale Order...");
    const orderLines = [
      [ 0, 0, { product_id: productId, product_uom_qty: 1, price_unit: 10, discount: 0 } ]
    ];
    
    const odooSaleId = await odoo.create('sale.order', {
      partner_id: partnerId,
      order_line: orderLines,
    });
    console.log(`✅ Sale Order Created with ID: ${odooSaleId}`);

    // Try Confirm
    console.log("Attempting to confirm Sale Order...");
    try {
      await odoo.execute('sale.order', 'action_confirm', [[odooSaleId]]);
      console.log(`✅ Sale Order ${odooSaleId} confirmed successfully!`);
    } catch (err: any) {
      console.error(`⚠️ Failed to confirm Sale Order ${odooSaleId}:`, err?.message || err);
    }
  } catch (err) {
    console.error("Error in test script:", err);
  } finally {
    await prisma.$disconnect();
  }
}

testConfirm();
