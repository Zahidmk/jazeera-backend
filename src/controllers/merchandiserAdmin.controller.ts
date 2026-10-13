/**
 * merchandiserAdmin.controller.ts — back-office management of the Merchandiser module (Phase 2)
 *
 * Mounted under /api/v1/admin/* (the admin router already enforces ADMIN / MANAGER).
 *   Attendance, trusted devices, shops, shop visits, feedback review.
 */
import { Response } from 'express';
import { FeedbackCategory } from '@prisma/client';
import prisma from '../utils/prisma';
import { AuthRequest } from '../types';
import { riyadhRangeFilter, riyadhDayRange } from '../utils/geo';
import { fail, str, truthy, pageParams, serializeAttendance, sendSelfie, parseShopFields } from './merchandiser.controller';

const ADMIN_BASE = '/api/v1/admin';
const FEEDBACK_STATUSES = ['NEW', 'REVIEWED', 'RESOLVED'];
const FEEDBACK_CATEGORIES: string[] = Object.values(FeedbackCategory);
const userBrief = { select: { id: true, name: true, email: true, phone: true, isActive: true } };

// ═════════════════════════════════════════════════════════════════════════════
// MERCHANDISERS OVERVIEW
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/v1/admin/merchandisers — every merchandiser with today's status (Riyadh day)
export const getMerchandisers = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const today = riyadhDayRange(new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10))!;
    const users = await prisma.user.findMany({
      where: { role: 'MERCHANDISER' },
      select: {
        id: true, name: true, email: true, phone: true, isActive: true,
        attendances: { where: { checkInAt: { gte: today.start, lt: today.end } }, orderBy: { checkInAt: 'desc' }, take: 1, select: { id: true, checkInAt: true, checkOutAt: true, flagged: true } },
        devices: { select: { id: true, isApproved: true } },
      },
      orderBy: { name: 'asc' },
    });
    const openVisits = await prisma.shopVisit.findMany({ where: { openKey: { not: null } }, select: { merchandiserId: true } });
    const inVisit = new Set(openVisits.map((v) => v.merchandiserId));
    res.json({
      success: true,
      data: users.map((u) => ({
        id: u.id, name: u.name, email: u.email, phone: u.phone, isActive: u.isActive,
        today: u.attendances[0] ?? null,
        isCheckedIn: !!u.attendances[0] && !u.attendances[0].checkOutAt,
        inVisit: inVisit.has(u.id),
        pendingDevices: u.devices.filter((d) => !d.isApproved).length,
      })),
    });
  } catch (err) {
    console.error('getMerchandisers error:', err);
    fail(res, 500, 'Failed to load merchandisers');
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ATTENDANCE
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/v1/admin/attendance?date=&from=&to=&merchandiserId=&status=open|closed&flagged=true&page=&limit=
export const getAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = pageParams(req, 30, 200);
    const q = req.query;
    const range = q.date ? riyadhRangeFilter(q.date, q.date) : riyadhRangeFilter(q.from, q.to);
    if (!range) return void fail(res, 400, 'date/from/to must be YYYY-MM-DD');
    const where: any = {};
    if (range.gte || range.lt) where.checkInAt = range;
    if (q.merchandiserId) where.merchandiserId = String(q.merchandiserId);
    if (q.status === 'open') where.checkOutAt = null;
    else if (q.status === 'closed') where.checkOutAt = { not: null };
    else if (q.status) return void fail(res, 400, 'status must be open or closed');
    if (q.flagged !== undefined) where.flagged = truthy(q.flagged);

    const [rows, total] = await Promise.all([
      prisma.attendance.findMany({ where, orderBy: { checkInAt: 'desc' }, skip, take: limit, include: { merchandiser: userBrief } }),
      prisma.attendance.count({ where }),
    ]);
    res.json({
      success: true,
      data: rows.map((r) => ({ ...serializeAttendance(r, ADMIN_BASE), merchandiser: r.merchandiser })),
      meta: { page, limit, total },
    });
  } catch (err) {
    console.error('getAttendance error:', err);
    fail(res, 500, 'Failed to load attendance');
  }
};

// GET /api/v1/admin/attendance/:id
export const getAttendanceById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const row = await prisma.attendance.findUnique({
      where: { id: req.params.id },
      include: {
        merchandiser: userBrief,
        visits: { select: { id: true, customerId: true, startedAt: true, endedAt: true, status: true, outOfRange: true, customer: { select: { name: true } } }, orderBy: { startedAt: 'asc' } },
      },
    });
    if (!row) return void fail(res, 404, 'Attendance record not found');
    res.json({ success: true, data: { ...serializeAttendance(row, ADMIN_BASE), merchandiser: row.merchandiser, visits: row.visits } });
  } catch (err) {
    console.error('getAttendanceById error:', err);
    fail(res, 500, 'Failed to load attendance record');
  }
};

// GET /api/v1/admin/attendance/:id/selfie?type=in|out
export const getAttendanceSelfie = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const row = await prisma.attendance.findUnique({ where: { id: req.params.id } });
    if (!row) return void fail(res, 404, 'Attendance record not found');
    sendSelfie(row, req.query.type, res);
  } catch (err) {
    console.error('getAttendanceSelfie error:', err);
    fail(res, 500, 'Failed to load selfie');
  }
};

// PATCH /api/v1/admin/attendance/:id   { adminNote?, flagged?, forceCheckOut? }
export const updateAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const b = req.body || {};
    const row = await prisma.attendance.findUnique({ where: { id: req.params.id } });
    if (!row) return void fail(res, 404, 'Attendance record not found');

    const data: Record<string, unknown> = {};
    if (b.adminNote !== undefined) data.adminNote = str(b.adminNote, 500);
    if (b.flagged !== undefined) data.flagged = truthy(b.flagged);
    if (truthy(b.forceCheckOut)) {
      if (row.checkOutAt) return void fail(res, 409, 'Attendance is already checked out');
      Object.assign(data, { openKey: null, checkOutAt: new Date(), closedByAdminId: req.user!.userId, flagged: true });
      if (data.adminNote === undefined) data.adminNote = 'Closed by admin (merchandiser did not check out)';
    }
    if (Object.keys(data).length === 0) return void fail(res, 400, 'Nothing to update');

    const updated = await prisma.attendance.update({ where: { id: row.id }, data, include: { merchandiser: userBrief } });
    res.json({ success: true, data: { ...serializeAttendance(updated, ADMIN_BASE), merchandiser: updated.merchandiser } });
  } catch (err) {
    console.error('updateAttendance error:', err);
    fail(res, 500, 'Failed to update attendance');
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// TRUSTED DEVICES
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/v1/admin/devices?userId=&pending=true
export const getDevices = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const where: any = { user: { role: 'MERCHANDISER' } };
    if (req.query.userId) where.userId = String(req.query.userId);
    if (truthy(req.query.pending)) where.isApproved = false;
    const rows = await prisma.userDevice.findMany({
      where,
      orderBy: [{ isApproved: 'asc' }, { lastSeenAt: 'desc' }],
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('getDevices error:', err);
    fail(res, 500, 'Failed to load devices');
  }
};

// PATCH /api/v1/admin/devices/:id   { isApproved: boolean }
export const updateDevice = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (typeof req.body?.isApproved !== 'boolean') return void fail(res, 400, 'isApproved (boolean) is required');
    const device = await prisma.userDevice.findUnique({ where: { id: req.params.id } });
    if (!device) return void fail(res, 404, 'Device not found');
    const updated = await prisma.userDevice.update({
      where: { id: device.id },
      data: req.body.isApproved
        ? { isApproved: true, approvedById: req.user!.userId, approvedAt: new Date() }
        : { isApproved: false, approvedById: null, approvedAt: null },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('updateDevice error:', err);
    fail(res, 500, 'Failed to update device');
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// SHOPS
// ═════════════════════════════════════════════════════════════════════════════
const adminShopSelect = {
  id: true, odooId: true, name: true, phone: true, contactPerson: true, shopType: true, notes: true,
  address: true, street: true, district: true, city: true, zip: true, buildingNumber: true,
  lat: true, lng: true, createdAt: true, updatedAt: true, createdBy: userBrief,
  _count: { select: { shopVisits: true, feedbacks: true } },
} as const;

// GET /api/v1/admin/shops?q=&source=merchandiser|all&createdById=&hasLocation=&page=&limit=
export const getShops = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = pageParams(req, 30, 200);
    const q = str(req.query.q, 100);
    const where: any = {};
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } },
        { contactPerson: { contains: q, mode: 'insensitive' } }, { address: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (req.query.createdById) where.createdById = String(req.query.createdById);
    else if (req.query.source !== 'all') where.createdBy = { role: 'MERCHANDISER' }; // default: shops merchandisers registered
    if (req.query.hasLocation === 'true') { where.lat = { not: null }; where.lng = { not: null }; }
    const [rows, total] = await Promise.all([
      prisma.customer.findMany({ where, select: adminShopSelect, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.customer.count({ where }),
    ]);
    res.json({ success: true, data: rows, meta: { page, limit, total } });
  } catch (err) {
    console.error('getShops error:', err);
    fail(res, 500, 'Failed to load shops');
  }
};

// GET /api/v1/admin/shops/:id
export const getShopDetail = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const shop = await prisma.customer.findUnique({
      where: { id: req.params.id },
      select: {
        ...adminShopSelect,
        shopVisits: { orderBy: { startedAt: 'desc' }, take: 20, include: { merchandiser: { select: { id: true, name: true } }, _count: { select: { feedback: true } } } },
      },
    });
    if (!shop) return void fail(res, 404, 'Shop not found');
    res.json({ success: true, data: shop });
  } catch (err) {
    console.error('getShopDetail error:', err);
    fail(res, 500, 'Failed to load shop');
  }
};

// PATCH /api/v1/admin/shops/:id
export const updateShop = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = parseShopFields(req.body || {}, true);
    if ('error' in parsed) return void fail(res, 400, parsed.error);
    if (Object.keys(parsed.data).length === 0) return void fail(res, 400, 'Nothing to update');
    const shop = await prisma.customer.update({ where: { id: req.params.id }, data: parsed.data, select: adminShopSelect });
    res.json({ success: true, data: shop });
  } catch (err: any) {
    if (err.code === 'P2025') return void fail(res, 404, 'Shop not found');
    console.error('admin updateShop error:', err);
    fail(res, 500, 'Failed to update shop');
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// VISITS
// ═════════════════════════════════════════════════════════════════════════════
const adminVisitInclude = {
  merchandiser: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true, phone: true, address: true, lat: true, lng: true } },
  _count: { select: { feedback: true } },
};

// GET /api/v1/admin/shop-visits?merchandiserId=&customerId=&from=&to=&date=&status=&outOfRange=&page=&limit=
export const getShopVisits = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = pageParams(req, 30, 200);
    const q = req.query;
    const range = q.date ? riyadhRangeFilter(q.date, q.date) : riyadhRangeFilter(q.from, q.to);
    if (!range) return void fail(res, 400, 'date/from/to must be YYYY-MM-DD');
    const where: any = {};
    if (range.gte || range.lt) where.startedAt = range;
    if (q.merchandiserId) where.merchandiserId = String(q.merchandiserId);
    if (q.customerId) where.customerId = String(q.customerId);
    if (q.status) {
      if (!['IN_PROGRESS', 'COMPLETED'].includes(String(q.status))) return void fail(res, 400, 'status must be IN_PROGRESS or COMPLETED');
      where.status = String(q.status);
    }
    if (q.outOfRange !== undefined) where.outOfRange = truthy(q.outOfRange);
    const [rows, total] = await Promise.all([
      prisma.shopVisit.findMany({ where, orderBy: { startedAt: 'desc' }, skip, take: limit, include: adminVisitInclude }),
      prisma.shopVisit.count({ where }),
    ]);
    res.json({ success: true, data: rows, meta: { page, limit, total } });
  } catch (err) {
    console.error('getShopVisits error:', err);
    fail(res, 500, 'Failed to load visits');
  }
};

// GET /api/v1/admin/shop-visits/:id
export const getShopVisitById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const visit = await prisma.shopVisit.findUnique({
      where: { id: req.params.id },
      include: { ...adminVisitInclude, feedback: { orderBy: { createdAt: 'asc' } }, attendance: { select: { id: true, checkInAt: true, checkOutAt: true } } },
    });
    if (!visit) return void fail(res, 404, 'Visit not found');
    res.json({ success: true, data: visit });
  } catch (err) {
    console.error('getShopVisitById error:', err);
    fail(res, 500, 'Failed to load visit');
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// FEEDBACK
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/v1/admin/feedback?status=&category=&merchandiserId=&customerId=&followUp=true&from=&to=&page=&limit=
export const getFeedback = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = pageParams(req, 30, 200);
    const q = req.query;
    const range = riyadhRangeFilter(q.from, q.to);
    if (!range) return void fail(res, 400, 'from/to must be YYYY-MM-DD');
    const where: any = {};
    if (range.gte || range.lt) where.createdAt = range;
    if (q.status) {
      if (!FEEDBACK_STATUSES.includes(String(q.status))) return void fail(res, 400, `status must be one of: ${FEEDBACK_STATUSES.join(', ')}`);
      where.status = String(q.status);
    }
    if (q.category) {
      if (!FEEDBACK_CATEGORIES.includes(String(q.category))) return void fail(res, 400, `category must be one of: ${FEEDBACK_CATEGORIES.join(', ')}`);
      where.category = String(q.category);
    }
    if (q.merchandiserId) where.merchandiserId = String(q.merchandiserId);
    if (q.customerId) where.customerId = String(q.customerId);
    if (q.followUp !== undefined) where.followUpRequired = truthy(q.followUp);
    const [rows, total] = await Promise.all([
      prisma.shopFeedback.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take: limit,
        include: { customer: { select: { id: true, name: true } }, merchandiser: { select: { id: true, name: true } } },
      }),
      prisma.shopFeedback.count({ where }),
    ]);
    res.json({ success: true, data: rows, meta: { page, limit, total } });
  } catch (err) {
    console.error('getFeedback error:', err);
    fail(res, 500, 'Failed to load feedback');
  }
};

// PATCH /api/v1/admin/feedback/:id   { status?, adminNote? }
export const reviewFeedback = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const b = req.body || {};
    const data: Record<string, unknown> = {};
    if (b.status !== undefined) {
      if (!FEEDBACK_STATUSES.includes(String(b.status))) return void fail(res, 400, `status must be one of: ${FEEDBACK_STATUSES.join(', ')}`);
      data.status = b.status;
    }
    if (b.adminNote !== undefined) data.adminNote = str(b.adminNote, 1000);
    if (Object.keys(data).length === 0) return void fail(res, 400, 'Nothing to update');
    data.reviewedById = req.user!.userId;
    data.reviewedAt = new Date();
    const updated = await prisma.shopFeedback.update({ where: { id: req.params.id }, data });
    res.json({ success: true, data: updated });
  } catch (err: any) {
    if (err.code === 'P2025') return void fail(res, 404, 'Feedback not found');
    console.error('reviewFeedback error:', err);
    fail(res, 500, 'Failed to update feedback');
  }
};
