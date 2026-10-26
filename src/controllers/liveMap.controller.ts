/**
 * liveMap.controller.ts — back-office "live map" (mounted under /api/v1/admin, ADMIN / MANAGER only)
 *
 * There is no continuous GPS tracking: the apps only record a position when something happens
 * (check-in/out, shop visit start/end, cash sale). So "live" here means each person's LAST KNOWN
 * position today (Riyadh day) and when it was recorded, plus the registered shops. The dashboard
 * polls this endpoint.
 */
import { Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../types';
import { riyadhDayRange } from '../utils/geo';

type PositionSource = 'CHECK_IN' | 'CHECK_OUT' | 'VISIT_START' | 'VISIT_END' | 'SALE';

interface LastKnown {
  at: Date;
  lat: number;
  lng: number;
  source: PositionSource;
  detail: string | null;
}

const SHOP_LIMIT = 500;

function latest(current: LastKnown | undefined, next: LastKnown): LastKnown {
  return !current || next.at > current.at ? next : current;
}

// GET /api/v1/admin/live-map
export const getLiveMap = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const today = riyadhDayRange(new Date(now.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10))!;
    const dayWindow = { gte: today.start, lt: today.end };

    const [merchandisers, fieldStaff, attendances, visits, openVisits, sales, activeShifts, shops] = await Promise.all([
      prisma.user.findMany({
        where: { role: 'MERCHANDISER', isActive: true },
        select: { id: true, name: true, phone: true },
        orderBy: { name: 'asc' },
      }),
      prisma.user.findMany({
        where: { role: { in: ['DRIVER', 'SALESMAN'] }, isActive: true },
        select: { id: true, name: true, phone: true, role: true },
        orderBy: { name: 'asc' },
      }),
      prisma.attendance.findMany({
        where: { checkInAt: dayWindow },
        select: {
          merchandiserId: true, openKey: true,
          checkInAt: true, checkInLat: true, checkInLng: true,
          checkOutAt: true, checkOutLat: true, checkOutLng: true,
        },
      }),
      prisma.shopVisit.findMany({
        where: { startedAt: dayWindow },
        select: {
          merchandiserId: true, startedAt: true, startLat: true, startLng: true,
          endedAt: true, endLat: true, endLng: true,
          customer: { select: { name: true } },
        },
      }),
      prisma.shopVisit.findMany({
        where: { openKey: { not: null } },
        select: { merchandiserId: true, customer: { select: { name: true } } },
      }),
      prisma.cashSale.findMany({
        where: { createdAt: dayWindow, latitude: { not: null }, longitude: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: {
          driverId: true, createdAt: true, latitude: true, longitude: true,
          customer: { select: { name: true } },
        },
      }),
      prisma.shift.findMany({
        where: { status: 'ACTIVE' },
        select: { driverId: true, van: { select: { plateNumber: true } } },
      }),
      prisma.customer.findMany({
        where: { createdBy: { role: 'MERCHANDISER' }, lat: { not: null }, lng: { not: null } },
        select: { id: true, name: true, lat: true, lng: true, shopType: true, city: true },
        orderBy: { createdAt: 'desc' },
        take: SHOP_LIMIT,
      }),
    ]);

    // ── Merchandisers: newest of today's attendance + visit events ───────────
    const lastByUser = new Map<string, LastKnown>();
    const openAttendance = new Set<string>();
    const anyAttendance = new Set<string>();

    for (const a of attendances) {
      anyAttendance.add(a.merchandiserId);
      if (a.openKey) openAttendance.add(a.merchandiserId);
      lastByUser.set(
        a.merchandiserId,
        latest(lastByUser.get(a.merchandiserId), {
          at: a.checkInAt, lat: a.checkInLat, lng: a.checkInLng, source: 'CHECK_IN', detail: null,
        })
      );
      if (a.checkOutAt && a.checkOutLat != null && a.checkOutLng != null) {
        lastByUser.set(
          a.merchandiserId,
          latest(lastByUser.get(a.merchandiserId), {
            at: a.checkOutAt, lat: a.checkOutLat, lng: a.checkOutLng, source: 'CHECK_OUT', detail: null,
          })
        );
      }
    }
    for (const v of visits) {
      lastByUser.set(
        v.merchandiserId,
        latest(lastByUser.get(v.merchandiserId), {
          at: v.startedAt, lat: v.startLat, lng: v.startLng, source: 'VISIT_START', detail: v.customer.name,
        })
      );
      if (v.endedAt && v.endLat != null && v.endLng != null) {
        lastByUser.set(
          v.merchandiserId,
          latest(lastByUser.get(v.merchandiserId), {
            at: v.endedAt, lat: v.endLat, lng: v.endLng, source: 'VISIT_END', detail: v.customer.name,
          })
        );
      }
    }
    const inVisit = new Map(openVisits.map((v) => [v.merchandiserId, v.customer.name] as const));

    const merchandiserRows = merchandisers.map((u) => {
      const last = lastByUser.get(u.id);
      const status = inVisit.has(u.id)
        ? 'IN_VISIT'
        : openAttendance.has(u.id)
        ? 'ON_DUTY'
        : anyAttendance.has(u.id)
        ? 'CHECKED_OUT'
        : 'NOT_STARTED';
      return {
        id: u.id,
        name: u.name,
        phone: u.phone,
        role: 'MERCHANDISER' as const,
        status,
        lat: last?.lat ?? null,
        lng: last?.lng ?? null,
        at: last?.at ?? null,
        source: last?.source ?? null,
        detail: inVisit.get(u.id) ?? last?.detail ?? null,
      };
    });

    // ── Drivers / salesmen: last geotagged sale today ────────────────────────
    // Newest first, so the first sale seen per user is their latest.
    const saleByUser = new Map<string, (typeof sales)[number]>();
    for (const s of sales) if (!saleByUser.has(s.driverId)) saleByUser.set(s.driverId, s);
    const vanByDriver = new Map(activeShifts.map((s) => [s.driverId, s.van.plateNumber] as const));

    const fieldRows = fieldStaff.map((u) => {
      const sale = saleByUser.get(u.id);
      const van = vanByDriver.get(u.id) ?? null;
      return {
        id: u.id,
        name: u.name,
        phone: u.phone,
        role: u.role,
        status: van ? 'ON_SHIFT' : sale ? 'ACTIVE_TODAY' : 'NO_ACTIVITY',
        lat: sale?.latitude ?? null,
        lng: sale?.longitude ?? null,
        at: sale?.createdAt ?? null,
        source: sale ? ('SALE' as const) : null,
        detail: sale ? sale.customer?.name ?? 'Cash sale' : van ? `Van ${van}` : null,
      };
    });

    res.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        people: [...merchandiserRows, ...fieldRows],
        shops,
      },
    });
  } catch (err) {
    console.error('getLiveMap error:', err);
    res.status(500).json({ success: false, error: 'Failed to load live map' });
  }
};
