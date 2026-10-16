/**
 * pricing.service.ts
 *
 * Customer-specific product pricing.
 *
 * Every shop in Odoo has its own pricelist, so the price a product should be
 * shown at depends on *which customer* is being served. Odoo exposes this via
 * the custom model `vansales.integration.service`:
 *
 *     get_last_sale_price(customer_id, product_id)
 *       -> { product_id, last_sale_price, sale_date, currency_id }  // has history
 *       -> false                                                    // no history
 *
 * Two properties of that call shape everything here:
 *   1. It handles ONE product per call (a list raises "Expected singleton").
 *   2. A round-trip costs ~290 ms, so a 20-product page done serially would
 *      block for ~6 s.
 *
 * So this module resolves a whole page of products at once through a small
 * concurrency pool, memoises each (customer, product) answer for a few minutes,
 * and always degrades to the locally synced list price (`priceRetail`) when
 * Odoo is unreachable or the customer has never bought that product. Pricing
 * must never take the mobile app down.
 */

import prisma from '../utils/prisma';
import odoo from './odoo/odoo.service';

// ─── Tunables ────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = Number(process.env.CUSTOMER_PRICE_CACHE_TTL_MS) || 10 * 60 * 1000; // 10 min
const CONCURRENCY = Number(process.env.CUSTOMER_PRICE_CONCURRENCY) || 8;
const MAX_LOOKUPS = Number(process.env.CUSTOMER_PRICE_MAX_LOOKUPS) || 100; // per request
const CACHE_MAX_ENTRIES = 20000;

export type PriceSource = 'CUSTOMER_LAST_SALE' | 'LIST';

export interface ResolvedPrice {
  /** Local product UUID */
  productId: string;
  /** Price to display / charge for this customer */
  price: number;
  /** Catalogue price from the Odoo sync — what we fall back to */
  listPrice: number;
  /** Where `price` came from */
  priceSource: PriceSource;
  /** Date of the sale `price` was taken from (null for LIST) */
  lastSaleDate: string | null;
}

// ─── Cache ───────────────────────────────────────────────────────────────────
// key: `${customerOdooId}:${productOdooId}` -> last sale price (or null, meaning
// "no history" — cached too, so we do not re-ask Odoo on every page load).
interface CacheEntry {
  price: number | null;
  saleDate: string | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(customerOdooId: number, productOdooId: number): string {
  return `${customerOdooId}:${productOdooId}`;
}

function cacheGet(key: string): CacheEntry | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit;
}

function cacheSet(key: string, price: number | null, saleDate: string | null): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Cheap eviction: drop everything already expired, then the oldest inserts
    const now = Date.now();
    for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
    if (cache.size >= CACHE_MAX_ENTRIES) {
      let toDrop = Math.ceil(CACHE_MAX_ENTRIES / 10);
      for (const k of cache.keys()) {
        cache.delete(k);
        if (--toDrop <= 0) break;
      }
    }
  }
  cache.set(key, { price, saleDate, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Drop cached prices for one customer — call this after a sale is pushed to
 * Odoo, because that sale becomes the customer's new "last sale price".
 */
export function invalidateCustomerPriceCache(customerOdooId: number | null | undefined): void {
  if (!customerOdooId) return;
  const prefix = `${customerOdooId}:`;
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

/** Wipe the whole cache (used by tests and the manual sync endpoints). */
export function clearPriceCache(): void {
  cache.clear();
}

// ─── Customer resolution ─────────────────────────────────────────────────────
/**
 * Accepts either a local customer UUID or a raw Odoo partner id (as the admin
 * dashboard sends) and returns the Odoo partner id, or null when it cannot be
 * mapped — e.g. a shop a merchandiser registered that is not in Odoo yet.
 */
export async function resolveCustomerOdooId(
  customerId: string | number | null | undefined
): Promise<number | null> {
  // Query strings can arrive as arrays (?customerId=a&customerId=b) — take the
  // first value rather than letting a bad shape reach Prisma.
  if (Array.isArray(customerId)) customerId = customerId[0];
  if (customerId == null || customerId === '') return null;

  // Numeric -> already an Odoo partner id
  if (typeof customerId === 'number') return Number.isFinite(customerId) ? customerId : null;
  if (/^\d+$/.test(customerId)) return parseInt(customerId, 10);

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { odooId: true },
  });
  return customer?.odooId ?? null;
}

// ─── Concurrency pool ────────────────────────────────────────────────────────
/** The slice of a Product row a price lookup needs */
interface PriceLookupTarget {
  id: string;
  odooId: number | null;
  priceRetail: number;
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i]);
    }
  });

  await Promise.all(runners);
}

// ─── Core lookup ─────────────────────────────────────────────────────────────
async function lookupLastSalePrice(
  customerOdooId: number,
  productOdooId: number
): Promise<CacheEntry | null> {
  const key = cacheKey(customerOdooId, productOdooId);
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const result = await odoo.getLastSalePrice(customerOdooId, productOdooId);
    const price = result && result.price > 0 ? result.price : null;
    const saleDate = result?.saleDate ?? null;
    cacheSet(key, price, saleDate);
    return { price, saleDate, expiresAt: Date.now() + CACHE_TTL_MS };
  } catch (err: any) {
    // Odoo down / method missing / timeout -> caller falls back to list price.
    // Deliberately not cached: we want to retry on the next request.
    console.warn(
      `⚠️  Pricing: get_last_sale_price(${customerOdooId}, ${productOdooId}) failed — falling back to list price:`,
      err?.message || err
    );
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolve the price each of `productIds` should be sold at for `customerId`.
 * Always returns an entry for every product that exists — falling back to the
 * local list price whenever Odoo has no answer.
 */
export async function getCustomerPrices(
  customerId: string | number | null | undefined,
  productIds: string[]
): Promise<Map<string, ResolvedPrice>> {
  const out = new Map<string, ResolvedPrice>();
  const uniqueIds = [...new Set(productIds)].filter(Boolean);
  if (uniqueIds.length === 0) return out;

  const products = await prisma.product.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, odooId: true, priceRetail: true },
  });

  // Seed every product with its list price, then upgrade the ones Odoo answers for
  for (const p of products) {
    out.set(p.id, {
      productId: p.id,
      price: p.priceRetail,
      listPrice: p.priceRetail,
      priceSource: 'LIST',
      lastSaleDate: null,
    });
  }

  const customerOdooId = await resolveCustomerOdooId(customerId);
  if (!customerOdooId) return out;

  // Only products that exist in Odoo can have a customer price. Cap the fan-out
  // so one oversized page cannot stall on hundreds of RPCs.
  const inOdoo: PriceLookupTarget[] = products.filter((p: PriceLookupTarget) => p.odooId != null);
  const lookupTargets = inOdoo.slice(0, MAX_LOOKUPS);

  if (lookupTargets.length < inOdoo.length) {
    console.warn(
      `⚠️  Pricing: capped customer-price lookup at ${MAX_LOOKUPS} products (customer ${customerOdooId}); the rest keep list price.`
    );
  }

  await mapWithConcurrency(lookupTargets, CONCURRENCY, async (p: PriceLookupTarget) => {
    const entry = await lookupLastSalePrice(customerOdooId, p.odooId!);
    if (entry?.price != null) {
      out.set(p.id, {
        productId: p.id,
        price: entry.price,
        listPrice: p.priceRetail,
        priceSource: 'CUSTOMER_LAST_SALE',
        lastSaleDate: entry.saleDate,
      });
    }
  });

  return out;
}

/** Single-product convenience wrapper. Returns null if the product does not exist. */
export async function getCustomerPrice(
  customerId: string | number | null | undefined,
  productId: string
): Promise<ResolvedPrice | null> {
  const prices = await getCustomerPrices(customerId, [productId]);
  return prices.get(productId) ?? null;
}

/**
 * Attach `customerPrice` / `priceSource` / `lastSaleDate` to products already
 * selected from the DB. Returns the list untouched when no customer is given,
 * so every listing endpoint can call this unconditionally.
 */
export async function attachCustomerPrices<T extends { id: string }>(
  customerId: string | number | null | undefined,
  items: T[]
): Promise<(T & { customerPrice?: number; priceSource?: PriceSource; lastSaleDate?: string | null })[]> {
  if (!customerId || items.length === 0) return items;

  const prices = await getCustomerPrices(
    customerId,
    items.map((i) => i.id)
  );

  return items.map((item) => {
    const resolved = prices.get(item.id);
    if (!resolved) return item;
    return {
      ...item,
      customerPrice: resolved.price,
      priceSource: resolved.priceSource,
      lastSaleDate: resolved.lastSaleDate,
    };
  });
}

export default {
  getCustomerPrice,
  getCustomerPrices,
  attachCustomerPrices,
  resolveCustomerOdooId,
  invalidateCustomerPriceCache,
  clearPriceCache,
};
