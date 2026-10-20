import { AppError } from "@lpludo/shared";
import { env } from "../config/env.js";
import { log } from "../config/logger.js";
import { redis } from "../db/redis.js";

const l = log("imbpay");

/**
 * IMB Pay (api.imbpay.in) client — the ONLY place that talks to the gateway.
 *
 * Contract (support.imbpayment.co.in → API Credentials):
 *   POST /v2/create-order        form-urlencoded: customer_mobile, user_token,
 *                                amount (RUPEES), order_id, redirect_url, remark1, remark2
 *     -> { status: true, result: { orderId, payment_url, bhim_link, paytm_link, phonepe_link, check_link } }
 *   POST /v2/check-order-status  form-urlencoded: user_token, order_id
 *     -> { status: "COMPLETED"|"PENDING"|"FAILED"|"ERROR", result: { status: "SUCCESS", amount, utr, ... } }
 *
 * The gateway answers HTTP 200 even for errors (`{ status: false, message }`),
 * so "did it work" is decided by the body, never the status code. Responses are
 * parsed defensively (string|number amounts, snake|camel keys): a slightly
 * different live shape must never silently break crediting.
 */

export function isGatewayEnabled() {
  return Boolean(env.IMB_API_TOKEN);
}

/* ------------------------------------------------------------------ */
/* Circuit breaker                                                     */
/*                                                                     */
/* While the gateway is refusing orders (no merchant connected, bad    */
/* token, downtime) sub-threshold deposits fall back to the manual UPI */
/* flow instead of leaving players with no way to deposit at all.      */
/* The breaker is per-instance state in Redis, so it self-heals.       */
/* ------------------------------------------------------------------ */

const DOWN_KEY = "imb:gateway_down";
const DOWN_TTL_SEC = 600;

/** systemic failures that mean "stop sending players to the gateway" */
const SYSTEMIC = /merchant not connected|invalid user_token|invalid token|unauthori[sz]ed|not activated|kyc|maintenance|disabled|unavailable|not enabled/i;

async function setBreaker(reason) {
  try {
    await redis.set(DOWN_KEY, String(reason).slice(0, 200), "EX", DOWN_TTL_SEC);
    l.warn({ reason }, "gateway circuit OPEN — manual deposits take over for 10 min");
  } catch { /* redis blip must never block payments */ }
}

async function clearBreaker() {
  try {
    await redis.del(DOWN_KEY);
  } catch { /* ignore */ }
}

/** true when the gateway is configured AND not known to be failing */
export async function isGatewayUsable() {
  if (!isGatewayEnabled()) return false;
  try {
    return !(await redis.get(DOWN_KEY));
  } catch {
    return true; // cannot read the breaker -> trust the gateway
  }
}

/** why the gateway is currently considered down (for user-facing messaging) */
export async function gatewayDownReason() {
  try {
    return (await redis.get(DOWN_KEY)) || null;
  } catch {
    return null;
  }
}

/** fetch with a hard timeout; network problems become a 502 the caller can show */
async function postForm(path, fields) {
  const url = `${env.IMB_API_URL.replace(/\/+$/, "")}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.IMB_API_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AppError(`Payment gateway returned an unreadable response (HTTP ${res.status})`, {
        status: 502, code: "GATEWAY_BAD_RESPONSE",
      });
    }
    if (!res.ok) {
      l.warn({ path, http: res.status, body: text.slice(0, 300) }, "gateway http error");
      throw new AppError(json?.message || `Payment gateway error (HTTP ${res.status})`, {
        status: 502, code: "GATEWAY_ERROR",
      });
    }
    return json;
  } catch (err) {
    if (err instanceof AppError) throw err;
    l.error({ path, err: err.message }, "gateway unreachable");
    throw new AppError("Payment gateway is not reachable right now, please try again", {
      status: 502, code: "GATEWAY_UNAVAILABLE",
    });
  } finally {
    clearTimeout(timer);
  }
}

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());

/** first defined value among aliases (snake_case vs camelCase drift) */
function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

/**
 * True when a gateway status string means "the payment went through".
 * IMB's live responses are not always exactly `SUCCESS`/`COMPLETED` — some
 * builds return `TXN_SUCCESS`, `SUCCESSFUL`, `PENDING`… and the top-level
 * `status` can even be the boolean `true`. Matching on the keyword (instead of
 * an exact enum) is what keeps a genuinely completed payment from lingering as
 * `pending` — the amount check below is the real guard against bad credits.
 */
function isPositiveStatus(s) {
  if (s === undefined || s === null || s === "") return false;
  const v = String(s).trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  return /success|complet|approv|paid|credited/i.test(v);
}

/** a status string that means the transaction definitively did NOT go through */
function isNegativeStatus(s) {
  if (s === undefined || s === null || s === "") return false;
  const v = String(s).trim().toLowerCase();
  return /fail|expired|cancel|reject|error|false|not.?paid|failed/i.test(v);
}

/** lenient rupee-amount parsing (tolerates ₹1,000 / "500.00" / numeric) */
function parseAmountPaise(amountRaw) {
  if (amountRaw === undefined || amountRaw === null) return null;
  const cleaned = String(amountRaw).replace(/[^0-9.-]/g, "");
  if (cleaned === "") return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.round(num * 100) : null;
}

/**
 * Create a payment order.
 * @returns {{ orderId: string, paymentUrl: string, checkLink: string|null, bhimLink: string|null, raw: object }}
 * @throws {AppError} 502 when the gateway refuses (e.g. "Merchant Not Connected")
 */
export async function createOrder({ orderId, amountPaise, mobile, redirectUrl, remark1, remark2 }) {
  if (amountPaise % 100 !== 0) {
    throw new AppError("Gateway payments must be a whole rupee amount", { status: 400, code: "BAD_REQUEST" });
  }
  const raw = await postForm("/v2/create-order", {
    customer_mobile: mobile,
    user_token: env.IMB_API_TOKEN,
    amount: String(amountPaise / 100), // gateway takes RUPEES
    order_id: orderId,
    redirect_url: redirectUrl,
    ...(remark1 ? { remark1 } : {}),
    ...(remark2 ? { remark2 } : {}),
  }).catch(async (err) => {
    await setBreaker(err.message); // unreachable / unreadable -> let the manual rail serve users
    throw err;
  });

  if (raw?.status !== true && String(raw?.status).toUpperCase() !== "SUCCESS") {
    const message = str(raw?.message) || "Payment gateway rejected the order";
    if (SYSTEMIC.test(message)) await setBreaker(message);
    l.warn({ orderId, message }, "create-order refused");
    throw new AppError(`Payment gateway: ${message}`, { status: 502, code: "GATEWAY_REFUSED" });
  }
  await clearBreaker();

  const result = raw?.result && typeof raw.result === "object" ? raw.result : {};
  const paymentUrl = str(pick(result, "payment_url", "paymentUrl"));
  if (!paymentUrl) {
    l.warn({ orderId, raw }, "create-order returned no payment_url");
    throw new AppError("Payment gateway did not return a payment page", { status: 502, code: "GATEWAY_BAD_RESPONSE" });
  }

  return {
    orderId: str(pick(result, "orderId", "order_id")) || orderId,
    paymentUrl,
    checkLink: str(pick(result, "check_link", "checkLink")) || null,
    bhimLink: str(pick(result, "bhim_link", "bhimLink")) || null,
    raw,
  };
}

/**
 * Server-to-server status check — the AUTHORITATIVE answer (webhook bodies are
 * never trusted for money decisions).
 * @returns {{ state: "success"|"pending"|"failed"|"unknown", txnStatus: string,
 *             resultStatus: string, amountPaise: number|null, utr: string,
 *             payerName: string, payerVpa: string, payerApp: string, message: string, raw: object }}
 */
export async function checkOrderStatus(orderId) {
  const raw = await postForm("/v2/check-order-status", {
    user_token: env.IMB_API_TOKEN,
    order_id: orderId,
  });

  const result = raw?.result && typeof raw.result === "object" ? raw.result : {};
  const top = str(raw?.status);
  const txnStatus = str(pick(result, "txnStatus", "txn_status"));
  const resultStatus = str(pick(result, "status"));
  const message = str(raw?.message);

  // Success wins when ANY field reports it (live IMB builds vary); the amount
  // cross-check in reconcileGatewayDeposit is what actually guards crediting.
  const isSuccess = isPositiveStatus(top) || isPositiveStatus(resultStatus) || isPositiveStatus(txnStatus);
  const isFailed = isNegativeStatus(top) || isNegativeStatus(resultStatus) || isNegativeStatus(txnStatus);

  // "Order not found"-style answers stay `unknown`, never failed — they just mean
  // IMB has not seen the order yet (or the id won), so we keep waiting instead
  // of wrongly telling the player their payment failed.
  const isInvalidOrder = /(not found|invalid (order|transaction|id))/i.test(str(raw?.message || ""));

  let state = "pending";
  if (isSuccess) state = "success";
  else if (isInvalidOrder) state = "unknown";
  else if (isFailed) state = "failed";

  const amountPaise = parseAmountPaise(pick(result, "amount", "amountPaise", "paid") || pick(result, "paid_amount", "paidAmount"));

  return {
    state,
    txnStatus: txnStatus || resultStatus || top,
    resultStatus: resultStatus || txnStatus || top,
    amountPaise,
    utr: str(pick(result, "utr")) || null,
    payerName: str(pick(result, "payer_name", "payerName")) || null,
    payerVpa: str(pick(result, "payer_vpa", "payerVpa")) || null,
    payerApp: str(pick(result, "payer_app", "payerApp")) || null,
    message,
    raw,
  };
}
