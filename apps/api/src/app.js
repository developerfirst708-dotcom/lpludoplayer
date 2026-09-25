import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";

import { logger } from "./config/logger.js";
import { corsOrigins } from "./config/env.js";
import routes from "./routes/index.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { redisPing } from "./db/redis.js";
import { assertReplicaSet } from "./db/connect.js";

/** The HTTP app — built separately from server.js so tests can drive it without a port. */
export const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "same-site" }, // images served cross-origin to the two frontends
  })
);
app.use(cors({ origin: corsOrigins, credentials: true }));
/**
 * Payment-gateway callbacks are posted as application/x-www-form-urlencoded
 * (with `result` as a JSON string), so the urlencoded parser is mounted on that
 * path BEFORE the global JSON parser. JSON-bodied callbacks still work: this
 * parser skips other content types and the global one below handles them.
 */
app.use("/api/webhooks/imb", express.urlencoded({ extended: false, limit: "64kb" }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// request ids + access logs (I3) — pino redacts auth headers/cookies/tokens
app.use(
  pinoHttp({
    logger,
    genReqId: () => randomUUID(),
    autoLogging: { ignore: (req) => req.url === "/health" },
  })
);

/** Liveness: the API only reports healthy when BOTH backing stores answer. */
app.get("/health", async (_req, res) => {
  const out = { ok: true, mongo: false, redis: false, uptime: process.uptime() };
  try {
    await mongoosePing();
    out.mongo = true;
  } catch { /* reported below */ }
  try {
    out.redis = await redisPing();
  } catch { /* reported below */ }
  const healthy = out.mongo && out.redis;
  res.status(healthy ? 200 : 503).json(out);
});

async function mongoosePing() {
  const { mongoose } = await import("mongoose");
  if (mongoose.connection.readyState !== 1) throw new Error("mongo not connected");
  await mongoose.connection.db.admin().command({ ping: 1 });
  await assertReplicaSet();
}

app.use("/api", routes);

app.use(notFoundHandler);
app.use(errorHandler);