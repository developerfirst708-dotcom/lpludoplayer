import { TooManyRequestsError } from "@lpludo/shared";
import { log } from "../config/logger.js";
import { redis } from "../db/redis.js";

const l = log("ratelimit");

/**
 * Redis-backed limiter (works across restarts / multiple instances).
 * The store is built on the FIRST REQUEST, not at import time — at import the
 * Redis connection may not be up yet (the reference app crashed exactly like
 * this whenever Redis answered slowly).
 */
function makeLimiter({ windowMs, max, keyPrefix, skipFailedRequests = false }) {
  let middlewarePromise = null;

  async function build() {
    if (!middlewarePromise) {
      middlewarePromise = import("express-rate-limit").then(async ({ default: rateLimit }) => {
        const { default: RedisStore } = await import("rate-limit-redis");
        return rateLimit({
          windowMs,
          max,
          standardHeaders: true,
          legacyHeaders: false,
          skipFailedRequests,
          store: new RedisStore({
            sendCommand: (...args) => redis.call(...args),
            prefix: `rl:${keyPrefix}:`,
          }),
          keyGenerator: (req) => {
            const ip = req.ip || req.socket?.remoteAddress || "unknown";
            const phone = req.body?.phone || "";
            return phone ? `${ip}:${phone}` : ip;
          },
          handler: (_req, _res, next) => next(new TooManyRequestsError()),
        });
      });
    }
    return middlewarePromise;
  }

  return (req, res, next) => {
    build()
      .then((mw) => mw(req, res, next))
      .catch(next);
  };
}

/** login/OTP routes: strict, per IP+phone (fixes S6) */
export const otpLimiter = makeLimiter({ windowMs: 15 * 60_000, max: 10, keyPrefix: "otp" });

/** general API: generous but bounded */
export const apiLimiter = makeLimiter({ windowMs: 60_000, max: 300, keyPrefix: "api", skipFailedRequests: true });

/** admin login: very strict */
export const adminLoginLimiter = makeLimiter({ windowMs: 15 * 60_000, max: 5, keyPrefix: "adminlogin" });

/** payment-gateway callbacks: per-IP ceiling only, generous enough for retries */
export const webhookLimiter = makeLimiter({ windowMs: 60_000, max: 120, keyPrefix: "gwcallback" });
