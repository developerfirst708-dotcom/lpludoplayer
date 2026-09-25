import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { User } from "../db/models/user.model.js";
import { Wallet } from "../db/models/wallet.model.js";
import { withTransaction } from "../db/connect.js";
import { env } from "../config/env.js";
import { log } from "../config/logger.js";
import { UnauthorizedError, NotFoundError, ForbiddenError } from "@lpludo/shared";

const l = log("auth");

/**
 * Access token: short-lived, used on every request.
 * Refresh token: long-lived, rotated on every use (theft is detectable).
 * `tokenVersion` on the user lets us invalidate every session instantly.
 */
export function signAccessToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role, tv: user.tokenVersion }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
  });
}

export function signRefreshToken(user) {
  return jwt.sign({ sub: user._id.toString(), tv: user.tokenVersion }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL,
  });
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET);
  } catch {
    throw new UnauthorizedError("Session expired, please log in again");
  }
}

export function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET);
  } catch {
    throw new UnauthorizedError("Please log in again");
  }
}

/** Verify a password for admin/agent login (12 rounds, same worker count locally). */
export async function checkPassword(user, plain) {
  if (!user.passwordHash) throw new UnauthorizedError("Password login is not enabled for this account");
  const ok = await bcrypt.compare(plain, user.passwordHash);
  if (!ok) throw new UnauthorizedError("Incorrect email or password");
  return true;
}

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

/**
 * Player handles are assigned server-side and are NOT user input: every new
 * player gets a random 5-letter name (26^5 ≈ 11.9M combinations) that must be
 * unique — the `player_name_unique` partial index is the backstop.
 */
const NAME_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // I and O omitted (look-alikes)
const NAME_LENGTH = 5;

export function makePlayerName() {
  let out = "";
  for (let i = 0; i < NAME_LENGTH; i++) {
    out += NAME_ALPHABET[Math.floor(Math.random() * NAME_ALPHABET.length)];
  }
  return out;
}

/** Retries on collision so two concurrent signups can never claim one handle. */
export async function generateUniquePlayerName({ session } = {}) {
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = makePlayerName();
    const query = User.exists({ role: "player", name: candidate });
    const clash = await (session ? query.session(session) : query);
    if (!clash) return candidate;
  }
  throw new Error("Could not allocate a unique player name — please retry");
}

/** Create (or return) the player for a verified phone, plus their wallet. */
export async function upsertPlayer({ phone, referralCode }) {
  return withTransaction(async (session) => {
    // +tokenVersion is required here — the signed token embeds it, and a
    // select:false field read without the projection signs `undefined`
    let user = await User.findOne({ phone }).session(session).select("+tokenVersion +phone");
    if (!user) {
      user = new User({ phone, name: await generateUniquePlayerName({ session }), role: "player" });
      user.referral.code = makeReferralCode();
      if (referralCode) {
        const referrer = await User.findOne({ "referral.code": referralCode }).session(session);
        if (referrer) user.referral.referredBy = referrer._id;
      }
      await user.save({ session });
      l.info({ userId: String(user._id), name: user.name }, "player created with auto name");
    } else {
      if (user.status === "banned") throw new ForbiddenError("This account is banned");
      // backfill legacy rows created before auto-naming existed
      if (!user.name || user.name === "Player") {
        user.name = await generateUniquePlayerName({ session });
      }
      if (user.referral?.code == null) {
        user.referral = user.referral || {};
        user.referral.code = makeReferralCode();
      }
      await user.save({ session });
    }

    if (!(await Wallet.findOne({ userId: user._id }).session(session))) {
      await Wallet.create([{ userId: user._id }], { session });
    }
    return user;
  });
}

/** Rotate: bump tokenVersion -> every existing refresh token dies at once. */
export async function invalidateAllSessions(userId) {
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  l.info({ userId: String(userId) }, "all sessions invalidated");
}

export async function getAuthUser(userId) {
  // +tokenVersion: the refresh/me paths compare it against the token payload
  const user = await User.findById(userId).select("+tokenVersion +phone");
  if (!user) throw new NotFoundError("User not found");
  if (user.status === "banned") throw new ForbiddenError("This account is banned");
  return user;
}

function makeReferralCode() {
  return "LP" + Math.random().toString(36).slice(2, 8).toUpperCase();
}
