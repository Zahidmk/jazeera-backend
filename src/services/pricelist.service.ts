/**
 * pricelist.service.ts
 *
 * The price a product has on a customer's Odoo pricelist (res.partner.property_product_pricelist),
 * for display next to the catalogue price.
 *
 * Odoo has no public method for this (`_get_product_price` is private and `price_get` is gone in
 * 18), so the pricelist rules are read and applied here. Quantity is taken as 1. Supported:
 *   applied_on  : global, product category (incl. child categories), product template, variant
 *   compute     : fixed, percentage, formula (discount / surcharge / rounding / margins)
 *   base        : list_price (Sales Price) or standard_price (Cost); another pricelist as the
 *                 base is not followed and falls back to the Sales Price
 * Anything that fails returns null so callers fall back to the catalogue price.
 */
import odoo from './odoo/odoo.service';

const CACHE_TTL_MS = 10 * 60 * 1000;

interface Item {
  applied_on: string;
  compute_price: string;
  base: string;
  fixed_price: number;
  percent_price: number;
  price_discount: number;
  price_surcharge: number;
  price_round: number;
  price_min_margin: number;
  price_max_margin: number;
  min_quantity: number;
  date_start: string | false;
  date_end: string | false;
  product_tmpl_id: [number, string] | false;
  product_id: [number, string] | false;
  categ_id: [number, string] | false;
}

interface ProductInfo {
  tmplId: number | null;
  categId: number | null;
  listPrice: number;
  standardPrice: number;
}

const ITEM_FIELDS = [
  'applied_on', 'compute_price', 'base', 'fixed_price', 'percent_price', 'price_discount',
  'price_surcharge', 'price_round', 'price_min_margin', 'price_max_margin', 'min_quantity',
  'date_start', 'date_end', 'product_tmpl_id', 'product_id', 'categ_id',
];

// Most specific first, as Odoo orders them
const APPLIED_ORDER: Record<string, number> = {
  '0_product_variant': 0,
  '1_product': 1,
  '2_product_category': 2,
  '3_global': 3,
};

function timed<T>(ttl: number) {
  const store = new Map<string, { value: T; expiresAt: number }>();
  return {
    get(key: string): T | undefined {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt <= Date.now()) {
        store.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key: string, value: T): void {
      store.set(key, { value, expiresAt: Date.now() + ttl });
    },
  };
}

const partnerCache = timed<number | null>(CACHE_TTL_MS);
const itemsCache = timed<Item[]>(CACHE_TTL_MS);
const productCache = timed<ProductInfo>(CACHE_TTL_MS);
const categPathCache = timed<number[]>(CACHE_TTL_MS);

async function getPartnerPricelistId(partnerId: number): Promise<number | null> {
  const key = String(partnerId);
  const cached = partnerCache.get(key);
  if (cached !== undefined) return cached;
  const rows = await odoo.read('res.partner', [partnerId], ['property_product_pricelist']);
  const pl = rows?.[0]?.property_product_pricelist;
  const id = Array.isArray(pl) ? Number(pl[0]) : null;
  partnerCache.set(key, id);
  return id;
}

async function getItems(pricelistId: number): Promise<Item[]> {
  const key = String(pricelistId);
  const cached = itemsCache.get(key);
  if (cached) return cached;
  const items: Item[] = await odoo.searchRead(
    'product.pricelist.item',
    [['pricelist_id', '=', pricelistId]],
    ITEM_FIELDS,
    { limit: 5000 }
  );
  items.sort((a, b) => {
    const byApplied = (APPLIED_ORDER[a.applied_on] ?? 9) - (APPLIED_ORDER[b.applied_on] ?? 9);
    return byApplied || b.min_quantity - a.min_quantity;
  });
  itemsCache.set(key, items);
  return items;
}

async function getProducts(productOdooIds: number[]): Promise<Map<number, ProductInfo>> {
  const out = new Map<number, ProductInfo>();
  const missing: number[] = [];
  for (const id of productOdooIds) {
    const hit = productCache.get(String(id));
    if (hit) out.set(id, hit);
    else missing.push(id);
  }
  if (missing.length) {
    const rows = await odoo.read('product.product', missing, [
      'product_tmpl_id', 'categ_id', 'list_price', 'standard_price',
    ]);
    for (const r of rows || []) {
      const info: ProductInfo = {
        tmplId: Array.isArray(r.product_tmpl_id) ? Number(r.product_tmpl_id[0]) : null,
        categId: Array.isArray(r.categ_id) ? Number(r.categ_id[0]) : null,
        listPrice: Number(r.list_price) || 0,
        standardPrice: Number(r.standard_price) || 0,
      };
      productCache.set(String(r.id), info);
      out.set(r.id, info);
    }
  }
  return out;
}

/** A category's own id plus every ancestor id, from Odoo's parent_path ("1/4/9/") */
async function getCategoryLineage(categId: number): Promise<number[]> {
  const key = String(categId);
  const cached = categPathCache.get(key);
  if (cached) return cached;
  const rows = await odoo.read('product.category', [categId], ['parent_path']);
  const path = String(rows?.[0]?.parent_path ?? '');
  const ids = path.split('/').filter(Boolean).map(Number);
  const lineage = ids.length ? ids : [categId];
  categPathCache.set(key, lineage);
  return lineage;
}

function inDateRange(item: Item, today: string): boolean {
  if (item.date_start && today < String(item.date_start).slice(0, 10)) return false;
  if (item.date_end && today > String(item.date_end).slice(0, 10)) return false;
  return true;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function applyItem(item: Item, p: ProductInfo): number {
  const base = item.base === 'standard_price' ? p.standardPrice : p.listPrice;
  let price: number;
  switch (item.compute_price) {
    case 'fixed':
      return item.fixed_price;
    case 'percentage':
      price = base - (base * item.percent_price) / 100;
      return Math.max(price, 0);
    default: {
      // formula
      price = base - (base * item.price_discount) / 100;
      if (item.price_round) price = Math.round(price / item.price_round) * item.price_round;
      price += item.price_surcharge;
      if (item.price_min_margin) price = Math.max(price, base + item.price_min_margin);
      if (item.price_max_margin) price = Math.min(price, base + item.price_max_margin);
      return Math.max(price, 0);
    }
  }
}

/**
 * Pricelist price per Odoo product id for one Odoo customer (partner).
 * Products no rule matches get their plain Sales Price, which is what Odoo charges then.
 * Returns an empty map when the customer's pricelist cannot be read.
 */
export async function getPricelistPrices(
  customerOdooId: number,
  productOdooIds: number[]
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const ids = [...new Set(productOdooIds)].filter((id) => Number.isFinite(id));
  if (!ids.length) return out;

  try {
    const pricelistId = await getPartnerPricelistId(customerOdooId);
    if (!pricelistId) return out;

    const [items, products] = await Promise.all([getItems(pricelistId), getProducts(ids)]);
    const today = new Date().toISOString().slice(0, 10);
    const usable = items.filter((i) => i.min_quantity <= 1 && inDateRange(i, today));

    for (const id of ids) {
      const p = products.get(id);
      if (!p) continue;

      let lineage: number[] | null = null;
      let price = p.listPrice;

      for (const item of usable) {
        let match = false;
        switch (item.applied_on) {
          case '3_global':
            match = true;
            break;
          case '1_product':
            match = !!item.product_tmpl_id && item.product_tmpl_id[0] === p.tmplId;
            break;
          case '0_product_variant':
            match = !!item.product_id && item.product_id[0] === id;
            break;
          case '2_product_category':
            if (item.categ_id && p.categId != null) {
              lineage ??= await getCategoryLineage(p.categId);
              match = lineage.includes(item.categ_id[0]);
            }
            break;
        }
        if (match) {
          price = applyItem(item, p);
          break;
        }
      }
      out.set(id, round2(price));
    }
  } catch (err: any) {
    console.warn('⚠️  Pricelist lookup failed — falling back to catalogue price:', err?.message || err);
    return new Map();
  }
  return out;
}

export default { getPricelistPrices };
