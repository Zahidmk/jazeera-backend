require('dotenv').config();
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const http = require('http');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const BASE = 'http://localhost:3000';
let SALESMAN_TOKEN = '';
let MANAGER_TOKEN = '';

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
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

async function runTests() {
  console.log('=== STARTING SALESMAN API INTEGRATION TESTS ===\n');

  // Fetch a customer and a product from database to get valid IDs
  const customer = await prisma.customer.findFirst();
  const product = await prisma.product.findFirst();

  if (!customer || !product) {
    console.error('❌ Error: Please run seed script first before running this test.');
    process.exit(1);
  }

  console.log(`ℹ️ Customer found: ${customer.name} (${customer.id})`);
  console.log(`ℹ️ Product found: ${product.name} (${product.id})`);

  // 1. Login as Salesman
  const sLogin = await request('POST', '/api/v1/auth/login', {
    email: 'salesman@jazeera.com',
    password: 'password123'
  });
  console.log(`${sLogin.status === 200 ? '✅' : '❌'} Salesman Login: ${sLogin.status}`);
  SALESMAN_TOKEN = sLogin.body.data?.token;

  if (!SALESMAN_TOKEN) {
    console.error('❌ Failed to get Salesman token. Aborting.');
    process.exit(1);
  }

  // 2. Login as Manager (for status updates)
  const mLogin = await request('POST', '/api/v1/auth/login', {
    email: 'manager@jazeera.com',
    password: 'password123'
  });
  console.log(`${mLogin.status === 200 ? '✅' : '❌'} Manager Login: ${mLogin.status}`);
  MANAGER_TOKEN = mLogin.body.data?.token;

  // 3. Create a Quotation
  const quoteData = {
    customerId: customer.id,
    remarks: 'Negotiating discount for water crates',
    items: [
      {
        productId: product.id,
        quantity: 20,
        unitPrice: product.priceRetail,
        requestedPrice: product.priceRetail * 0.9, // 10% off requested
        suggestedMode: true
      }
    ]
  };

  const createQuote = await request('POST', '/api/v1/salesman/quotations', quoteData, SALESMAN_TOKEN);
  console.log(`${createQuote.status === 201 ? '✅' : '❌'} Create Quotation: ${createQuote.status}`);
  const quotation = createQuote.body.data;

  if (!quotation) {
    console.error('❌ Failed to create quotation. Aborting.');
    process.exit(1);
  }
  console.log(`   Quotation ID: ${quotation.id}, Total: ${quotation.totalAmount}, Status: ${quotation.status}`);

  // 4. Retrieve Quotations
  const getQuotes = await request('GET', '/api/v1/salesman/quotations', null, SALESMAN_TOKEN);
  console.log(`${getQuotes.status === 200 ? '✅' : '❌'} List Quotations: ${getQuotes.status} — Count: ${getQuotes.body.data?.length}`);

  // 5. Get Quotation by ID
  const getQuote = await request('GET', `/api/v1/salesman/quotations/${quotation.id}`, null, SALESMAN_TOKEN);
  console.log(`${getQuote.status === 200 ? '✅' : '❌'} Get Quotation by ID: ${getQuote.status} — Customer: ${getQuote.body.data?.customer?.name}`);

  // 6. Update Quotation
  const updateData = {
    remarks: 'Negotiated 10% discount updated remarks',
    items: [
      {
        productId: product.id,
        quantity: 25, // Updated qty
        unitPrice: product.priceRetail,
        requestedPrice: product.priceRetail * 0.9,
        suggestedMode: true
      }
    ]
  };
  const updateQuote = await request('PUT', `/api/v1/salesman/quotations/${quotation.id}`, updateData, SALESMAN_TOKEN);
  console.log(`${updateQuote.status === 200 ? '✅' : '❌'} Update Quotation: ${updateQuote.status} — New Total: ${updateQuote.body.data?.totalAmount}`);

  // 7. Submit Quotation
  const submitQuote = await request('POST', `/api/v1/salesman/quotations/${quotation.id}/submit`, null, SALESMAN_TOKEN);
  console.log(`${submitQuote.status === 200 ? '✅' : '❌'} Submit Quotation: ${submitQuote.status} — Status: ${submitQuote.body.data?.status}`);

  // 8. Approve Quotation (as Manager)
  const approveQuote = await request('PATCH', `/api/v1/salesman/quotations/${quotation.id}/status`, {
    status: 'APPROVED'
  }, MANAGER_TOKEN);
  console.log(`${approveQuote.status === 200 ? '✅' : '❌'} Approve Quotation (Manager): ${approveQuote.status} — Status: ${approveQuote.body.data?.status}`);
  console.log(`   PDF Url generated: ${approveQuote.body.data?.pdfUrl}`);

  // 9. Log Visit
  const visitData = {
    customerId: customer.id,
    notes: 'Visited store, discussed new inventory arrival',
    latitude: 25.0754,
    longitude: 55.1887
  };
  const logVisit = await request('POST', '/api/v1/salesman/visits', visitData, SALESMAN_TOKEN);
  console.log(`${logVisit.status === 201 ? '✅' : '❌'} Log Visit: ${logVisit.status} — ID: ${logVisit.body.data?.id}`);

  // 10. List Visits
  const getVisits = await request('GET', '/api/v1/salesman/visits', null, SALESMAN_TOKEN);
  console.log(`${getVisits.status === 200 ? '✅' : '❌'} List Visits: ${getVisits.status} — Count: ${getVisits.body.data?.length}`);

  // 11. Get Dashboard Stats
  const getDashboard = await request('GET', '/api/v1/salesman/dashboard', null, SALESMAN_TOKEN);
  console.log(`${getDashboard.status === 200 ? '✅' : '❌'} Get Dashboard Stats: ${getDashboard.status}`);
  if (getDashboard.status === 200) {
    console.log(`   Response Data:`, JSON.stringify(getDashboard.body.data, null, 2));
  }

  console.log('\n=== INTEGRATION TESTS COMPLETED ===');
  prisma.$disconnect();
}

runTests().catch((err) => {
  console.error('❌ Error executing integration tests:', err);
  prisma.$disconnect();
});
