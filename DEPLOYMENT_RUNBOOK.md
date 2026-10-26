# Jazeera Backend — Deployment Runbook

## Production URLs
- **API**: `https://api.jazeera.com`
- **Dashboard**: `https://dashboard.jazeera.com`
- **Health check**: `https://api.jazeera.com/health`

---

## VPS Access
```bash
ssh root@147.93.96.94
```

> **Verified layout (Oct 2026).** The app code lives in `/app/jazeera-backend` (API, PM2 name
> `jazeera-backend`, port 5000) and `/app/jazeera-dashboard` (Next.js, PM2 name
> `jazeera-dashboard`, port 3000). Both are git checkouts of the GitHub repos. Odoo is a
> separate service. Older notes below that mention `/var/www` or `jazeera-api` are outdated.

---

## Deploy (git pull)
Push to `main` on GitHub first, then on the server:
```bash
cd /app/jazeera-backend   && bash deploy/deploy.sh     # backend
cd /app/jazeera-dashboard && bash deploy.sh            # dashboard
# add --force to rebuild and restart even when nothing new was pulled
```
Each script: refuses to run over uncommitted changes to tracked files, fast-forwards to
`origin/main`, backs up `dist/` (or `.next/`), installs dependencies only when
`package*.json` changed, builds, restarts PM2, checks health, and **rolls back
automatically** if the build or health check fails. The last 5 backups are kept
(`dist.bak-*`, `.next.bak-*`).

Database migrations are **never** run by the script. If a release adds files under
`prisma/migrations/`, it prints a warning: take a backup (`pg_dump`), then run
`npx prisma migrate deploy` yourself.

---

## PM2 Commands

| Task | Command |
|------|---------|
| Check status | `pm2 status` |
| View API logs | `pm2 logs jazeera-backend` |
| View dashboard logs | `pm2 logs jazeera-dashboard` |
| Restart API | `pm2 restart jazeera-backend` |
| Restart dashboard | `pm2 restart jazeera-dashboard` |
| Restart after env change | `pm2 restart jazeera-backend --update-env` |
| Stop all | `pm2 stop all` |
| Monitor live | `pm2 monit` |

---

## Manual Redeploy / Rollback
Prefer the scripts above. To roll back by hand after a bad release:
```bash
cd /app/jazeera-backend
git log --oneline -10                 # find the last good commit
git reset --hard <good-commit>        # server checkout only; fix forward on GitHub afterwards
npm run build && pm2 restart jazeera-backend --update-env
# or restore the previous build directly:
#   rm -rf dist && cp -a dist.bak-<timestamp> dist && pm2 restart jazeera-backend
```
(Dashboard: same idea in `/app/jazeera-dashboard` with `.next.bak-<timestamp>` and `pm2 restart jazeera-dashboard`.)

---

## Database
```bash
# Connect to DB
psql -U jazeera_user -d jazeera_db

# Run migrations manually
cd /app/jazeera-backend
npx prisma migrate deploy

# Check migration status
npx prisma migrate status

# Backup DB
pg_dump -U jazeera_user jazeera_db > backup_$(date +%Y%m%d).sql

# Restore DB
psql -U jazeera_user -d jazeera_db < backup_YYYYMMDD.sql
```

---

## Nginx
```bash
# Test config
nginx -t

# Reload (no downtime)
systemctl reload nginx

# View logs
tail -f /var/log/nginx/error.log
tail -f /var/log/nginx/access.log
```

---

## SSL Renewal (auto via certbot)
```bash
certbot renew --dry-run    # Test
certbot renew              # Manual renew
systemctl status certbot.timer  # Check auto-renew timer
```

---

## Check All Services
```bash
systemctl status nginx postgresql
pm2 status
curl https://api.jazeera.com/health
```

---

## Environment Variables
Located at: `/app/jazeera-backend/.env` (not in git)

To update: `nano /app/jazeera-backend/.env` then `pm2 restart jazeera-backend --update-env`

---

## Logs
```bash
# PM2 logs directory
ls /var/log/pm2/

# Application logs
pm2 logs jazeera-backend --lines 100

# System logs
journalctl -u nginx -f
```

---

## UFW Firewall
```bash
ufw status          # Check rules
ufw allow <port>    # Open port
ufw deny <port>     # Block port
```
Allowed: `22` (SSH), `80` (HTTP), `443` (HTTPS)

---

## Security Checklist
> Not re-verified against the live server. In particular "SSH root login disabled" is **not** true
> (the server is administered as `root`); the nginx/SSL/UFW items also need checking.

- [x] JWT_SECRET is 64-char random string
- [x] `.env` is in `.gitignore`
- [ ] SSH root login disabled (currently enabled)
- [x] SSH key auth only
- [x] UFW configured (22, 80, 443 only)
- [x] Rate limiting on auth + webhook endpoints
- [x] CORS restricted to VPS domain
- [x] Helmet.js security headers
- [x] HSTS enabled via Nginx
- [x] Input validation with express-validator
- [x] SSL/TLS via Let's Encrypt (auto-renews)
