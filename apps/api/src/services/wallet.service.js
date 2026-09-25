import { withTransaction } from "../db/connect.js";
import { applyLedger } from "./ledger.service.js";
import { withLock } from "../db/redis.js";
import { Wallet } from "../db/models/wallet.model.js";
import { ForbiddenError } from "@lpludo/shared";

/**
 * High-level money operations. Each one:
 *   1. takes a per-user Redis lock when it owns the transaction
 *   2. runs inside a Mongo transaction with a deterministic idempotency key
 *   3. writes through applyLedger (ledger row + wallet, atomically)
 *
 * IMPORTANT: every op accepts `{ session }`. When the caller (contest service)
 * is already inside a transaction, the wallet write JOINS that session instead
 * of opening its own — so the contest state and the money move commit together
 * or not at all. A nested independent transaction here would recreate the
 * reference app's stuck-money bug (C1).
 */

function viewOf(wallet) {
  if (!wallet) return null;
  return {
    totalPaise: wallet.totalPaise,
    heldPaise: wallet.heldPaise,
    availablePaise: wallet.totalPaise - wallet.heldPaise,
    totals: wallet.totals,
    currency: wallet.currency,
  };
}

/** @returns the wallet document */
export async function getOrCreateWallet(userId, { session } = {}) {
  let wallet = await Wallet.findOne({ userId }).session(session);
  if (!wallet) wallet = (await Wallet.create([{ userId, totalPaise: 0, heldPaise: 0 }], { session }))[0];
  return wallet;
}

export async function walletView(userId) {
  const wallet = await getOrCreateWallet(userId);
  return viewOf(wallet);
}

/** standalone path: take the per-user lock, then open our own transaction */
function lockedFor(userId, run) {
  return withLock(`wallet:${userId}`, () => withTransaction(run));
}

/** Credit a UPI deposit after an admin approves it. */
export async function creditDeposit({ userId, depositRequestId, amountPaise, actorId, note }) {
  return lockedFor(userId, async (session) => {
    const { wallet } = await applyLedger({
      session, userId, amount: amountPaise, type: "deposit",
      refType: "deposit", refId: depositRequestId,
      note: note || "Deposit approved",
      idempotencyKey: `deposit:${depositRequestId}`, actorId,
    });
    return viewOf(wallet);
  });
}

/** Hold a battle stake when a player is actually seated. 409 if short of money. */
export async function holdEntryFee({ userId, contestId, amountPaise, session }) {
  const run = async (s) => {
    await getOrCreateWallet(userId, { session: s });
    const { wallet } = await applyLedger({
      session: s, userId, amount: 0, heldDelta: amountPaise, type: "entry_fee_hold",
      refType: "contest", refId: contestId, note: "Stake held for battle",
      idempotencyKey: `entry_hold:${contestId}:${userId}`,
    });
    return viewOf(wallet);
  };
  return session ? run(session) : lockedFor(userId, run);
}

/** Release a hold back to available (unseat / cancel / refund). */
export async function releaseEntryFee({ userId, contestId, amountPaise, note = "Stake released", session }) {
  const run = async (s) => {
    const { wallet } = await applyLedger({
      session: s, userId, amount: 0, heldDelta: -amountPaise, type: "entry_fee_release",
      refType: "contest", refId: contestId, note,
      idempotencyKey: `entry_release:${contestId}:${userId}`,
    });
    return viewOf(wallet);
  };
  return session ? run(session) : lockedFor(userId, run);
}

/** Consume the hold (battle played to completion) — moves held -> gone. */
export async function consumeEntryFee({ userId, contestId, amountPaise, contestRef, session }) {
  const run = async (s) => {
    const { wallet } = await applyLedger({
      session: s, userId, amount: -amountPaise, heldDelta: -amountPaise, type: "entry_fee_paid",
      refType: "contest", refId: contestId, note: "Stake consumed",
      metadata: contestRef,
      idempotencyKey: `entry_consume:${contestId}:${userId}`,
    });
    return viewOf(wallet);
  };
  return session ? run(session) : lockedFor(userId, run);
}

/** Refund the hold for cancelled battles. */
export async function refundEntryFee({ userId, contestId, amountPaise, note = "Battle cancelled — stake refunded", session }) {
  const run = async (s) => {
    const { wallet } = await applyLedger({
      session: s, userId, amount: 0, heldDelta: -amountPaise, type: "entry_fee_refund",
      refType: "contest", refId: contestId, note,
      idempotencyKey: `entry_refund:${contestId}:${userId}`,
    });
    return viewOf(wallet);
  };
  return session ? run(session) : lockedFor(userId, run);
}

/** Pay the winner (idempotent — a retried settle cannot double-pay). */
export async function creditPrize({ userId, contestId, amountPaise, settledBy = "system", session }) {
  const run = async (s) => {
    const { wallet } = await applyLedger({
      session: s, userId, amount: amountPaise, type: "prize_win",
      refType: "contest", refId: contestId, note: `Prize credited (${settledBy})`,
      idempotencyKey: `prize:${contestId}:${userId}`,
    });
    return viewOf(wallet);
  };
  return session ? run(session) : lockedFor(userId, run);
}

/** Withdrawals: hold on request, then pay (hold->gone) or refund (hold->available). */
export async function holdWithdrawal({ userId, withdrawalId, amountPaise, session }) {
  const run = async (s) => {
    const { wallet } = await applyLedger({
      session: s, userId, amount: 0, heldDelta: amountPaise, type: "withdrawal_hold",
      refType: "withdrawal", refId: withdrawalId, note: "Withdrawal requested",
      idempotencyKey: `w_hold:${withdrawalId}`,
    });
    return viewOf(wallet);
  };
  return session ? run(session) : lockedFor(userId, run);
}

export async function payWithdrawal({ userId, withdrawalId, amountPaise, actorId, providerRef, session }) {
  const run = async (s) => {
    const { wallet } = await applyLedger({
      session: s, userId, amount: -amountPaise, heldDelta: -amountPaise, type: "withdrawal_paid",
      refType: "withdrawal", refId: withdrawalId,
      note: `Withdrawal paid${providerRef ? ` (${providerRef})` : ""}`,
      idempotencyKey: `w_paid:${withdrawalId}`, actorId,
    });
    return viewOf(wallet);
  };
  return session ? run(session) : lockedFor(userId, run);
}

export async function refundWithdrawal({ userId, withdrawalId, amountPaise, actorId, reason, session }) {
  const run = async (s) => {
    const { wallet } = await applyLedger({
      session: s, userId, amount: 0, heldDelta: -amountPaise, type: "withdrawal_refund",
      refType: "withdrawal", refId: withdrawalId,
      note: `Withdrawal rejected — amount returned (${reason})`,
      idempotencyKey: `w_refund:${withdrawalId}`, actorId,
    });
    return viewOf(wallet);
  };
  return session ? run(session) : lockedFor(userId, run);
}

/** Guard used by battle join: must have enough AVAILABLE (not held) money. */
export async function assertAvailable(userId, amountPaise) {
  const w = await getOrCreateWallet(userId);
  if (w.totalPaise - w.heldPaise < amountPaise) {
    throw new ForbiddenError("Insufficient balance for this stake");
  }
  return true;
}
