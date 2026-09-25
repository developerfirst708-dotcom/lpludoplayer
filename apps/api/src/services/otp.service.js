import Redis from "ioredis";
import { randomInt } from "crypto";
import { env, isTest } from "../config/env.js";
import { log } from "../config/logger.js";
import { AppError, BadRequestError, TooManyRequestsError } from "@lpludo/shared";

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

/**
 * Deliver the code over SMS through MeraOTP (the provider the legacy app used).
 * Their API answers HTTP 400 with `{ success: false, message }` for a bad key
 * or an unroutable number, so both the status code and the body are checked.
 * A delivery failure is surfaced to the caller (never a silent "sent") so the
 * player is told to retry instead of staring at an empty inbox.
 */
async function sendViaMeraOtp(phone, otp) {
  if (!env.MERAOTP_API_KEY) {
    throw new AppError("SMS delivery is not configured on the server", {
      status: 503,
      code: "SMS_NOT_CONFIGURED",
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.MERAOTP_TIMEOUT_MS);
  try {
    const res = await fetch(env.MERAOTP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: env.MERAOTP_API_KEY,
        mobileNo: phone,
        messageType: env.MERAOTP_MESSAGE_TYPE,
        brandName: env.MERAOTP_BRAND_NAME,
        otp,
        senderId: env.MERAOTP_SENDER_ID,
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch { /* non-JSON body — judged by status code below */ }

    if (!res.ok || payload?.success === false || payload?.status === false) {
      const message = payload?.message || `HTTP ${res.status}`;
      l.error({ phone, message }, "SMS gateway refused the OTP");
      throw new AppError("Could not send the OTP SMS, please try again", { status: 502, code: "SMS_FAILED" });
    }
    l.info({ phone, gateway: payload?.message || "ok" }, "OTP sent by SMS");
    return payload;
  } catch (err) {
    if (err instanceof AppError) throw err;
    l.error({ phone, err: err.message }, "SMS gateway unreachable");
    throw new AppError("Could not send the OTP SMS, please try again", { status: 502, code: "SMS_FAILED" });
  } finally {
    clearTimeout(timer);
  }
}

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
    try {
      await sendViaMeraOtp(phone, code);
    } catch (err) {
      // hand the resend slot back: otherwise the 60s throttle locks the player
      // out of re-requesting the OTP they never received
      await client.del(`otp:last:${phone}`);
      await client.del(`otp:code:${phone}`);
      throw err;
    }
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
