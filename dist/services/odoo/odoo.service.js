"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
exports.search = search;
exports.read = read;
exports.searchRead = searchRead;
exports.searchCount = searchCount;
exports.create = create;
exports.write = write;
exports.version = version;
exports.fetchProducts = fetchProducts;
exports.fetchCustomers = fetchCustomers;
exports.fetchSaleOrders = fetchSaleOrders;
exports.fetchOrderLines = fetchOrderLines;
exports.fetchStockQuants = fetchStockQuants;
exports.createSaleOrder = createSaleOrder;
exports.createLead = createLead;
exports.findOrCreateVanLocation = findOrCreateVanLocation;
exports.getWarehouseStockLocationId = getWarehouseStockLocationId;
exports.getCustomerLocationId = getCustomerLocationId;
exports.createStockTransfer = createStockTransfer;
exports.validateStockPicking = validateStockPicking;
exports.validateDeliveryForSaleOrder = validateDeliveryForSaleOrder;
exports.confirmSaleOrderWithVanLocation = confirmSaleOrderWithVanLocation;
exports.updateSaleOrderStatus = updateSaleOrderStatus;
exports.createInventoryAdjustment = createInventoryAdjustment;
exports.fetchProductsModifiedSince = fetchProductsModifiedSince;
exports.fetchCustomersModifiedSince = fetchCustomersModifiedSince;
exports.fetchOrdersModifiedSince = fetchOrdersModifiedSince;
const xmlrpc_1 = __importDefault(require("xmlrpc"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../../.env') });
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
const createClient = (endpoint) => {
    const opts = { host, port, path: endpoint };
    return isSecure ? xmlrpc_1.default.createSecureClient(opts) : xmlrpc_1.default.createClient(opts);
};
const commonClient = createClient('/xmlrpc/2/common');
const objectClient = createClient('/xmlrpc/2/object');
// ─── Cache UID ──────────────────────────────────────────
let cachedUid = null;
// ─── Helper: promisify xmlrpc calls ─────────────────────
function rpcCall(client, method, params) {
    return new Promise((resolve, reject) => {
        client.methodCall(method, params, (err, result) => {
            if (err)
                reject(err);
            else
                resolve(result);
        });
    });
}
// ─── Authenticate ───────────────────────────────────────
async function authenticate() {
    if (cachedUid)
        return cachedUid;
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
    cachedUid = uid;
    console.log(`✅ Odoo authenticated — UID: ${uid}`);
    return uid;
}
// ─── Generic Execute (execute_kw) ───────────────────────
async function execute(model, method, args, kwargs = {}) {
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
async function search(model, domain, options = {}) {
    return execute(model, 'search', [domain], options);
}
/** Read records by IDs */
async function read(model, ids, fields = []) {
    return execute(model, 'read', [ids], { fields });
}
/** Search + Read in one call */
async function searchRead(model, domain, fields = [], options = {}) {
    return execute(model, 'search_read', [domain], { fields, ...options });
}
/** Count records */
async function searchCount(model, domain = [[]]) {
    return execute(model, 'search_count', [domain]);
}
/** Create a record — returns new ID */
async function create(model, values) {
    return execute(model, 'create', [values]);
}
/** Update records */
async function write(model, ids, values) {
    return execute(model, 'write', [ids, values]);
}
// ─── Version Check (no auth needed) ─────────────────────
async function version() {
    return rpcCall(commonClient, 'version', []);
}
// ─── Specific Business Methods ──────────────────────────
/** Fetch all products from Odoo */
async function fetchProducts(limit = 500) {
    return searchRead('product.product', [['sale_ok', '=', true]], [
        'id', 'name', 'default_code', 'barcode', 'list_price',
        'standard_price', 'categ_id', 'uom_id', 'image_128',
        'type', 'active', 'qty_available',
    ], { limit });
}
/** Fetch all customers (res.partner) */
async function fetchCustomers(limit = 500) {
    return searchRead('res.partner', [['customer_rank', '>', 0]], [
        'id', 'name', 'phone', 'mobile', 'email',
        'street', 'street2', 'city', 'partner_latitude',
        'partner_longitude',
    ], { limit });
}
/** Fetch sale orders (for deliveries) */
async function fetchSaleOrders(limit = 100) {
    return searchRead('sale.order', [['state', 'in', ['sale', 'done']]], [
        'id', 'name', 'partner_id', 'date_order', 'state',
        'amount_total', 'order_line',
    ], { limit, order: 'date_order desc' });
}
/** Fetch sale order lines */
async function fetchOrderLines(ids) {
    return read('sale.order.line', ids, ['id', 'product_id', 'product_uom_qty', 'price_unit', 'price_subtotal']);
}
/** Fetch stock quants (warehouse inventory) */
async function fetchStockQuants(limit = 500) {
    return searchRead('stock.quant', [['location_id.usage', '=', 'internal']], ['id', 'product_id', 'quantity', 'location_id'], { limit });
}
/** Create a sale order in Odoo (for cash sales) */
async function createSaleOrder(partnerId, lines) {
    const orderLines = lines.map((l) => [
        0, 0,
        {
            product_id: l.productId,
            product_uom_qty: l.qty,
            price_unit: l.price,
            discount: l.discount || 0,
        },
    ]);
    return create('sale.order', {
        partner_id: partnerId,
        order_line: orderLines,
    });
}
/** Create a CRM lead in Odoo */
async function createLead(data) {
    return create('crm.lead', {
        name: data.name,
        phone: data.phone || false,
        street: data.street || false,
        description: data.description || false,
        type: 'lead',
    });
}
// ─── Van as Odoo Stock Location ──────────────────────────────────────────────
/**
 * Find or create a virtual stock location for a van inside Odoo.
 * Location path: Physical Locations / Virtual Locations / Vans / Van-<plateNumber>
 * Returns the Odoo location ID.
 */
async function findOrCreateVanLocation(plateNumber) {
    const locationName = `Van-${plateNumber}`;
    // Search for existing van location
    const existing = await search('stock.location', [
        ['name', '=', locationName],
        ['usage', '=', 'internal'],
    ]);
    if (existing.length > 0)
        return existing[0];
    // Find the parent "Vans" location (or fallback to Virtual Locations)
    let parentId;
    const vansParent = await search('stock.location', [
        ['name', '=', 'Vans'],
        ['usage', '=', 'view'],
    ]);
    if (vansParent.length > 0) {
        parentId = vansParent[0];
    }
    else {
        // Find Virtual Locations as parent
        const virtualLocs = await search('stock.location', [
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
async function getWarehouseStockLocationId() {
    const locs = await searchRead('stock.location', [['usage', '=', 'internal'], ['name', '=', 'Stock']], ['id', 'name', 'complete_name'], { limit: 1 });
    if (locs.length > 0)
        return locs[0].id;
    // Fallback to location id 8 (WH/Stock is typically 8 in a fresh Odoo)
    return 8;
}
/**
 * Get the customer output location (used for outgoing deliveries).
 * Typically "WH/Output" or "Partners/Customers"
 */
async function getCustomerLocationId() {
    const locs = await search('stock.location', [
        ['usage', '=', 'customer'],
    ]);
    return locs[0] ?? 5; // 5 is Odoo default customer location
}
/**
 * Create an internal stock transfer (picking) in Odoo.
 * e.g. from warehouse → van location (for loading van at start of day)
 * Returns the picking ID.
 */
async function createStockTransfer(fromLocationId, toLocationId, lines, note) {
    // Find the internal operation type
    const opTypes = await searchRead('stock.picking.type', [['code', '=', 'internal']], ['id', 'name', 'default_location_src_id', 'warehouse_id'], { limit: 1 });
    const pickingTypeId = opTypes[0]?.id;
    if (!pickingTypeId)
        throw new Error('No internal picking type found in Odoo');
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
async function validateStockPicking(pickingId) {
    // First confirm the picking
    try {
        await execute('stock.picking', 'action_confirm', [[pickingId]]);
    }
    catch {
        // May already be confirmed
    }
    // Check availability
    try {
        await execute('stock.picking', 'action_assign', [[pickingId]]);
    }
    catch {
        // Ignore — may not be needed
    }
    // Set all move_line quantities to done
    const picking = await read('stock.picking', [pickingId], ['move_line_ids', 'move_ids']);
    if (picking[0]?.move_line_ids?.length > 0) {
        for (const lineId of picking[0].move_line_ids) {
            const [line] = await read('stock.move.line', [lineId], ['reserved_qty', 'quantity']);
            await write('stock.move.line', [lineId], { quantity: line.reserved_qty || line.quantity });
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
async function validateDeliveryForSaleOrder(odooSaleOrderId) {
    // Find outgoing pickings for this sale order
    const pickings = await searchRead('stock.picking', [
        ['sale_id', '=', odooSaleOrderId],
        ['state', 'not in', ['done', 'cancel']],
        ['picking_type_code', '=', 'outgoing'],
    ], ['id', 'name', 'state', 'picking_type_code'], { limit: 5 });
    if (pickings.length === 0) {
        console.warn(`⚠️  Odoo: No pending outgoing picking found for sale order ${odooSaleOrderId}`);
        return;
    }
    for (const picking of pickings) {
        try {
            await validateStockPicking(picking.id);
            console.log(`✅ Odoo: Validated delivery picking ${picking.name} for SO ${odooSaleOrderId}`);
        }
        catch (err) {
            console.error(`⚠️  Odoo: Could not validate picking ${picking.id}:`, err?.message);
        }
    }
}
/**
 * Confirm a sale order in Odoo (sale → confirmed) and set the delivery
 * location to the van's Odoo location so stock is pulled from the van.
 */
async function confirmSaleOrderWithVanLocation(odooSaleOrderId, vanLocationId) {
    try {
        await execute('sale.order', 'action_confirm', [[odooSaleOrderId]]);
    }
    catch {
        // Already confirmed
    }
    // Update the outgoing picking's source location to the van
    const pickings = await searchRead('stock.picking', [['sale_id', '=', odooSaleOrderId], ['state', 'not in', ['done', 'cancel']]], ['id', 'state', 'location_id'], { limit: 5 });
    for (const picking of pickings) {
        try {
            await write('stock.picking', [picking.id], { location_id: vanLocationId });
            // Also update move lines
            const moveLine = await read('stock.picking', [picking.id], ['move_ids']);
            if (moveLine[0]?.move_ids?.length > 0) {
                await write('stock.move', moveLine[0].move_ids, { location_id: vanLocationId });
            }
        }
        catch (err) {
            console.warn(`⚠️  Could not set van location on picking ${picking.id}:`, err?.message);
        }
    }
    console.log(`✅ Odoo: Confirmed SO ${odooSaleOrderId} with van location ${vanLocationId}`);
}
/** Update sale order status in Odoo — called when delivery is DELIVERED or FAILED */
async function updateSaleOrderStatus(odooOrderId, status, notes) {
    // Map our status to Odoo action
    // DELIVERED → confirm order (action_confirm) if draft, or mark done
    // FAILED    → cancel order (action_cancel)
    if (status === 'DELIVERED') {
        // Try to confirm if not already confirmed
        try {
            await execute('sale.order', 'action_confirm', [[odooOrderId]]);
        }
        catch {
            // Already confirmed — ignore
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
    }
    else {
        // FAILED → cancel
        try {
            await execute('sale.order', 'action_cancel', [[odooOrderId]]);
        }
        catch {
            // May already be cancelled or not cancellable — log but don't throw
            console.warn(`⚠️  Could not cancel Odoo order ${odooOrderId}`);
        }
        return true;
    }
}
/** Create stock adjustment in Odoo (for damage/expiry) */
async function createInventoryAdjustment(productId, locationId, qty, reason) {
    // Odoo 17+: update stock.quant inventory_quantity then call action_apply_inventory
    const quantIds = await search('stock.quant', [['product_id', '=', productId], ['location_id', '=', locationId]]);
    if (quantIds.length > 0) {
        // Update existing quant
        await write('stock.quant', quantIds, { inventory_quantity: qty });
        await execute('stock.quant', 'action_apply_inventory', [quantIds]);
        return quantIds[0];
    }
    else {
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
async function fetchProductsModifiedSince(since) {
    const sinceStr = since.toISOString().replace('T', ' ').substring(0, 19);
    return searchRead('product.product', [['sale_ok', '=', true], ['write_date', '>', sinceStr]], [
        'id', 'name', 'default_code', 'barcode', 'list_price',
        'standard_price', 'categ_id', 'uom_id', 'image_128',
        'type', 'active', 'qty_available', 'write_date',
    ], { limit: 500 });
}
/** Customers modified after `since` */
async function fetchCustomersModifiedSince(since) {
    const sinceStr = since.toISOString().replace('T', ' ').substring(0, 19);
    return searchRead('res.partner', [['customer_rank', '>', 0], ['write_date', '>', sinceStr]], [
        'id', 'name', 'phone', 'mobile', 'email',
        'street', 'street2', 'city', 'partner_latitude',
        'partner_longitude', 'write_date',
    ], { limit: 500 });
}
/** Sale orders modified after `since` */
async function fetchOrdersModifiedSince(since) {
    const sinceStr = since.toISOString().replace('T', ' ').substring(0, 19);
    return searchRead('sale.order', [['state', 'in', ['sale', 'done']], ['write_date', '>', sinceStr]], [
        'id', 'name', 'partner_id', 'date_order', 'state',
        'amount_total', 'order_line', 'write_date',
    ], { limit: 200, order: 'write_date desc' });
}
exports.default = {
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
//# sourceMappingURL=odoo.service.js.map