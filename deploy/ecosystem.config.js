// PM2 Ecosystem Config — Jazeera Backend + Dashboard
// Usage: pm2 start ecosystem.config.js
//        pm2 save && pm2 startup

module.exports = {
  apps: [
    // ── Backend API ───────────────────────────────────────────────────────────
    {
      name: 'jazeera-api',
      script: './dist/index.js',
      cwd: '/var/www/jazeera-backend',
      instances: 2,            // Cluster mode — adjust to CPU count
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: '/var/log/pm2/jazeera-api-error.log',
      out_file: '/var/log/pm2/jazeera-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 3000,
      max_restarts: 10,
      autorestart: true,
    },

    // ── Next.js Dashboard ─────────────────────────────────────────────────────
    {
      name: 'jazeera-dashboard',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: '/var/www/jazeera-dashboard',
      instances: 1,
      watch: false,
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
        NEXT_PUBLIC_API_URL: 'https://api.jazeera.com',
      },
      error_file: '/var/log/pm2/jazeera-dashboard-error.log',
      out_file: '/var/log/pm2/jazeera-dashboard-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 3000,
      autorestart: true,
    },
  ],
};
