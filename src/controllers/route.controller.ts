/**
 * Driving directions for the merchandiser map (proof of concept).
 *
 * The Flutter app never talks to a routing service. It asks us, and we call the configured
 * engine, so the API key stays on the server and we can cache, rate-limit and swap engines.
 *
 * Engines (env):
 *   ORS_API_KEY          openrouteservice (https://openrouteservice.org) - hosted, free key
 *   ROUTING_BASE_URL     an OSRM-compatible server you run yourself, e.g. http://127.0.0.1:5000
 *   ROUTING_PROVIDER     'ors' | 'osrm' - optional; defaults to ors when a key is set, else osrm
 *
 * The public OSRM demo server (router.project-osrm.org) is deliberately NOT a default: its usage
 * policy forbids production use, has no SLA, and it is set up for the car profile only.
 */
import { Response } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { parseLatLng } from '../utils/geo';

type LatLng = [number, number];
interface RouteResult {
  distanceM: number;
  durationS: number;
  points: LatLng[];
  provider: string;
}

const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 500;
const MAX_POINTS = 1500;
// Per user: protects the free ORS quota (40/min, 2000/day) from a stuck client.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 20;

const cache = new Map<string, { at: number; route: RouteResult }>();
const inflight = new Map<string, Promise<RouteResult>>();
const hits = new Map<string, number[]>();

function provider(): 'ors' | 'osrm' | null {
  const want = (process.env.ROUTING_PROVIDER || '').toLowerCase();
  if (want === 'ors' && process.env.ORS_API_KEY) return 'ors';
  if (want === 'osrm' && process.env.ROUTING_BASE_URL) return 'osrm';
  if (!want) {
    if (process.env.ORS_API_KEY) return 'ors';
    if (process.env.ROUTING_BASE_URL) return 'osrm';
  }
  return null;
}

/** Keeps the line light for the phone while preserving its shape and both ends. */
function thin(points: LatLng[]): LatLng[] {
  if (points.length <= MAX_POINTS) return points;
  const step = Math.ceil(points.length / MAX_POINTS);
  const out = points.filter((_, i) => i % step === 0);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

async function http(url: string, init: RequestInit): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...init, signal: ctrl.signal });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw Object.assign(new Error(`Routing service returned ${resp.status}`), { status: resp.status, body: text.slice(0, 300) });
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

async function viaOrs(a: LatLng, b: LatLng): Promise<RouteResult> {
  const base = process.env.ORS_BASE_URL || 'https://api.openrouteservice.org';
  const json = await http(`${base}/v2/directions/driving-car/geojson`, {
    method: 'POST',
    headers: { Authorization: process.env.ORS_API_KEY as string, 'Content-Type': 'application/json' },
    // ORS takes [lng, lat].
    body: JSON.stringify({ coordinates: [[a[1], a[0]], [b[1], b[0]]], instructions: false }),
  });
  const feature = json?.features?.[0];
  const coords: [number, number][] | undefined = feature?.geometry?.coordinates;
  const summary = feature?.properties?.summary;
  if (!coords?.length || !summary) throw new Error('Routing service returned no route');
  return {
    distanceM: Math.round(summary.distance),
    durationS: Math.round(summary.duration),
    points: thin(coords.map(([lng, lat]) => [lat, lng] as LatLng)),
    provider: 'openrouteservice',
  };
}

async function viaOsrm(a: LatLng, b: LatLng): Promise<RouteResult> {
  const base = (process.env.ROUTING_BASE_URL as string).replace(/\/+$/, '');
  const json = await http(
    `${base}/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson&steps=false`,
    { method: 'GET' },
  );
  const route = json?.routes?.[0];
  const coords: [number, number][] | undefined = route?.geometry?.coordinates;
  if (json?.code !== 'Ok' || !coords?.length) throw new Error('Routing service returned no route');
  return {
    distanceM: Math.round(route.distance),
    durationS: Math.round(route.duration),
    points: thin(coords.map(([lng, lat]) => [lat, lng] as LatLng)),
    provider: 'osrm',
  };
}

function allow(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);
  return true;
}

// POST /api/v1/merchandiser/route
// { fromLat, fromLng, customerId }  or  { fromLat, fromLng, toLat, toLng }
export const getRoute = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const engine = provider();
    if (!engine) {
      res.status(503).json({ success: false, error: 'Directions are not configured on the server', code: 'ROUTING_NOT_CONFIGURED' });
      return;
    }

    const from = parseLatLng(req.body?.fromLat, req.body?.fromLng);
    if (!from) {
      res.status(400).json({ success: false, error: 'Your GPS position (fromLat, fromLng) is required' });
      return;
    }

    let to = parseLatLng(req.body?.toLat, req.body?.toLng);
    if (req.body?.customerId) {
      const shop = await prisma.customer.findUnique({
        where: { id: String(req.body.customerId).slice(0, 64) },
        select: { lat: true, lng: true },
      });
      if (!shop) {
        res.status(404).json({ success: false, error: 'Shop not found' });
        return;
      }
      to = parseLatLng(shop.lat, shop.lng);
      if (!to) {
        res.status(422).json({ success: false, error: 'This shop has no location saved', code: 'NO_DESTINATION' });
        return;
      }
    }
    if (!to) {
      res.status(400).json({ success: false, error: 'A destination is required (customerId or toLat/toLng)' });
      return;
    }

    const a: LatLng = [from.lat, from.lng];
    const b: LatLng = [to.lat, to.lng];
    // ~11 m grid: two requests from almost the same spot share one answer.
    const key = `${engine}|${a[0].toFixed(4)},${a[1].toFixed(4)}|${b[0].toFixed(5)},${b[1].toFixed(5)}`;

    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      res.json({ success: true, data: { ...cached.route, cached: true } });
      return;
    }

    let pending = inflight.get(key);
    if (!pending) {
      if (!allow(req.user!.userId)) {
        res.status(429).json({ success: false, error: 'Too many route requests. Wait a few minutes.', code: 'RATE_LIMITED' });
        return;
      }
      pending = (engine === 'ors' ? viaOrs(a, b) : viaOsrm(a, b)).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }

    const route = await pending;
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), route });
    res.json({ success: true, data: { ...route, cached: false } });
  } catch (err: any) {
    console.error('getRoute error:', err?.status || '', err?.body || err?.message || err);
    const quota = err?.status === 429;
    const noRoad = err?.status === 404 || /no route/i.test(err?.message || '');
    res.status(quota ? 503 : noRoad ? 404 : 502).json({
      success: false,
      error: quota
        ? 'The routing service is busy. Try again shortly.'
        : noRoad
          ? 'No driving route was found to this shop'
          : err?.name === 'AbortError'
            ? 'The routing service timed out'
            : 'Could not calculate the route',
    });
  }
};
