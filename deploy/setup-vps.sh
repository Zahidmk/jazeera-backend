#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Jazeera Backend — Hostinger VPS Initial Setup Script
# Run as root on a fresh Ubuntu 22.04 VPS
# Usage: chmod +x deploy.sh && sudo ./deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

echo "🚀 Starting Jazeera VPS deployment setup..."

# ── Variables (edit before running) ──────────────────────────────────────────
DOMAIN="api.jazeera.com"          # Your backend API domain
DASHBOARD_DOMAIN="dashboard.jazeera.com"
APP_DIR="/var/www/jazeera-backend"
DASHBOARD_DIR="/var/www/jazeera-dashboard"
NODE_VERSION="20"
DB_NAME="jazeera_db"
DB_USER="jazeera_user"
DB_PASS="$(openssl rand -base64 32)"  # Auto-generate secure password
APP_USER="jazeera"

# ── 1. System Update ─────────────────────────────────────────────────────────
echo "📦 Updating system packages..."
apt-get update -y && apt-get upgrade -y
apt-get install -y curl git nginx certbot python3-certbot-nginx ufw build-essential

# ── 2. Create App User (non-root) ─────────────────────────────────────────────
if ! id "$APP_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$APP_USER"
  echo "✅ Created user: $APP_USER"
fi

# ── 3. Install Node.js 20 via nvm ─────────────────────────────────────────────
echo "📦 Installing Node.js $NODE_VERSION..."
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
apt-get install -y nodejs
node --version
npm --version

# ── 4. Install PostgreSQL ──────────────────────────────────────────────────────
echo "📦 Installing PostgreSQL..."
apt-get install -y postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql

# Create DB + user
sudo -u postgres psql <<EOF
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS';
  END IF;
END
\$\$;
CREATE DATABASE IF NOT EXISTS $DB_NAME OWNER $DB_USER;
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
EOF
echo "✅ PostgreSQL configured — DB: $DB_NAME, User: $DB_USER"
echo "🔑 DB Password (save this!): $DB_PASS"

# ── 5. Install PM2 ────────────────────────────────────────────────────────────
echo "📦 Installing PM2..."
npm install -g pm2
pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER"

# ── 6. Create app directories ─────────────────────────────────────────────────
mkdir -p "$APP_DIR" "$DASHBOARD_DIR"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR" "$DASHBOARD_DIR"

# ── 7. Configure UFW Firewall ─────────────────────────────────────────────────
echo "🔒 Configuring UFW firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable
echo "✅ UFW configured — ports 22, 80, 443 open"

# ── 8. Configure Nginx ────────────────────────────────────────────────────────
echo "🌐 Configuring Nginx..."
cp /tmp/jazeera-nginx.conf /etc/nginx/sites-available/jazeera
ln -sf /etc/nginx/sites-available/jazeera /etc/nginx/sites-enabled/jazeera
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ── 9. SSL with Let's Encrypt ─────────────────────────────────────────────────
echo "🔐 Installing SSL certificates..."
certbot --nginx -d "$DOMAIN" -d "$DASHBOARD_DOMAIN" --non-interactive --agree-tos -m admin@jazeera.com
systemctl enable certbot.timer

echo ""
echo "════════════════════════════════════════════════"
echo "✅ VPS setup complete!"
echo "   Domain:     https://$DOMAIN"
echo "   Dashboard:  https://$DASHBOARD_DOMAIN"
echo "   DB Password: $DB_PASS (save this NOW)"
echo "════════════════════════════════════════════════"
echo ""
echo "Next: SSH back in as $APP_USER and run:"
echo "  cd $APP_DIR && git clone <repo> . && cp .env.example .env"
echo "  # Fill in .env values then:"
echo "  npm install && npx prisma migrate deploy && npm run build"
echo "  pm2 start ecosystem.config.js && pm2 save"
