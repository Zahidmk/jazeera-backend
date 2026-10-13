# Jazeera Merchandiser — API Guide (Phase 2)

REST API for the Merchandiser mobile app (`/api/v1/merchandiser/*`) and the back-office management endpoints used by the
dashboard (`/api/v1/admin/*`). JSON everywhere except check-in/check-out, which are `multipart/form-data`.

Every response is `{ "success": true|false, ... }`. Errors carry `"error"` (human text) and sometimes a machine `"code"`.

## 1. Authentication & permissions

| Header | Value |
|---|---|
| `Authorization` | `Bearer <token>` from `POST /api/v1/auth/login` (the account must have role `MERCHANDISER`) |

| Area | Who can call it |
|---|---|
| `/api/v1/merchandiser/*` | **MERCHANDISER only** (Admin/Manager/Driver/… get `403`). Every query is scoped to the caller. |
| `/api/v1/admin/{merchandisers,attendance,devices,shops,shop-visits,feedback}` | **ADMIN, MANAGER** |

* Role and active status are checked against the database on every request — deactivating a user or changing a role takes effect immediately (`401` / `403`).
* Times are stored in UTC. All `from` / `to` / `date` filters are **Saudi calendar days (UTC+3)** in `YYYY-MM-DD`.
* Pagination: `?page=1&limit=20`; lists return `meta: { page, limit, total }`.

---

## 2. Attendance

### How device & biometric verification work (read this)
* The **fingerprint / face prompt runs on the phone** (Flutter `local_auth`). The server cannot verify a biometric; the app must call check-in/out **only after the prompt succeeds** and send `biometricVerified=true`. The request is rejected without it.
* **Device binding:** every request carries a stable `deviceId`. A merchandiser's **first** device is trusted automatically; any other device gets `403 DEVICE_NOT_APPROVED` until an admin approves it in the dashboard (Attendance → Devices). This is what stops a colleague checking in from another phone.
* A check-out from a different device than the check-in is allowed but the record is **auto-flagged** for review.
* This is app-attested, not cryptographically attested. If stronger guarantees are needed later, add Play Integrity / App Attest.

### `GET /merchandiser/attendance/status`
Current state, used on app start.
```json
{ "success": true, "data": {
  "isCheckedIn": true,
  "attendance": { "...see attendance object..." },
  "activeVisit": { "id": "…", "customerId": "…", "startedAt": "…" },
  "devices": [ { "deviceId": "abc123", "label": "Pixel 8", "isApproved": true } ]
} }
```

### `POST /merchandiser/attendance/check-in`  — `multipart/form-data`
| Field | Required | Notes |
|---|---|---|
| `selfie` | ✅ (file) | JPEG or PNG, ≤ 5 MB. Content is verified, not just the extension. |
| `latitude`, `longitude` | ✅ | Decimal degrees. `(0,0)` and out-of-range values are rejected. |
| `accuracy` | – | GPS accuracy in metres |
| `deviceId` | ✅ | Stable per-install id (4–128 chars) |
| `deviceName` | – | e.g. "Pixel 8" (shown to admins) |
| `biometricVerified` | ✅ | Must be `true` |
| `biometricMethod` | – | `fingerprint` \| `face` \| `device_credential` |
| `capturedAt` | – | Phone time, ISO-8601 (stored for audit; the **server time is authoritative**) |

`201` → attendance object. Errors: `400` validation · `403 DEVICE_NOT_APPROVED` · `409 ALREADY_CHECKED_IN`.

### `POST /merchandiser/attendance/check-out` — same fields as check-in
`200` → attendance object with check-out data and `durationMinutes`.
Errors: `409 NOT_CHECKED_IN` · `409 VISIT_IN_PROGRESS` (end the open visit first) · `403 DEVICE_NOT_APPROVED`.

### `GET /merchandiser/attendance?from=&to=&page=&limit=` — own history

### `GET /merchandiser/attendance/:id/selfie?type=in|out`
Returns the image (`image/jpeg|png`). **Requires the `Authorization` header** (selfies are private; they are not under `/uploads`). In Flutter use `Image.network(url, headers: {...})`.

### Attendance object
```json
{
  "id": "…", "isOpen": false,
  "checkInAt": "2026-10-13T06:50:12.000Z", "checkInLat": 24.7136, "checkInLng": 46.6753, "checkInAccuracy": 12.5,
  "checkInDeviceId": "abc123", "checkInBiometric": true, "checkInBiometricMethod": "fingerprint",
  "checkInSelfieUrl": "/api/v1/merchandiser/attendance/<id>/selfie?type=in",
  "checkOutAt": "…", "checkOutLat": 24.7137, "checkOutLng": 46.6754, "checkOutSelfieUrl": "…?type=out",
  "durationMinutes": 482, "flagged": false, "adminNote": null
}
```

---

## 3. Shops (map, search, registration)

A *shop* is a `Customer` record (the same table Odoo customers sync into). Shops without GPS are searchable but don't appear on the map.

### `GET /merchandiser/shops/nearby?lat=&lng=&radiusKm=5&limit=100&q=`
Shops within the radius, nearest first. `radiusKm` 0.1–50 (default 5), `limit` ≤ 300.
```json
{ "success": true, "meta": { "center": {"lat":24.7136,"lng":46.6753}, "radiusKm": 5, "count": 2 },
  "data": [ { "id": "…", "name": "Al Noor Grocery", "phone": "+966…", "contactPerson": "Omar", "shopType": "Grocery",
              "address": "…", "city": "Riyadh", "lat": 24.7140, "lng": 46.6760,
              "distanceM": 62, "isMine": false, "lastVisitAt": "2026-10-12T09:10:00.000Z" } ] }
```
Draw the merchandiser's own position from the phone's GPS; the API only needs it as `lat`/`lng`.

### `GET /merchandiser/shops?q=&lat=&lng=&page=&limit=`
Search by name, phone, contact person, address, city, district. Optional `lat`/`lng` adds `distanceM`.

### `GET /merchandiser/shops/:id`
Details plus `myVisitCount` and `recentVisits` (last 5 of yours).

### `POST /merchandiser/shops` — register a new shop
```json
{ "name": "Al Noor Grocery", "phone": "+966501234567", "contactPerson": "Omar", "shopType": "Grocery",
  "address": "Olaya St", "street": "", "district": "Olaya", "city": "Riyadh", "zip": "", "buildingNumber": "",
  "notes": "Opens 7am", "latitude": 24.7136, "longitude": 46.6753 }
```
* `name` (≥ 2 chars) and `latitude`/`longitude` are required. Use the phone GPS as the default and let the user drag the pin on the map before sending the final coordinates.
* A phone number that already exists returns `409 { "code": "DUPLICATE_PHONE", "existingShop": { "id", "name" } }`. Send `"confirmDuplicate": true` to create it anyway.
* Saved as a `Customer` (visible on the map immediately) **and** as a pending **Lead** for admin approval, then pushed to Odoo CRM — the same pipeline as the driver's "new customer".
* `201` → shop object + `leadId`.

### `PATCH /merchandiser/shops/:id`
Edit a shop **you registered** (same fields, all optional; send both coordinates to move the pin). Others → `403`.

---

## 4. Shop visits & feedback

Flow: **start visit → submit feedback (0..n) → end visit.** One visit can be open at a time. A visit may be started without being checked in; it is linked to the open attendance when there is one.

### `POST /merchandiser/visits/start`
```json
{ "customerId": "<shop id>", "latitude": 24.7140, "longitude": 46.6760 }
```
`201` → visit with `startedAt`, `startDistanceM`, `outOfRange` (true when > 500 m from the shop's recorded location — flagged for admins, **not blocked**). `409 VISIT_IN_PROGRESS` (response includes `visitId`) · `404` unknown shop.

### `GET /merchandiser/visits/current` → open visit or `null`

### `POST /merchandiser/visits/:id/feedback`
```json
{ "category": "STOCK", "rating": 4, "comments": "Low stock of water 1.5L", "followUpRequired": true }
```
`category`: `STOCK | DISPLAY | PRICING | COMPETITOR | SERVICE | OTHER` (default `OTHER`) · `rating`: optional integer 1–5 · `comments`: required, ≤ 2000 chars.
Only while the visit is in progress (`409` afterwards).

### `POST /merchandiser/visits/:id/end`
`{ "latitude": …, "longitude": …, "notes": "optional" }` (all optional) → completed visit with its feedback. `409` if already ended.

### `GET /merchandiser/visits?from=&to=&customerId=&status=IN_PROGRESS|COMPLETED&page=&limit=` · `GET /merchandiser/visits/:id`

---

## 5. Back-office endpoints (ADMIN / MANAGER)

| Method & path | Purpose |
|---|---|
| `GET /admin/merchandisers` | Every merchandiser with today's status: `isCheckedIn`, `inVisit`, `pendingDevices` |
| `GET /admin/attendance?date=&from=&to=&merchandiserId=&status=open\|closed&flagged=true` | Attendance list |
| `GET /admin/attendance/:id` | Detail incl. the visits made during that shift |
| `GET /admin/attendance/:id/selfie?type=in\|out` | Selfie image (needs `Authorization`) |
| `PATCH /admin/attendance/:id` | `{ adminNote?, flagged?, forceCheckOut? }` — `forceCheckOut` closes a record the merchandiser forgot to close (auto-flagged) |
| `GET /admin/devices?userId=&pending=true` | Trusted devices |
| `PATCH /admin/devices/:id` | `{ isApproved: true|false }` — approve / revoke a phone |
| `GET /admin/shops?q=&source=merchandiser\|all&createdById=&hasLocation=true` | Shops (default: those merchandisers registered) |
| `GET /admin/shops/:id` · `PATCH /admin/shops/:id` | Detail with visit history · edit details/location |
| `GET /admin/shop-visits?date=&from=&to=&merchandiserId=&customerId=&status=&outOfRange=true` · `GET …/:id` | Visits |
| `GET /admin/feedback?status=&category=&merchandiserId=&customerId=&followUp=true&from=&to=` | Feedback |
| `PATCH /admin/feedback/:id` | `{ status: NEW\|REVIEWED\|RESOLVED, adminNote }` — records reviewer + time |

Merchandiser accounts themselves are created/edited/deactivated with the existing `POST/PATCH /admin/users` (role `MERCHANDISER`).
Registered shops also appear in the existing **Leads** page for approval.

## 6. Error reference

| Status | Meaning |
|---|---|
| 400 | Validation (message says which field) |
| 401 | Missing/invalid token, or the account was deactivated |
| 403 | Wrong role, edit of someone else's shop, or `DEVICE_NOT_APPROVED` |
| 404 | Record not found (also returned for another merchandiser's records) |
| 409 | State conflict: `ALREADY_CHECKED_IN`, `NOT_CHECKED_IN`, `VISIT_IN_PROGRESS`, `DUPLICATE_PHONE` |
| 429 | Rate limited (300 requests/min/IP; auth endpoints 20/15 min) |

## 7. Deployment notes

1. Back up the DB, then `npx prisma migrate deploy` (migration `20261014090000_merchandiser_phase2` is additive — new tables + nullable `Customer` columns) and `npx prisma generate`.
2. **Selfies are stored on disk in `private-uploads/attendance/<userId>/`** (next to `dist/`, e.g. `/var/www/jazeera-backend/private-uploads`). The folder is created automatically; the Node user needs write access, it **must survive deploys** (don't `rm -rf` / re-clone over it) and it must be included in backups. It is deliberately *not* under `/uploads`, which nginx serves publicly.
3. nginx: `deploy/nginx.conf` now sets `client_max_body_size 6m` on `/api/` — required, the default 1 MB would reject phone selfies with `413`. Reload nginx after updating.
4. Rebuild and restart the API and dashboard.

## 8. Testing
`npx ts-node scripts/test-phase2.ts` (API running, started with `AUTH_RATE_LIMIT_MAX=1000`) — 220 checks covering permissions, selfie/GPS/biometric/device rules, shops, visits, feedback and admin management. It creates and removes its own `phase2test` data (and archives the one Odoo CRM lead the shop registration creates).
