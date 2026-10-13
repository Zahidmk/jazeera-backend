/** Parse a latitude/longitude pair from request input. Returns null when missing or out of range. */
export function parseLatLng(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (lat === undefined || lat === null || lat === '' || lng === undefined || lng === null || lng === '') return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  // (0,0) is the classic "GPS not ready" value from mobile SDKs — treat as missing
  if (la === 0 && ln === 0) return null;
  return { lat: la, lng: ln };
}

export function parseOptionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Great-circle distance in metres. */
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Lat/lng box around a point, used to pre-filter rows in SQL before the exact distance is computed. */
export function boundingBox(lat: number, lng: number, radiusKm: number) {
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

/**
 * Day boundaries in Saudi time (UTC+3, no DST) for a YYYY-MM-DD string, so "today's attendance"
 * means the Riyadh calendar day regardless of the server's timezone.
 */
export function riyadhDayRange(date: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const start = new Date(`${date}T00:00:00+03:00`);
  if (isNaN(start.getTime())) return null;
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** Optional from/to (YYYY-MM-DD, inclusive) → Prisma date filter on Riyadh days. */
export function riyadhRangeFilter(from?: unknown, to?: unknown): { gte?: Date; lt?: Date } | null {
  const f: { gte?: Date; lt?: Date } = {};
  if (from) {
    const r = riyadhDayRange(String(from));
    if (!r) return null;
    f.gte = r.start;
  }
  if (to) {
    const r = riyadhDayRange(String(to));
    if (!r) return null;
    f.lt = r.end;
  }
  return f;
}
