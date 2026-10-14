# Phase 1 — Security fixes & Merchandiser role: deployment notes

## What changed
**Backend (`jazeera-backend`)**
- `authenticate` now loads the user from the DB on every request. Role changes and deactivation apply immediately (no waiting for the 7-day JWT to expire).
- `/api/v1/admin/*` → ADMIN / MANAGER only.
- `/api/v1/sync/*` and `/api/v1/odoo/*` → require login, ADMIN / MANAGER only. `POST /sync/webhook` stays JWT-free but is protected by `X-Odoo-Webhook-Secret`; it now **fails closed** (503) if `ODOO_WEBHOOK_SECRET` is unset, and uses a constant-time comparison.
- `/api/v1/driver/*` and `/api/v1/driver/sales/*` → DRIVER, ADMIN, MANAGER.
- New role `MERCHANDISER` (enum + migration). It can log in and call `/auth/me`; it has no other access yet (Phase 2+).
- User management: role validated against the enum, email/password (min 8) validated, only an ADMIN can create/modify ADMIN accounts or grant ADMIN, nobody can demote/deactivate their own account.
- Login/forgot-password lookup fixed: `OR: [{email: undefined}, ...]` matched every row, so an unknown email could resolve to an arbitrary user.
- Removed logging of login request bodies (passwords) and password-match results.
- `AUTH_RATE_LIMIT_MAX` env (optional, default 20) for the `/auth` rate limiter — only raise it for automated test runs.

**Frontend (`jazeera-dashboard`)**
- Users page: `MERCHANDISER` role, badge, summary card; Managers can't see/assign the ADMIN role or edit Admins; can't deactivate yourself; password min 8; errors from status toggles are shown.
- Odoo/stock/sync calls now send the JWT (`lib/api/odoo.ts`, stock page).
- Any 401 (expired token, deactivated user) clears the session and returns to `/login`.
- Dashboard login accepts ADMIN / MANAGER only (other roles get a clear message).

## Migrations (3, all additive — no data is modified or dropped)
| Migration | Purpose |
|---|---|
| `20260915063000_add_sync_log` / `20260915094500_add_vat_to_cash_sale` | Already in the repo; were not yet applied to the local Docker DB |
| `20261013090000_add_merchandiser_role` | `ALTER TYPE "Role" ADD VALUE 'MERCHANDISER'` |
| `20261013091000_add_missing_schema_columns` | **Catch-up.** `User.odooEmployeeId` and the address columns on `Customer`/`Lead` were in `schema.prisma` but in no migration. Uses `IF NOT EXISTS`, so it is a no-op on a database that already has them |

## Deploy steps
1. **Back up the database** (`pg_dump -Fc`).
2. Set `ODOO_WEBHOOK_SECRET` to a strong value in the backend `.env` and put the same value in the Odoo webhook header `X-Odoo-Webhook-Secret`. (The local `.env` still holds the placeholder `CHANGE_THIS_TO_A_STRONG_32_CHAR_SECRET` — rotate it.)
3. Backend: `git pull && npm ci && npx prisma migrate deploy && npx prisma generate && npm run build`, then restart the process. **Use `migrate deploy`, never `migrate reset` / `migrate dev` against production.**
4. Frontend: `git pull && npm ci && npm run build`, restart.
5. Smoke test: log in as Admin → Users page → create a Merchandiser → log in as that Merchandiser (`POST /api/v1/auth/login`).
6. Optional, on a non-production DB: `npx ts-node scripts/test-phase1.ts` (needs the API running; start it with `AUTH_RATE_LIMIT_MAX=1000`). It creates and removes its own `phase1test-` users and archives the one Odoo employee it creates.

## Rollback
Code can be rolled back by redeploying the previous commit. The migrations are additive and harmless to older code; Postgres cannot remove an enum value, so `MERCHANDISER` simply stays unused.

## Things to be aware of
- Clients that called `/sync/*` or `/odoo/*` without a token (scripts, cron hitting the API, external tools) now get 401. The Odoo webhook is unaffected. Internal cron and BullMQ workers call the services directly and are unaffected.
- Sessions are checked against the DB per request (one small indexed query).
