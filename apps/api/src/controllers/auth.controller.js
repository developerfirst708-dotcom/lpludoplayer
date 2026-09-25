import { env, corsOrigins } from "../config/env.js";
import { validate } from "@lpludo/shared/schemas";
import { sendOtpSchema, verifyOtpSchema } from "@lpludo/shared/schemas";
import * as otpService from "../services/otp.service.js";
import {
  signAccessToken, signRefreshToken, verifyRefreshToken,
  upsertPlayer, invalidateAllSessions, getAuthUser,
} from "../services/auth.service.js";
import { UnauthorizedError, BadRequestError } from "@lpludo/shared";
import { Wallet } from "../db/models/wallet.model.js";
import { log } from "../config/logger.js";

const l = log("auth.controller");

const REFRESH_COOKIE = "lp_refresh";
const cookieOpts = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 30 * 24 * 3600 * 1000, // JWT_REFRESH_TTL
};

export function issueTokens(res, user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOpts); // never in localStorage (F7)
  return { accessToken };
}

/** POST /auth/send-otp */
export async function sendOtp(req, res) {
  const { phone } = validate(sendOtpSchema, req.body);
  const result = await otpService.createOtp(phone);
  res.json({ sent: true, ...(result.devOtp ? { devOtp: result.devOtp } : {}) });
}

/** POST /auth/verify-otp -> creates the player on first login */
export async function verifyOtp(req, res) {
  const { phone, otp, referralCode } = validate(verifyOtpSchema, req.body);
  await otpService.verifyOtp(phone, otp);

  const user = await upsertPlayer({ phone, referralCode }); // name is generated server-side
  const wallet = await Wallet.findOne({ userId: user._id }).lean();
  const tokens = issueTokens(res, user);
  l.info({ userId: String(user._id) }, "player logged in");
  res.json({
    accessToken: tokens.accessToken,
    user: { ...user.toPublic(), phone: user.phone },
    wallet: wallet ? { totalPaise: wallet.totalPaise, heldPaise: wallet.heldPaise } : null,
  });
}

/** POST /auth/refresh — rotates the cookie, returns a fresh access token */
export async function refresh(req, res) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw new UnauthorizedError("No refresh token");
  const payload = verifyRefreshToken(token);

  const user = await getAuthUser(payload.sub);
  if (payload.tv !== user.tokenVersion) throw new UnauthorizedError("Session revoked, please log in again");

  issueTokens(res, user);
  const isAdmin = user.role === "admin" || user.role === "superadmin";
  res.json({
    accessToken: signAccessToken(user),
    user: { ...user.toPublic(), phone: user.phone },
    ...(isAdmin ? { admin: { id: user._id, name: user.name, email: user.email, role: user.role } } : {}),
  });
}

/** POST /logout */
export async function logout(req, res) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      await invalidateAllSessions(payload.sub); // tokenVersion bump kills every session
    } catch { /* already invalid — nothing to do */ }
  }
  res.clearCookie(REFRESH_COOKIE, { path: "/" });
  res.json({ ok: true });
}

/** GET /auth/me */
export async function me(req, res) {
  if (!req.user) throw new UnauthorizedError();
  const user = await getAuthUser(req.user.id);
  res.json({ user: user.toPublic() });
}