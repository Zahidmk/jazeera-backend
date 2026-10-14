# Jazeera Merchandiser — Mobile App API Guide

API for the **Merchandiser** user type in the Jazeera app. The Driver, Storekeeper and Salesman flows already use the same
backend and the same login; this document covers only what is new for Merchandisers. All examples below are real responses
from the running API.

**Contents:** [1. Basics](#1-basics) · [2. Login](#2-login) · [3. App flow](#3-app-flow) · [4. Attendance](#4-attendance) · [5. Shops](#5-shops-map-search-registration) · [6. Visits & feedback](#6-visits--feedback) · [7. Errors](#7-errors-and-what-the-app-should-do) · [8. Flutter notes](#8-flutter-implementation-notes) · [9. Testing](#9-testing)

---

## 1. Basics

| | |
|---|---|
| **Base URL (production)** | `http://147.93.96.94:5000` — all paths below start with `/api/v1` |
| **Format** | JSON, except check-in / check-out which are `multipart/form-data` |
| **Auth header** | `Authorization: Bearer <token>` on every call except login |
| **Timestamps** | ISO-8601 in **UTC** (e.g. `2026-10-14T09:46:07.766Z`). Convert to Saudi time (UTC+3) for display. |
| **Coordinates** | Decimal degrees: `latitude` −90…90, `longitude` −180…180 |
| **Pagination** | `?page=1&limit=20` → response `meta: { page, limit, total }` |
| **Rate limit** | 300 requests/minute per IP overall; **all `/auth/*` calls (login and `/auth/me`) share 20 per 15 minutes per IP** — don't call them in a loop, and remember several phones on one Wi-Fi share an IP |

Every response has the same envelope:
```json
{ "success": true,  "data": { } }
{ "success": false, "error": "Human readable message", "code": "OPTIONAL_MACHINE_CODE" }
```
Use `code` (when present) in app logic and show `error` to the user.

> ⚠️ The API is currently served over plain **HTTP**. For Android release builds you must allow cleartext traffic for this host
> (`android:usesCleartextTraffic="true"` or a network-security-config), and iOS needs an ATS exception. This goes away when HTTPS is enabled — keep the base URL in one config constant.

**Permissions:** a Merchandiser token works only on `/api/v1/merchandiser/*` (plus login, `/auth/me`, `PATCH /auth/me`). Calls to
other areas (`/driver`, `/salesman`, `/storekeeper`, `/admin`) return `403`. The server checks the account on every request, so if an
admin deactivates the user the next call returns `401`.

---

## 2. Login

Same endpoint as the other roles. Route the user to the Merchandiser screens when `user.role == "MERCHANDISER"`.

### `POST /api/v1/auth/login`
```json
{ "email": "merchandiser@example.com", "password": "••••••••" }
```
`200`
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5…",
    "isShiftStarted": false,
    "user": {
      "id": "dfc4f4c0-4df8-4edd-9ae2-5f4d88f15d20",
      "name": "Sami Al-Harbi",
      "email": "merchandiser@example.com",
      "phone": "+966574224751",
      "role": "MERCHANDISER",
      "van": null,
      "isShiftStarted": false
    }
  }
}
```
`van` and `isShiftStarted` are driver concepts — ignore them for Merchandisers. The token is valid for 7 days.
Wrong credentials → `401 { "success": false, "error": "Invalid credentials" }`. `GET /api/v1/auth/me` returns the current user (use it to validate a stored token on app start).

---

## 3. App flow

```
Login ─▶ GET /attendance/status ─┬─ not checked in ─▶ Check-in ──┐
                                 └─ checked in ──────────────────┤
                                                                 ▼
        ┌──────────── Shop map / search (nearby, search) ◀───────┤
        │  Add new shop (POST /shops)                            │
        ▼                                                        │
   Select shop ─▶ Start visit ─▶ Feedback (0..n) ─▶ End visit ───┘ (repeat per shop)
                                                                 │
                                                  Check-out (end the open visit first)
```
Rules the app should reflect in the UI:
* Check-in only when `isCheckedIn == false`; check-out only when `true` **and** no visit is open (`activeVisit == null`).
* Only **one visit** can be open at a time. On app start, call `GET /visits/current` (or read `activeVisit` from status) to resume it.
* A visit can be started without being checked in, but the normal flow is check-in first.

---

## 4. Attendance

### How biometric & device verification work — please read
* **The fingerprint / face prompt runs on the phone** (`local_auth`). The server cannot verify a biometric. Show the prompt **before** every check-in and check-out; call the API **only if it succeeds** and send `biometricVerified=true`. Requests without it are rejected.
* **Device binding.** Every attendance call carries a stable `deviceId`. A user's **first** phone is trusted automatically. Any other phone gets `403 DEVICE_NOT_APPROVED` until an admin approves it in the dashboard. Show a clear message ("This phone must be approved by your supervisor").
* Checking out from a different device than the check-in is allowed but gets flagged for admin review.

### `GET /api/v1/merchandiser/attendance/status`
Call on app start / after login.
```json
{ "success": true, "data": {
  "isCheckedIn": true,
  "attendance": { "...attendance object, see below..." },
  "activeVisit": null,
  "devices": [ { "deviceId": "a1b2c3d4e5f6", "label": "Pixel 8", "isApproved": true } ]
} }
```
When not checked in: `isCheckedIn: false, attendance: null, activeVisit: null, devices: []`. `activeVisit`, when set, is
`{ "id", "customerId", "startedAt" }`.

### `POST /api/v1/merchandiser/attendance/check-in`  ·  `multipart/form-data`

| Field | Required | Notes |
|---|---|---|
| `selfie` | ✅ file | JPEG or PNG, **max 5 MB**. The content is verified, not just the extension. |
| `latitude`, `longitude` | ✅ | Current GPS. `(0,0)` and out-of-range values are rejected. |
| `accuracy` | – | GPS accuracy in metres |
| `deviceId` | ✅ | Stable per-install identifier, 4–128 chars |
| `deviceName` | – | e.g. `Pixel 8` — shown to admins |
| `biometricVerified` | ✅ | Must be `true` |
| `biometricMethod` | – | `fingerprint` · `face` · `device_credential` |
| `capturedAt` | – | Phone time, ISO-8601. Stored for audit; **server time is authoritative**. |

`201`
```json
{ "success": true, "data": {
  "id": "331c4880-8b75-4511-8afb-cca9695b53ff",
  "isOpen": true,
  "checkInAt": "2026-10-14T09:46:07.766Z",
  "checkInDeviceTime": "2026-10-14T09:46:07.684Z",
  "checkInLat": 24.7136, "checkInLng": 46.6753, "checkInAccuracy": 12.5,
  "checkInDeviceId": "a1b2c3d4e5f6",
  "checkInBiometric": true, "checkInBiometricMethod": "fingerprint",
  "checkInSelfieUrl": "/api/v1/merchandiser/attendance/331c4880-…/selfie?type=in",
  "checkOutAt": null, "checkOutDeviceTime": null, "checkOutLat": null, "checkOutLng": null,
  "checkOutAccuracy": null, "checkOutDeviceId": null, "checkOutBiometric": null,
  "checkOutBiometricMethod": null, "checkOutSelfieUrl": null,
  "durationMinutes": null, "flagged": false, "adminNote": null
} }
```
Errors: `400` validation · `403 DEVICE_NOT_APPROVED` · `409 ALREADY_CHECKED_IN`.

### `POST /api/v1/merchandiser/attendance/check-out`  ·  same fields as check-in
`200` → the same attendance object with `isOpen: false`, `checkOutAt`, `checkOutLat/Lng`, `checkOutSelfieUrl` and
`durationMinutes` filled in.
Errors: `409 NOT_CHECKED_IN` · `409 VISIT_IN_PROGRESS` (end the open visit first) · `403 DEVICE_NOT_APPROVED` · `400`.

### `GET /api/v1/merchandiser/attendance?from=2026-10-01&to=2026-10-31&page=1&limit=30`
Your own history, newest first. `from`/`to` are optional `YYYY-MM-DD` (Saudi calendar days, inclusive).
`{ "success": true, "data": [ <attendance object>, … ], "meta": { "page": 1, "limit": 30, "total": 1 } }`

### `GET /api/v1/merchandiser/attendance/:id/selfie?type=in|out`
Returns the image bytes (`image/jpeg` or `image/png`). **It needs the `Authorization` header**, so a plain `Image.network(url)`
will not work — pass `headers`. Selfies are private; you can only read your own.

---

## 5. Shops (map, search, registration)

A *shop* is a customer record (the same table Odoo customers sync into). Shops without GPS can be searched but won't appear on the map.

**Shop object** (used by all shop endpoints):
```json
{
  "id": "a711d1f0-0720-4c2e-95ce-5016c4b99d73",
  "name": "Al Noor Grocery", "phone": "+966513059239", "contactPerson": "Omar", "shopType": "Grocery",
  "notes": "Opens 7am", "address": "Olaya St", "street": null, "district": "Olaya", "city": "Riyadh",
  "zip": null, "buildingNumber": null,
  "lat": 24.7136, "lng": 46.6753,
  "updatedAt": "2026-10-14T09:46:07.867Z",
  "isMine": true,
  "distanceM": 0
}
```
`isMine` = registered by this merchandiser (only those can be edited). `distanceM` (metres) is filled only when you pass `lat`/`lng`, otherwise `null`.

### `GET /api/v1/merchandiser/shops/nearby?lat=24.7136&lng=46.6753&radiusKm=5&limit=100&q=`
Shops within the radius, **nearest first** — use this for the map. `lat`/`lng` required (the phone's current position — also draw it as
the "you are here" marker), `radiusKm` 0.1–50 (default 5), `limit` ≤ 300, `q` optional name/phone filter.
```json
{ "success": true,
  "data": [ { "...shop object...", "distanceM": 0, "lastVisitAt": null } ],
  "meta": { "center": { "lat": 24.7136, "lng": 46.6753 }, "radiusKm": 1, "count": 1 } }
```
`lastVisitAt` = when *you* last visited that shop (`null` if never). Re-query when the map moves or the user pulls to refresh.

### `GET /api/v1/merchandiser/shops?q=noor&lat=&lng=&page=1&limit=20`
Search by name, phone, contact person, address, city or district. Optional `lat`/`lng` adds `distanceM`.
`{ "success": true, "data": [ <shop object>, … ], "meta": { "page": 1, "limit": 20, "total": 1 } }`

### `GET /api/v1/merchandiser/shops/:id`
Shop object plus your history with it:
```json
{ "success": true, "data": { "...shop object...", "myVisitCount": 0, "recentVisits": [
  { "id": "…", "status": "COMPLETED", "startedAt": "…", "endedAt": "…", "_count": { "feedback": 1 } } ] } }
```
Unknown id → `404`.

### `POST /api/v1/merchandiser/shops` — register a new shop
```json
{
  "name": "Al Noor Grocery", "phone": "+966513059239", "contactPerson": "Omar", "shopType": "Grocery",
  "address": "Olaya St", "street": "", "district": "Olaya", "city": "Riyadh", "zip": "", "buildingNumber": "",
  "notes": "Opens 7am", "latitude": 24.7136, "longitude": 46.6753
}
```
* Required: `name` (≥ 2 chars) and `latitude` + `longitude`. Default them to the phone GPS and let the user **drag the pin on the map**; send the final coordinates.
* Optional text fields can be omitted or empty. `phone`: 5–20 chars of digits, `+ - ( )` and spaces.
* `201` → the shop object plus `leadId` (the shop also goes to the admin's lead-approval list and Odoo CRM automatically).
* Phone already exists → `409`:
  ```json
  { "success": false, "error": "A shop with this phone number already exists",
    "code": "DUPLICATE_PHONE", "existingShop": { "id": "a711d1f0-…", "name": "Al Noor Grocery" } }
  ```
  Offer the user "Open existing shop" or "Create anyway"; the latter re-sends the same body with `"confirmDuplicate": true`.
* Missing/invalid location → `400 "A valid shop location is required (latitude, longitude)"`.

### `PATCH /api/v1/merchandiser/shops/:id` — edit a shop you registered
Same fields, all optional (send **both** `latitude` and `longitude` to move the pin). Other people's shops → `403`.

---

## 6. Visits & feedback

Flow: **start visit → submit feedback (0..n) → end visit.**

> Visit objects also contain `merchandiserId` and `openKey` — internal fields, ignore them.

### `POST /api/v1/merchandiser/visits/start`
```json
{ "customerId": "a711d1f0-0720-4c2e-95ce-5016c4b99d73", "latitude": 24.714, "longitude": 46.676 }
```
`201`
```json
{ "success": true, "data": {
  "id": "99728707-0949-483d-86f6-87f8037d3ded",
  "customerId": "a711d1f0-…", "attendanceId": "331c4880-…",
  "status": "IN_PROGRESS",
  "startedAt": "2026-10-14T09:46:08.073Z", "startLat": 24.714, "startLng": 46.676,
  "startDistanceM": 84, "outOfRange": false,
  "endedAt": null, "endLat": null, "endLng": null, "notes": null,
  "customer": { "id": "a711d1f0-…", "name": "Al Noor Grocery", "phone": "+966513059239", "address": "Olaya St", "lat": 24.7136, "lng": 46.6753 },
  "feedback": []
} }
```
`outOfRange` becomes `true` when the visit starts more than 500 m from the shop's recorded location. The visit is **not blocked** (GPS can be poor); it is flagged for supervisors. You may warn the user.
Errors: `404` unknown shop · `400` missing coordinates · `409 VISIT_IN_PROGRESS` — includes the open visit's id so the app can resume it:
```json
{ "success": false, "error": "You already have a visit in progress", "code": "VISIT_IN_PROGRESS", "visitId": "99728707-…" }
```

### `GET /api/v1/merchandiser/visits/current`
The open visit (same object as above, with its `feedback` list) or `{ "success": true, "data": null }`.

### `POST /api/v1/merchandiser/visits/:id/feedback`
```json
{ "category": "STOCK", "rating": 4, "comments": "Low stock of water 1.5L", "followUpRequired": true }
```

| Field | Required | Values |
|---|---|---|
| `category` | – (default `OTHER`) | `STOCK` · `DISPLAY` · `PRICING` · `COMPETITOR` · `SERVICE` · `OTHER` |
| `rating` | – | whole number 1–5 |
| `comments` | ✅ | text, up to 2000 chars |
| `followUpRequired` | – | boolean — asks the supervisor to act |

`201`
```json
{ "success": true, "data": { "id": "edee699a-…", "visitId": "99728707-…", "category": "STOCK", "rating": 4,
  "comments": "Low stock of water 1.5L", "followUpRequired": true, "status": "NEW",
  "reviewedById": null, "reviewedAt": null, "adminNote": null, "createdAt": "2026-10-14T09:46:08.107Z" } }
```
`status` (`NEW` → `REVIEWED` → `RESOLVED`) is changed by the supervisor; `adminNote` is their reply. Feedback can only be added while the visit is in progress (`409` after it ends). Bad category → `400 "category must be one of: STOCK, DISPLAY, …"`.

### `POST /api/v1/merchandiser/visits/:id/end`
```json
{ "latitude": 24.7136, "longitude": 46.6753, "notes": "All good" }
```
All fields optional (if you send coordinates, send both and they must be valid). `200` → the visit with `status: "COMPLETED"`, `endedAt`, and all its `feedback`. Ending twice → `409`.

### `GET /api/v1/merchandiser/visits?from=&to=&customerId=&status=COMPLETED&page=1&limit=20`
Your visit history. Each item has `customer: { id, name }` and `_count: { feedback }`; `meta` as usual.
`status` filter: `IN_PROGRESS` or `COMPLETED`.

### `GET /api/v1/merchandiser/visits/:id`
One visit with its feedback (your own only; others → `404`).

---

## 7. Errors and what the app should do

| HTTP | `code` | Meaning | App behaviour |
|---|---|---|---|
| 400 | – | Validation — `error` names the field | Show the message |
| 401 | – | Missing/expired token, or account deactivated | Clear the session, go to login |
| 403 | `DEVICE_NOT_APPROVED` | This phone isn't approved yet | Tell the user to ask their supervisor |
| 403 | – | Wrong role, or editing someone else's shop | Show the message |
| 404 | – | Not found (also for other users' records) | Refresh the list |
| 409 | `ALREADY_CHECKED_IN` | Already checked in | Refresh status |
| 409 | `NOT_CHECKED_IN` | Not checked in | Refresh status |
| 409 | `VISIT_IN_PROGRESS` | Open visit exists (`visitId` included on start; on check-out it means end the visit first) | Resume / end the visit |
| 409 | `DUPLICATE_PHONE` | Shop phone exists (`existingShop` included) | Offer open existing / create anyway |
| 429 | – | Rate limited | Back off and retry |
| 5xx | – | Server problem | Show a generic retry message |

---

## 8. Flutter implementation notes

Suggested packages (versions change — check their docs): `local_auth` (biometric prompt), `geolocator` (GPS), `image_picker` or `camera` (selfie),
`dio` (multipart upload), `device_info_plus` (device id), `flutter_secure_storage` (token), and `flutter_map` / `google_maps_flutter` (map).

**Biometric prompt, then check-in** (`local_auth` 2.x style):
```dart
final auth = LocalAuthentication();
final ok = await auth.authenticate(
  localizedReason: 'Confirm it is you to check in',
  options: const AuthenticationOptions(stickyAuth: true), // biometricOnly: false allows PIN fallback
);
if (!ok) return; // never call the API without a successful prompt

final form = FormData.fromMap({
  'selfie': await MultipartFile.fromFile(selfie.path,
      filename: 'selfie.jpg', contentType: MediaType('image', 'jpeg')), // MediaType from package:http_parser
  'latitude': pos.latitude,
  'longitude': pos.longitude,
  'accuracy': pos.accuracy,
  'deviceId': deviceId,
  'deviceName': deviceName,
  'biometricVerified': true,
  'biometricMethod': 'fingerprint',
  'capturedAt': DateTime.now().toUtc().toIso8601String(),
});
final res = await dio.post('/api/v1/merchandiser/attendance/check-in', data: form,
    options: Options(headers: {'Authorization': 'Bearer $token'}));
```

**Practical tips**
* **Device id:** use a stable value — e.g. Android `androidId` (via `device_info_plus`) or iOS `identifierForVendor`. A random UUID regenerated on reinstall would count as a *new* phone and need re-approval.
* **Selfie size:** the limit is 5 MB. Compress (e.g. `imageQuality: 70`, max width ~1280) before upload. Use the front camera and force a live capture (no gallery picking) if you want proof the person is present.
* **GPS:** request location permission and wait for a fix; send `accuracy`. Don't send `0,0`. Consider asking the user to wait/retry when accuracy is poor (> ~50 m).
* **Showing a selfie:** `Image.network(baseUrl + selfieUrl, headers: {'Authorization': 'Bearer $token'})` (or the equivalent `httpHeaders` in a caching image package).
* **Map:** call `/shops/nearby` with the phone position; for "add shop", start the pin at the phone position and let the user drag it.
* **Session:** store the token securely; on any `401` clear it and return to login.
* **Time display:** timestamps are UTC — format in Saudi time (UTC+3).
* **No offline mode:** every action needs a connection. Disable the buttons and show a message when offline rather than queueing, so server timestamps stay accurate.
* **Don't retry blindly on `409`** — refresh `/attendance/status` or `/visits/current` and show the real state.

---

## 9. Testing

* Import **`jazeera-merchandiser.postman_collection.json`**. Set the `merch_token` after running *Merchandiser Login*; the *Merchandiser App* folders are the calls in this guide (the *Admin* folders are for the dashboard and aren't needed by the app). Choose a selfie file in the form-data body for check-in/out.
* You need a Merchandiser test account — ask the project owner to create one in the dashboard (Users & Roles → role *Merchandiser*).
* To test the "second phone" case, check in from a second `deviceId`; it will return `403 DEVICE_NOT_APPROVED` until it's approved in the dashboard (Attendance → Devices).
* To reset a stuck state (e.g. checked in and forgot to check out), a supervisor force-closes the record in the dashboard (Attendance).
