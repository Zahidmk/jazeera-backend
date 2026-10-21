/**
 * Phase 2 regression test — Merchandiser module (attendance, devices, shops, visits, feedback, admin management).
 *
 *   npx ts-node scripts/test-phase2.ts          (API must be running; start it with AUTH_RATE_LIMIT_MAX=1000)
 *
 * Creates throwaway users/shops with the prefix "phase2test" and removes everything it created, including selfie
 * files. Registering a shop pushes one CRM lead to Odoo (existing behaviour); that lead is archived afterwards.
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import bcrypt from 'bcryptjs';
import prisma from '../src/utils/prisma';
import { write as odooWrite } from '../src/services/odoo/odoo.service';
import { PRIVATE_UPLOAD_ROOT } from '../src/utils/privateUpload';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const API = `${BASE}/api/v1`;
const PASSWORD = 'Phase2-Test-Pass!';
const PREFIX = 'phase2test';

// Valid 1x1 PNG and a minimal JPEG header (the server checks real magic bytes)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]), Buffer.alloc(64, 1)]);

// Riyadh city centre, and a point ~5.5 km away
const HERE = { latitude: 24.7136, longitude: 46.6753 };
const FAR = { latitude: 24.7636, longitude: 46.6753 };

let passed = 0, failed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); } else { failed++; failures.push(`${name} ${detail}`); console.log(`  ❌ ${name} ${detail}`); }
};

async function req(method: string, url: string, token?: string, body?: unknown, raw?: FormData) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!raw && body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${url}`, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const ct = res.headers.get('content-type') || '';
  let json: any = null; let buf: Buffer | null = null;
  if (ct.includes('application/json')) { try { json = await res.json(); } catch { /* */ } } else { buf = Buffer.from(await res.arrayBuffer()); }
  return { status: res.status, json, buf, ct };
}
const expect = async (label: string, r: Promise<{ status: number; json: any }>, status: number) => {
  const x = await r; check(`${label} → ${status}`, x.status === status, `(got ${x.status}: ${JSON.stringify(x.json)?.slice(0, 140)})`); return x;
};

function form(fields: Record<string, unknown>, file?: { buf: Buffer; mime: string; name?: string } | null) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, String(v));
  if (file) fd.append('selfie', new Blob([new Uint8Array(file.buf)], { type: file.mime }), file.name || 'selfie.png');
  return fd;
}
const att = (extra: Record<string, unknown> = {}, file: { buf: Buffer; mime: string; name?: string } | null = { buf: PNG, mime: 'image/png' }) =>
  form({ ...HERE, accuracy: 12.5, deviceId: 'device-A-0001', deviceName: 'Pixel Test', biometricVerified: true, biometricMethod: 'fingerprint', capturedAt: new Date().toISOString(), ...extra }, file);

async function main() {
  console.log(`\nPhase 2 tests against ${BASE}\n`);
  const hash = await bcrypt.hash(PASSWORD, 10);
  const tag = Date.now().toString(36);
  const mk = (role: any, name: string) => prisma.user.create({ data: { name: `P2 ${name}`, email: `${PREFIX}-${name.toLowerCase()}-${tag}@example.com`, passwordHash: hash, role } });
  const U: Record<string, any> = {
    ADMIN: await mk('ADMIN', 'admin'), MANAGER: await mk('MANAGER', 'manager'), DRIVER: await mk('DRIVER', 'driver'),
    SALESMAN: await mk('SALESMAN', 'salesman'), M1: await mk('MERCHANDISER', 'merch1'), M2: await mk('MERCHANDISER', 'merch2'),
  };
  const T: Record<string, string> = {};
  const leadOdooIds: number[] = [];

  try {
    for (const k of Object.keys(U)) {
      const r = await req('POST', '/auth/login', undefined, { email: U[k].email, password: PASSWORD });
      T[k] = r.json?.data?.token;
      if (!T[k]) throw new Error(`login failed for ${k}: ${JSON.stringify(r.json)}`);
    }

    // ── A. permission matrix ────────────────────────────────────────────────
    console.log('A. Permissions');
    const appGets = ['/merchandiser/attendance/status', '/merchandiser/attendance', '/merchandiser/shops', `/merchandiser/shops/nearby?lat=${HERE.latitude}&lng=${HERE.longitude}`, '/merchandiser/visits', '/merchandiser/visits/current'];
    for (const u of appGets) {
      await expect(`${u.split('?')[0]} no token`, req('GET', u), 401);
      for (const r of ['DRIVER', 'SALESMAN', 'ADMIN', 'MANAGER']) await expect(`${u.split('?')[0]} as ${r}`, req('GET', u, T[r]), 403);
      await expect(`${u.split('?')[0]} as MERCHANDISER`, req('GET', u, T.M1), 200);
    }
    for (const u of ['/admin/merchandisers', '/admin/attendance', '/admin/devices', '/admin/shops', '/admin/shop-visits', '/admin/feedback']) {
      await expect(`${u} no token`, req('GET', u), 401);
      for (const r of ['M1', 'DRIVER', 'SALESMAN']) await expect(`${u} as ${r}`, req('GET', u, T[r]), 403);
      for (const r of ['ADMIN', 'MANAGER']) await expect(`${u} as ${r}`, req('GET', u, T[r]), 200);
    }
    await expect('check-in no token', req('POST', '/merchandiser/attendance/check-in', undefined, undefined, att()), 401);
    await expect('check-in as DRIVER', req('POST', '/merchandiser/attendance/check-in', T.DRIVER, undefined, att()), 403);

    // ── B. attendance validation ────────────────────────────────────────────
    console.log('\nB. Attendance validation');
    const ci = (fd: FormData, t = T.M1) => req('POST', '/merchandiser/attendance/check-in', t, undefined, fd);
    await expect('missing selfie', ci(att({}, null)), 400);
    await expect('biometricVerified missing', ci(att({ biometricVerified: undefined })), 400);
    await expect('biometricVerified=false', ci(att({ biometricVerified: false })), 400);
    await expect('missing GPS', ci(att({ latitude: undefined, longitude: undefined })), 400);
    await expect('GPS out of range', ci(att({ latitude: 123, longitude: 46 })), 400);
    await expect('GPS (0,0) rejected', ci(att({ latitude: 0, longitude: 0 })), 400);
    await expect('missing deviceId', ci(att({ deviceId: undefined })), 400);
    await expect('invalid capturedAt', ci(att({ capturedAt: 'not-a-date' })), 400);
    await expect('text file as selfie (wrong mime)', ci(att({}, { buf: Buffer.from('hello'), mime: 'text/plain', name: 'x.txt' })), 400);
    await expect('fake image (png mime, text content)', ci(att({}, { buf: Buffer.from('this is not an image at all'), mime: 'image/png' })), 400);
    await expect('oversized selfie (>5MB)', ci(att({}, { buf: Buffer.concat([PNG, Buffer.alloc(5.5 * 1024 * 1024)]), mime: 'image/png' })), 400);
    await expect('check-out when not checked in', req('POST', '/merchandiser/attendance/check-out', T.M1, undefined, att()), 409);
    const stray = fs.existsSync(path.join(PRIVATE_UPLOAD_ROOT, 'attendance', U.M1.id)) ? fs.readdirSync(path.join(PRIVATE_UPLOAD_ROOT, 'attendance', U.M1.id)).length : 0;
    check('rejected uploads leave no files on disk', stray === 0, `(found ${stray})`);

    // ── C. check-in / selfie ────────────────────────────────────────────────
    console.log('\nC. Check-in, selfie access');
    const in1 = await expect('MERCHANDISER check-in', ci(att()), 201);
    const a1 = in1.json?.data;
    check('attendance has server time, GPS, device, biometric', !!a1?.checkInAt && a1.checkInLat === HERE.latitude && a1.checkInLng === HERE.longitude && a1.checkInDeviceId === 'device-A-0001' && a1.checkInBiometric === true && a1.checkInBiometricMethod === 'fingerprint' && a1.isOpen === true);
    check('response exposes no server file path', !JSON.stringify(a1).includes('private-uploads') && !('checkInSelfie' in a1));
    await expect('second check-in blocked', ci(att()), 409);
    const st = await expect('status endpoint', req('GET', '/merchandiser/attendance/status', T.M1), 200);
    check('status shows checked in + approved device', st.json.data.isCheckedIn === true && st.json.data.devices[0]?.isApproved === true);
    const own = await req('GET', `/merchandiser/attendance/${a1.id}/selfie?type=in`, T.M1);
    check('own selfie download → 200 image/png, same bytes', own.status === 200 && own.ct.includes('image/png') && !!own.buf && own.buf.equals(PNG), `(got ${own.status} ${own.ct})`);
    const hdr = await fetch(`${API}/merchandiser/attendance/${a1.id}/selfie?type=in`, { headers: { Authorization: `Bearer ${T.M1}` } });
    check('selfie served with Cache-Control: private, no-store', /no-store/.test(hdr.headers.get('cache-control') || ''), `(got ${hdr.headers.get('cache-control')})`);
    await expect('other merchandiser cannot read selfie', req('GET', `/merchandiser/attendance/${a1.id}/selfie?type=in`, T.M2), 404);
    await expect('selfie without token', req('GET', `/merchandiser/attendance/${a1.id}/selfie?type=in`), 401);
    await expect('admin can view selfie', req('GET', `/admin/attendance/${a1.id}/selfie?type=in`, T.ADMIN), 200);
    await expect('manager can view selfie', req('GET', `/admin/attendance/${a1.id}/selfie?type=in`, T.MANAGER), 200);
    await expect('driver cannot view selfie via admin', req('GET', `/admin/attendance/${a1.id}/selfie?type=in`, T.DRIVER), 403);
    await expect('check-out selfie absent → 404', req('GET', `/admin/attendance/${a1.id}/selfie?type=out`, T.ADMIN), 404);
    const pub = await fetch(`${BASE}/uploads/attendance/${U.M1.id}/anything.png`);
    check('selfies are not reachable via public /uploads', pub.status === 404, `(got ${pub.status})`);

    // ── D. device binding ───────────────────────────────────────────────────
    console.log('\nD. Device binding');
    await expect('M2 first device auto-approved (check-in)', req('POST', '/merchandiser/attendance/check-in', T.M2, undefined, att({ deviceId: 'device-M2-A' })), 201);
    await expect('M2 check-out from NEW device blocked', req('POST', '/merchandiser/attendance/check-out', T.M2, undefined, att({ deviceId: 'device-M2-B', deviceName: 'Other phone' })), 403);
    const pend = await expect('admin lists pending devices', req('GET', '/admin/devices?pending=true', T.ADMIN), 200);
    const devB = pend.json.data.find((d: any) => d.deviceId === 'device-M2-B');
    check('pending device visible to admin', !!devB && devB.isApproved === false);
    await expect('approve needs boolean', req('PATCH', `/admin/devices/${devB?.id}`, T.ADMIN, { isApproved: 'yes' }), 400);
    await expect('admin approves device', req('PATCH', `/admin/devices/${devB?.id}`, T.ADMIN, { isApproved: true }), 200);
    const out2 = await expect('M2 check-out from approved 2nd device', req('POST', '/merchandiser/attendance/check-out', T.M2, undefined, att({ deviceId: 'device-M2-B' }, { buf: JPG, mime: 'image/jpeg', name: 's.jpg' })), 200);
    check('different-device check-out auto-flagged', out2.json.data.flagged === true && out2.json.data.isOpen === false && typeof out2.json.data.durationMinutes === 'number');
    await expect('M2 out-selfie is JPEG', req('GET', `/merchandiser/attendance/${out2.json.data.id}/selfie?type=out`, T.M2), 200);
    await expect('admin revokes device', req('PATCH', `/admin/devices/${devB?.id}`, T.ADMIN, { isApproved: false }), 200);

    // ── E. shops ────────────────────────────────────────────────────────────
    console.log('\nE. Shops');
    const phone = `+9665${Math.floor(10000000 + Math.random() * 89999999)}`;
    const shopBody = { name: `P2 Test Shop ${tag}`, phone, contactPerson: 'Ali', shopType: 'Grocery', address: 'Olaya St', city: 'Riyadh', district: 'Olaya', notes: 'created by test', ...HERE };
    await expect('shop without location', req('POST', '/merchandiser/shops', T.M1, { ...shopBody, latitude: undefined, longitude: undefined }), 400);
    await expect('shop with short name', req('POST', '/merchandiser/shops', T.M1, { ...shopBody, name: 'A' }), 400);
    await expect('shop with bad phone', req('POST', '/merchandiser/shops', T.M1, { ...shopBody, phone: 'abc' }), 400);
    await expect('driver cannot create shop via merchandiser API', req('POST', '/merchandiser/shops', T.DRIVER, shopBody), 403);
    const made = await expect('register new shop', req('POST', '/merchandiser/shops', T.M1, shopBody), 201);
    const shop = made.json?.data;
    check('shop saved with GPS + details + isMine + leadId', shop?.lat === HERE.latitude && shop?.lng === HERE.longitude && shop?.isMine === true && !!shop?.leadId && shop?.shopType === 'Grocery');
    const dbShop = await prisma.customer.findUnique({ where: { id: shop.id } });
    check('stored as Customer (existing system) with createdBy', dbShop?.createdById === U.M1.id && dbShop?.name === shopBody.name);
    const dbLead = await prisma.lead.findFirst({ where: { customerId: shop.id } });
    check('Lead created for admin approval (existing pipeline)', dbLead?.driverId === U.M1.id && dbLead?.status === 'PENDING');
    const dup = await expect('duplicate phone → 409', req('POST', '/merchandiser/shops', T.M1, shopBody), 409);
    check('duplicate response names the existing shop', dup.json?.existingShop?.id === shop.id && dup.json?.code === 'DUPLICATE_PHONE');

    const near = await expect('nearby shops', req('GET', `/merchandiser/shops/nearby?lat=${HERE.latitude}&lng=${HERE.longitude}&radiusKm=1`, T.M1), 200);
    const inNear = near.json.data.find((s: any) => s.id === shop.id);
    check('nearby includes new shop with distance ~0 m', !!inNear && inNear.distanceM <= 5, `(${JSON.stringify(inNear?.distanceM)})`);
    check('nearby sorted by distance', near.json.data.every((s: any, i: number, a: any[]) => i === 0 || a[i - 1].distanceM <= s.distanceM));
    const farNear = await req('GET', `/merchandiser/shops/nearby?lat=${FAR.latitude}&lng=${FAR.longitude}&radiusKm=1`, T.M1);
    check('nearby respects radius (shop 5.5 km away excluded)', !farNear.json.data.some((s: any) => s.id === shop.id));
    await expect('nearby without coords', req('GET', '/merchandiser/shops/nearby', T.M1), 400);
    const byName = await req('GET', `/merchandiser/shops?q=${encodeURIComponent('P2 Test Shop ' + tag)}`, T.M1);
    check('search by name', byName.json.data.some((s: any) => s.id === shop.id));
    const byPhone = await req('GET', `/merchandiser/shops?q=${encodeURIComponent(phone.slice(-8))}`, T.M1);
    check('search by phone', byPhone.json.data.some((s: any) => s.id === shop.id));
    check('search with no match is empty', (await req('GET', '/merchandiser/shops?q=zzzz-no-such-shop-zzzz', T.M1)).json.data.length === 0);
    const detail = await expect('shop detail', req('GET', `/merchandiser/shops/${shop.id}`, T.M1), 200);
    check('detail has contact + visit stats', detail.json.data.contactPerson === 'Ali' && detail.json.data.myVisitCount === 0);
    await expect('unknown shop → 404', req('GET', '/merchandiser/shops/00000000-0000-0000-0000-000000000000', T.M1), 404);
    check('shop list hides createdById', !('createdById' in detail.json.data));
    await expect('M2 cannot edit M1 shop', req('PATCH', `/merchandiser/shops/${shop.id}`, T.M2, { notes: 'x' }), 403);
    const pinned = await expect('M1 adjusts location (map pin)', req('PATCH', `/merchandiser/shops/${shop.id}`, T.M1, { latitude: 24.7140, longitude: 46.6760 }), 200);
    check('location updated', pinned.json.data.lat === 24.714 && pinned.json.data.lng === 46.676);
    await expect('invalid location edit', req('PATCH', `/merchandiser/shops/${shop.id}`, T.M1, { latitude: 99, longitude: 200 }), 400);
    const seedCust = await prisma.customer.findFirst({ where: { createdById: null } });
    if (seedCust) await expect('cannot edit Odoo/other customers', req('PATCH', `/merchandiser/shops/${seedCust.id}`, T.M1, { notes: 'x' }), 403);

    // ── F. visits & feedback ────────────────────────────────────────────────
    console.log('\nF. Visits & feedback');
    await expect('start visit without GPS', req('POST', '/merchandiser/visits/start', T.M1, { customerId: shop.id }), 400);
    await expect('start visit unknown shop', req('POST', '/merchandiser/visits/start', T.M1, { customerId: '00000000-0000-0000-0000-000000000000', ...HERE }), 404);
    await expect('start visit without customerId', req('POST', '/merchandiser/visits/start', T.M1, { ...HERE }), 400);
    const v = await expect('start visit', req('POST', '/merchandiser/visits/start', T.M1, { customerId: shop.id, latitude: 24.7140, longitude: 46.6760 }), 201);
    const visit = v.json?.data;
    check('visit has start time, linked to attendance, in range', !!visit?.startedAt && visit.attendanceId === a1.id && visit.outOfRange === false && visit.status === 'IN_PROGRESS');
    const dv = await expect('second visit blocked', req('POST', '/merchandiser/visits/start', T.M1, { customerId: shop.id, ...HERE }), 409);
    check('409 names the open visit', dv.json?.visitId === visit.id);
    const cur = await req('GET', '/merchandiser/visits/current', T.M1);
    check('current visit returned', cur.json.data?.id === visit.id);
    await expect('feedback bad category', req('POST', `/merchandiser/visits/${visit.id}/feedback`, T.M1, { category: 'NOPE', comments: 'x' }), 400);
    await expect('feedback missing comments', req('POST', `/merchandiser/visits/${visit.id}/feedback`, T.M1, { category: 'STOCK' }), 400);
    await expect('feedback rating out of range', req('POST', `/merchandiser/visits/${visit.id}/feedback`, T.M1, { category: 'STOCK', comments: 'x', rating: 9 }), 400);
    await expect('other merchandiser cannot add feedback', req('POST', `/merchandiser/visits/${visit.id}/feedback`, T.M2, { category: 'STOCK', comments: 'x' }), 404);
    const fb = await expect('submit feedback', req('POST', `/merchandiser/visits/${visit.id}/feedback`, T.M1, { category: 'STOCK', rating: 4, comments: 'Low stock of water 1.5L', followUpRequired: true }), 201);
    await expect('submit 2nd feedback', req('POST', `/merchandiser/visits/${visit.id}/feedback`, T.M1, { category: 'DISPLAY', comments: 'Shelf is well arranged' }), 201);
    await expect('other merchandiser cannot read visit', req('GET', `/merchandiser/visits/${visit.id}`, T.M2), 404);
    await expect('check-out blocked while visit open', req('POST', '/merchandiser/attendance/check-out', T.M1, undefined, att()), 409);
    await expect('end visit bad GPS', req('POST', `/merchandiser/visits/${visit.id}/end`, T.M1, { latitude: 500, longitude: 1 }), 400);
    const ended = await expect('end visit', req('POST', `/merchandiser/visits/${visit.id}/end`, T.M1, { ...HERE, notes: 'all good' }), 200);
    check('visit completed with end time + 2 feedback', ended.json.data.status === 'COMPLETED' && !!ended.json.data.endedAt && ended.json.data.feedback.length === 2);
    await expect('feedback after end blocked', req('POST', `/merchandiser/visits/${visit.id}/feedback`, T.M1, { category: 'STOCK', comments: 'late' }), 409);
    await expect('end twice blocked', req('POST', `/merchandiser/visits/${visit.id}/end`, T.M1, {}), 409);
    const far = await expect('visit started far from shop', req('POST', '/merchandiser/visits/start', T.M1, { customerId: shop.id, ...FAR }), 201);
    check('far visit flagged outOfRange with distance', far.json.data.outOfRange === true && far.json.data.startDistanceM > 5000);
    await expect('end far visit', req('POST', `/merchandiser/visits/${far.json.data.id}/end`, T.M1, {}), 200);
    const hist = await expect('visit history', req('GET', `/merchandiser/visits?customerId=${shop.id}`, T.M1), 200);
    check('history lists both visits with feedback counts', hist.json.meta.total === 2 && hist.json.data.some((x: any) => x._count.feedback === 2));
    await expect('history bad status', req('GET', '/merchandiser/visits?status=BAD', T.M1), 400);
    check('M2 history is empty (scoped to caller)', (await req('GET', '/merchandiser/visits', T.M2)).json.meta.total === 0);
    const shopAfter = await req('GET', `/merchandiser/shops/${shop.id}`, T.M1);
    check('shop detail shows 2 visits', shopAfter.json.data.myVisitCount === 2);

    // ── G. check-out & history ──────────────────────────────────────────────
    console.log('\nG. Check-out & attendance history');
    const out1 = await expect('MERCHANDISER check-out', req('POST', '/merchandiser/attendance/check-out', T.M1, undefined, att({ latitude: 24.7137, longitude: 46.6754 }, { buf: JPG, mime: 'image/jpeg', name: 'o.jpg' })), 200);
    check('check-out has time, GPS, selfie url, duration', !!out1.json.data.checkOutAt && out1.json.data.checkOutLat === 24.7137 && !!out1.json.data.checkOutSelfieUrl && out1.json.data.durationMinutes >= 0 && out1.json.data.flagged === false);
    await expect('out-selfie download', req('GET', `/merchandiser/attendance/${a1.id}/selfie?type=out`, T.M1), 200);
    const ah = await expect('attendance history', req('GET', '/merchandiser/attendance', T.M1), 200);
    check('history has the record, closed', ah.json.data.length === 1 && ah.json.data[0].isOpen === false);
    await expect('history bad date', req('GET', '/merchandiser/attendance?from=yesterday', T.M1), 400);
    check('M2 history only shows own', (await req('GET', '/merchandiser/attendance', T.M2)).json.data.every((r: any) => r.checkInDeviceId.startsWith('device-M2')));

    // ── H. admin management ─────────────────────────────────────────────────
    console.log('\nH. Admin / Manager management');
    const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
    const al = await expect('attendance list by date', req('GET', `/admin/attendance?date=${today}&merchandiserId=${U.M1.id}`, T.MANAGER), 200);
    check('admin attendance includes merchandiser + selfie urls', al.json.data.length === 1 && al.json.data[0].merchandiser.name === 'P2 merch1' && al.json.data[0].checkInSelfieUrl.startsWith('/api/v1/admin/'));
    check('flagged filter works', (await req('GET', `/admin/attendance?flagged=true&merchandiserId=${U.M2.id}`, T.ADMIN)).json.data.length === 1);
    await expect('bad date filter', req('GET', '/admin/attendance?date=2026-13-45x', T.ADMIN), 400);
    await expect('bad status filter', req('GET', '/admin/attendance?status=weird', T.ADMIN), 400);
    const ad = await expect('attendance detail', req('GET', `/admin/attendance/${a1.id}`, T.ADMIN), 200);
    check('detail lists the visits', ad.json.data.visits.length === 2);
    const note = await expect('admin adds note + flag', req('PATCH', `/admin/attendance/${a1.id}`, T.ADMIN, { adminNote: 'Reviewed OK', flagged: true }), 200);
    check('note saved', note.json.data.adminNote === 'Reviewed OK' && note.json.data.flagged === true);
    await expect('empty attendance patch', req('PATCH', `/admin/attendance/${a1.id}`, T.ADMIN, {}), 400);
    await expect('force check-out on closed record', req('PATCH', `/admin/attendance/${a1.id}`, T.ADMIN, { forceCheckOut: true }), 409);
    await expect('M1 second check-in (new day record)', req('POST', '/merchandiser/attendance/check-in', T.M1, undefined, att()), 201);
    const open = (await req('GET', '/admin/attendance?status=open&merchandiserId=' + U.M1.id, T.ADMIN)).json.data[0];
    const forced = await expect('admin force-closes forgotten check-out', req('PATCH', `/admin/attendance/${open?.id}`, T.ADMIN, { forceCheckOut: true }), 200);
    check('force-closed is flagged with note', forced.json.data.isOpen === false && forced.json.data.flagged === true && /admin/i.test(forced.json.data.adminNote));
    check('merchandiser can check in again after force-close', (await req('GET', '/merchandiser/attendance/status', T.M1)).json.data.isCheckedIn === false);
    const mo = await expect('merchandisers overview', req('GET', '/admin/merchandisers', T.ADMIN), 200);
    check('overview lists both merchandisers with status', ['P2 merch1', 'P2 merch2'].every((n) => mo.json.data.some((u: any) => u.name === n)));

    const sh = await expect('admin shops list (merchandiser-registered)', req('GET', `/admin/shops?q=${encodeURIComponent('P2 Test Shop ' + tag)}`, T.MANAGER), 200);
    check('shop visible with creator + counts', sh.json.data[0]?.id === shop.id && sh.json.data[0].createdBy.name === 'P2 merch1' && sh.json.data[0]._count.shopVisits === 2);
    check('source=all also works', (await req('GET', '/admin/shops?source=all&limit=5', T.ADMIN)).status === 200);
    const sd = await expect('admin shop detail', req('GET', `/admin/shops/${shop.id}`, T.ADMIN), 200);
    check('shop detail has visit history', sd.json.data.shopVisits.length === 2);
    const sp = await expect('admin edits shop', req('PATCH', `/admin/shops/${shop.id}`, T.ADMIN, { shopType: 'Supermarket', city: 'Jeddah' }), 200);
    check('shop updated', sp.json.data.shopType === 'Supermarket' && sp.json.data.city === 'Jeddah');
    await expect('admin shop bad location', req('PATCH', `/admin/shops/${shop.id}`, T.ADMIN, { latitude: 1000, longitude: 1 }), 400);
    await expect('admin shop unknown id', req('PATCH', '/admin/shops/00000000-0000-0000-0000-000000000000', T.ADMIN, { city: 'x' }), 404);

    const vl = await expect('admin visits list', req('GET', `/admin/shop-visits?merchandiserId=${U.M1.id}&date=${today}`, T.ADMIN), 200);
    check('lists 2 visits with merchandiser + shop', vl.json.data.length === 2 && vl.json.data[0].merchandiser.name === 'P2 merch1' && vl.json.data[0].customer.name.startsWith('P2 Test Shop'));
    check('outOfRange filter', (await req('GET', `/admin/shop-visits?merchandiserId=${U.M1.id}&outOfRange=true`, T.ADMIN)).json.data.length === 1);
    const vd = await expect('admin visit detail', req('GET', `/admin/shop-visits/${visit.id}`, T.ADMIN), 200);
    check('detail includes feedback + attendance', vd.json.data.feedback.length === 2 && vd.json.data.attendance.id === a1.id);

    const fl = await expect('admin feedback list', req('GET', `/admin/feedback?merchandiserId=${U.M1.id}&status=NEW`, T.MANAGER), 200);
    check('2 new feedback items with shop + merchandiser', fl.json.data.length === 2 && !!fl.json.data[0].customer.name && !!fl.json.data[0].merchandiser.name);
    check('followUp filter', (await req('GET', `/admin/feedback?merchandiserId=${U.M1.id}&followUp=true`, T.ADMIN)).json.data.length === 1);
    check('category filter', (await req('GET', `/admin/feedback?merchandiserId=${U.M1.id}&category=DISPLAY`, T.ADMIN)).json.data.length === 1);
    await expect('feedback bad status filter', req('GET', '/admin/feedback?status=BAD', T.ADMIN), 400);
    const rv = await expect('admin resolves feedback', req('PATCH', `/admin/feedback/${fb.json.data.id}`, T.MANAGER, { status: 'RESOLVED', adminNote: 'Restocked' }), 200);
    check('review recorded (status, note, reviewer, time)', rv.json.data.status === 'RESOLVED' && rv.json.data.adminNote === 'Restocked' && rv.json.data.reviewedById === U.MANAGER.id && !!rv.json.data.reviewedAt);
    await expect('feedback bad status', req('PATCH', `/admin/feedback/${fb.json.data.id}`, T.ADMIN, { status: 'DONE' }), 400);
    await expect('feedback unknown id', req('PATCH', '/admin/feedback/00000000-0000-0000-0000-000000000000', T.ADMIN, { status: 'REVIEWED' }), 404);
    await expect('merchandiser cannot review feedback', req('PATCH', `/admin/feedback/${fb.json.data.id}`, T.M1, { status: 'RESOLVED' }), 403);

    // ── I. immediate deactivation ───────────────────────────────────────────
    console.log('\nI. Deactivation applies immediately');
    await expect('admin deactivates merchandiser', req('PATCH', `/admin/users/${U.M1.id}`, T.ADMIN, { isActive: false }), 200);
    await expect('deactivated merchandiser: status → 401', req('GET', '/merchandiser/attendance/status', T.M1), 401);
    await expect('deactivated merchandiser: check-in → 401', req('POST', '/merchandiser/attendance/check-in', T.M1, undefined, att()), 401);

    // wait for the fire-and-forget Odoo lead push so we can archive it
    for (let i = 0; i < 20; i++) {
      const l = await prisma.lead.findFirst({ where: { customerId: shop.id } });
      if (l?.odooLeadId) { leadOdooIds.push(l.odooLeadId); break; }
      await new Promise((r) => setTimeout(r, 500));
    }
    check('shop lead was pushed to Odoo CRM (existing integration)', leadOdooIds.length === 1);
  } finally {
    console.log('\nCleanup');
    const ids = Object.values(U).map((u: any) => u.id);
    for (const id of leadOdooIds) {
      try { await odooWrite('crm.lead', [id], { active: false }); console.log(`  archived Odoo lead ${id}`); } catch (e: any) { console.log(`  ⚠️  could not archive Odoo lead ${id}: ${e?.message}`); }
    }
    const shops = await prisma.customer.findMany({ where: { createdById: { in: ids } }, select: { id: true } });
    const shopIds = shops.map((s) => s.id);
    await prisma.shopFeedback.deleteMany({ where: { OR: [{ merchandiserId: { in: ids } }, { customerId: { in: shopIds } }] } });
    await prisma.shopVisit.deleteMany({ where: { OR: [{ merchandiserId: { in: ids } }, { customerId: { in: shopIds } }] } });
    await prisma.attendance.deleteMany({ where: { merchandiserId: { in: ids } } });
    await prisma.userDevice.deleteMany({ where: { userId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { OR: [{ driverId: { in: ids } }, { customerId: { in: shopIds } }] } });
    await prisma.customer.deleteMany({ where: { id: { in: shopIds } } });
    const del = await prisma.user.deleteMany({ where: { id: { in: ids } } });
    for (const id of ids) fs.rmSync(path.join(PRIVATE_UPLOAD_ROOT, 'attendance', id), { recursive: true, force: true });
    console.log(`  removed ${del.count} users, ${shopIds.length} shops and their visits/feedback/attendance/devices/leads and selfie files`);
    await prisma.$disconnect();
  }

  console.log(`\n══════════ RESULT: ${passed} passed, ${failed} failed ══════════`);
  if (failed) { console.log(failures.map((f) => ` - ${f}`).join('\n')); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error('Test run crashed:', e); process.exit(2); });
