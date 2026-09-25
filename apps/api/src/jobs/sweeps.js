import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { env } from "../config/env.js";
import { log } from "../config/logger.js";
import { expireStaleOpenContests, expireStaleConflicts } from "../services/contest.service.js";
import { verifyPendingGatewayDeposits } from "../services/deposit.service.js";

const l = log("sweeps");

/**
 * BullMQ sweeps (fixes P3 — expiry moved OUT of the request path):
 *  - contest.expire   every 30s: open battles past their TTL -> expired + refund
 *  - contest.sla      every 60s: conflicts older than the SLA -> auto-refund
 *  - deposit.gateway  every 60s: ask IMB Pay about pending orders and credit
 *                     them — this is why gateway deposits settle even when the
 *                     webhook cannot reach the API (local dev, firewall, outage)
 * BullMQ requires maxRetriesPerRequest: null, so it gets its own connections.
 */
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const QUEUE_NAME = "lpludo-sweeps";
let queue;
let worker;

export async function startSweeps() {
  queue = new Queue(QUEUE_NAME, { connection });
  await queue.add(
    "expire-open",
    {},
    { repeat: { every: 30_000 }, jobId: "expire-open", removeOnComplete: { count: 50 } }
  );
  await queue.add(
    "sla-conflicts",
    {},
    { repeat: { every: 60_000 }, jobId: "sla-conflicts", removeOnComplete: { count: 50 } }
  );
  await queue.add(
    "deposit-gateway",
    {},
    { repeat: { every: 60_000 }, jobId: "deposit-gateway", removeOnComplete: { count: 50 } }
  );

  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === "expire-open") return { expired: await expireStaleOpenContests() };
      if (job.name === "sla-conflicts") return { refunded: await expireStaleConflicts() };
      if (job.name === "deposit-gateway") return verifyPendingGatewayDeposits();
      return null;
    },
    { connection, concurrency: 1 }
  );
  worker.on("failed", (job, err) => l.error({ job: job?.name, err: err.message }, "sweep job failed"));

  l.info("sweeps started (expire every 30s, conflict-SLA every 60s, gateway deposits every 60s)");
  return { queue, worker };
}

export async function stopSweeps() {
  try {
    if (worker) await worker.close();
    if (queue) await queue.close();
    connection.disconnect();
    l.info("sweeps stopped");
  } catch (err) {
    l.warn({ err: err.message }, "sweep shutdown warning");
  }
}