import Redis from "ioredis";
import { env } from "../config/env.js";
import { log } from "../config/logger.js";

const l = log("redis");

/** Connection for cache/locks/OTP/rate-limit (blocking commands allowed). */
export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  enableOfflineQueue: false,
});

/** Second connection reserved for the socket.io adapter + pub/sub. */
export const redisSub = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null });

function ensureConnected(client) {
  if (client.status === "ready") return Promise.resolve();
  if (["wait", "end"].includes(client.status)) return client.connect();
  // connecting/connect: wait for the ready event instead of calling connect() again
  return new Promise((resolve, reject) => {
    client.once("ready", resolve);
    client.once("error", reject);
  });
}

export async function connectRedis() {
  await ensureConnected(redis);
  await ensureConnected(redisSub);
  // never log credentials: REDIS_URL can carry a password (`redis://:pw@host`)
  const safeUrl = env.REDIS_URL.replace(/\/\/[^@/]*@/, "//<creds>@");
  l.info({ url: safeUrl }, "redis connected");
  return redis;
}

/** Ping; used by /health to prove the cache is reachable. */
export async function redisPing() {
  const p = await redis.ping();
  return p === "PONG";
}

/** Deliberately short keyspace so leaked/stale state cannot pile up. */
export async function shutdownRedis() {
  redis.disconnect();
  redisSub.disconnect();
}

/* ------------------------------------------------------------------ */
/* Per-user locks — prevents the double-spend races (C2/C6/C12)        */
/* ------------------------------------------------------------------ */

const LOCK_TTL_MS = 10_000;

/**
 * Acquire a named lock (e.g. `wallet:<userId>`, `contest:<id>`).
 * Returns a release function, or null if the lock is already held.
 */
export async function acquireLock(key, ttlMs = LOCK_TTL_MS) {
  const token = String(Date.now()) + Math.random().toString(36).slice(2);
  const ok = await redis.set(`lock:${key}`, token, "PX", ttlMs, "NX");
  if (!ok) return null;
  return async () => {
    const script = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`;
    await redis.eval(script, 1, `lock:${key}`, token);
  };
}

/** Run `fn` while holding a lock; throws 409-style ConflictError if busy. */
export async function withLock(key, fn, ttlMs = LOCK_TTL_MS) {
  const release = await acquireLock(key, ttlMs);
  if (!release) {
    const err = new Error("Another operation is in progress, please retry");
    err.status = 409;
    err.code = "LOCK_BUSY";
    throw err;
  }
  try {
    return await fn();
  } finally {
    await release();
  }
}

/* ------------------------------------------------------------------ */
/* Deterministic idempotency (fixes C1/C13)                           */
/* ------------------------------------------------------------------ */

const IDEMPOTENCY_TTL = 60 * 60 * 24; // 24h

/**
 * Remember that `key` produced `result`; if `key` is replayed, return the
 * stored result instead of re-executing (so a retried settle cannot pay twice).
 * @param {string} key  deterministic, e.g. `settle:<contestId>`
 * @param {number} result payload (a ledger id / payout id)
 */
export async function idempotencyRun(key, fn) {
  const rKey = `idem:${key}`;
  const existing = await redis.get(rKey);
  if (existing) return JSON.parse(existing);
  const result = await fn();
  await redis.set(rKey, JSON.stringify(result), "EX", IDEMPOTENCY_TTL);
  return result;
}
