import mongoose from "mongoose";
import { env } from "../config/env.js";
import { log } from "../config/logger.js";

const l = log("db");

export async function connectMongo(uri = env.MONGO_URI) {
  mongoose.set("strictQuery", true);
  mongoose.set("autoIndex", false); // indexes are applied explicitly via db:indexes
  await mongoose.connect(uri, { maxPoolSize: 20, serverSelectionTimeoutMS: 8000 });
  l.info({ uri: uri.replace(/\/\/[^?]+/, "//<creds>") }, "mongo connected");
  await assertReplicaSet();
  return mongoose.connection;
}

/** Transactions (the fix for C1–C7) require a replica set — refuse to run without one. */
export async function assertReplicaSet() {
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName) {
    throw new Error(
      "MongoDB is NOT running as a replica set — transactions are unavailable. " +
        "Run `npm run infra:up` (docker compose starts mongod with --replSet rs0)."
    );
  }
  return hello.setName;
}

export async function disconnectMongo() {
  await mongoose.disconnect();
}

/**
 * Run `fn` inside a Mongo transaction with automatic retry on transient errors.
 * Every money mutation in the app goes through here (fixes C1–C7).
 * @returns the value fn resolves with
 */
export async function withTransaction(fn, { attempts = 3 } = {}) {
  const session = await mongoose.startSession();
  try {
    for (let i = 1; ; i += 1) {
      try {
        let result;
        await session.withTransaction(async () => {
          result = await fn(session);
        });
        return result;
      } catch (err) {
        const transient = err?.hasErrorLabel?.("TransientTransactionError") || err?.code === 251;
        if (transient && i < attempts) continue;
        throw err;
      }
    }
  } finally {
    await session.endSession();
  }
}
