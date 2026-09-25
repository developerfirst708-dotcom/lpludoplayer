import { BadRequestError, ConflictError, NotFoundError, formatPaise } from "@lpludo/shared";
import { env } from "../config/env.js";
import { log } from "../config/logger.js";
import { DepositRequest } from "../db/models/depositRequest.model.js";
import { LedgerEntry } from "../db/models/ledgerEntry.model.js";
import { getSettings } from "../db/models/settings.model.js";
import { emitAdminRefresh, emitToUser, emitWalletUpdate } from "../realtime/io.js";
import { normalizeUtr } from "../utils/utr.js";
import { writeAudit } from "./audit.service.js";
import * as imbpay from "./imbpay.service.js";
import * as walletService from "./wallet.service.js";

const l = log("deposits");

/** last 10 digits — the gateway wants a plain 10-digit indian mobile */
function mobileDigits(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** hybrid rule: below the threshold -> gateway, at/above -> manual */
export function usesGateway(amountPaise, settings) {
  return amountPaise < settings.depositGatewayMaxPaise;
}

function assertGatewayAmount(amountPaise, s) {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new BadRequestError("Enter a valid amount");
  if (amountPaise % 100 !== 0) {
    throw new BadRequestError("Instant UPI payments must be in whole rupees (no paise)");
  }
  if (amountPaise < s.depositMinPaise) throw new BadRequestError(`Minimum deposit is ₹${s.depositMinPaise / 100}`);
  if (amountPaise > s.depositMaxPaise) throw new BadRequestError(`Maximum deposit is ₹${s.depositMaxPaise / 100}`);
  if (!usesGateway(amountPaise, s)) {
    throw new BadRequestError(
      `Amounts of ₹${s.depositGatewayMaxPaise / 100} or more are paid by UPI transfer with a UTR — use the manual deposit`
    );
  }
}

/**
 * Start an IMB Pay order.
 * The row is created first (so the order id can embed the deposit id), then the
 * gateway is called. A refused order is parked as `failed` (never left pending)
 * so the player is not blocked from trying again.
 */
export async function startGatewayDeposit({ userId, phone, amountPaise }) {
  if (!(await imbpay.isGatewayUsable())) {
    throw new ConflictError("Instant UPI is temporarily unavailable — please use the UPI transfer option");
  }
  const s = await getSettings();
  assertGatewayAmount(amountPaise, s);

  const pending = await DepositRequest.findOne({ userId, status: "pending" }).lean();
  if (pending) throw new ConflictError("You already have a deposit in progress — finish or cancel it first");

  const mobile = mobileDigits(phone);
  if (mobile.length !== 10) {
    throw new BadRequestError("Add a valid 10-digit mobile number to your profile before paying via UPI");
  }

  const doc = await DepositRequest.create({ userId, amountPaise, method: "gateway", status: "pending" });
  const orderId = `LPL${doc._id}`;

  try {
    const order = await imbpay.createOrder({
      orderId,
      amountPaise,
      mobile,
      redirectUrl: `${env.PUBLIC_WEB_URL.replace(/\/+$/, "")}/wallet?deposit=${doc._id}`,
      remark1: `user:${userId}`,
      remark2: "LPLUDO wallet deposit",
    });
    doc.gateway.orderId = orderId;
    doc.gateway.paymentUrl = order.paymentUrl;
    doc.gateway.checkLink = order.checkLink;
    await doc.save();
    l.info({ depositId: String(doc._id), orderId, amountPaise }, "gateway deposit started");
    return doc;
  } catch (err) {
    doc.status = "failed";
    doc.gateway.orderId = orderId;
    doc.gateway.createError = err.message;
    doc.gateway.note = `Order could not be created: ${err.message}`;
    await doc.save();
    emitAdminRefresh();
    l.warn({ depositId: String(doc._id), orderId, err: err.message }, "gateway deposit could not be created");
    throw err;
  }
}

/** the ledger row that proves the money moved (written by creditDeposit) */
async function ledgerRowFor(depositId) {
  return LedgerEntry.findOne({ idempotencyKey: `deposit:${depositId}` }).lean();
}

/** credit + flip to approved; safe to run twice (creditDeposit is idempotent) */
async function creditGatewayDeposit(deposit, { source, status }) {
  const note = `Deposit auto-verified via IMB Pay${status.utr ? ` (UTR ${status.utr})` : ""}`;
  const view = await walletService.creditDeposit({
    userId: deposit.userId,
    depositRequestId: deposit._id,
    amountPaise: deposit.amountPaise,
    actorId: null, // system-verified, not an admin action
    note,
  });

  const row = await ledgerRowFor(deposit._id);
  deposit.status = "approved";
  deposit.ledgerEntryId = row?._id || null;
  deposit.reviewedAt = new Date();
  deposit.rejectReason = undefined;
  if (status.utr) {
    const normalized = normalizeUtr(status.utr);
    deposit.utr = normalized.utr;
    deposit.utrHash = normalized.utrHash;
    deposit.gateway.utr = normalized.utr;
  }
  deposit.gateway.txnStatus = status.txnStatus;
  deposit.gateway.payerName = status.payerName || deposit.gateway.payerName;
  deposit.gateway.payerVpa = status.payerVpa || deposit.gateway.payerVpa;
  deposit.gateway.payerApp = status.payerApp || deposit.gateway.payerApp;
  deposit.gateway.amountReportedPaise = status.amountPaise ?? deposit.amountPaise;
  deposit.gateway.verifiedAt = new Date();
  deposit.gateway.verifiedSource = source;
  deposit.gateway.note = undefined;
  await deposit.save();

  await writeAudit(deposit.userId, "deposit.auto_verify", "deposit", deposit._id, {
    amountPaise: deposit.amountPaise, source, orderId: deposit.gateway.orderId, utr: status.utr || null,
  });
  emitToUser(deposit.userId, "deposit:updated", {
    id: deposit._id, status: "approved", method: "gateway", amountPaise: deposit.amountPaise,
  });
  emitWalletUpdate(deposit.userId, view);
  emitAdminRefresh();
  l.info({ depositId: String(deposit._id), orderId: deposit.gateway.orderId, source, utr: status.utr || null },
    "gateway deposit credited");
  return deposit;
}

/** crash-recovery: approved but the ledger pointer is missing -> re-credit (idempotent) */
async function selfHealLedger(deposit) {
  if (deposit.ledgerEntryId) return deposit;
  const row = await ledgerRowFor(deposit._id);
  if (!row) {
    await walletService.creditDeposit({
      userId: deposit.userId,
      depositRequestId: deposit._id,
      amountPaise: deposit.amountPaise,
      actorId: null,
      note: "Deposit auto-verified via IMB Pay (recovered)",
    });
  }
  deposit.ledgerEntryId = row?._id || (await ledgerRowFor(deposit._id))?._id || null;
  await deposit.save();
  return deposit;
}

/**
 * Ask the gateway what really happened and settle the row.
 *
 * Idempotent: safe from the webhook, the player's poll, the sweep and the admin
 * path at the same time — the money move itself is protected by the wallet lock
 * + the `deposit:<id>` ledger idempotency key, so only ONE credit can ever land.
 *
 * @param {object|string} depositOrId
 * @param {{ source: "webhook"|"poll"|"sweep"|"admin", force?: boolean }} opts
 *        force = ignore the throttle / re-check a `failed` row (a real payment
 *        must never be lost because we gave up on an order too early).
 */
export async function reconcileGatewayDeposit(depositOrId, { source, force = false }) {
  const deposit = typeof depositOrId === "string"
    ? await DepositRequest.findById(depositOrId)
    : depositOrId;
  if (!deposit || deposit.method !== "gateway") return deposit;
  if (!deposit.gateway?.orderId) return deposit;

  if (deposit.status === "approved") return selfHealLedger(deposit);
  if (deposit.status === "rejected") return deposit;
  if (deposit.status === "failed" && !force) return deposit;

  const last = deposit.gateway.lastCheckedAt ? new Date(deposit.gateway.lastCheckedAt).getTime() : 0;
  if (!force && Date.now() - last < env.IMB_STATUS_MIN_INTERVAL_MS) return deposit;

  const status = await imbpay.checkOrderStatus(deposit.gateway.orderId);
  deposit.gateway.lastCheckedAt = new Date();
  deposit.gateway.txnStatus = status.txnStatus;

  if (status.state === "success") {
    const paid = status.amountPaise;
    if (paid === null || paid !== deposit.amountPaise) {
      // never credit an amount we could not verify — hand it to a human instead
      deposit.gateway.amountReportedPaise = paid;
      deposit.gateway.utr = status.utr || deposit.gateway.utr;
      deposit.gateway.note = paid === null
        ? "Gateway reported success without an amount — needs manual review"
        : `Customer paid ${formatPaise(paid)} but this deposit was for ${formatPaise(deposit.amountPaise)} — needs manual review`;
      await deposit.save();
      emitAdminRefresh();
      l.warn({ depositId: String(deposit._id), paid, expected: deposit.amountPaise },
        "gateway amount mismatch — left pending for admin review");
      return deposit;
    }
    return creditGatewayDeposit(deposit, { source, status });
  }

  if (status.state === "failed") {
    if (deposit.status === "failed") { await deposit.save(); return deposit; }
    deposit.status = "failed";
    deposit.rejectReason = (status.message || "Payment failed or expired").slice(0, 200);
    deposit.gateway.utr = status.utr || deposit.gateway.utr;
    await deposit.save();
    await writeAudit(deposit.userId, "deposit.gateway_failed", "deposit", deposit._id, {
      orderId: deposit.gateway.orderId, message: status.message,
    });
    emitToUser(deposit.userId, "deposit:updated", { id: deposit._id, status: "failed", method: "gateway" });
    emitAdminRefresh();
    l.info({ depositId: String(deposit._id), message: status.message }, "gateway deposit failed");
    return deposit;
  }

  // pending / unknown ("Order not found") — keep waiting, the sweep expires it
  await deposit.save();
  return deposit;
}

/** player cancels a gateway order they no longer want to pay (frees the slot) */
export async function cancelGatewayDeposit({ depositId, userId }) {
  const deposit = await DepositRequest.findOne({ _id: depositId, userId });
  if (!deposit) throw new NotFoundError("Deposit not found");
  if (deposit.method !== "gateway") throw new BadRequestError("Only instant UPI deposits can be cancelled");
  if (deposit.status !== "pending") return deposit;

  // last authoritative check — if it was actually paid in the meantime, credit it
  const reconciled = await reconcileGatewayDeposit(deposit, { source: "poll", force: true });
  if (reconciled.status !== "pending") return reconciled;

  reconciled.status = "failed";
  reconciled.rejectReason = "Cancelled by you";
  await reconciled.save();
  emitToUser(reconciled.userId, "deposit:updated", { id: reconciled._id, status: "failed", method: "gateway" });
  emitAdminRefresh();
  return reconciled;
}

/**
 * Sweep (every 60s) — the reason gateway payments work even when the webhook
 * cannot reach us (local dev, firewall, gateway delivery failure):
 *   1. reconcile `pending` orders with the gateway,
 *   2. expire orders past the grace window,
 *   3. re-check recently `failed` orders once more (cancel-race / late payment).
 */
export async function verifyPendingGatewayDeposits({ limit = 25 } = {}) {
  if (!imbpay.isGatewayEnabled()) return { checked: 0, approved: 0, failed: 0, expired: 0 };

  const graceMs = env.IMB_ORDER_GRACE_MIN * 60_000;
  const stats = { checked: 0, approved: 0, failed: 0, expired: 0 };

  const pendingRows = await DepositRequest.find({
    method: "gateway",
    status: "pending",
    createdAt: { $lte: new Date(Date.now() - 20_000) }, // let the checkout page open first
  }).sort({ createdAt: 1 }).limit(limit);

  for (const row of pendingRows) {
    try {
      const before = row.status;
      const after = await reconcileGatewayDeposit(row, { source: "sweep" });
      stats.checked += 1;
      if (after.status === "approved" && before !== "approved") stats.approved += 1;

      // expired: the gateway itself times an order out after 30 minutes
      if (after.status === "pending" && Date.now() - new Date(after.createdAt).getTime() > graceMs) {
        after.status = "failed";
        after.rejectReason = "Payment window expired";
        await after.save();
        emitToUser(after.userId, "deposit:updated", { id: after._id, status: "failed", method: "gateway" });
        emitAdminRefresh();
        stats.expired += 1;
      }
    } catch (err) {
      l.warn({ depositId: String(row._id), err: err.message }, "gateway reconcile failed (will retry next sweep)");
    }
  }

  // late-payment safety net: a cancelled/expired order that was actually paid.
  // Bounded hard: only the last 45 min, and each order at most once per 5 min,
  // so a closed order cannot keep burning gateway status credits.
  const failedRows = await DepositRequest.find({
    method: "gateway",
    status: "failed",
    createdAt: { $gte: new Date(Date.now() - 45 * 60_000) },
    $or: [
      { "gateway.lastCheckedAt": { $lt: new Date(Date.now() - 5 * 60_000) } },
      { "gateway.lastCheckedAt": null },
    ],
  }).sort({ createdAt: -1 }).limit(5);

  for (const row of failedRows) {
    try {
      const before = row.status;
      const after = await reconcileGatewayDeposit(row, { source: "sweep", force: true });
      stats.checked += 1;
      if (after.status === "approved" && before !== "approved") {
        stats.approved += 1;
        l.warn({ depositId: String(row._id) }, "late gateway payment credited after the order was closed");
      }
    } catch (err) {
      l.warn({ depositId: String(row._id), err: err.message }, "gateway re-check failed");
    }
  }

  return stats;
}
