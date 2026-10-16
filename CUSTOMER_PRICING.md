# Customer-Specific Pricing

Every shop has its own pricelist in Odoo, so a product does not have one price —
it has a price *per customer*. This guide covers how the backend resolves that
price and how the apps should ask for it.

---

## 1. Where the price comes from

Odoo exposes a custom service for this:

| | |
|---|---|
| Model | `vansales.integration.service` |
| Method | `get_last_sale_price` |
| Parameters | `customer_id` (Odoo partner id), `product_id` (Odoo product id) |

It returns the price that customer last actually paid for that product:

```json
{ "product_id": 23915, "last_sale_price": 1.0, "sale_date": "2026-10-11 14:35:48", "currency_id": 150 }
```

…or `false` when that customer has never bought that product.

Two constraints from Odoo shape everything below:

1. **One product per call.** Passing a list raises `Expected singleton`.
2. **~290 ms per call.** A 20-product page resolved serially would block ~6 s.

So `src/services/pricing.service.ts` resolves a whole page at once through a
concurrency pool (8 by default), caches each answer for 10 minutes, and always
falls back to the catalogue price. **Pricing never fails a request** — if Odoo is
down, unreachable, or has no history for the pair, the app gets `priceRetail`.

### The fallback chain

| Situation | Price returned | `priceSource` |
|---|---|---|
| Customer has bought this product before | Last price that customer paid | `CUSTOMER_LAST_SALE` |
| Customer has never bought this product | Catalogue price (`priceRetail`) | `LIST` |
| Product not synced to Odoo (`odooId` is null) | Catalogue price | `LIST` |
| Shop not pushed to Odoo yet (no `odooId`) | Catalogue price | `LIST` |
| No `customerId` passed / Odoo unreachable | Catalogue price | `LIST` |

---

## 2. Reading prices in a product list

Add `customerId` to any of the existing listing endpoints and every row gains
three fields. Leave it off and the responses are byte-for-byte what they were
before — this is fully backward compatible.

| Endpoint | Use it for |
|---|---|
| `GET /api/v1/products/search?customerId=` | Generic product search |
| `GET /api/v1/salesman/products?customerId=` | Salesman building a quotation |
| `GET /api/v1/driver/van/inventory?customerId=` | Driver selling from the van at a shop |

The admin dashboard uses the batch endpoint below instead, because its stock
views come live from Odoo and are keyed by Odoo product id.

Added to each product row:

```jsonc
{
  "id": "24589969-85e9-426a-8777-887e7ffd17a2",
  "name": "Mineral Water 500ml",
  "priceRetail": 1.50,          // catalogue price — unchanged

  "customerPrice": 1.25,        // ← charge this
  "priceSource": "CUSTOMER_LAST_SALE",
  "lastSaleDate": "2026-10-11 14:35:48"
}
```

**App rule:** display and charge `customerPrice` when it is present, otherwise
`priceRetail`. Showing `priceRetail` struck through next to `customerPrice` when
`priceSource` is `CUSTOMER_LAST_SALE` makes the shop's own price visible to the
driver, which is usually what the shop owner wants to see too.

`customerId` accepts either a local customer UUID (what the mobile apps hold) or
a raw Odoo partner id (what the dashboard holds).

---

## 3. Asking for prices directly

**One product**

```http
GET /api/v1/products/:productId/price?customerId=<uuid|odooId>
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "data": {
    "productId": "24589969-85e9-426a-8777-887e7ffd17a2",
    "price": 1.25,
    "listPrice": 1.50,
    "priceSource": "CUSTOMER_LAST_SALE",
    "lastSaleDate": "2026-10-11 14:35:48"
  }
}
```

**Many products** (one round-trip — prefer this for a cart or a saved list)

```http
POST /api/v1/products/prices
Authorization: Bearer <token>
Content-Type: application/json

{
  "customerId": "a1b2c3d4-...",
  "productIds": ["24589969-...", "7b2c1a90-..."]
}
```

```json
{
  "success": true,
  "data": [
    { "productId": "24589969-...", "odooId": 23915, "price": 1.25, "listPrice": 1.50, "priceSource": "CUSTOMER_LAST_SALE", "lastSaleDate": "2026-10-11 14:35:48" },
    { "productId": "7b2c1a90-...", "odooId": 21302, "price": 3.00, "listPrice": 3.00, "priceSource": "LIST", "lastSaleDate": null }
  ],
  "meta": { "customerId": "a1b2c3d4-...", "requested": 2, "resolved": 2, "keyedBy": "productId" }
}
```

**By Odoo product id instead.** The mobile apps hold local UUIDs, but the admin
dashboard works in Odoo ids (its stock views come straight from Odoo). Send
`productOdooIds` in place of `productIds` and the result is the same shape, so
you can key on `odooId`:

```json
{ "customerId": 17120, "productOdooIds": [23915, 21302] }
```

Products not synced locally are simply absent from the response, so check for a
missing row rather than assuming a price. `meta.keyedBy` tells you which
identifier the call was resolved by.

Up to 200 product ids per batch, either kind. A 404 on the single-product
endpoint means the product id does not exist; a product that exists always
resolves to *some* price.

---

## 4. Selling at the customer price

The cash-sale flow applies the shop's pricelist on its own — the app does not
have to send prices.

* **`POST /api/v1/driver/sales/cart/items`** now accepts `customerId`. When sent,
  the line is added at that shop's price instead of the catalogue price.
* **`POST /api/v1/driver/sales/submit`** re-prices every line against the chosen
  customer at submit time. This matters because the cart is usually built before
  the customer is picked.

**An explicit `unitPrice` in the submit body is never overwritten.** That is
treated as the driver deliberately setting a price, and it wins over the
pricelist. Send `unitPrice` only when you mean to override; omit it to let the
customer's pricelist apply.

Walk-in customers have no Odoo partner, so they are always sold at list price.

After a sale is pushed to Odoo, that customer's cached prices are dropped — the
new sale is now their "last sale price".

---

## 5. Operating notes

Tunable via `.env` (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `CUSTOMER_PRICE_CACHE_TTL_MS` | `600000` (10 min) | How long a resolved price is cached |
| `CUSTOMER_PRICE_CONCURRENCY` | `8` | Parallel Odoo lookups per request |
| `CUSTOMER_PRICE_MAX_LOOKUPS` | `100` | Lookups per request; products past the cap keep the list price |

The cache is in-process. With multiple API instances each keeps its own, which
is fine — entries are short-lived and the worst case is a repeated lookup.

**Latency to expect:** a cold page of 20 products resolves in roughly
`20 / 8 × 290 ms ≈ 0.8 s`; cached pages are instant. Keep `limit` modest on
product listings when `customerId` is set.

**Verify the integration** (read-only, hits real Odoo):

```bash
npx ts-node scripts/test-pricing.ts
```

It picks a real customer/product pair out of Odoo's confirmed orders and prints
the catalogue price next to the customer's price, then exercises the cache, the
UUID path and the fallbacks.
