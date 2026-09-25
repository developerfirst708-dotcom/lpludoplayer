import * as walletService from "../services/wallet.service.js";
import * as depositService from "../services/deposit.service.js";
import * as imbpay from "../services/imbpay.service.js";
import { DepositRequest } from "../db/models/depositRequest.model.js";
import { WithdrawalRequest } from "../db/models/withdrawalRequest.model.js";
import { getSettings } from "../db/models/settings.model.js";
import {
  BadRequestError, ForbiddenError, ConflictError, NotFoundError,
} from "@lpludo/shared";
import { validate } from "@lpludo/shared/schemas";
import { depositClaimSchema, gatewayDepositSchema, withdrawRequestSchema } from "../validation/extraSchemas.js";
import { paginationSchema } from "@lpludo/shared/schemas";
import { normalizeUtr } from "../utils/utr.js";
import { emitAdminRefresh, emitWalletUpdate } from "../realtime/io.js";

/* ------------------------------ deposits ------------------------------ */

/** the shape the wallet screen polls while a gateway payment is in flight */
function depositView(d) {
  return {
    id: d._id,
    method: d.method,
    amountPaise: d.amountPaise,
    status: d.status,
    utr: d.utr || d.gateway?.utr || null,
    rejectReason: d.rejectReason || null,
    paymentUrl: d.gateway?.paymentUrl || null,
    orderId: d.gateway?.orderId || null,
    gatewayNote: d.gateway?.note || null,
    gatewayTxnStatus: d.gateway?.txnStatus || null,
    verifiedAt: d.gateway?.verifiedAt || null,
    ledgerEntryId: d.ledgerEntryId || null,
    createdAt: d.createdAt,
  };
}

/** GET /payments/deposit/details — VPA + limits + which rail this amount uses */
export async function depositDetails(_req, res) {
  const s = await getSettings();
  const gatewayEnabled = await imbpay.isGatewayUsable();
  res.json({
    upiId: s.depositUpiId || null,
    upiName: s.depositUpiName || null,
    minPaise: s.depositMinPaise,
    maxPaise: s.depositMaxPaise,
    /** amounts BELOW gatewayThresholdPaise go through the instant gateway */
    gatewayEnabled,
    gatewayThresholdPaise: s.depositGatewayMaxPaise,
    /** configured but currently refusing orders -> tell the player to use the UPI transfer */
    gatewayUnavailable: imbpay.isGatewayEnabled() && !gatewayEnabled,
    gatewayMinPaise: s.depositMinPaise,
  });
}

/** POST /payments/deposit — user claims they paid; admin approves later */
export async function createDeposit(req, res) {
  const s = await getSettings();
  const { amountPaise, utr, proofImageKey } = validate(depositClaimSchema, req.body);

  if (!s.depositUpiId) throw new ConflictError("Deposits are not enabled right now");
  if (amountPaise < s.depositMinPaise) throw new BadRequestError(`Minimum deposit is ₹${s.depositMinPaise / 100}`);
  if (amountPaise > s.depositMaxPaise) throw new BadRequestError(`Maximum deposit is ₹${s.depositMaxPaise / 100}`);

  // hybrid rule: while the gateway is healthy, smaller amounts must use instant UPI
  if ((await imbpay.isGatewayUsable()) && depositService.usesGateway(amountPaise, s)) {
    throw new BadRequestError(
      `Amounts under ₹${s.depositGatewayMaxPaise / 100} are paid instantly through UPI — use the instant payment option`
    );
  }

  const normalized = normalizeUtr(utr);
  const dup = await DepositRequest.findOne({ utrHash: normalized.utrHash }).lean();
  if (dup) {
    // same UTR twice — the #1 deposit scam (C8); message never leaks the other user
    throw new ConflictError("This UTR has already been submitted");
  }

  const doc = await DepositRequest.create({
    userId: req.user.id,
    amountPaise,
    utr: normalized.utr,
    utrHash: normalized.utrHash,
    proofImageKey: proofImageKey || null,
  });

  emitAdminRefresh();
  res.status(201).json({
    id: doc._id,
    status: doc.status,
    amountPaise: doc.amountPaise,
    message: "Deposit submitted. An admin will verify and credit your wallet shortly.",
  });
}

/** POST /payments/deposit/gateway — instant UPI order (< threshold), auto-verified */
export async function createGatewayDeposit(req, res) {
  const { amountPaise } = validate(gatewayDepositSchema, req.body);
  const doc = await depositService.startGatewayDeposit({
    userId: req.user.id,
    phone: req.user.doc?.phone,
    amountPaise,
  });

  res.status(201).json({
    ...depositView(doc),
    message: "Payment page ready. Complete the payment in the gateway page.",
  });
}

/** GET /payments/deposit/:id — one deposit (the wallet screen polls this after checkout) */
export async function getDeposit(req, res) {
  let doc = await DepositRequest.findOne({ _id: req.params.id, userId: req.user.id });
  if (!doc) throw new NotFoundError("Deposit not found");

  // a poll is also a verification attempt; failures just leave the row as-is
  if (doc.method === "gateway" && doc.status === "pending") {
    try {
      doc = await depositService.reconcileGatewayDeposit(doc, { source: "poll" });
    } catch {
      /* gateway unreachable / wallet busy — the sweep will settle it */
    }
  }
  res.json(depositView(doc));
}

/** POST /payments/deposit/:id/cancel — abandon a gateway order (frees the pending slot) */
export async function cancelDeposit(req, res) {
  const doc = await depositService.cancelGatewayDeposit({ depositId: req.params.id, userId: req.user.id });
  res.json({ ...depositView(doc), message: doc.status === "failed" ? "Deposit cancelled" : "Deposit updated" });
}

/** GET /payments/deposits — the user's own claims */
export async function myDeposits(req, res) {
  const { limit } = validate(paginationSchema, req.query);
  const items = await DepositRequest.find({ userId: req.user.id })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  res.json({
    items: items.map((d) => ({
      id: d._id, amountPaise: d.amountPaise, status: d.status, method: d.method || "manual",
      utr: d.utr || d.gateway?.utr || null,
      rejectReason: d.rejectReason || null,
      gatewayNote: d.gateway?.note || null,
      createdAt: d.createdAt,
    })),
  });
}

/* ----------------------------- withdrawals ---------------------------- */

/** POST /payments/withdraw — holds the amount immediately (C5/C6/C7 fixed) */
export async function requestWithdraw(req, res) {
  const { amountPaise, upiId } = validate(withdrawRequestSchema, req.body);
  const s = await getSettings();
  if (amountPaise < s.withdrawalMinPaise) {
    throw new BadRequestError(`Minimum withdrawal is ₹${s.withdrawalMinPaise / 100}`);
  }

  const user = req.user.doc;
  if (user.kyc?.status !== "verified") {
    throw new ForbiddenError("KYC verification is required before withdrawing");
  }

  const doc = await WithdrawalRequest.create({
    userId: req.user.id,
    amountPaise,
    upiId,
  });
  try {
    await walletService.holdWithdrawal({ userId: req.user.id, withdrawalId: doc._id, amountPaise });
  } catch (err) {
    await WithdrawalRequest.deleteOne({ _id: doc._id }); // hold failed -> remove the request
    if (err?.name === "WalletError" || err?.status === 409) throw new ForbiddenError("Insufficient balance");
    throw err;
  }
  // traceability: point at the exact ledger row created by the hold
  const { LedgerEntry } = await import("../db/models/ledgerEntry.model.js");
  const holdRow = await LedgerEntry.findOne({ idempotencyKey: `w_hold:${doc._id}` }).lean();
  doc.holdLedgerId = holdRow?._id || null;
  await doc.save();

  emitWalletUpdate(req.user.id, await walletService.walletView(req.user.id));
  emitAdminRefresh();
  res.status(201).json({
    id: doc._id, status: doc.status, amountPaise,
    message: "Withdrawal requested. Funds are on hold until an admin pays them out.",
  });
}

/** GET /payments/withdrawals */
export async function myWithdrawals(req, res) {
  const { limit } = validate(paginationSchema, req.query);
  const items = await WithdrawalRequest.find({ userId: req.user.id })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  res.json({
    items: items.map((w) => ({
      id: w._id, amountPaise: w.amountPaise, status: w.status, upiId: w.upiId,
      rejectReason: w.rejectReason || null, providerRef: w.providerRef || null,
      createdAt: w.createdAt, paidAt: w.paidAt || null,
    })),
  });
}