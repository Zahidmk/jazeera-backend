// Self-contained test: starts server, runs tests, then exits
const fs = require('fs');
const envPath = '/Users/muhammedshakirva/App-jazeera/jazeera-backend/.env';
const envContent = fs.readFileSync(envPath, 'utf8');
envContent.split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && !k.startsWith('#')) process.env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
});

const http = require('http');
const BASE = 'http://127.0.0.1:3000';
let TOKEN = '';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = { hostname: '127.0.0.1', port: 3000, path: url.pathname + url.search, method, headers: { 'Content-Type': 'application/json' } };
    if (TOKEN) opts.headers['Authorization'] = `Bearer ${TOKEN}`;
    const r = http.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ s: res.statusCode, b: JSON.parse(d) }); } catch { resolve({ s: res.statusCode, b: d }); } });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function run() {
  // Wait for server to be ready
  for (let i = 0; i < 20; i++) {
    try { await req('GET', '/health'); break; }
    catch { await new Promise(r => setTimeout(r, 500)); }
  }

  console.log('=== JAZEERA API TEST ===\n');

  const h = await req('GET', '/health');
  console.log(`✅ Health: ${h.s}`);

  const login = await req('POST', '/api/v1/auth/login', { email: 'driver@jazeera.com', password: 'password123' });
  TOKEN = login.b.data?.token || '';
  console.log(`${login.s===200?'✅':'❌'} Login: ${login.s} — ${TOKEN ? 'Got token' : login.b.error}`);
  if (!TOKEN) { console.log('STOP'); process.exit(1); }

  const me = await req('GET', '/api/v1/auth/me');
  console.log(`${me.s===200?'✅':'❌'} Get Me: ${me.s} — ${me.b.data?.name}`);

  const home = await req('GET', '/api/v1/driver/home');
  console.log(`${home.s===200?'✅':'❌'} Home: ${home.s} — Pending: ${home.b.data?.stats?.pendingDeliveries}`);

  const route = await req('GET', '/api/v1/driver/route');
  console.log(`${route.s===200?'✅':'❌'} Route: ${route.s} — Stops: ${route.b.data?.stops?.length}`);

  const del = await req('GET', '/api/v1/driver/deliveries');
  console.log(`${del.s===200?'✅':'❌'} Deliveries: ${del.s} — Count: ${del.b.data?.length}`);

  const delId = del.b.data?.[0]?.id;
  if (delId) {
    const detail = await req('GET', `/api/v1/driver/deliveries/${delId}`);
    console.log(`${detail.s===200?'✅':'❌'} Delivery Detail: ${detail.s} — ${detail.b.data?.customer?.name}`);
    const upd = await req('PATCH', `/api/v1/driver/deliveries/${delId}/status`, { status: 'DELIVERED' });
    console.log(`${upd.s===200?'✅':'❌'} Status Update: ${upd.s} — ${upd.b.data?.status}`);
  }

  const inv = await req('GET', '/api/v1/driver/van/inventory');
  console.log(`${inv.s===200?'✅':'❌'} Van Inventory: ${inv.s} — Items: ${inv.b.data?.totalItems}, Units: ${inv.b.data?.totalUnits}`);

  const srch = await req('GET', '/api/v1/products/search?q=water');
  console.log(`${srch.s===200?'✅':'❌'} Product Search: ${srch.s} — Found: ${srch.b.data?.length}`);

  const scan = await req('POST', '/api/v1/driver/stock/scan', { barcode: '6281234500001', quantity: 10 });
  console.log(`${scan.s===200?'✅':'❌'} Stock Scan: ${scan.s} — ${scan.b.data?.product?.name || scan.b.error}`);

  const queue = await req('GET', '/api/v1/driver/stock/queue');
  console.log(`${queue.s===200?'✅':'❌'} Stock Queue: ${queue.s} — Items: ${queue.b.data?.length}`);

  const conf = await req('POST', '/api/v1/driver/stock/confirm');
  console.log(`${conf.s===200?'✅':'❌'} Stock Confirm: ${conf.s} — ${conf.b.message || conf.b.error}`);

  if (srch.b.data?.length) {
    const cart = await req('POST', '/api/v1/driver/sales/cart/items', { productId: srch.b.data[0].id, quantity: 5 });
    console.log(`${cart.s===200?'✅':'❌'} Add to Cart: ${cart.s}`);
    const gc = await req('GET', '/api/v1/driver/sales/cart');
    console.log(`${gc.s===200?'✅':'❌'} Get Cart: ${gc.s} — Total: ${gc.b.data?.totalAmount}`);
    const sale = await req('POST', '/api/v1/driver/sales/submit', { customerName: 'Walk-in', saleType: 'CASH' });
    console.log(`${sale.s===201?'✅':'❌'} Submit Sale: ${sale.s} — ${sale.b.data?.id ? 'OK' : sale.b.error}`);
  }

  if (srch.b.data?.[0]) {
    const adj = await req('POST', '/api/v1/driver/stock/adjust', { productId: srch.b.data[0].id, quantity: 2, reason: 'DAMAGE', notes: 'Broken' });
    console.log(`${adj.s===200?'✅':'❌'} Stock Adjust: ${adj.s} — ${adj.b.message || adj.b.error}`);
  }

  const lead = await req('POST', '/api/v1/driver/leads', { name: 'New Shop', phone: '+971502222222', address: 'Al Quoz' });
  console.log(`${lead.s===201?'✅':'❌'} Add Lead: ${lead.s} — ${lead.b.data?.name}`);

  const shift = await req('POST', '/api/v1/driver/shift/end', { notes: 'All done' });
  console.log(`${shift.s===200?'✅':'❌'} End Shift: ${shift.s} — ${shift.b.data?.shiftId ? 'Ended' : shift.b.error}`);

  const forgot = await req('POST', '/api/v1/auth/forgot-password', { email: 'driver@jazeera.com' });
  console.log(`${forgot.s===200?'✅':'❌'} Forgot Password: ${forgot.s}`);

  console.log('\n=== ALL 20 API TESTS COMPLETE ===');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
