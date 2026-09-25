/**
 * Rotate an admin password.
 *
 * `seed.js` deliberately never overwrites an existing password hash (so
 * re-running it cannot silently reset a live admin), which means this is the
 * supported way to change one:
 *
 *   1. put the new value in apps/api/.env as ADMIN_PASSWORD
 *   2. npm run admin:password -w @lpludo/api
 *
 * Also bumps tokenVersion, so every session that admin already has is
 * invalidated immediately.
 */
if (process.argv[1] && process.argv[1].endsWith("admin.password.js")) {
  const { default: dotenv } = await import("dotenv");
  dotenv.config({ path: new URL("../../.env", import.meta.url) });
}

const { env } = await import("../config/env.js");

export async function resetAdminPassword() {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in apps/api/.env");
  }
  const { User } = await import("../db/models/user.model.js");
  const { hashPassword } = await import("../services/auth.service.js");

  const user = await User.findOne({ email: env.ADMIN_EMAIL.toLowerCase() }).select("+passwordHash +tokenVersion");
  if (!user) throw new Error(`no account with email ${env.ADMIN_EMAIL}`);
  if (!["admin", "superadmin"].includes(user.role)) {
    throw new Error(`${user.email} is not an admin account`);
  }

  user.passwordHash = await hashPassword(env.ADMIN_PASSWORD);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  return user.email;
}

// CLI entry
if (process.argv[1] && process.argv[1].endsWith("admin.password.js")) {
  const { connectMongo, disconnectMongo } = await import("../db/connect.js");
  try {
    await connectMongo();
    const email = await resetAdminPassword();
    console.log(`✔ password rotated for ${email} — existing sessions invalidated`);
    process.exit(0);
  } catch (err) {
    console.error("✖ password reset failed:", err.message);
    process.exit(1);
  } finally {
    await disconnectMongo();
  }
}
