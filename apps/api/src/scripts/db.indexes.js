/**
 * Apply every model index. Called at API boot (autoIndex is globally disabled —
 * indexes are explicit) and from `npm run db:indexes`.
 */
if (process.argv[1] && process.argv[1].endsWith("db.indexes.js")) {
  const { default: dotenv } = await import("dotenv");
  dotenv.config({ path: new URL("../../.env", import.meta.url) });
  dotenv.config({ path: new URL("../../../.env", import.meta.url) }); // also try monorepo root
}

const { ALL_MODELS } = await import("../db/models/index.js");
const { log } = await import("../config/logger.js");

const l = log("indexes");

export async function applyIndexes(asModule = false) {
  const t0 = Date.now();
  for (const model of ALL_MODELS) {
    await model.createIndexes();
  }
  const ms = Date.now() - t0;
  if (!asModule) l.info({ ms, models: ALL_MODELS.map((m) => m.modelName) }, "indexes applied");
  else return { ms, models: ALL_MODELS.map((m) => m.modelName) };
}

// CLI entry
if (process.argv[1] && process.argv[1].endsWith("db.indexes.js")) {
  const { connectMongo, disconnectMongo } = await import("../db/connect.js");
  try {
    await connectMongo();
    await applyIndexes(false);
    console.log("✔ db:indexes applied");
    process.exit(0);
  } catch (err) {
    console.error("✖ db:indexes failed:", err.message);
    process.exit(1);
  } finally {
    await disconnectMongo();
  }
}
