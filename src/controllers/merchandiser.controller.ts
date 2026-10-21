/**
 * merchandiser.controller.ts — Merchandiser mobile app API (Phase 2)
 *
 * Mounted at /api/v1/merchandiser and restricted to the MERCHANDISER role. Every query is scoped to the
 * calling user (req.user.userId), so one merchandiser can never read or change another's records.
 *
 *   Attendance : check-in / check-out (selfie + GPS + device + biometric flag), status, history, own selfies
 *   Shops      : search, nearby (map), detail, register new shop, edit own shop
 *   Visits     : start, current, feedback, end, history, detail
 */
import { Response } from 'express';
import { FeedbackCategory } from '@prisma/client';
import prisma from '../utils/prisma';
import { AuthRequest } from '../types';
import { parseLatLng, parseOptionalNumber, haversineMeters, boundingBox, riyadhRangeFilter } from '../utils/geo';
import { removeUploaded, toStoredPath, resolveStoredPath } from '../utils/privateUpload';
import { pushLeadToOdoo } from './driver.controller';

// A visit started further than this from the shop's recorded location is flagged (not blocked — GPS can be poor).
const VISIT_RANGE_METERS = 500;
const FEEDBACK_CATEGORIES: string[] = Object.values(FeedbackCategory);

// ─── helpers ─────────────────────────────────────────────────────────────────
export const str = (v: unknown, max: number): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

export const truthy = (v: unknown): boolean => v === true || v === 'true' || v === '1' || v === 1;

export const pageParams = (req: AuthRequest, defLimit = 20, maxLimit = 100) => {
  const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? String(defLimit)), 10) || defLimit, 1), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
};

export const fail = (res: Response, status: number, error: string, extra: Record<string, unknown> = {}) =>
  res.status(status).json({ success: false, error, ...extra });

export const serializeAttendance = (a: any, base = '/api/v1/merchandiser') => ({
  id: a.id,
  isOpen: !a.checkOutAt,
  checkInAt: a.checkInAt,
  checkInDeviceTime: a.checkInDeviceTime,
  checkInLat: a.checkInLat,
  checkInLng: a.checkInLng,
  checkInAccuracy: a.checkInAccuracy,
  checkInDeviceId: a.checkInDeviceId,
  checkInBiometric: a.checkInBiometric,
  checkInBiometricMethod: a.checkInBiometricMethod,
  checkInSelfieUrl: `${base}/attendance/${a.id}/selfie?type=in`,
  checkOutAt: a.checkOutAt,
  checkOutDeviceTime: a.checkOutDeviceTime,
  checkOutLat: a.checkOutLat,
  checkOutLng: a.checkOutLng,
  checkOutAccuracy: a.checkOutAccuracy,
  checkOutDeviceId: a.checkOutDeviceId,
  checkOutBiometric: a.checkOutBiometric,
  checkOutBiometricMethod: a.checkOutBiometricMethod,
  checkOutSelfieUrl: a.checkOutSelfie ? `${base}/attendance/${a.id}/selfie?type=out` : null,
  durationMinutes: a.checkOutAt ? Math.round((new Date(a.checkOutAt).getTime() - new Date(a.checkInAt).getTime()) / 60000) : null,
  flagged: a.flagged,
  adminNote: a.adminNote,
});

/**
 * Validates the multipart check-in/out form. On any problem it removes the uploaded file, answers 400 and returns null.
 * The biometric prompt itself runs on the phone (the server cannot verify a fingerprint) — the app must report the
 * result in `biometricVerified`, and the call is rejected unless it is true.
 *
 * The selfie is required at check-in only; at check-out it is optional (a supplied one is still stored).
 */
function parseAttendanceForm(req: AuthRequest, res: Response, opts: { selfieRequired: boolean }) {
  const reject = (msg: string) => {
    removeUploaded(req.file?.path);
    fail(res, 400, msg);
    return null;
  };
  const b = req.body || {};
  if (opts.selfieRequired && !req.file) return reject('A selfie image is required (multipart field "selfie")');
  if (!truthy(b.biometricVerified)) return reject('Biometric verification is required (biometricVerified must be true)');
  const pos = parseLatLng(b.latitude, b.longitude);
  if (!pos) return reject('Valid GPS coordinates are required (latitude, longitude)');
  const deviceId = str(b.deviceId, 128);
  if (!deviceId || deviceId.length < 4) return reject('deviceId is required');
  let deviceTime: Date | null = null;
  if (b.capturedAt) {
    deviceTime = new Date(String(b.capturedAt));
    if (isNaN(deviceTime.getTime())) return reject('capturedAt must be a valid ISO date-time');
  }
  return {
    pos,
    accuracy: parseOptionalNumber(b.accuracy),
    deviceId,
    deviceName: str(b.deviceName, 100),
    method: str(b.biometricMethod, 40),
    deviceTime,
  };
}

/**
 * Every device is trusted: there is no admin approval step. The device is still recorded (and its `lastSeenAt`
 * kept fresh) so supervisors can see which phone was used, and a phone that was waiting for approval from before
 * this rule is approved here the next time it is used. Always resolves true; the boolean stays so the callers'
 * DEVICE_NOT_APPROVED branch keeps compiling, and so approval can be brought back by changing only this function.
 */
async function checkDevice(userId: string, deviceId: string, label: string | null): Promise<boolean> {
  const now = new Date();
  const existing = await prisma.userDevice.findUnique({ where: { userId_deviceId: { userId, deviceId } } });
  if (existing) {
    await prisma.userDevice.update({
      where: { id: existing.id },
      data: { lastSeenAt: now, ...(existing.isApproved ? {} : { isApproved: true, approvedAt: now }) },
    });
    return true;
  }
  try {
    await prisma.userDevice.create({ data: { userId, deviceId, label, isApproved: true, approvedAt: now } });
  } catch (err: any) {
    // Two requests from a brand-new phone raced to create the row; the other one won, which is fine.
    if (err.code !== 'P2002') throw err;
  }
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
// ATTENDANCE
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/v1/merchandiser/attendance/status
export const getAttendanceStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const [open, visit, devices] = await Promise.all([
      prisma.attendance.findUnique({ where: { openKey: userId } }),
      prisma.shopVisit.findUnique({ where: { openKey: userId }, select: { id: true, customerId: true, startedAt: true } }),
      prisma.userDevice.findMany({ where: { userId }, select: { deviceId: true, label: true, isApproved: true } }),
    ]);
    res.json({
      success: true,
      data: {
        isCheckedIn: !!open,
        attendance: open ? serializeAttendance(open) : null,
        activeVisit: visit,
        devices,
      },
    });
  } catch (err) {
    console.error('getAttendanceStatus error:', err);
    fail(res, 500, 'Failed to get attendance status');
  }
};

// POST /api/v1/merchandiser/attendance/check-in   (multipart/form-data)
export const checkIn = async (req: AuthRequest, res: Response): Promise<void> => {
  const input = parseAttendanceForm(req, res, { selfieRequired: true });
  if (!input) return;
  const userId = req.user!.userId;
  const selfiePath = req.file!.path;
  try {
    if (await prisma.attendance.findUnique({ where: { openKey: userId }, select: { id: true } })) {
      removeUploaded(selfiePath);
      return void fail(res, 409, 'You are already checked in. Check out first.', { code: 'ALREADY_CHECKED_IN' });
    }
    if (!(await checkDevice(userId, input.deviceId, input.deviceName))) {
      removeUploaded(selfiePath);
      return void fail(res, 403, 'This device is awaiting admin approval', { code: 'DEVICE_NOT_APPROVED' });
    }

    const attendance = await prisma.attendance.create({
      data: {
        merchandiserId: userId,
        openKey: userId,
        checkInDeviceTime: input.deviceTime,
        checkInLat: input.pos.lat,
        checkInLng: input.pos.lng,
        checkInAccuracy: input.accuracy,
        checkInSelfie: toStoredPath(selfiePath),
        checkInDeviceId: input.deviceId,
        checkInBiometric: true,
        checkInBiometricMethod: input.method,
      },
    });
    res.status(201).json({ success: true, data: serializeAttendance(attendance) });
  } catch (err: any) {
    removeUploaded(selfiePath);
    if (err.code === 'P2002') return void fail(res, 409, 'You are already checked in. Check out first.', { code: 'ALREADY_CHECKED_IN' });
    console.error('checkIn error:', err);
    fail(res, 500, 'Check-in failed');
  }
};

// POST /api/v1/merchandiser/attendance/check-out  (multipart/form-data)
export const checkOut = async (req: AuthRequest, res: Response): Promise<void> => {
  const input = parseAttendanceForm(req, res, { selfieRequired: false });
  if (!input) return;
  const userId = req.user!.userId;
  const selfiePath = req.file?.path;
  try {
    const open = await prisma.attendance.findUnique({ where: { openKey: userId } });
    if (!open) {
      removeUploaded(selfiePath);
      return void fail(res, 409, 'You are not checked in', { code: 'NOT_CHECKED_IN' });
    }
    if (await prisma.shopVisit.findUnique({ where: { openKey: userId }, select: { id: true } })) {
      removeUploaded(selfiePath);
      return void fail(res, 409, 'End your current shop visit before checking out', { code: 'VISIT_IN_PROGRESS' });
    }
    if (!(await checkDevice(userId, input.deviceId, input.deviceName))) {
      removeUploaded(selfiePath);
      return void fail(res, 403, 'This device is awaiting admin approval', { code: 'DEVICE_NOT_APPROVED' });
    }

    const differentDevice = open.checkInDeviceId !== input.deviceId;
    const result = await prisma.attendance.updateMany({
      where: { id: open.id, openKey: userId },
      data: {
        openKey: null,
        checkOutAt: new Date(),
        checkOutDeviceTime: input.deviceTime,
        checkOutLat: input.pos.lat,
        checkOutLng: input.pos.lng,
        checkOutAccuracy: input.accuracy,
        checkOutSelfie: selfiePath ? toStoredPath(selfiePath) : null,
        checkOutDeviceId: input.deviceId,
        checkOutBiometric: true,
        checkOutBiometricMethod: input.method,
        ...(differentDevice ? { flagged: true, adminNote: 'Auto-flag: checked out from a different device than check-in' } : {}),
      },
    });
    if (result.count === 0) {
      removeUploaded(selfiePath);
      return void fail(res, 409, 'You are not checked in', { code: 'NOT_CHECKED_IN' });
    }
    const updated = await prisma.attendance.findUnique({ where: { id: open.id } });
    res.json({ success: true, data: serializeAttendance(updated) });
  } catch (err) {
    removeUploaded(selfiePath);
    console.error('checkOut error:', err);
    fail(res, 500, 'Check-out failed');
  }
};

// GET /api/v1/merchandiser/attendance?from=YYYY-MM-DD&to=YYYY-MM-DD&page=&limit=
export const getAttendanceHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = pageParams(req, 30);
    const range = riyadhRangeFilter(req.query.from, req.query.to);
    if (!range) return void fail(res, 400, 'from/to must be YYYY-MM-DD');
    const where: any = { merchandiserId: req.user!.userId, ...(range.gte || range.lt ? { checkInAt: range } : {}) };
    const [rows, total] = await Promise.all([
      prisma.attendance.findMany({ where, orderBy: { checkInAt: 'desc' }, skip, take: limit }),
      prisma.attendance.count({ where }),
    ]);
    res.json({ success: true, data: rows.map((r) => serializeAttendance(r)), meta: { page, limit, total } });
  } catch (err) {
    console.error('getAttendanceHistory error:', err);
    fail(res, 500, 'Failed to get attendance history');
  }
};

/** Streams a stored selfie. Shared with the admin controller; callers must already have authorised access. */
export function sendSelfie(attendance: any, type: unknown, res: Response): void {
  const stored = type === 'out' ? attendance.checkOutSelfie : attendance.checkInSelfie;
  const abs = stored ? resolveStoredPath(stored) : null;
  if (!abs) return void fail(res, 404, 'Selfie not found');
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(abs, (err) => {
    if (err && !res.headersSent) fail(res, 404, 'Selfie not found');
  });
}

// GET /api/v1/merchandiser/attendance/:id/selfie?type=in|out
export const getOwnSelfie = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const att = await prisma.attendance.findFirst({ where: { id: req.params.id, merchandiserId: req.user!.userId } });
    if (!att) return void fail(res, 404, 'Attendance record not found');
    sendSelfie(att, req.query.type, res);
  } catch (err) {
    console.error('getOwnSelfie error:', err);
    fail(res, 500, 'Failed to load selfie');
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// SHOPS  (a shop is a Customer record)
// ═════════════════════════════════════════════════════════════════════════════
const shopSelect = {
  id: true, name: true, phone: true, contactPerson: true, shopType: true, notes: true,
  address: true, street: true, district: true, city: true, zip: true, buildingNumber: true,
  lat: true, lng: true, createdById: true, updatedAt: true,
} as const;

const toShop = (s: any, userId: string, origin?: { lat: number; lng: number } | null) => {
  const { createdById, ...rest } = s;
  return {
    ...rest,
    isMine: createdById === userId,
    distanceM: origin && s.lat != null && s.lng != null ? Math.round(haversineMeters(origin.lat, origin.lng, s.lat, s.lng)) : null,
  };
};

// GET /api/v1/merchandiser/shops?q=&lat=&lng=&page=&limit=
export const searchShops = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const q = str(req.query.q, 100);
    const { page, limit, skip } = pageParams(req, 20, 50);
    const origin = parseLatLng(req.query.lat, req.query.lng);
    const where: any = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            { contactPerson: { contains: q, mode: 'insensitive' } },
            { address: { contains: q, mode: 'insensitive' } },
            { city: { contains: q, mode: 'insensitive' } },
            { district: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};
    const [rows, total] = await Promise.all([
      prisma.customer.findMany({ where, select: shopSelect, orderBy: { name: 'asc' }, skip, take: limit }),
      prisma.customer.count({ where }),
    ]);
    res.json({ success: true, data: rows.map((s) => toShop(s, req.user!.userId, origin)), meta: { page, limit, total } });
  } catch (err) {
    console.error('searchShops error:', err);
    fail(res, 500, 'Failed to search shops');
  }
};

// GET /api/v1/merchandiser/shops/nearby?lat=&lng=&radiusKm=5&limit=100&q=
export const getNearbyShops = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const origin = parseLatLng(req.query.lat, req.query.lng);
    if (!origin) return void fail(res, 400, 'Valid lat and lng are required');
    const radiusKm = Math.min(Math.max(parseOptionalNumber(req.query.radiusKm) ?? 5, 0.1), 50);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 300);
    const q = str(req.query.q, 100);
    const box = boundingBox(origin.lat, origin.lng, radiusKm);

    const candidates = await prisma.customer.findMany({
      where: {
        lat: { gte: box.minLat, lte: box.maxLat },
        lng: { gte: box.minLng, lte: box.maxLng },
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } : {}),
      },
      select: shopSelect,
    });

    const shops = candidates
      .map((s) => toShop(s, req.user!.userId, origin))
      .filter((s) => s.distanceM !== null && s.distanceM <= radiusKm * 1000)
      .sort((a, b) => (a.distanceM as number) - (b.distanceM as number))
      .slice(0, limit);

    const last = shops.length
      ? await prisma.shopVisit.groupBy({
          by: ['customerId'],
          where: { merchandiserId: req.user!.userId, customerId: { in: shops.map((s) => s.id) } },
          _max: { startedAt: true },
        })
      : [];
    const lastByShop = new Map(last.map((l) => [l.customerId, l._max.startedAt]));

    res.json({
      success: true,
      data: shops.map((s) => ({ ...s, lastVisitAt: lastByShop.get(s.id) ?? null })),
      meta: { center: origin, radiusKm, count: shops.length },
    });
  } catch (err) {
    console.error('getNearbyShops error:', err);
    fail(res, 500, 'Failed to load nearby shops');
  }
};

// GET /api/v1/merchandiser/shops/:id
export const getShopById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const shop = await prisma.customer.findUnique({ where: { id: req.params.id }, select: shopSelect });
    if (!shop) return void fail(res, 404, 'Shop not found');
    const [visitCount, recent] = await Promise.all([
      prisma.shopVisit.count({ where: { merchandiserId: userId, customerId: shop.id } }),
      prisma.shopVisit.findMany({
        where: { merchandiserId: userId, customerId: shop.id },
        orderBy: { startedAt: 'desc' },
        take: 5,
        select: { id: true, status: true, startedAt: true, endedAt: true, _count: { select: { feedback: true } } },
      }),
    ]);
    const origin = parseLatLng(req.query.lat, req.query.lng);
    res.json({ success: true, data: { ...toShop(shop, userId, origin), myVisitCount: visitCount, recentVisits: recent } });
  } catch (err) {
    console.error('getShopById error:', err);
    fail(res, 500, 'Failed to get shop');
  }
};

/** Shared validation for create/update. Returns an error message or the cleaned fields. */
export function parseShopFields(b: any, partial: boolean): { error: string } | { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  if (!partial || b.name !== undefined) {
    const name = str(b.name, 120);
    if (!name || name.length < 2) return { error: 'Shop name is required (at least 2 characters)' };
    data.name = name;
  }
  if (b.phone !== undefined) {
    const phone = str(b.phone, 20);
    if (phone && !/^[0-9+\-\s()]{5,20}$/.test(phone)) return { error: 'Phone number format is invalid' };
    data.phone = phone ? phone.replace(/\s+/g, '') : null;
  }
  for (const [key, max] of [['contactPerson', 100], ['shopType', 60], ['notes', 1000], ['address', 300], ['street', 150],
    ['district', 100], ['city', 100], ['zip', 20], ['buildingNumber', 30]] as const) {
    if (b[key] !== undefined) data[key] = str(b[key], max);
  }
  if (!partial || b.latitude !== undefined || b.longitude !== undefined) {
    const pos = parseLatLng(b.latitude, b.longitude);
    if (!pos) return { error: 'A valid shop location is required (latitude, longitude)' };
    data.lat = pos.lat;
    data.lng = pos.lng;
  }
  return { data };
}

// POST /api/v1/merchandiser/shops
export const createShop = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const parsed = parseShopFields(req.body || {}, false);
    if ('error' in parsed) return void fail(res, 400, parsed.error);
    const d = parsed.data as any;

    if (d.phone && !truthy(req.body.confirmDuplicate)) {
      const dup = await prisma.customer.findFirst({ where: { phone: d.phone }, select: { id: true, name: true } });
      if (dup) {
        return void fail(res, 409, 'A shop with this phone number already exists', {
          code: 'DUPLICATE_PHONE', existingShop: dup,
        });
      }
    }

    // Same pipeline as the driver's "new customer": Customer + Lead (pending admin approval), then pushed to Odoo CRM.
    const { shop, lead } = await prisma.$transaction(async (tx) => {
      const shop = await tx.customer.create({ data: { ...d, createdById: userId }, select: shopSelect });
      const lead = await tx.lead.create({
        data: {
          driverId: userId, customerId: shop.id, name: d.name, phone: d.phone ?? null, address: d.address ?? null,
          street: d.street ?? null, district: d.district ?? null, city: d.city ?? null, zip: d.zip ?? null,
          buildingNumber: d.buildingNumber ?? null, notes: d.notes ?? null, lat: d.lat, lng: d.lng,
        },
      });
      return { shop, lead };
    });

    pushLeadToOdoo(lead.id, {
      name: d.name, phone: d.phone ?? undefined, street: d.street || d.address, district: d.district,
      city: d.city, zip: d.zip, description: d.notes,
    }).catch((err: any) => console.error('⚠️  Odoo lead push failed (non-blocking):', err?.message));

    res.status(201).json({ success: true, data: { ...toShop(shop, userId), leadId: lead.id } });
  } catch (err) {
    console.error('createShop error:', err);
    fail(res, 500, 'Failed to register shop');
  }
};

// PATCH /api/v1/merchandiser/shops/:id   — only shops this merchandiser registered
export const updateShop = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const existing = await prisma.customer.findUnique({ where: { id: req.params.id }, select: { id: true, createdById: true } });
    if (!existing) return void fail(res, 404, 'Shop not found');
    if (existing.createdById !== userId) return void fail(res, 403, 'You can only edit shops you registered');
    const parsed = parseShopFields(req.body || {}, true);
    if ('error' in parsed) return void fail(res, 400, parsed.error);
    if (Object.keys(parsed.data).length === 0) return void fail(res, 400, 'Nothing to update');
    const shop = await prisma.customer.update({ where: { id: existing.id }, data: parsed.data, select: shopSelect });
    res.json({ success: true, data: toShop(shop, userId) });
  } catch (err) {
    console.error('updateShop error:', err);
    fail(res, 500, 'Failed to update shop');
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// VISITS & FEEDBACK
// ═════════════════════════════════════════════════════════════════════════════
const visitInclude = {
  customer: { select: { id: true, name: true, phone: true, address: true, lat: true, lng: true } },
  feedback: { orderBy: { createdAt: 'asc' as const }, select: { id: true, category: true, rating: true, comments: true, followUpRequired: true, status: true, createdAt: true } },
};

// POST /api/v1/merchandiser/visits/start   { customerId, latitude, longitude }
export const startVisit = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const customerId = str(req.body?.customerId, 64);
    if (!customerId) return void fail(res, 400, 'customerId is required');
    const pos = parseLatLng(req.body?.latitude, req.body?.longitude);
    if (!pos) return void fail(res, 400, 'Valid GPS coordinates are required (latitude, longitude)');

    const shop = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, lat: true, lng: true } });
    if (!shop) return void fail(res, 404, 'Shop not found');

    const current = await prisma.shopVisit.findUnique({ where: { openKey: userId }, select: { id: true } });
    if (current) return void fail(res, 409, 'You already have a visit in progress', { code: 'VISIT_IN_PROGRESS', visitId: current.id });

    const attendance = await prisma.attendance.findUnique({ where: { openKey: userId }, select: { id: true } });
    const distance = shop.lat != null && shop.lng != null ? haversineMeters(pos.lat, pos.lng, shop.lat, shop.lng) : null;

    try {
      const visit = await prisma.shopVisit.create({
        data: {
          merchandiserId: userId, customerId, openKey: userId, attendanceId: attendance?.id ?? null,
          startLat: pos.lat, startLng: pos.lng,
          startDistanceM: distance !== null ? Math.round(distance) : null,
          outOfRange: distance !== null && distance > VISIT_RANGE_METERS,
        },
        include: visitInclude,
      });
      res.status(201).json({ success: true, data: visit });
    } catch (err: any) {
      if (err.code === 'P2002') return void fail(res, 409, 'You already have a visit in progress', { code: 'VISIT_IN_PROGRESS' });
      throw err;
    }
  } catch (err) {
    console.error('startVisit error:', err);
    fail(res, 500, 'Failed to start visit');
  }
};

// GET /api/v1/merchandiser/visits/current
export const getCurrentVisit = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const visit = await prisma.shopVisit.findUnique({ where: { openKey: req.user!.userId }, include: visitInclude });
    res.json({ success: true, data: visit });
  } catch (err) {
    console.error('getCurrentVisit error:', err);
    fail(res, 500, 'Failed to get current visit');
  }
};

// POST /api/v1/merchandiser/visits/:id/feedback   { category, rating?, comments, followUpRequired? }
export const addFeedback = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const b = req.body || {};
    const category = b.category === undefined ? 'OTHER' : String(b.category);
    if (!FEEDBACK_CATEGORIES.includes(category)) return void fail(res, 400, `category must be one of: ${FEEDBACK_CATEGORIES.join(', ')}`);
    const comments = str(b.comments, 2000);
    if (!comments) return void fail(res, 400, 'comments is required');
    let rating: number | null = null;
    if (b.rating !== undefined && b.rating !== null && b.rating !== '') {
      rating = Number(b.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return void fail(res, 400, 'rating must be a whole number from 1 to 5');
    }

    const visit = await prisma.shopVisit.findFirst({ where: { id: req.params.id, merchandiserId: userId } });
    if (!visit) return void fail(res, 404, 'Visit not found');
    if (visit.status !== 'IN_PROGRESS') return void fail(res, 409, 'Feedback can only be added while the visit is in progress');

    const feedback = await prisma.shopFeedback.create({
      data: {
        visitId: visit.id, customerId: visit.customerId, merchandiserId: userId,
        category: category as FeedbackCategory, rating, comments, followUpRequired: truthy(b.followUpRequired),
      },
    });
    res.status(201).json({ success: true, data: feedback });
  } catch (err) {
    console.error('addFeedback error:', err);
    fail(res, 500, 'Failed to submit feedback');
  }
};

// POST /api/v1/merchandiser/visits/:id/end   { latitude?, longitude?, notes? }
export const endVisit = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const b = req.body || {};
    let end: { lat: number; lng: number } | null = null;
    if (b.latitude !== undefined || b.longitude !== undefined) {
      end = parseLatLng(b.latitude, b.longitude);
      if (!end) return void fail(res, 400, 'Valid GPS coordinates are required when latitude/longitude are sent');
    }
    const visit = await prisma.shopVisit.findFirst({ where: { id: req.params.id, merchandiserId: userId } });
    if (!visit) return void fail(res, 404, 'Visit not found');
    if (visit.status !== 'IN_PROGRESS') return void fail(res, 409, 'Visit has already ended');

    const result = await prisma.shopVisit.updateMany({
      where: { id: visit.id, status: 'IN_PROGRESS' },
      data: { status: 'COMPLETED', openKey: null, endedAt: new Date(), endLat: end?.lat ?? null, endLng: end?.lng ?? null, notes: str(b.notes, 1000) },
    });
    if (result.count === 0) return void fail(res, 409, 'Visit has already ended');
    const done = await prisma.shopVisit.findUnique({ where: { id: visit.id }, include: visitInclude });
    res.json({ success: true, data: done });
  } catch (err) {
    console.error('endVisit error:', err);
    fail(res, 500, 'Failed to end visit');
  }
};

// GET /api/v1/merchandiser/visits?from=&to=&customerId=&status=&page=&limit=
export const getVisits = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = pageParams(req);
    const range = riyadhRangeFilter(req.query.from, req.query.to);
    if (!range) return void fail(res, 400, 'from/to must be YYYY-MM-DD');
    const where: any = { merchandiserId: req.user!.userId, ...(range.gte || range.lt ? { startedAt: range } : {}) };
    if (req.query.customerId) where.customerId = String(req.query.customerId);
    if (req.query.status) {
      if (!['IN_PROGRESS', 'COMPLETED'].includes(String(req.query.status))) return void fail(res, 400, 'status must be IN_PROGRESS or COMPLETED');
      where.status = String(req.query.status);
    }
    const [rows, total] = await Promise.all([
      prisma.shopVisit.findMany({
        where, orderBy: { startedAt: 'desc' }, skip, take: limit,
        include: { customer: { select: { id: true, name: true } }, _count: { select: { feedback: true } } },
      }),
      prisma.shopVisit.count({ where }),
    ]);
    res.json({ success: true, data: rows, meta: { page, limit, total } });
  } catch (err) {
    console.error('getVisits error:', err);
    fail(res, 500, 'Failed to get visits');
  }
};

// GET /api/v1/merchandiser/visits/:id
export const getVisitById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const visit = await prisma.shopVisit.findFirst({ where: { id: req.params.id, merchandiserId: req.user!.userId }, include: visitInclude });
    if (!visit) return void fail(res, 404, 'Visit not found');
    res.json({ success: true, data: visit });
  } catch (err) {
    console.error('getVisitById error:', err);
    fail(res, 500, 'Failed to get visit');
  }
};
