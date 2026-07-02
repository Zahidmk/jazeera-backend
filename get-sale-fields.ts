import odoo from './src/services/odoo/odoo.service';

async function checkFields() {
  try {
    console.log("Connecting to Odoo...");
    await odoo.authenticate();

    // The execute_kw method for fields_get
    const fields = await odoo.execute('sale.order', 'fields_get', [], { attributes: ['string', 'type'] });

    for (const [fieldName, fieldInfo] of Object.entries(fields as Record<string, any>)) {
      if (fieldName.startsWith('x_') || fieldInfo.string.toLowerCase().includes('van sales') || fieldInfo.string.toLowerCase().includes('created by')) {
        console.log(`Found matching field: ${fieldName} -> Label: "${fieldInfo.string}" (Type: ${fieldInfo.type})`);
      }
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

checkFields();
