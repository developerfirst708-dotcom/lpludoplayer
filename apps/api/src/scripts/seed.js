/**
 * Seed: admin (from env only — no hardcoded credentials, S4), payment settings
 * with the local UPI VPA, and two demo players with a starting balance so the
 * battle flow can be tested end-to-end immediately.
 *
 * NOTE: env is loaded BEFORE any import of config/env.js (dynamic imports below).
 */
if (process.argv[1] && process.argv[1].endsWith("seed.js")) {
  const { default: dotenv } = await import("dotenv");
  dotenv.config({ path: new URL("../../.env", import.meta.url) });
  dotenv.config({ path: new URL("../../../.env", import.meta.url) }); // also try monorepo root
}

const { env } = await import("../config/env.js");
const { log } = await import("../config/logger.js");
const { User } = await import("../db/models/user.model.js");
const { Wallet } = await import("../db/models/wallet.model.js");
const { getSettings } = await import("../db/models/settings.model.js");
const { hashPassword } = await import("../services/auth.service.js");

const l = log("seed");

export async function seed() {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in apps/api/.env to seed an admin");
  }

  // ---- admin ----
  let admin = await User.findOne({ email: env.ADMIN_EMAIL.toLowerCase() });
  if (!admin) {
    admin = new User({
      name: env.ADMIN_NAME || "Main Admin",
      email: env.ADMIN_EMAIL.toLowerCase(),
      role: "superadmin",
      passwordHash: await hashPassword(env.ADMIN_PASSWORD),
    });
    await admin.save();
    l.info({ email: admin.email }, "admin created");
  } else {
    admin.role = "superadmin";
    if (!admin.passwordHash) admin.passwordHash = await hashPassword(env.ADMIN_PASSWORD);
    await admin.save();
    l.info({ email: admin.email }, "admin already present — updated");
  }

  // ---- settings (the deposit VPA admins can change later) ----
  const settings = await getSettings();
  if (!settings.depositUpiId) {
    settings.depositUpiId = "lpludo@upi";
    settings.depositUpiName = "LPLUDO";
    await settings.save();
    l.info({ upiId: settings.depositUpiId }, "payment settings initialised");
  }

  // ---- demo players (₹500 each) so battles can be played immediately ----
  // Credited THROUGH THE LEDGER (like any deposit) so reconciliation drift
  // stays exactly 0 — a bare Wallet.create would break the invariant.
  const { applyLedger } = await import("../services/ledger.service.js");
  const { withTransaction } = await import("../db/connect.js");
  const demo = [
    { phone: "9999000001", name: "DemoA", amount: 50000 },
    { phone: "9999000002", name: "DemoB", amount: 50000 },
  ];
  for (const d of demo) {
    let u = await User.findOne({ phone: d.phone });
    if (!u) {
      u = new User({ phone: d.phone, name: d.name, role: "player" });
      u.referral = { code: "LP" + d.phone.slice(-4) + "X" };
      await u.save();
      await withTransaction(async (session) => {
        await applyLedger({
          session,
          userId: u._id,
          amount: d.amount,
          type: "deposit",
          refType: "system",
          refId: u._id,
          note: "Welcome balance (seed)",
          idempotencyKey: `seed:${d.phone}`,
        });
      });
      l.info({ phone: d.phone, bonusPaise: d.amount }, "demo player created");
    }
  }

  return { admin: admin.email };
}

// CLI entry
if (process.argv[1] && process.argv[1].endsWith("seed.js")) {
  const { connectMongo, disconnectMongo } = await import("../db/connect.js");
  try {
    await connectMongo();
    const out = await seed();
    console.log(`✔ seed ok — admin ${out.admin} ready; demo players 9999000001 / 9999000002 (₹500 each)`);
    process.exit(0);
  } catch (err) {
    console.error("✖ seed failed:", err.message);
    process.exit(1);
  } finally {
    await disconnectMongo();
  }
}
