import { DepositRequest } from "../db/models/depositRequest.model.js";
import * as depositService from "../services/deposit.service.js";
import { log } from "../config/logger.js";

const l = log("imb-webhook");

/**
 * IMB Pay webhook (configured in the IMB dashboard → API Credentials).
 *
 * The gateway sends either JSON or `application/x-www-form-urlencoded` with
 * `result` as a JSON *string* (their own PHP sample reads it from $_POST), so
 * both shapes are normalized here.
 *
 * SECURITY: the payload is NOT trusted — it carries no signature. It is only a
 * trigger: we look the order up and ask the gateway (server-to-server) what
 * really happened, and the credit happens from that answer alone. Unknown or
 * replayed events are no-ops, and the handler always answers 200 so the
 * gateway never retries into a loop.
 */
function normalizeBody(body) {
  if (!body || typeof body !== "object") return {};
  const out = { ...body };
  if (typeof out.result === "string") {
    try {
      out.result = JSON.parse(out.result);
    } catch {
      out.result = {};
    }
  }
  return out;
}

export async function imbWebhook(req, res) {
  try {
    const payload = normalizeBody(req.body);
    const orderId = String(payload.order_id ?? payload.orderId ?? "").trim();
    const claimed = String(payload.status ?? "").toUpperCase();
    l.info(
      { orderId, claimed, txnStatus: payload.result?.txnStatus || null, amount: payload.result?.amount ?? null },
      "gateway webhook received"
    );

    if (!orderId) return res.status(200).json({ ok: true });

    const deposit = await DepositRequest.findOne({ "gateway.orderId": orderId });
    if (!deposit) {
      l.warn({ orderId }, "webhook for an unknown order — ignored");
      return res.status(200).json({ ok: true });
    }

    // a webhook that arrives after the order was closed is the one case that must
    // bypass the throttle — a real payment must never be lost
    await depositService.reconcileGatewayDeposit(deposit, {
      source: "webhook",
      force: deposit.status === "failed",
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    // never 5xx: the sweep reconciles every pending order anyway
    l.error({ err: err.message }, "webhook processing failed (sweep will settle it)");
    return res.status(200).json({ ok: true });
  }
}
