/**
 * First-boot check: the API refuses to run on a standalone mongod because the
 * money paths require multi-document transactions (C1–C7).
 * `npm run db:init` exists so `infra:up` can verify the replica set + both
 * stores answer before the dev servers start.
 */
export async function dbInit() {
  const { connectMongo } = await import("../db/connect.js");
  const { connectRedis, redis } = await import("../db/redis.js");
  await connectMongo();
  await connectRedis();
  const pong = await redis.ping();
  if (pong !== "PONG") throw new Error("redis did not answer PONG");
  return true;
}

// CLI entry
if (process.argv[1] && process.argv[1].endsWith("db.init.js")) {
  const { default: dotenv } = await import("dotenv");
  dotenv.config({ path: new URL("../../.env", import.meta.url) });
  dotenv.config({ path: new URL("../../../.env", import.meta.url) }); // also try monorepo root
  const { disconnectMongo } = await import("../db/connect.js");
  const { shutdownRedis } = await import("../db/redis.js");
  try {
    await dbInit();
    console.log("✔ db:init ok — mongo replica set + redis reachable");
    process.exit(0);
  } catch (err) {
    console.error("✖ db:init failed:", err.message);
    process.exit(1);
  } finally {
    await shutdownRedis();
    await disconnectMongo();
  }
}