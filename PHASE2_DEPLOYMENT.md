# Merchandiser module (Phase 2) — internal deployment & testing notes

*(The API-only document for the mobile developer is `MERCHANDISER_API_GUIDE.md`.)*

## Deployment
1. Back up the DB, then `npx prisma migrate deploy` (migration `20261014090000_merchandiser_phase2` is additive: new tables + nullable `Customer` columns) and `npx prisma generate`.
2. **Selfies are stored on disk in `private-uploads/attendance/<userId>/`** next to `dist/` (production: `/app/jazeera-backend/private-uploads`). The folder is created automatically; the Node user needs write access, it **must survive deploys** (don't wipe / re-clone over it) and must be included in backups. It is deliberately *not* under `/uploads`, which is served publicly.
3. If the API sits behind nginx, `deploy/nginx.conf` sets `client_max_body_size 6m` on `/api/` — required, the default 1 MB rejects phone selfies with `413`. (Production currently serves the API directly on port 5000 with no nginx, so this only matters once a proxy/HTTPS is added.)
4. Rebuild and restart the API and dashboard.

## Operations
* **Device approvals:** a merchandiser's first phone is auto-trusted; any other phone is blocked until approved in the dashboard (Attendance → Devices).
* **Forgotten check-out:** an admin closes it from the dashboard (Attendance → open record → *Force check-out*). Until then the merchandiser cannot check in again.
* **Shop registrations** create a Customer + a pending Lead (Leads page) and push a CRM lead to Odoo, same as the driver's "new customer".

## Testing
`npx ts-node scripts/test-phase2.ts` (API running, started with `AUTH_RATE_LIMIT_MAX=1000`) — 220 checks covering permissions, selfie/GPS/biometric/device rules, shops, visits, feedback and admin management. It creates and removes its own `phase2test` data and archives the one Odoo CRM lead the shop registration creates. Run `scripts/test-phase1.ts` as the regression check for roles/auth (125 checks); restart the API between the two runs to reset the rate limiter.
