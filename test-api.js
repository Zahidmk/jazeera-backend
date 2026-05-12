// Quick API test script
const http = require('http');

const BASE = 'http://localhost:3000';
let TOKEN = '';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (TOKEN) opts.headers['Authorization'] = `Bearer ${TOKEN}`;
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  console.log('=== JAZEERA API TEST ===\n');

  // 1. Health
  const h = await request('GET', '/health');
  console.log(`✅ Health: ${h.status} — ${h.body.message}`);

  // 2. Login
  const login = await request('POST', '/api/v1/auth/login', { email: 'driver@jazeera.com', password: 'password123' });
  console.log(`${login.status === 200 ? '✅' : '❌'} Login: ${login.status} — ${login.body.success ? 'Got token' : login.body.error}`);
  TOKEN = login.body.data?.token || '';

  if (!TOKEN) { console.log('❌ No token, stopping.'); return; }

  // 3. Get Me
  const me = await request('GET', '/api/v1/auth/me');
  console.log(`${me.status === 200 ? '✅' : '❌'} Get Me: ${me.status} — ${me.body.data?.name || me.body.error}`);

  // 4. Home
  const home = await request('GET', '/api/v1/driver/home');
  console.log(`${home.status === 200 ? '✅' : '❌'} Home: ${home.status} — Pending: ${home.body.data?.stats?.pendingDeliveries}`);

  // 5. Route
  const route = await request('GET', '/api/v1/driver/route');
  console.log(`${route.status === 200 ? '✅' : '❌'} Route: ${route.status} — Stops: ${route.body.data?.stops?.length}`);

  // 6. Deliveries
  const del = await request('GET', '/api/v1/driver/deliveries');
  console.log(`${del.status === 200 ? '✅' : '❌'} Deliveries: ${del.status} — Count: ${del.body.data?.length}`);

  // 7. Delivery Detail
  const delId = del.body.data?.[0]?.id;
  if (delId) {
    const detail = await request('GET', `/api/v1/driver/deliveries/${delId}`);
    console.log(`${detail.status === 200 ? '✅' : '❌'} Delivery Detail: ${detail.status} — Customer: ${detail.body.data?.customer?.name}`);

    // 8. Update status
    const upd = await request('PATCH', `/api/v1/driver/deliveries/${delId}/status`, { status: 'DELIVERED' });
    console.log(`${upd.status === 200 ? '✅' : '❌'} Delivery Status Update: ${upd.status} — ${upd.body.data?.status}`);
  }

  // 9. Van Inventory
  const inv = await request('GET', '/api/v1/driver/van/inventory');
  console.log(`${inv.status === 200 ? '✅' : '❌'} Van Inventory: ${inv.status} — Items: ${inv.body.data?.totalItems}, Units: ${inv.body.data?.totalUnits}`);

  // 10. Product Search
  const search = await request('GET', '/api/v1/products/search?q=water');
  console.log(`${search.status === 200 ? '✅' : '❌'} Product Search: ${search.status} — Found: ${search.body.data?.length}`);

  // 11. Stock Scan (barcode)
  const scan = await request('POST', '/api/v1/driver/stock/scan', { barcode: '6281234500001', quantity: 10 });
  console.log(`${scan.status === 200 ? '✅' : '❌'} Stock Scan: ${scan.status} — ${scan.body.data?.product?.name || scan.body.error}`);

  // 12. Stock Queue
  const queue = await request('GET', '/api/v1/driver/stock/queue');
  console.log(`${queue.status === 200 ? '✅' : '❌'} Stock Queue: ${queue.status} — Items: ${queue.body.data?.length}`);

  // 13. Confirm Stock Load
  const confirm = await request('POST', '/api/v1/driver/stock/confirm');
  console.log(`${confirm.status === 200 ? '✅' : '❌'} Stock Confirm: ${confirm.status} — ${confirm.body.message || confirm.body.error}`);

  // 14. Add to Cart
  const products = search.body.data;
  if (products?.length) {
    const cart = await request('POST', '/api/v1/driver/sales/cart/items', { productId: products[0].id, quantity: 5 });
    console.log(`${cart.status === 200 ? '✅' : '❌'} Add to Cart: ${cart.status} — Items: ${cart.body.data?.length}`);

    // 15. Get Cart
    const getCart = await request('GET', '/api/v1/driver/sales/cart');
    console.log(`${getCart.status === 200 ? '✅' : '❌'} Get Cart: ${getCart.status} — Total: ${getCart.body.data?.totalAmount}`);

    // 16. Submit Sale
    const sale = await request('POST', '/api/v1/driver/sales/submit', { customerName: 'Walk-in Customer', customerPhone: '+971501111111', saleType: 'CASH' });
    console.log(`${sale.status === 201 ? '✅' : '❌'} Submit Sale: ${sale.status} — ${sale.body.data?.id ? 'Sale ID: ' + sale.body.data.id.substring(0, 8) + '...' : sale.body.error}`);
  }

  // 17. Stock Adjust
  if (search.body.data?.[0]) {
    const adj = await request('POST', '/api/v1/driver/stock/adjust', { productId: search.body.data[0].id, quantity: 2, reason: 'DAMAGE', notes: 'Broken in transit' });
    console.log(`${adj.status === 200 ? '✅' : '❌'} Stock Adjust: ${adj.status} — ${adj.body.message || adj.body.error}`);
  }

  // 18. Add Lead
  const lead = await request('POST', '/api/v1/driver/leads', { name: 'New Shop Owner', phone: '+971502222222', address: 'Al Quoz, Dubai', notes: 'Interested in bulk water orders' });
  console.log(`${lead.status === 201 ? '✅' : '❌'} Add Lead: ${lead.status} — ${lead.body.data?.name || lead.body.error}`);

  // 19. End Shift
  const shift = await request('POST', '/api/v1/driver/shift/end', { notes: 'Good day, all deliveries completed' });
  console.log(`${shift.status === 200 ? '✅' : '❌'} End Shift: ${shift.status} — ${shift.body.data?.shiftId ? 'Shift ended' : shift.body.error}`);

  // 20. Forgot Password
  const forgot = await request('POST', '/api/v1/auth/forgot-password', { email: 'driver@jazeera.com' });
  console.log(`${forgot.status === 200 ? '✅' : '❌'} Forgot Password: ${forgot.status} — ${forgot.body.message}`);

  console.log('\n=== TEST COMPLETE ===');
}

test().catch(console.error);
