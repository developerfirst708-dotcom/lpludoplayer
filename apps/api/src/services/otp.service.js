import { randomInt, randomUUID } from "crypto";
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
 *
 * Delivery uses the MeraOTP v1 API, which GENERATES the OTP itself and returns
 * a `message_id`. We store that id per phone and hand it back on verification
 * (their verify endpoint checks the code against the message id).
 */

let client;
export function otpStoreInit(redisClient) {
  client = redisClient;
}

const SEND_LIMIT_KEY = (phone) => `otp:send:${phone}`;
const ATTEMPT_KEY = (phone) => `otp:att:${phone}`;
const VERIFY_LIMIT_KEY = (phone) => `otp:verify:${phone}`;
const MESSAGE_ID_KEY = (phone) => `otp:msg:${phone}`;

const OTP_TTL_SECONDS = 300; // 5 min
const MESSAGE_TTL_SECONDS = 600; // provider says 10 min validity

/** POST /api/v1/otp/send — the provider creates the code and texts it */
async function sendViaMeraOtp(phone) {
  if (!env.MERAOTP_API_KEY) {
    throw new AppError("SMS delivery is not configured on the server", {
      status: 503,
      code: "SMS_NOT_CONFIGURED",
    });
  }

  const reference = `${env.MERAOTP_PURPOSE}_${phone}_${Date.now()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.MERAOTP_TIMEOUT_MS);
  try {
    const res = await fetch(env.MERAOTP_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MERAOTP_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": reference,
      },
      body: JSON.stringify({
        mobile: phone,
        purpose: env.MERAOTP_PURPOSE,
        otp_length: env.MERAOTP_OTP_LENGTH,
        reference,
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch { /* non-JSON body — judged by status code below */ }

    if (!res.ok || !payload?.success) {
      const message = payload?.message || payload?.error?.message || `HTTP ${res.status}`;
      l.error({ phone, status: res.status, message }, "MeraOTP refused the OTP");
      throw new AppError("Could not send the OTP SMS, please try again", { status: 502, code: "SMS_FAILED" });
    }

    const messageId = payload.data?.message_id || null;
    l.info({ phone, messageId, reference }, "OTP sent via MeraOTP");
    return { messageId };
  } catch (err) {
    if (err instanceof AppError) throw err;
    l.error({ phone, err: err.message }, "MeraOTP send unreachable");
    throw new AppError("Could not send the OTP SMS, please try again", { status: 502, code: "SMS_FAILED" });
  } finally {
    clearTimeout(timer);
  }
}

/** POST /api/v1/otp/verify — the provider checks the code against the message id */
async function verifyViaMeraOtp(phone, otp) {
  const messageId = await client.get(MESSAGE_ID_KEY(phone));
  if (!messageId) throw new BadRequestError("OTP expired or was never sent");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.MERAOTP_TIMEOUT_MS);
  try {
    const res = await fetch(env.MERAOTP_VERIFY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MERAOTP_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message_id: messageId, otp }),
      signal: controller.signal,
    });

    const text = await res.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch { /* handled below */ }

    // exact contract: response.ok && result.success && result.data.verified
    const verified = Boolean(res.ok && payload?.success && payload?.data?.verified === true);

    if (!verified) {
      l.warn({ phone, status: res.status, body: text.slice(0, 300) }, "MeraOTP verify rejected the OTP");
      throw new BadRequestError(payload?.message || payload?.error?.message || "Incorrect OTP");
    }

    await client.del(MESSAGE_ID_KEY(phone));
    return true;
  } catch (err) {
    if (err instanceof AppError) throw err;
    l.error({ phone, err: err.message }, "MeraOTP verify unreachable");
    throw new AppError("Could not verify the OTP right now, please try again", {
      status: 502,
      code: "OTP_VERIFY_FAILED",
    });
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

  // local development: generate + keep the code ourselves, never call the provider
  if (env.ALLOW_DEV_OTP) {
    const code = String(randomInt(100000, 1000000));
    await client.set(`otp:code:${phone}`, code, "EX", OTP_TTL_SECONDS);
    await client.del(ATTEMPT_KEY(phone));
    l.warn({ phone }, "DEV OTP (ALLOW_DEV_OTP=true) — code printed to log only");
    l.info({ phone, otp: code }, "OTP for local development");
    return { sent: true, devOtp: isTest ? undefined : code };
  }

  try {
    const { messageId } = await sendViaMeraOtp(phone);
    if (messageId) await client.set(MESSAGE_ID_KEY(phone), messageId, "EX", MESSAGE_TTL_SECONDS);
    await client.del(ATTEMPT_KEY(phone));
  } catch (err) {
    // hand the resend slot back: otherwise the 60s throttle locks the player
    // out of re-requesting the OTP they never received
    await client.del(`otp:last:${phone}`);
    await client.del(MESSAGE_ID_KEY(phone));
    throw err;
  }
  return { sent: true };
}

export async function verifyOtp(phone, otp) {
  const attempts = await client.incr(VERIFY_LIMIT_KEY(phone));
  if (attempts === 1) await client.expire(VERIFY_LIMIT_KEY(phone), MESSAGE_TTL_SECONDS);
  if (attempts > 5) throw new TooManyRequestsError("Too many wrong attempts. Request a new OTP.");

  // master OTP: only in explicit dev mode, and only the configured dev value
  if (env.ALLOW_DEV_OTP && env.DEV_MASTER_OTP && otp === env.DEV_MASTER_OTP) {
    l.warn({ phone }, "DEV_MASTER_OTP used (local development only)");
    return true;
  }

  if (env.ALLOW_DEV_OTP) {
    const stored = await client.get(`otp:code:${phone}`);
    if (!stored) throw new BadRequestError("OTP expired or was never sent");
    if (otp !== stored) throw new BadRequestError("Incorrect OTP");
    await client.del(`otp:code:${phone}`);
    await client.del(ATTEMPT_KEY(phone));
    await client.del(VERIFY_LIMIT_KEY(phone));
    return true;
  }

  await verifyViaMeraOtp(phone, otp);
  await client.del(ATTEMPT_KEY(phone));
  await client.del(VERIFY_LIMIT_KEY(phone));
  return true;
}
