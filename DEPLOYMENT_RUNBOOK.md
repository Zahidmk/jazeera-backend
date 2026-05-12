# Jazeera Backend — Deployment Runbook

## Production URLs
- **API**: `https://api.jazeera.com`
- **Dashboard**: `https://dashboard.jazeera.com`
- **Health check**: `https://api.jazeera.com/health`

---

## VPS Access
```bash
ssh jazeera@<VPS_IP>
```

---

## PM2 Commands

| Task | Command |
|------|---------|
| Check status | `pm2 status` |
| View API logs | `pm2 logs jazeera-api` |
| View dashboard logs | `pm2 logs jazeera-dashboard` |
| Restart API | `pm2 restart jazeera-api` |
| Restart dashboard | `pm2 restart jazeera-dashboard` |
| Reload (zero-downtime) | `pm2 reload jazeera-api` |
| Stop all | `pm2 stop all` |
| Monitor live | `pm2 monit` |

---

## Manual Redeploy (Backend)
```bash
cd /var/www/jazeera-backend
git pull origin main
npm ci --omit=dev
npm run build
npx prisma migrate deploy
pm2 reload jazeera-api --update-env
pm2 status
```

## Manual Redeploy (Dashboard)
```bash
cd /var/www/jazeera-dashboard
git pull origin main
npm ci
npm run build
pm2 reload jazeera-dashboard --update-env
```

---

## Rollback
```bash
cd /var/www/jazeera-backend
git log --oneline -10          # Find previous commit hash
git checkout <commit-hash>     # Or: git revert HEAD
npm run build
pm2 reload jazeera-api
```

---

## Database
```bash
# Connect to DB
psql -U jazeera_user -d jazeera_db

# Run migrations manually
cd /var/www/jazeera-backend
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
Located at: `/var/www/jazeera-backend/.env`

To update: `nano /var/www/jazeera-backend/.env` then `pm2 reload jazeera-api --update-env`

---

## Logs
```bash
# PM2 logs directory
ls /var/log/pm2/

# Application logs
pm2 logs jazeera-api --lines 100

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
- [x] JWT_SECRET is 64-char random string
- [x] `.env` is in `.gitignore`
- [x] SSH root login disabled
- [x] SSH key auth only
- [x] UFW configured (22, 80, 443 only)
- [x] Rate limiting on auth + webhook endpoints
- [x] CORS restricted to VPS domain
- [x] Helmet.js security headers
- [x] HSTS enabled via Nginx
- [x] Input validation with express-validator
- [x] SSL/TLS via Let's Encrypt (auto-renews)
