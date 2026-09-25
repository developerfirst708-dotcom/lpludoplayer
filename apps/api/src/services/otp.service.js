import Redis from "ioredis";
import { randomInt } from "crypto";
import { env, isTest } from "../config/env.js";
import { log } from "../config/logger.js";
import { BadRequestError, TooManyRequestsError } from "@lpludo/shared";

const l = log("otp");

/**
 * OTP storage + rate limiting, backed by Redis with hard TTLs.
 * Fixes S1 (the master OTP 999999 backdoor) and S6 (no rate limit at all):
 *  - the bypass only exists when env.ALLOW_DEV_OTP is true AND NODE_ENV != production
 *    (env.js refuses to boot with ALLOW_DEV_OTP in production)
 *  - 5 sends / hour / phone, 5 verify attempts / OTP, 1 send / 60s
 */

let client;
export function otpStoreInit(redisClient) {
  client = redisClient;
}

const SEND_LIMIT_KEY = (phone) => `otp:send:${phone}`;
const ATTEMPT_KEY = (phone) => `otp:att:${phone}`;
const VERIFY_LIMIT_KEY = (phone) => `otp:verify:${phone}`;

export async function createOtp(phone) {
  const sendHour = await client.incr(SEND_LIMIT_KEY(phone));
  if (sendHour === 1) await client.expire(SEND_LIMIT_KEY(phone), 3600);
  if (sendHour > 5) throw new TooManyRequestsError("Too many OTP requests. Try again later.");

  // re-send throttle: 1 per 60s
  const recently = await client.get(`otp:last:${phone}`);
  if (recently) throw new TooManyRequestsError("Please wait a minute before requesting another OTP");
  await client.set(`otp:last:${phone}`, "1", "EX", 60);

  const code = String(randomInt(100000, 1000000));
  await client.set(`otp:code:${phone}`, code, "EX", 300); // 5 min
  await client.del(ATTEMPT_KEY(phone));

  if (env.ALLOW_DEV_OTP) {
    l.warn({ phone }, "DEV OTP (ALLOW_DEV_OTP=true) — code printed to log only");
    l.info({ phone, otp: code }, "OTP for local development");
  } else {
    // production SMS provider goes here (SMS_PROVIDER_KEY); nothing is logged
    l.info({ phone }, "OTP generated for delivery");
  }
  return { sent: true, devOtp: env.ALLOW_DEV_OTP && !isTest ? code : undefined };
}

export async function verifyOtp(phone, otp) {
  const stored = await client.get(`otp:code:${phone}`);
  if (!stored) throw new BadRequestError("OTP expired or was never sent");

  const attempts = await client.incr(VERIFY_LIMIT_KEY(phone));
  if (attempts === 1) await client.expire(VERIFY_LIMIT_KEY(phone), 300);
  if (attempts > 5) throw new TooManyRequestsError("Too many wrong attempts. Request a new OTP.");

  // master OTP: only in explicit dev mode, and only the configured dev value
  if (env.ALLOW_DEV_OTP && env.DEV_MASTER_OTP && otp === env.DEV_MASTER_OTP) {
    l.warn({ phone }, "DEV_MASTER_OTP used (local development only)");
    return true;
  }

  if (otp !== stored) throw new BadRequestError("Incorrect OTP");

  // single use
  await client.del(`otp:code:${phone}`);
  await client.del(ATTEMPT_KEY(phone));
  await client.del(VERIFY_LIMIT_KEY(phone));
  return true;
}
