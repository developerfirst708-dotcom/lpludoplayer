import "dotenv/config";
import http from "http";
import { env } from "./config/env.js";
import { app } from "./app.js";
import { connectMongo, disconnectMongo } from "./db/connect.js";
import { connectRedis, shutdownRedis, redis } from "./db/redis.js";
import { otpStoreInit } from "./services/otp.service.js";
import { isGatewayEnabled } from "./services/imbpay.service.js";
import { initRealtime } from "./realtime/io.js";
import { startSweeps, stopSweeps } from "./jobs/sweeps.js";
import { applyIndexes } from "./scripts/db.indexes.js";
import { log } from "./config/logger.js";

const l = log("server");

const server = http.createServer(app);

async function main() {
  await connectMongo();   // refuses to boot without a replica set (transactions)
  await connectRedis();
  otpStoreInit(redis);
  initRealtime(server);
  await applyIndexes(true); // idempotent
  await startSweeps();

  server.listen(env.PORT, () => {
    l.info(`API listening on :${env.PORT} (${env.NODE_ENV})`);
    l.info(`web → http://localhost:5173   admin → http://localhost:5174`);
    if (isGatewayEnabled()) {
      const webhookUrl = `${env.PUBLIC_API_URL || "https://<your-public-api-domain>"}/api/webhooks/imb`;
      l.info(`IMB Pay instant deposits ON — webhook URL for the IMB dashboard: ${webhookUrl}`);
    } else {
      l.warn("IMB Pay instant deposits OFF (IMB_API_TOKEN empty) — manual UPI/UTR serves every amount");
    }
    if (!env.ALLOW_DEV_OTP && !env.MERAOTP_API_KEY) {
      l.warn("MeraOTP key missing (MERAOTP_API_KEY) — login OTPs CANNOT be delivered");
    }
  });
}

async function shutdown(signal) {
  l.info({ signal }, "shutting down");
  server.close();
  await stopSweeps();
  await shutdownRedis();
  await disconnectMongo();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((err) => {
  l.error({ err: err.message }, "failed to start");
  process.exit(1);
});