import xmlrpc from 'xmlrpc';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// ─── Config ──────────────────────────────────────────────
const ODOO_URL = process.env.ODOO_URL || '';
const ODOO_DB = process.env.ODOO_DB || '';
const ODOO_USERNAME = process.env.ODOO_USERNAME || '';
const ODOO_API_KEY = process.env.ODOO_API_KEY || '';

// Parse URL for xmlrpc client
const url = new URL(ODOO_URL);
const isSecure = url.protocol === 'https:';
const host = url.hostname;
const port = isSecure ? 443 : (parseInt(url.port) || 80);

// ─── XML-RPC Clients ────────────────────────────────────
const createClient = (endpoint: string) => {
  const opts = { host, port, path: endpoint };
  return isSecure ? xmlrpc.createSecureClient(opts) : xmlrpc.createClient(opts);
};

const commonClient = createClient('/xmlrpc/2/common');
const objectClient = createClient('/xmlrpc/2/object');

// ─── Cache UID ──────────────────────────────────────────
let cachedUid: number | null = null;

// ─── Helper: promisify xmlrpc calls ─────────────────────
function rpcCall(client: any, method: string, params: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    client.methodCall(method, params, (err: Error | null, result: any) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

// ─── Authenticate ───────────────────────────────────────
export async function authenticate(): Promise<number> {
  if (cachedUid) return cachedUid;

  console.log(`🔌 Connecting to Odoo: ${ODOO_URL} (DB: ${ODOO_DB}, User: ${ODOO_USERNAME})`);

  const uid = await rpcCall(commonClient, 'authenticate', [
    ODOO_DB,
    ODOO_USERNAME,
    ODOO_API_KEY,
    {},
  ]);

  if (!uid || uid === false) {
    throw new Error('Odoo authentication failed. Check URL, DB, username, and API key.');
  }

  cachedUid = uid as number;
  console.log(`✅ Odoo authenticated — UID: ${uid}`);
  return uid;
}

// ─── Generic Execute (execute_kw) ───────────────────────
async function execute(
  model: string,
  method: string,
  args: any[],
  kwargs: Record<string, any> = {}
): Promise<any> {
  const uid = await authenticate();
  return rpcCall(objectClient, 'execute_kw', [
    ODOO_DB,
    uid,
    ODOO_API_KEY,
    model,
    method,
    args,
    kwargs,
  ]);
}

// ─── CRUD Methods ───────────────────────────────────────

/** Search records — returns array of IDs */
export async function search(
  model: string,
  domain: any[][],
  options: { limit?: number; offset?: number; order?: string } = {}
): Promise<number[]> {
  return execute(model, 'search', [domain], options);
}

/** Read records by IDs */
export async function read(
  model: string,
  ids: number[],
  fields: string[] = []
): Promise<any[]> {
  return execute(model, 'read', [ids], { fields });
}

/** Search + Read in one call */
export async function searchRead(
  model: string,
  domain: any[][],
  fields: string[] = [],
  options: { limit?: number; offset?: number; order?: string } = {}
): Promise<any[]> {
  return execute(model, 'search_read', [domain], { fields, ...options });
}

/** Count records */
export async function searchCount(
  model: string,
  domain: any[][] = [[]]
): Promise<number> {
  return execute(model, 'search_count', [domain]);
}

/** Create a record — returns new ID */
export async function create(
  model: string,
  values: Record<string, any>
): Promise<number> {
  return execute(model, 'create', [values]);
}

/** Update records */
export async function write(
  model: string,
  ids: number[],
  values: Record<string, any>
): Promise<boolean> {
  return execute(model, 'write', [ids, values]);
}

// ─── Version Check (no auth needed) ─────────────────────
export async function version(): Promise<any> {
  return rpcCall(commonClient, 'version', []);
}

// ─── Specific Business Methods ──────────────────────────

/** Fetch all products from Odoo */
export async function fetchProducts(limit = 500): Promise<any[]> {
  return searchRead(
    'product.product',
    [['sale_ok', '=', true]],
    [
      'id', 'name', 'default_code', 'barcode', 'list_price',
      'standard_price', 'categ_id', 'uom_id', 'image_128',
      'type', 'active', 'qty_available',
    ],
    { limit }
  );
}

/** Fetch all customers (res.partner) */
export async function fetchCustomers(limit = 500): Promise<any[]> {
  return searchRead(
    'res.partner',
    [['customer_rank', '>', 0]],
    [
      'id', 'name', 'phone', 'mobile', 'email',
      'street', 'street2', 'city', 'partner_latitude',
      'partner_longitude',
    ],
    { limit }
  );
}

/** Fetch sale orders (for deliveries) */
export async function fetchSaleOrders(limit = 100): Promise<any[]> {
  return searchRead(
    'sale.order',
    [['state', 'in', ['sale', 'done']]],
    [
      'id', 'name', 'partner_id', 'date_order', 'state',
      'amount_total', 'order_line',
    ],
    { limit, order: 'date_order desc' }
  );
}

/** Fetch sale order lines */
export async function fetchOrderLines(ids: number[]): Promise<any[]> {
  return read(
    'sale.order.line',
    ids,
    ['id', 'product_id', 'product_uom_qty', 'price_unit', 'price_subtotal']
  );
}

/** Fetch stock quants (warehouse inventory) */
export async function fetchStockQuants(limit = 500): Promise<any[]> {
  return searchRead(
    'stock.quant',
    [['location_id.usage', '=', 'internal']],
    ['id', 'product_id', 'quantity', 'location_id'],
    { limit }
  );
}

/** Create a sale order in Odoo (for cash sales) */
export async function createSaleOrder(
  partnerId: number,
  lines: { productId: number; qty: number; price: number; discount?: number }[],
  salesmanName?: string
): Promise<number> {
  const orderLines = lines.map((l) => [
    0, 0,
    {
      product_id: l.productId,
      product_uom_qty: l.qty,
      price_unit: l.price,
      discount: l.discount || 0,
    },
  ]);

  const payload: any = {
    partner_id: partnerId,
    order_line: orderLines,
  };

  if (salesmanName) {
    payload.external_system_id = salesmanName;
  }

  return create('sale.order', payload);
}

/** Create a CRM lead in Odoo */
export async function createLead(data: {
  name: string;
  phone?: string;
  street?: string;
  description?: string;
}): Promise<number> {
  return create('crm.lead', {
    name: data.name,
    phone: data.phone || false,
    street: data.street || false,
    description: data.description || false,
    type: 'lead',
  });
}

/** Create an employee in Odoo */
export async function createEmployee(data: {
  name: string;
  work_email: string;
  work_phone?: string;
}): Promise<number> {
  return create('hr.employee', {
    name: data.name,
    work_email: data.work_email,
    work_phone: data.work_phone || false,
  });
}

// ─── Van as Odoo Stock Location ──────────────────────────────────────────────

/**
 * Find or create a virtual stock location for a van inside Odoo.
 * Location path: Physical Locations / Virtual Locations / Vans / Van-<plateNumber>
 * Returns the Odoo location ID.
 */
export async function findOrCreateVanLocation(plateNumber: string): Promise<number> {
  const locationName = `Van-${plateNumber}`;

  // Search for existing van location
  const existing: number[] = await search('stock.location', [
    ['name', '=', locationName],
    ['usage', '=', 'internal'],
  ]);

  if (existing.length > 0) return existing[0];

  // Find the parent "Vans" location (or fallback to Virtual Locations)
  let parentId: number;
  const vansParent: number[] = await search('stock.location', [
    ['name', '=', 'Vans'],
    ['usage', '=', 'view'],
  ]);

  if (vansParent.length > 0) {
    parentId = vansParent[0];
  } else {
    // Find Virtual Locations as parent
    const virtualLocs: number[] = await search('stock.location', [
      ['name', '=', 'Virtual Locations'],
      ['usage', '=', 'view'],
    ]);
    // Create "Vans" view location
    parentId = await create('stock.location', {
      name: 'Vans',
      usage: 'view',
      location_id: virtualLocs[0] ?? 1,
    });
  }

  // Create the van location
  const newLocationId = await create('stock.location', {
    name: locationName,
    usage: 'internal',
    location_id: parentId,
    comment: `Mobile van stock location for plate ${plateNumber}`,
  });

  console.log(`✅ Odoo: Created van stock location "${locationName}" with ID ${newLocationId}`);
  return newLocationId;
}

/**
 * Get the main warehouse source location ID (WH/Stock).
 * Searches for the first internal location named "Stock" under a warehouse.
 */
export async function getWarehouseStockLocationId(): Promise<number> {
  const locs: any[] = await searchRead(
    'stock.location',
    [['usage', '=', 'internal'], ['name', '=', 'Stock']],
    ['id', 'name', 'complete_name'],
    { limit: 1 }
  );
  if (locs.length > 0) return locs[0].id;
  // Fallback to location id 8 (WH/Stock is typically 8 in a fresh Odoo)
  return 8;
}

/**
 * Get the customer output location (used for outgoing deliveries).
 * Typically "WH/Output" or "Partners/Customers"
 */
export async function getCustomerLocationId(): Promise<number> {
  const locs: number[] = await search('stock.location', [
    ['usage', '=', 'customer'],
  ]);
  return locs[0] ?? 5; // 5 is Odoo default customer location
}

/**
 * Create an internal stock transfer (picking) in Odoo.
 * e.g. from warehouse → van location (for loading van at start of day)
 * Returns the picking ID.
 */
export async function createStockTransfer(
  fromLocationId: number,
  toLocationId: number,
  lines: { productOdooId: number; quantity: number; productName?: string }[],
  note?: string
): Promise<number> {
  // Find the internal operation type
  const opTypes: any[] = await searchRead(
    'stock.picking.type',
    [['code', '=', 'internal']],
    ['id', 'name', 'default_location_src_id', 'warehouse_id'],
    { limit: 1 }
  );

  const pickingTypeId = opTypes[0]?.id;
  if (!pickingTypeId) throw new Error('No internal picking type found in Odoo');

  const moveLines = lines.map(l => [0, 0, {
    product_id: l.productOdooId,
    product_uom_qty: l.quantity,
    product_uom: 1, // Unit of measure (1 = Units by default)
    name: l.productName || `Product ${l.productOdooId}`,
    location_id: fromLocationId,
    location_dest_id: toLocationId,
  }]);

  const pickingId = await create('stock.picking', {
    picking_type_id: pickingTypeId,
    location_id: fromLocationId,
    location_dest_id: toLocationId,
    move_ids: moveLines,
    note: note || 'Van stock load — created by Jazeera mobile app',
    origin: `VAN-LOAD-${Date.now()}`,
  });

  console.log(`✅ Odoo: Created stock transfer ID ${pickingId} (${fromLocationId} → ${toLocationId})`);
  return pickingId;
}

/**
 * Validate (confirm + immediate transfer) a stock picking in Odoo.
 * This actually moves the stock.
 */
export async function validateStockPicking(pickingId: number): Promise<void> {
  // First confirm the picking
  try {
    await execute('stock.picking', 'action_confirm', [[pickingId]]);
  } catch {
    // May already be confirmed
  }

  // Check availability
  try {
    await execute('stock.picking', 'action_assign', [[pickingId]]);
  } catch {
    // Ignore — may not be needed
  }

  // Set all move_line quantities to done
  const picking: any[] = await read('stock.picking', [pickingId], ['move_line_ids', 'move_ids']);
  if (picking[0]?.move_line_ids?.length > 0) {
    for (const lineId of picking[0].move_line_ids) {
      // Pass [] to read ALL fields safely, avoiding "Invalid field" crashes across Odoo versions
      const [line] = await read('stock.move.line', [lineId], []);
      
      const reserved = line.reserved_uom_qty || line.product_uom_qty || line.reserved_qty || 0;
      const currentDone = line.quantity || line.qty_done || 0;
      
      const qtyToSet = reserved || currentDone;
      
      // Determine correct write field based on what exists on the record
      const writeData: any = {};
      if ('quantity' in line) writeData.quantity = qtyToSet;
      else if ('qty_done' in line) writeData.qty_done = qtyToSet;
      
      if (Object.keys(writeData).length > 0) {
        await write('stock.move.line', [lineId], writeData);
      }
    }
  }

  // Validate (transfer)
  await execute('stock.picking', 'button_validate', [[pickingId]]);
  console.log(`✅ Odoo: Validated stock picking ID ${pickingId}`);
}

/**
 * Find and validate the outgoing delivery picking for a sale order.
 * Called when driver marks a delivery as DELIVERED.
 */
export async function validateDeliveryForSaleOrder(odooSaleOrderId: number): Promise<void> {
  // Find outgoing pickings for this sale order
  const pickings: any[] = await searchRead(
    'stock.picking',
    [
      ['sale_id', '=', odooSaleOrderId],
      ['state', 'not in', ['done', 'cancel']],
      ['picking_type_code', '=', 'outgoing'],
    ],
    ['id', 'name', 'state', 'picking_type_code'],
    { limit: 5 }
  );

  if (pickings.length === 0) {
    console.warn(`⚠️  Odoo: No pending outgoing picking found for sale order ${odooSaleOrderId}`);
    return;
  }

  for (const picking of pickings) {
    try {
      await validateStockPicking(picking.id);
      console.log(`✅ Odoo: Validated delivery picking ${picking.name} for SO ${odooSaleOrderId}`);
    } catch (err: any) {
      console.error(`⚠️  Odoo: Could not validate picking ${picking.id}:`, err?.message);
    }
  }
}

/**
 * Confirm a sale order in Odoo (sale → confirmed) and set the delivery
 * location to the van's Odoo location so stock is pulled from the van.
 */
export async function confirmSaleOrderWithVanLocation(
  odooSaleOrderId: number,
  vanLocationId: number
): Promise<void> {
  try {
    await execute('sale.order', 'action_confirm', [[odooSaleOrderId]]);
  } catch (err: any) {
    console.error(`⚠️ Failed to confirm Sale Order ${odooSaleOrderId}:`, err?.message || err);
  }

  // Update the outgoing picking's source location to the van
  const pickings: any[] = await searchRead(
    'stock.picking',
    [['sale_id', '=', odooSaleOrderId], ['state', 'not in', ['done', 'cancel']]],
    ['id', 'state', 'location_id'],
    { limit: 5 }
  );

  for (const picking of pickings) {
    try {
      await write('stock.picking', [picking.id], { location_id: vanLocationId });
      // Also update move lines
      const moveLine: any[] = await read('stock.picking', [picking.id], ['move_ids']);
      if (moveLine[0]?.move_ids?.length > 0) {
        await write('stock.move', moveLine[0].move_ids, { location_id: vanLocationId });
      }
    } catch (err: any) {
      console.warn(`⚠️  Could not set van location on picking ${picking.id}:`, err?.message);
    }
  }

  console.log(`✅ Odoo: Confirmed SO ${odooSaleOrderId} with van location ${vanLocationId}`);
}

/** Update sale order status in Odoo — called when delivery is DELIVERED or FAILED */
export async function updateSaleOrderStatus(
  odooOrderId: number,
  status: 'DELIVERED' | 'FAILED',
  notes?: string
): Promise<boolean> {
  // Map our status to Odoo action
  // DELIVERED → confirm order (action_confirm) if draft, or mark done
  // FAILED    → cancel order (action_cancel)
  if (status === 'DELIVERED') {
    // Try to confirm if not already confirmed
    try {
      await execute('sale.order', 'action_confirm', [[odooOrderId]]);
    } catch (err: any) {
      console.error(`⚠️ Failed to confirm Sale Order ${odooOrderId}:`, err?.message || err);
    }
    // Add internal note
    if (notes) {
      await create('mail.message', {
        model: 'sale.order',
        res_id: odooOrderId,
        body: `<p>Delivery completed. Notes: ${notes}</p>`,
        message_type: 'comment',
        subtype_xmlid: 'mail.mt_note',
      });
    }
    return true;
  } else {
    // FAILED → cancel
    try {
      await execute('sale.order', 'action_cancel', [[odooOrderId]]);
    } catch {
      // May already be cancelled or not cancellable — log but don't throw
      console.warn(`⚠️  Could not cancel Odoo order ${odooOrderId}`);
    }
    return true;
  }
}

/** Create stock adjustment in Odoo (for damage/expiry) */
export async function createInventoryAdjustment(
  productId: number,
  locationId: number,
  qty: number,
  reason: string
): Promise<number> {
  // Odoo 17+: update stock.quant inventory_quantity then call action_apply_inventory
  const quantIds: number[] = await search(
    'stock.quant',
    [['product_id', '=', productId], ['location_id', '=', locationId]]
  );

  if (quantIds.length > 0) {
    // Update existing quant
    await write('stock.quant', quantIds, { inventory_quantity: qty });
    await execute('stock.quant', 'action_apply_inventory', [quantIds]);
    return quantIds[0];
  } else {
    // Create new quant
    const newId = await create('stock.quant', {
      product_id: productId,
      location_id: locationId,
      inventory_quantity: qty,
    });
    await execute('stock.quant', 'action_apply_inventory', [[newId]]);
    return newId;
  }
}

// ─── Polling: fetch records modified since a given datetime ─────────────────
// Used by the cron job as a safety-net fallback.
// Odoo stores last-write time in the `write_date` field on every model.

/** Products modified after `since` */
export async function fetchProductsModifiedSince(since: Date): Promise<any[]> {
  const sinceStr = since.toISOString().replace('T', ' ').substring(0, 19);
  return searchRead(
    'product.product',
    [['sale_ok', '=', true], ['write_date', '>', sinceStr]],
    [
      'id', 'name', 'default_code', 'barcode', 'list_price',
      'standard_price', 'categ_id', 'uom_id', 'image_128',
      'type', 'active', 'qty_available', 'write_date',
    ],
    { limit: 500 }
  );
}

/** Customers modified after `since` */
export async function fetchCustomersModifiedSince(since: Date): Promise<any[]> {
  const sinceStr = since.toISOString().replace('T', ' ').substring(0, 19);
  return searchRead(
    'res.partner',
    [['customer_rank', '>', 0], ['write_date', '>', sinceStr]],
    [
      'id', 'name', 'phone', 'mobile', 'email',
      'street', 'street2', 'city', 'partner_latitude',
      'partner_longitude', 'write_date',
    ],
    { limit: 500 }
  );
}

/** Sale orders modified after `since` */
export async function fetchOrdersModifiedSince(since: Date): Promise<any[]> {
  const sinceStr = since.toISOString().replace('T', ' ').substring(0, 19);
  return searchRead(
    'sale.order',
    [['state', 'in', ['sale', 'done']], ['write_date', '>', sinceStr]],
    [
      'id', 'name', 'partner_id', 'date_order', 'state',
      'amount_total', 'order_line', 'write_date',
    ],
    { limit: 200, order: 'write_date desc' }
  );
}

export default {
  authenticate,
  version,
  search,
  read,
  searchRead,
  searchCount,
  create,
  write,
  execute,
  fetchProducts,
  fetchCustomers,
  fetchSaleOrders,
  fetchOrderLines,
  fetchStockQuants,
  fetchProductsModifiedSince,
  fetchCustomersModifiedSince,
  fetchOrdersModifiedSince,
  createSaleOrder,
  createLead,
  createEmployee,
  updateSaleOrderStatus,
  createInventoryAdjustment,
  // Van warehouse integration
  findOrCreateVanLocation,
  getWarehouseStockLocationId,
  getCustomerLocationId,
  createStockTransfer,
  validateStockPicking,
  validateDeliveryForSaleOrder,
  confirmSaleOrderWithVanLocation,
};
