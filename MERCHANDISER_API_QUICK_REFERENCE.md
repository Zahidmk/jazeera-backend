# Merchandiser API — Quick Reference

**Base URL:** `http://147.93.96.94:5000/api/v1`
**Auth:** `Authorization: Bearer <token>` on every call except login. Bodies are JSON, except check-in/out (`multipart/form-data`).
**Response:** `{ "success": true, "data": … }` or `{ "success": false, "error": "…", "code": "OPTIONAL" }`
**Times:** UTC ISO-8601 (show in Saudi time, UTC+3).

## Login
`POST /auth/login` — `{ "email": "…", "password": "…" }` → `data.token`, `data.user.role` (must be `MERCHANDISER`).
`GET /auth/me` checks a stored token. Any `401` = session ended → back to login.

## Attendance
| Method | Path | Notes |
|---|---|---|
| GET | `/merchandiser/attendance/status` | On app start: `isCheckedIn`, `attendance`, `activeVisit`, `devices` |
| POST | `/merchandiser/attendance/check-in` | multipart (below) |
| POST | `/merchandiser/attendance/check-out` | multipart (below) |
| GET | `/merchandiser/attendance?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=30` | Own history |
| GET | `/merchandiser/attendance/:id/selfie?type=in\|out` | Image; needs the auth header |

**Check-in / check-out form fields**

| Field | Required | Value |
|---|---|---|
| `selfie` | ✅ | JPEG/PNG file, max 5 MB |
| `latitude`, `longitude` | ✅ | GPS (not 0,0) |
| `deviceId` | ✅ | Stable device id (4–128 chars) |
| `biometricVerified` | ✅ | `true` — only after the phone's fingerprint/face prompt succeeds |
| `accuracy`, `deviceName`, `biometricMethod` (`fingerprint`/`face`/`device_credential`), `capturedAt` (ISO) | – | optional |

Errors: `409 ALREADY_CHECKED_IN` · `409 NOT_CHECKED_IN` · `409 VISIT_IN_PROGRESS` (end the visit before check-out) · `403 DEVICE_NOT_APPROVED` (a user's first phone is auto-trusted; any other phone needs supervisor approval).

## Shops
| Method | Path | Notes |
|---|---|---|
| GET | `/merchandiser/shops/nearby?lat=&lng=&radiusKm=5&limit=100&q=` | Map; nearest first; `lat`/`lng` required |
| GET | `/merchandiser/shops?q=&lat=&lng=&page=1&limit=20` | Search name/phone/contact/address/city |
| GET | `/merchandiser/shops/:id` | Details + `myVisitCount`, `recentVisits` |
| POST | `/merchandiser/shops` | Register a shop. Required: `name`, `latitude`, `longitude`. `409 DUPLICATE_PHONE` unless `confirmDuplicate: true` |
| PATCH | `/merchandiser/shops/:id` | Edit a shop you registered (`403` otherwise) |

## Visits & feedback
| Method | Path | Notes |
|---|---|---|
| POST | `/merchandiser/visits/start` | `{ "customerId": "<shop id>", "latitude": 24.714, "longitude": 46.676 }` |
| GET | `/merchandiser/visits/current` | Open visit or `data: null` |
| POST | `/merchandiser/visits/:id/feedback` | Only while the visit is in progress |
| POST | `/merchandiser/visits/:id/end` | `{ "latitude": …, "longitude": …, "notes": "…" }` (all optional) |
| GET | `/merchandiser/visits?from=&to=&customerId=&status=IN_PROGRESS\|COMPLETED&page=1&limit=20` | Own history |
| GET | `/merchandiser/visits/:id` | One visit + feedback |

**Feedback body**
```json
{ "category": "STOCK", "rating": 4, "comments": "Low stock of water 1.5L", "followUpRequired": true }
```
`category`: `STOCK` `DISPLAY` `PRICING` `COMPETITOR` `SERVICE` `OTHER` (default `OTHER`) · `rating`: whole number 1–5 (optional) · `comments`: required, ≤ 2000 chars.

`outOfRange: true` in the visit means it started > 500 m from the shop (flagged, not blocked). `409 VISIT_IN_PROGRESS` returns the open `visitId` so the app can resume it.

## Flow
Login → `GET /attendance/status` → check-in → shop map / search → start visit → feedback (any number) → end visit → repeat → check-out.
One open visit at a time. Check-out is blocked while a visit is open.

## Notes for the app
* The API is plain HTTP for now → allow cleartext traffic for this host on Android/iOS.
* `/auth/*` calls share a limit of 20 per 15 min per IP — don't call them in a loop.
* Full guide with real sample responses: `MERCHANDISER_API_GUIDE.md`. Postman collection: `jazeera-merchandiser.postman_collection.json`.
