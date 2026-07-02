import odoo from './src/services/odoo/odoo.service';

async function checkDraftOrders() {
  try {
    console.log("Connecting to Odoo...");
    await odoo.authenticate();

    // Find recent draft orders
    const draftOrders = await odoo.searchRead(
      'sale.order', 
      [['state', '=', 'draft']], 
      ['id', 'name', 'partner_id', 'date_order'], 
      { limit: 5, order: 'id desc' }
    );

    if (draftOrders.length === 0) {
      console.log("✅ No draft Quotations found. All recent orders are confirmed!");
      return;
    }

    console.log(`Found ${draftOrders.length} recent Quotations (Drafts). Attempting to confirm them to see the error...`);

    for (const order of draftOrders) {
      console.log(`\n--- Order ${order.name} (ID: ${order.id}) ---`);
      try {
        await odoo.execute('sale.order', 'action_confirm', [[order.id]]);
        console.log(`✅ Successfully confirmed ${order.name}! It seems it was just stuck.`);
      } catch (err: any) {
        console.error(`❌ FAILED to confirm ${order.name}. Odoo Error:`);
        console.error(err?.message || err);
      }
    }
  } catch (err) {
    console.error("Error in check script:", err);
  }
}

checkDraftOrders();
