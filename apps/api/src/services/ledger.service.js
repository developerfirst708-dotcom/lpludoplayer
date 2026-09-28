import { LedgerEntry } from "../db/models/ledgerEntry.model.js";
import { Wallet } from "../db/models/wallet.model.js";
import { WalletError } from "@lpludo/shared";
import { log } from "../config/logger.js";

const l = log("ledger");

/**
 * THE only way money moves.
 *
 * Appends an immutable ledger row AND applies the same delta to the wallet
 * inside the caller's transaction. Both happen or neither happens (fixes C1–C7).
 *
 * Replaying the same `idempotencyKey` returns the original row without
 * applying anything twice (fixes C13 / double-credit on retry).
 *
 * @param {object} p
 * @param {import("mongoose").ClientSession} [p.session] required for money moves
 * @param {number} p.amount       signed delta to wallet.totalPaise
 * @param {number} [p.heldDelta]  signed delta to wallet.heldPaise
 * @param {string} p.idempotencyKey deterministic, e.g. `prize:<contestId>:<userId>`
 */
export async function applyLedger({
  session,
  userId,
  amount,
  heldDelta = 0,
  referralDelta = 0,
  type,
  refType,
  refId,
  note,
  metadata = {},
  idempotencyKey,
  actorId = null,
}) {
  if (!session) throw new WalletError("applyLedger requires a transaction session");
  if (!Number.isInteger(amount) || !Number.isInteger(heldDelta) || !Number.isInteger(referralDelta)) {
    throw new WalletError(
      `ledger deltas must be integers (amount=${amount}, heldDelta=${heldDelta}, referralDelta=${referralDelta})`
    );
  }

  // 1) idempotency: if this exact operation already ran, return its row untouched
  const existing = await LedgerEntry.findOne({ idempotencyKey }).session(session);
  if (existing) {
    l.info({ idempotencyKey, type }, "ledger replay blocked (already applied)");
    return { entry: existing, wallet: await Wallet.findOne({ userId }).session(session), idempotentReplay: true };
  }

  // 2) load wallet with a lock-ish ordering (caller holds the per-user redis lock)
  let wallet = await Wallet.findOne({ userId }).session(session);
  if (!wallet) {
    wallet = new Wallet({ userId, totalPaise: 0, heldPaise: 0 });
  }

  const newTotal = wallet.totalPaise + amount;
  const newHeld = wallet.heldPaise + heldDelta;
  const newReferral = wallet.referralPaise + referralDelta;
  if (newTotal < 0) throw new WalletError("insufficient balance", { need: -amount, have: wallet.totalPaise });
  if (newHeld < 0) throw new WalletError("cannot release more than is held", { heldDelta });
  if (newTotal - newHeld < 0) throw new WalletError("operation would overdraw available balance");
  if (newReferral < 0) throw new WalletError("insufficient referral balance", { need: -referralDelta, have: wallet.referralPaise });

  wallet.totalPaise = newTotal;
  wallet.heldPaise = newHeld;
  wallet.referralPaise = newReferral;
  wallet.version += 1;

  // running counters so dashboards never re-aggregate the ledger (fixes P5)
  switch (type) {
    case "deposit": wallet.totals.depositedPaise += amount; break;
    case "withdrawal_paid": wallet.totals.withdrawnPaise += -amount; break;
    case "prize_win": wallet.totals.wonPaise += amount; break;
    case "referral_commission": wallet.totals.referralEarnedPaise = (wallet.totals.referralEarnedPaise || 0) + referralDelta; break;
    case "entry_fee_paid":
      wallet.totals.lostPaise += -amount; // stake consumed by this battle
      wallet.totals.battlesPlayed += 1;
      break;
    default: break;
  }

  // per-contest aggregates (admin dispute screen reads these, not a scan)
  if (refType === "contest" && refId) {
    wallet.contestTotals = wallet.contestTotals || {};
    wallet.contestTotals[refId.toString()] = (wallet.contestTotals[refId.toString()] || 0) + amount;
    wallet.markModified("contestTotals");
  }

  // 3) ledger row, then wallet — same transaction
  const [entry] = await LedgerEntry.create(
    [
      {
        walletId: wallet._id,
        userId,
        amount,
        heldDelta,
        referralDelta,
        balanceAfter: newTotal,
        availableAfter: newTotal - newHeld,
        type,
        refType,
        refId,
        note,
        metadata,
        idempotencyKey,
        actorId,
      },
    ],
    { session }
  );

  await wallet.save({ session });

  l.debug(
    { userId: String(userId), type, amount, heldDelta, balanceAfter: newTotal, idempotencyKey },
    "ledger applied"
  );
  return { entry, wallet, idempotentReplay: false };
}

/**
 * Reconciliation: sum the ledger and compare with the wallet balance.
 * `drift` must be 0 for every wallet (used by the admin health screen + tests).
 */
export async function reconcileWallet(userId, { session } = {}) {
  const wallet = await Wallet.findOne({ userId }).session(session);
  if (!wallet) return { wallet: null, ledgerSum: 0, ledgerHeld: 0, ledgerReferral: 0, rows: 0, drift: 0, heldDrift: 0, referralDrift: 0 };

  const [agg] = await LedgerEntry.aggregate([
    { $match: { walletId: wallet._id } },
    {
      $group: {
        _id: null,
        total: { $sum: "$amount" },
        held: { $sum: "$heldDelta" },
        referral: { $sum: "$referralDelta" },
        rows: { $sum: 1 },
      },
    },
  ]).session(session);

  const ledgerSum = agg?.total ?? 0;
  const ledgerHeld = agg?.held ?? 0;
  const ledgerReferral = agg?.referral ?? 0;
  return {
    wallet,
    ledgerSum,
    ledgerHeld,
    ledgerReferral,
    rows: agg?.rows ?? 0,
    drift: ledgerSum - wallet.totalPaise,
    heldDrift: ledgerHeld - wallet.heldPaise,
    referralDrift: ledgerReferral - (wallet.referralPaise || 0),
  };
}

/** Wallet history (paginated, newest first) for the wallet page. */
export async function listLedger(userId, { limit = 20, before } = {}) {
  const query = { userId };
  if (before) query.createdAt = { $lt: new Date(before) };
  return LedgerEntry.find(query).sort({ createdAt: -1 }).limit(limit + 1).lean();
}
