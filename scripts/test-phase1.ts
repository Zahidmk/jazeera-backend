/**
 * Phase 1 regression test — role authorization, auth hardening, Merchandiser role.
 *
 * Run against a running backend (default http://localhost:3000):
 *   npx ts-node scripts/test-phase1.ts
 *
 * It creates its own throwaway users (email prefix "phase1test-") directly in the DB and removes them
 * afterwards. Existing records are never modified. One Merchandiser is created through the admin API, which
 * (by design) also creates an Odoo hr.employee; that employee is archived again in cleanup.
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import bcrypt from 'bcryptjs';
import prisma from '../src/utils/prisma';
import { write as odooWrite } from '../src/services/odoo/odoo.service';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const API = `${BASE}/api/v1`;
const PASSWORD = 'Phase1-Test-Pass!';
const PREFIX = 'phase1test-';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(`${name} ${detail}`); console.log(`  ❌ ${name} ${detail}`); }
}

async function call(method: string, url: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${API}${url}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

const login = async (email: string, password = PASSWORD) => call('POST', '/auth/login', { body: { email, password } });

/** Expect an exact status */
async function expectStatus(label: string, method: string, url: string, token: string | undefined, expected: number, body?: unknown) {
  const r = await call(method, url, { token, body });
  check(`${label} → ${expected}`, r.status === expected, `(got ${r.status}: ${JSON.stringify(r.json)?.slice(0, 120)})`);
  return r;
}

/** Expect the request to get past the role gate (i.e. neither 401 nor 403) */
async function expectAllowed(label: string, method: string, url: string, token: string) {
  const r = await call(method, url, { token });
  check(`${label} → allowed (not 401/403)`, r.status !== 401 && r.status !== 403, `(got ${r.status}: ${JSON.stringify(r.json)?.slice(0, 120)})`);
  return r;
}

async function main() {
  console.log(`\nPhase 1 tests against ${BASE}\n`);
  const hash = await bcrypt.hash(PASSWORD, 10);
  const tag = Date.now().toString(36);
  const mk = (role: any, extra: Record<string, unknown> = {}) =>
    prisma.user.create({
      data: { name: `P1 ${role}`, email: `${PREFIX}${role.toLowerCase()}-${tag}@example.com`, passwordHash: hash, role, ...extra },
    });

  const users: Record<string, any> = {};
  for (const r of ['ADMIN', 'MANAGER', 'DRIVER', 'SALESMAN', 'STORE_KEEPER']) users[r] = await mk(r);
  users.INACTIVE = await mk('DRIVER', { isActive: false, email: `${PREFIX}inactive-${tag}@example.com` });
  users.ROLECHANGE = await mk('DRIVER', { email: `${PREFIX}rolechange-${tag}@example.com` });
  users.DEACT = await mk('DRIVER', { email: `${PREFIX}deact-${tag}@example.com` });

  const tokens: Record<string, string> = {};
  let merchandiserOdooId: number | null = null;

  try {
    // ── 1. Authentication ──────────────────────────────────────────────────
    console.log('1. Authentication');
    for (const key of ['ADMIN', 'MANAGER', 'DRIVER', 'SALESMAN', 'STORE_KEEPER', 'ROLECHANGE', 'DEACT']) {
      const r = await login(users[key].email);
      check(`login ${key}`, r.status === 200 && !!r.json?.data?.token && r.json.data.user.role === users[key].role);
      tokens[key] = r.json?.data?.token;
    }
    check('wrong password → 401', (await login(users.DRIVER.email, 'nope-nope')).status === 401);
    check('inactive user cannot log in → 401', (await login(users.INACTIVE.email)).status === 401);
    check('missing credentials → 400', (await call('POST', '/auth/login', { body: { password: 'x' } })).status === 400);
    // Regression: {email: undefined} inside an OR matched every row, so an unknown email + a real password could log in as someone else
    const ghost = await call('POST', '/auth/login', { body: { email: `${PREFIX}ghost-${tag}@example.com`, password: 'password123' } });
    check('unknown email + any password → 401 (no arbitrary-user match)', ghost.status === 401, `(got ${ghost.status})`);
    check('login response carries no passwordHash', !JSON.stringify((await login(users.ADMIN.email)).json).includes('passwordHash'));
    await expectStatus('no token on /auth/me', 'GET', '/auth/me', undefined, 401);
    await expectStatus('garbage token on /auth/me', 'GET', '/auth/me', 'not.a.jwt', 401);
    await expectStatus('valid token on /auth/me', 'GET', '/auth/me', tokens.DRIVER, 200);

    // ── 2. /admin/* ────────────────────────────────────────────────────────
    console.log('\n2. /admin/* authorization');
    await expectStatus('admin/stats no token', 'GET', '/admin/stats', undefined, 401);
    for (const r of ['DRIVER', 'SALESMAN', 'STORE_KEEPER']) await expectStatus(`admin/stats as ${r}`, 'GET', '/admin/stats', tokens[r], 403);
    await expectStatus('admin/users as DRIVER', 'GET', '/admin/users', tokens.DRIVER, 403);
    await expectStatus('driver cannot create ADMIN via API', 'POST', '/admin/users', tokens.DRIVER, 403, { name: 'x', email: `${PREFIX}x@example.com`, password: PASSWORD, role: 'ADMIN' });
    await expectStatus('admin/stats as MANAGER', 'GET', '/admin/stats', tokens.MANAGER, 200);
    await expectStatus('admin/stats as ADMIN', 'GET', '/admin/stats', tokens.ADMIN, 200);
    await expectStatus('admin/users as ADMIN', 'GET', '/admin/users', tokens.ADMIN, 200);

    // ── 3. /sync/* and /odoo/* ─────────────────────────────────────────────
    console.log('\n3. /sync/* and /odoo/* authorization');
    for (const [m, u] of [['GET', '/sync/test'], ['GET', '/sync/queue-status'], ['GET', '/sync/logs'], ['POST', '/sync/products'], ['POST', '/sync/customers'],
      ['POST', '/sync/orders'], ['POST', '/sync/all'], ['GET', '/odoo/products'], ['GET', '/odoo/orders'], ['GET', '/odoo/customers'], ['GET', '/odoo/stock']]) {
      await expectStatus(`${m} ${u} no token`, m, u, undefined, 401);
      await expectStatus(`${m} ${u} as DRIVER`, m, u, tokens.DRIVER, 403);
    }
    await expectStatus('GET /sync/test as ADMIN (Odoo connection)', 'GET', '/sync/test', tokens.ADMIN, 200);
    await expectStatus('GET /sync/queue-status as MANAGER', 'GET', '/sync/queue-status', tokens.MANAGER, 200);
    await expectStatus('GET /sync/logs as ADMIN', 'GET', '/sync/logs', tokens.ADMIN, 200);
    const odooProducts = await expectStatus('GET /odoo/products?limit=2 as ADMIN (live Odoo read)', 'GET', '/odoo/products?limit=2', tokens.ADMIN, 200);
    check('odoo/products returns data', Array.isArray(odooProducts.json?.data));

    console.log('   webhook (secret-protected, no JWT)');
    const secret = process.env.ODOO_WEBHOOK_SECRET || '';
    const wh = (headers: Record<string, string>) => call('POST', '/sync/webhook', { body: { event: 'noop.test' }, headers });
    check('webhook without secret → 401', (await wh({})).status === 401);
    check('webhook wrong secret → 401', (await wh({ 'x-odoo-webhook-secret': 'wrong' })).status === 401);
    if (secret) check('webhook right secret passes the secret check (→ 400 missing id, not 401)', (await wh({ 'x-odoo-webhook-secret': secret })).status === 400);

    // ── 4. /driver/* and /driver/sales/* ───────────────────────────────────
    console.log('\n4. /driver/* role validation');
    for (const u of ['/driver/home', '/driver/van/inventory', '/driver/sales/cart']) {
      await expectStatus(`${u} no token`, 'GET', u, undefined, 401);
      for (const r of ['SALESMAN', 'STORE_KEEPER']) await expectStatus(`${u} as ${r}`, 'GET', u, tokens[r], 403);
      await expectAllowed(`${u} as DRIVER`, 'GET', u, tokens.DRIVER);
      await expectAllowed(`${u} as ADMIN`, 'GET', u, tokens.ADMIN);
      await expectAllowed(`${u} as MANAGER`, 'GET', u, tokens.MANAGER);
    }

    // ── 5. Existing roles keep their own areas ─────────────────────────────
    console.log('\n5. Existing role areas unchanged');
    await expectAllowed('salesman/dashboard as SALESMAN', 'GET', '/salesman/dashboard', tokens.SALESMAN);
    await expectAllowed('salesman/dashboard as MANAGER', 'GET', '/salesman/dashboard', tokens.MANAGER);
    await expectStatus('salesman/dashboard as DRIVER', 'GET', '/salesman/dashboard', tokens.DRIVER, 403);
    await expectAllowed('storekeeper/dashboard as STORE_KEEPER', 'GET', '/storekeeper/dashboard', tokens.STORE_KEEPER);
    await expectAllowed('storekeeper/dashboard as ADMIN', 'GET', '/storekeeper/dashboard', tokens.ADMIN);
    await expectStatus('storekeeper/dashboard as DRIVER', 'GET', '/storekeeper/dashboard', tokens.DRIVER, 403);
    await expectAllowed('products/search as DRIVER (authenticated-only route)', 'GET', '/products/search?q=a', tokens.DRIVER);

    // ── 6. Changes take effect immediately ─────────────────────────────────
    console.log('\n6. Immediate effect of role change / deactivation');
    await expectAllowed('before: ROLECHANGE (DRIVER) can use /driver/home', 'GET', '/driver/home', tokens.ROLECHANGE);
    await expectStatus('admin changes role DRIVER→SALESMAN', 'PATCH', `/admin/users/${users.ROLECHANGE.id}`, tokens.ADMIN, 200, { role: 'SALESMAN' });
    await expectStatus('same old token: /driver/home now 403', 'GET', '/driver/home', tokens.ROLECHANGE, 403);
    await expectAllowed('same old token: /salesman/dashboard now allowed', 'GET', '/salesman/dashboard', tokens.ROLECHANGE);

    await expectStatus('before: DEACT token works', 'GET', '/auth/me', tokens.DEACT, 200);
    await expectStatus('admin deactivates user', 'PATCH', `/admin/users/${users.DEACT.id}`, tokens.ADMIN, 200, { isActive: false });
    await expectStatus('same old token: /auth/me now 401', 'GET', '/auth/me', tokens.DEACT, 401);
    await expectStatus('same old token: /driver/home now 401', 'GET', '/driver/home', tokens.DEACT, 401);
    check('deactivated user cannot log in again', (await login(users.DEACT.email)).status === 401);
    await expectStatus('admin reactivates user', 'PATCH', `/admin/users/${users.DEACT.id}`, tokens.ADMIN, 200, { isActive: true });
    await expectStatus('old token works again after reactivation', 'GET', '/auth/me', tokens.DEACT, 200);

    // ── 7. User management & role validation ───────────────────────────────
    console.log('\n7. User management / role validation');
    const base = { name: 'P1 Merch', phone: null };
    const mEmail = `${PREFIX}merch-${tag}@example.com`;
    await expectStatus('invalid role rejected', 'POST', '/admin/users', tokens.ADMIN, 400, { ...base, email: `${PREFIX}bad-${tag}@example.com`, password: PASSWORD, role: 'SUPERUSER' });
    await expectStatus('short password rejected', 'POST', '/admin/users', tokens.ADMIN, 400, { ...base, email: `${PREFIX}bad2-${tag}@example.com`, password: 'short', role: 'MERCHANDISER' });
    await expectStatus('bad email rejected', 'POST', '/admin/users', tokens.ADMIN, 400, { ...base, email: 'not-an-email', password: PASSWORD, role: 'MERCHANDISER' });
    await expectStatus('MANAGER cannot create ADMIN', 'POST', '/admin/users', tokens.MANAGER, 403, { ...base, email: `${PREFIX}esc-${tag}@example.com`, password: PASSWORD, role: 'ADMIN' });
    await expectStatus('MANAGER cannot edit an ADMIN', 'PATCH', `/admin/users/${users.ADMIN.id}`, tokens.MANAGER, 403, { name: 'hijack' });
    await expectStatus('MANAGER cannot grant ADMIN role', 'PATCH', `/admin/users/${users.DRIVER.id}`, tokens.MANAGER, 403, { role: 'ADMIN' });
    await expectStatus('ADMIN cannot demote self', 'PATCH', `/admin/users/${users.ADMIN.id}`, tokens.ADMIN, 400, { role: 'DRIVER' });
    await expectStatus('ADMIN cannot deactivate self', 'PATCH', `/admin/users/${users.ADMIN.id}`, tokens.ADMIN, 400, { isActive: false });
    await expectStatus('PATCH invalid role rejected', 'PATCH', `/admin/users/${users.DRIVER.id}`, tokens.ADMIN, 400, { role: 'NOPE' });

    const created = await expectStatus('ADMIN creates MERCHANDISER', 'POST', '/admin/users', tokens.ADMIN, 201, { ...base, email: mEmail, password: PASSWORD, role: 'MERCHANDISER' });
    const mUser = created.json?.data;
    merchandiserOdooId = mUser?.odooEmployeeId ?? null;
    check('MERCHANDISER role saved', mUser?.role === 'MERCHANDISER');
    check('Odoo employee created & linked (odooEmployeeId set)', typeof mUser?.odooEmployeeId === 'number', `(got ${mUser?.odooEmployeeId})`);
    check('create response has no passwordHash', !!mUser && !('passwordHash' in mUser));
    await expectStatus('duplicate email → 409', 'POST', '/admin/users', tokens.ADMIN, 409, { ...base, email: mEmail, password: PASSWORD, role: 'MERCHANDISER' });

    const list = await call('GET', '/admin/users', { token: tokens.MANAGER });
    check('GET /admin/users lists the merchandiser', Array.isArray(list.json?.data) && list.json.data.some((u: any) => u.id === mUser?.id && u.role === 'MERCHANDISER'));
    check('GET /admin/users exposes no passwordHash', !JSON.stringify(list.json).includes('passwordHash'));
    await expectStatus('MANAGER updates MERCHANDISER (name)', 'PATCH', `/admin/users/${mUser?.id}`, tokens.MANAGER, 200, { name: 'P1 Merch Renamed' });

    // ── 8. Merchandiser login + isolation ──────────────────────────────────
    console.log('\n8. Merchandiser login & isolation');
    const ml = await login(mEmail);
    check('MERCHANDISER can log in', ml.status === 200 && ml.json?.data?.user?.role === 'MERCHANDISER' && !!ml.json?.data?.token);
    const mTok = ml.json?.data?.token;
    const me = await expectStatus('MERCHANDISER /auth/me', 'GET', '/auth/me', mTok, 200);
    check('/auth/me returns role MERCHANDISER', me.json?.data?.role === 'MERCHANDISER');
    for (const u of ['/admin/stats', '/admin/users', '/sync/test', '/sync/logs', '/odoo/products', '/driver/home', '/driver/sales/cart', '/salesman/dashboard', '/storekeeper/dashboard']) {
      await expectStatus(`MERCHANDISER blocked from ${u}`, 'GET', u, mTok, 403);
    }
    await expectStatus('MERCHANDISER blocked: POST /sync/all', 'POST', '/sync/all', mTok, 403);
    await expectStatus('admin deactivates MERCHANDISER → token dead', 'PATCH', `/admin/users/${mUser?.id}`, tokens.ADMIN, 200, { isActive: false });
    await expectStatus('MERCHANDISER old token now 401', 'GET', '/auth/me', mTok, 401);
    await expectStatus('admin changes MERCHANDISER role → DRIVER', 'PATCH', `/admin/users/${mUser?.id}`, tokens.ADMIN, 200, { role: 'DRIVER', isActive: true });
    await expectAllowed('role change is immediate (old token now allowed on /driver/home)', 'GET', '/driver/home', mTok);

    // ── 9. forgot-password still safe ──────────────────────────────────────
    console.log('\n9. forgot-password');
    check('forgot-password, no identifier → 200 generic', (await call('POST', '/auth/forgot-password', { body: {} })).status === 200);
  } finally {
    console.log('\nCleanup');
    if (merchandiserOdooId) {
      try { await odooWrite('hr.employee', [merchandiserOdooId], { active: false }); console.log(`  archived Odoo employee ${merchandiserOdooId}`); }
      catch (e: any) { console.log(`  ⚠️  could not archive Odoo employee ${merchandiserOdooId}: ${e?.message}`); }
    }
    const del = await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    console.log(`  removed ${del.count} temporary users`);
    await prisma.$disconnect();
  }

  console.log(`\n══════════ RESULT: ${passed} passed, ${failed} failed ══════════`);
  if (failed) { console.log(failures.map((f) => ` - ${f}`).join('\n')); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error('Test run crashed:', e); process.exit(2); });
