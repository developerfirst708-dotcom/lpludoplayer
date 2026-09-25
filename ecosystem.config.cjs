const path = require("path");

/**
 * PM2 process definition for the LPLUDO API (single VPS, no Docker).
 *
 *   cd /opt/lpludo
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup          # survive reboots
 *
 * Secrets are NOT in this file: `apps/api/.env` is loaded by the app itself
 * (server.js imports dotenv/config), so .env stays the single source of keys.
 *
 * ONE process only. The HTTP API, socket.io and the BullMQ sweeps (gateway
 * reconciliation, battle expiry) all live in this process — BullMQ and the
 * socket.io Redis adapter can spread across several instances, but a single
 * fork is simpler and plenty until you actually measure a need.
 */
module.exports = {
  apps: [
    {
      name: "lpludo-api",
      cwd: path.join(__dirname, "apps/api"),
      script: "src/server.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      // restart if it ever balloons past this (Node heap for this API is small)
      max_memory_restart: "512M",
      // the app traps SIGINT to close the HTTP server, the BullMQ worker and the
      // redis/mongo connections — give that shutdown room before PM2 SIGKILLs
      kill_timeout: 10000,
      time: true, // prefix log lines with timestamps
      env: { NODE_ENV: "production" },
    },
  ],
};
