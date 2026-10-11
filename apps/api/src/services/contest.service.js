import { Contest, CONTEST_STATES } from "../db/models/contest.model.js";
import { User } from "../db/models/user.model.js";
import mongoose from "mongoose";
import { withTransaction } from "../db/connect.js";
import { withLock } from "../db/redis.js";
import {
  computePrize, computeReferralCommission, isTransitionAllowed, IllegalTransitionError,
  ConflictError, NotFoundError, ForbiddenError, BadRequestError, isValidStake,
  TERMINAL_STATES,
} from "@lpludo/shared";
import * as walletService from "./wallet.service.js";
import { emitContestUpdate, emitWalletUpdate } from "../realtime/io.js";
import { log } from "../config/logger.js";

const l = log("contest");

const OPEN_LIST_TTL = 3; // seconds — cache for /contests/open (fixes P2)
const OPEN_LIST_KEY = "contests:open:list:v1";
const BATTLE_OPEN_TTL_MS = 5 * 60 * 1000; // unjoined battles die in 5 min (reference)

/** Adda Ludo rule: a player may hold at most this many open (searching) battles. */
export const MAX_SEARCHING_BATTLES = 2;

/**
 * Adda Ludo rule: a player with an unsubmitted active battle cannot start
 * another one. `result_submitted` / `cancel_requested` only block while the
 * player has not filed their own report yet.
 */
async function hasActiveUnsubmittedContest(userId) {
  const active = await Contest.find({
    "players.userId": userId,
    status: {
      $in: [
        CONTEST_STATES.JOIN_REQUESTED,
        CONTEST_STATES.RUNNING,
        CONTEST_STATES.ROOM_SUBMITTED,
        CONTEST_STATES.RESULT_SUBMITTED,
        CONTEST_STATES.CANCEL_REQUESTED,
      ],
    },
  }).select("status resultReports");

  return active.some((c) => {
    if (
      c.status === CONTEST_STATES.RESULT_SUBMITTED ||
      c.status === CONTEST_STATES.CANCEL_REQUESTED
    ) {
      return !(c.resultReports || []).some((r) => String(r.userId) === String(userId));
    }
    return true;
  });
}

/**
 * Adda Ludo rule: joining a battle auto-cancels the player's other open
 * battles. An open battle holds no stake (money is only locked on accept), so
 * this only flips the status — no refund is needed.
 */
async function cancelOtherOpenBattles(userId, excludeContestId) {
  const others = await Contest.find({
    "players.userId": userId,
    status: CONTEST_STATES.OPEN,
    _id: { $ne: excludeContestId },
  }).select("_id");

  for (const other of others) {
    try {
      const out = await withLock(`contest:${other._id}`, () =>
        withTransaction(async (session) => {
          const fresh = await Contest.findOne({ _id: other._id }).session(session);
          if (!fresh || fresh.status !== CONTEST_STATES.OPEN) return null;
          fresh.transition(CONTEST_STATES.CANCELLED, {
            actor: userId,
            note: "auto-cancelled: another battle was joined",
          });
          await fresh.save({ session });
          await invalidateOpenList();
          return { contest: fresh };
        })
      );
      if (out) {
        emitContestUpdate(out.contest);
        l.info({ contestId: String(other._id), userId: String(userId) }, "open battle auto-cancelled on join");
      }
    } catch (err) {
      l.error({ contestId: String(other._id), err: err.message }, "auto-cancel of other open battle failed");
    }
  }
  return others.length;
}

/**
 * Create an open battle. The stake is only CHECKED here (read-only) — it is not
 * held. Creating a battle costs nothing; the stake is locked when the creator
 * accepts a join request (see acceptContest), which is the moment the match starts.
 */
export async function createContest({ userId, stakePaise, ip }) {
  if (!isValidStake(stakePaise)) throw new BadRequestError("Unknown amount");

  // Adda Ludo guards: one active battle at a time, max 2 open, no same amount twice
  if (await hasActiveUnsubmittedContest(userId)) {
    throw new ConflictError("You have an active battle. Submit its result before starting a new one");
  }
  const openMine = await Contest.find({ "players.userId": userId, status: CONTEST_STATES.OPEN }).select("stake");
  if (openMine.some((c) => c.stake === stakePaise)) {
    throw new ConflictError(`You already have an open battle of ₹${stakePaise / 100}. Choose a different amount`);
  }
  if (openMine.length >= MAX_SEARCHING_BATTLES) {
    throw new ConflictError("Maximum 2 open battles allowed. Cancel one first");
  }

  // balance is checked but NOT locked — the stake only moves once the creator accepts
  await walletService.assertAvailable(userId, stakePaise);

  return withTransaction(async (session) => {
    const [contest] = await Contest.create(
      [{
        stake: stakePaise,
        status: CONTEST_STATES.OPEN,
        players: [{ userId, seat: 1, joinedAt: new Date(), joinedIp: ip }],
        expiresAt: new Date(Date.now() + BATTLE_OPEN_TTL_MS),
      }],
      { session }
    );
    await invalidateOpenList();
    l.info({ contestId: String(contest._id), userId: String(userId), stakePaise }, "contest created");
    return contest;
  });
}

/* --------------------------- dummy (social proof) -------------------------- */

/** Admin-created dummy battle — shown in the lobby, never playable, never expires. */
export async function createDummyContest({ stakePaise, name, mobile }) {
  if (!isValidStake(stakePaise)) throw new BadRequestError("Unknown amount");
  const [contest] = await Contest.create([
    {
      stake: stakePaise,
      status: CONTEST_STATES.OPEN,
      isDummy: true,
      dummyName: name || "Player",
      dummyMobile: mobile || null,
      players: [{ userId: new mongoose.Types.ObjectId(), seat: 1, joinedAt: new Date() }],
      expiresAt: new Date(Date.now() + 3650 * 24 * 3600 * 1000), // dummies don't expire
    },
  ]);
  await invalidateOpenList();
  return contest;
}

export async function listDummyContests() {
  return Contest.find({ isDummy: true }).sort({ createdAt: -1 }).lean();
}

export async function deleteDummyContest(id) {
  const res = await Contest.deleteOne({ _id: id, isDummy: true });
  await invalidateOpenList();
  if (!res.deletedCount) throw new NotFoundError("Dummy battle not found");
  return true;
}

/**
 * Second player REQUESTS to join an open battle → join_requested. Only a
 * read-only balance check runs here; no money moves. The creator must accept
 * (acceptContest) before both stakes are locked and the match goes live.
 */
export async function joinContest({ userId, contestId, ip }) {
  // Adda Ludo guard: no new bets while an active battle is pending
  if (await hasActiveUnsubmittedContest(userId)) {
    throw new ConflictError("You have an active battle. Submit its result before joining a new one");
  }

  // a dummy (social-proof) battle is never playable — clicking it removes it
  const dummy = await Contest.findOne({ _id: contestId, isDummy: true }).select("_id").lean();
  if (dummy) {
    await Contest.deleteOne({ _id: dummy._id });
    await invalidateOpenList();
    throw new ConflictError("This battle is no longer available");
  }

  const contest = await withLock(`contest:${contestId}`, () =>
    withTransaction(async (session) => {
      const contest = await Contest.findOne({ _id: contestId }).session(session);
      if (!contest) throw new NotFoundError("Battle not found");
      if (contest.status !== CONTEST_STATES.OPEN) throw new ConflictError("Battle is not open to join");
      if (contest.isParticipant(userId)) throw new ConflictError("You already own this battle");

      // balance is checked but NOT locked — the stake moves only when the creator accepts
      await walletService.assertAvailable(userId, contest.stake);

      contest.players.push({ userId, seat: 2, joinedAt: new Date(), joinedIp: ip });
      contest.transition(CONTEST_STATES.JOIN_REQUESTED, { actor: userId, note: "second player seated — awaiting creator" });
      await contest.save({ session });

      await invalidateOpenList();
      l.info({ contestId: String(contestId), userId: String(userId), stake: contest.stake }, "contest join requested");
      return contest;
    })
  );

  // Adda Ludo rule: joining cancels the creator's and the joiner's other open
  // battles (open battles hold no stake, so nothing is refunded).
  const creatorId = contest.players.find((p) => p.seat === 1)?.userId;
  if (creatorId) await cancelOtherOpenBattles(creatorId, contestId);
  await cancelOtherOpenBattles(userId, contestId);

  return contest;
}

/**
 * Creator accepts a join request → THE MATCH STARTS: both players' entry fees
 * are locked (held, not spent) and the battle goes `running`. This is the only
 * place a battle's stakes are locked; open / join_requested battles hold nothing.
 */
export async function acceptContest({ userId, contestId }) {
  const pre = await Contest.findOne({ _id: contestId }).lean();
  if (!pre) throw new NotFoundError("Battle not found");
  if (!pre.players.some((p) => String(p.userId) === String(userId))) {
    throw new ForbiddenError("Not your battle");
  }
  const creator = pre.players.find((p) => p.seat === 1);
  const opponent = pre.players.find((p) => p.seat === 2);
  if (!creator || String(creator.userId) !== String(userId)) {
    throw new ForbiddenError("Only the creator can start this battle");
  }
  if (!opponent) throw new ConflictError("No opponent has joined yet");

  return withLock(`contest:${contestId}`, () =>
    withLock(`wallet:${creator.userId}`, () =>
      withLock(`wallet:${opponent.userId}`, () =>
        withTransaction(async (session) => {
          const contest = await Contest.findOne({ _id: contestId }).session(session);
          if (!contest) throw new NotFoundError("Battle not found");
          if (contest.status === CONTEST_STATES.RUNNING && contest.entryLocked) return contest; // idempotent replay
          if (contest.status !== CONTEST_STATES.JOIN_REQUESTED) {
            throw new ConflictError("This battle is not waiting for an accept");
          }

          await walletService.assertAvailable(creator.userId, contest.stake);
          try {
            await walletService.assertAvailable(opponent.userId, contest.stake);
          } catch {
            throw new ForbiddenError("Your opponent no longer has enough balance for this battle");
          }

          await walletService.holdEntryFee({ userId: creator.userId, contestId, amountPaise: contest.stake, session });
          await walletService.holdEntryFee({ userId: opponent.userId, contestId, amountPaise: contest.stake, session });

          contest.set("entryLocked", true);
          contest.set("timerStartedAt", new Date());
          contest.transition(CONTEST_STATES.RUNNING, { actor: userId, note: "creator accepted — battle live" });
          await contest.save({ session });

          await invalidateOpenList();
          l.info(
            { contestId: String(contestId), creator: String(creator.userId), opponent: String(opponent.userId), stake: contest.stake },
            "battle accepted — stakes locked"
          );
          return contest;
        })
      )
    )
  );
}

/**
 * Share the Ludo King room code. Only the two participants may ever see it,
 * and it is stripped from list responses (fixes S2/S3 leakage).
 */
export async function submitRoomCode({ userId, contestId, roomCode }) {
  return withLock(`contest:${contestId}`, () =>
    withTransaction(async (session) => {
      const contest = await Contest.findOne({ _id: contestId }).session(session);
      if (!contest) throw new NotFoundError("Battle not found");
      // reference rule: only the creator shares the room code
      const creator = contest.players.find((p) => p.seat === 1);
      if (!creator || String(creator.userId) !== String(userId)) {
        throw new ForbiddenError("Only the creator can submit the room code");
      }
      if (![CONTEST_STATES.RUNNING, CONTEST_STATES.ROOM_SUBMITTED].includes(contest.status)) {
        throw new ConflictError("Battle is not running");
      }

      contest.set("roomCode", roomCode.trim());
      contest.set("roomCodeUp", roomCode.trim().toUpperCase());
      contest.set("roomSubmittedBy", userId);
      contest.set("roomSubmittedAt", new Date());
      if (contest.status === CONTEST_STATES.RUNNING) {
        contest.transition(CONTEST_STATES.ROOM_SUBMITTED, { actor: userId, note: "room code shared" });
      }
      await contest.save({ session });
      return true;
    })
  );
}

/** All ledger rows for this contest (admin dispute screen / debugging). */
export async function contestLedger(contestId) {
  const { LedgerEntry } = await import("../db/models/ledgerEntry.model.js");
  return LedgerEntry.find({ refType: "contest", refId: contestId }).sort({ createdAt: 1 }).lean();
}

/** Participant submits the result; an admin/system settle follows. */
export async function submitResult({ userId, contestId, outcome, screenshotKeys = [] }) {
  return withLock(`contest:${contestId}`, () =>
    withTransaction(async (session) => {
      const contest = await Contest.findOne({ _id: contestId }).session(session);
      if (!contest) throw new NotFoundError("Battle not found");
      if (!contest.isParticipant(userId)) throw new ForbiddenError("Not your battle");

      const allowed = [CONTEST_STATES.RUNNING, CONTEST_STATES.ROOM_SUBMITTED, CONTEST_STATES.RESULT_SUBMITTED, CONTEST_STATES.CANCEL_REQUESTED];
      if (!allowed.includes(contest.status)) {
        throw new ConflictError(`Cannot submit a result from status "${contest.status}"`);
      }

      // a player may only report once (reference rule)
      contest.resultReports = contest.resultReports || [];
      if (contest.resultReports.some((r) => String(r.userId) === String(userId))) {
        throw new ConflictError("You have already submitted a result for this battle");
      }

      if (outcome === "cancel") {
        const otherCancelled = contest.resultReports.some(
          (r) => String(r.userId) !== String(userId) && r.outcome === "cancel"
        );
        if (otherCancelled) {
          // both players agree to cancel -> refund both immediately (reference)
          const result = await refundAllContest({ contestId, settledBy: "players", session });
          return result.contest;
        }
        contest.conflict = {
          active: true,
          raisedBy: userId,
          reason: "player requested cancel",
          autoRefundAt: new Date(Date.now() + conflictRefundHours() * 3600_000),
        };
        contest.markModified("conflict");
        if (contest.status !== CONTEST_STATES.CANCEL_REQUESTED) {
          contest.transition(CONTEST_STATES.CANCEL_REQUESTED, { actor: userId, note: "cancel requested" });
        }
      } else {
        if (contest.status !== CONTEST_STATES.RESULT_SUBMITTED) {
          contest.transition(CONTEST_STATES.RESULT_SUBMITTED, { actor: userId, note: "result submitted" });
        }
        contest.set("winnerUserId", outcome === "won" ? userId : null);
      }

      // keep each player's own claim + proof screenshots (never trust a single side's word alone)
      contest.resultReports.push({
        userId,
        outcome,
        reportedAt: new Date(),
        screenshots: (screenshotKeys || []).map((key) => ({
          key,
          uploadedBy: userId,
          uploadedAt: new Date(),
        })),
      });
      await contest.save({ session });
      return contest;
    })
  );
}

/**
 * THE settlement primitive — payout or refund, always transactional + idempotent.
 * Order (fixes C4): money moves FIRST, status flips to APPROVED last.
 */
export async function settleContest({ contestId, winnerUserId, settledBy, session }) {
  const contest = await Contest.findOne({ _id: contestId }).session(session);
  if (!contest) throw new NotFoundError("Battle not found");
  if (contest.settlement?.settledAt) return { contest, alreadySettled: true };

  const winner = contest.players.find((p) => p.userId.toString() === winnerUserId.toString());
  if (!winner) throw new BadRequestError("Winner is not a participant of this battle");
  const loser = contest.players.find((p) => p.userId.toString() !== winnerUserId.toString());
  if (!loser) throw new BadRequestError("Battle needs both players present before settling");

  const b = computePrize(contest.stake);
  // Both stakes are CONSUMED (the reference removes both from playable at lock and
  // never returns them). The winner is then paid the GROSS prize into `winnings`,
  // so the winner nets `prize - stake` and the house keeps the commission. (Fixes
  // the rebuild's overpay where the winner's stake was released *and* the full
  // prize credited — which minted money.)
  await walletService.consumeEntryFee({ userId: winner.userId, contestId, amountPaise: contest.stake, session });
  const loserWallet = await walletService.consumeEntryFee({ userId: loser.userId, contestId, amountPaise: contest.stake, session });
  const wallet = await walletService.creditPrize({
    userId: winner.userId, contestId, amountPaise: b.prizePaise, settledBy, session,
  });

  // lifetime referral commission: 2% of the winner's stake to their referrer
  // (same transaction + idempotency key, so a retried settle pays it exactly once)
  const winnerDoc = await User.findById(winner.userId).select("referral.referredBy").session(session);
  const referrerId = winnerDoc?.referral?.referredBy || null;
  let referrerWallet = null;
  if (referrerId) {
    const commissionPaise = computeReferralCommission(contest.stake);
    if (commissionPaise > 0) {
      referrerWallet = await walletService.creditReferralCommission({
        referrerId, referredUserId: winner.userId, contestId: contest._id,
        amountPaise: commissionPaise, session,
      });
    }
  }

  contest.settlement = {
    prizePaise: b.prizePaise,
    commissionPaise: b.commissionPaise,
    settledAt: new Date(),
    settledBy,
  };
  contest.set("winnerUserId", winner.userId);
  contest.transition(CONTEST_STATES.APPROVED, { actor: settledBy, note: "settled" });
  await contest.save({ session });

  l.info(
    { contestId: String(contestId), winner: String(winner.userId), prizePaise: b.prizePaise, settledBy },
    "contest settled"
  );
  return { contest, wallet, loserWallet, referrerId, referrerWallet };
}

/** Admin/system verdict on a submitted result. */
export async function decideContest({ contestId, winnerUserId, settledBy = "admin" }) {
  const result = await withLock(`contest:${contestId}`, () =>
    withTransaction(async (session) => settleContest({ contestId, winnerUserId, settledBy, session }))
  );
  if (result) {
    emitContestUpdate(result.contest);
    if (result.wallet) emitWalletUpdate(winnerUserId, result.wallet);
    if (result.loserWallet) {
      const loserId = result.contest.players.find((p) => p.userId.toString() !== winnerUserId.toString())?.userId;
      if (loserId) emitWalletUpdate(loserId, result.loserWallet);
    }
    // the winner's referrer earned a commission in the same transaction
    if (result.referrerId && result.referrerWallet) emitWalletUpdate(result.referrerId, result.referrerWallet);
  }
  return result;
}

/** Cancel an open/unmatched battle (or decline a join request). Nothing is held
 *  before `running`, so cancelling moves no money. */
export async function cancelContest({ userId, contestId }) {
  return withLock(`contest:${contestId}`, () =>
    withTransaction(async (session) => {
      const contest = await Contest.findOne({ _id: contestId }).session(session);
      if (!contest) throw new NotFoundError("Battle not found");
      if (!contest.isParticipant(userId)) throw new ForbiddenError("Not your battle");

      // join_requested: the OPPONENT withdraws (battle returns to `open`);
      // the CREATOR declining is handled by rejectJoinRequest.
      if (contest.status === CONTEST_STATES.JOIN_REQUESTED) {
        const creator = contest.players.find((p) => p.seat === 1);
        if (creator && String(creator.userId) !== String(userId)) {
          contest.players = contest.players.filter((p) => p.seat === 1);
          contest.markModified("players");
          contest.set("expiresAt", new Date(Date.now() + BATTLE_OPEN_TTL_MS));
          contest.transition(CONTEST_STATES.OPEN, { actor: userId, note: "join request withdrawn" });
          await contest.save({ session });
          await invalidateOpenList();
          return contest;
        }
      }

      if (!isTransitionAllowed(contest.status, CONTEST_STATES.CANCELLED)) {
        throw new ConflictError(`A battle in "${contest.status}" cannot be cancelled`);
      }
      contest.transition(CONTEST_STATES.CANCELLED, { actor: userId, note: "cancelled by player" });
      await contest.save({ session });
      await invalidateOpenList();
      return contest;
    })
  );
}

/** Creator declines a join request — drop the opponent, battle returns to `open`. */
export async function rejectJoinRequest({ userId, contestId }) {
  return withLock(`contest:${contestId}`, () =>
    withTransaction(async (session) => {
      const contest = await Contest.findOne({ _id: contestId }).session(session);
      if (!contest) throw new NotFoundError("Battle not found");
      const creator = contest.players.find((p) => p.seat === 1);
      if (!creator || String(creator.userId) !== String(userId)) {
        throw new ForbiddenError("Only the creator can decline a join request");
      }
      if (contest.status !== CONTEST_STATES.JOIN_REQUESTED) {
        throw new ConflictError("There is no join request to decline");
      }
      contest.players = contest.players.filter((p) => p.seat === 1);
      contest.markModified("players");
      contest.set("expiresAt", new Date(Date.now() + BATTLE_OPEN_TTL_MS));
      contest.transition(CONTEST_STATES.OPEN, { actor: userId, note: "join request declined" });
      await contest.save({ session });
      await invalidateOpenList();
      return contest;
    })
  );
}

/** Refund every participant from a cancelled/failed battle (admin + SLA path). */
export async function refundAllContest({ contestId, settledBy = "system", session }) {
  const contest = await Contest.findOne({ _id: contestId }).session(session);
  if (!contest) throw new NotFoundError("Battle not found");
  if (contest.settlement?.settledAt) return { contest, alreadySettled: true };

  const walletViews = {};
  // only a battle that reached `running` has locked stakes to give back
  if (contest.entryLocked) {
    for (const p of contest.players) {
      const view = await walletService.refundEntryFee({
        userId: p.userId, contestId, amountPaise: contest.stake,
        note: "Battle cancelled — amount refunded", session,
      });
      walletViews[String(p.userId)] = view;
    }
  }
  contest.settlement = { settledAt: new Date(), settledBy };
  contest.transition(CONTEST_STATES.CANCELLED, { actor: settledBy, note: "refunded all players" });
  await contest.save({ session });
  return { contest, walletViews };
}

/** Auto-refund stale conflicts (SLA sweep — fixes C8-style stuck money). */
export async function expireStaleConflicts() {
  const stale = await Contest.find({
    "conflict.active": true,
    "conflict.autoRefundAt": { $lte: new Date() },
  }).limit(50);

  let refunded = 0;
  for (const c of stale) {
    try {
      const out = await withLock(`contest:${c._id}`, () =>
        withTransaction(async (session) => {
          const fresh = await Contest.findOne({ _id: c._id }).session(session);
          if (!fresh || fresh.settlement?.settledAt || !fresh.conflict?.active) return null;
          const result = await refundAllContest({ contestId: fresh._id, settledBy: "sla", session });
          result.contest.set("conflict.active", false);
          await result.contest.save({ session });
          return result;
        })
      );
      if (out && !out.alreadySettled) {
        emitContestUpdate(out.contest);
        for (const p of out.contest.players) {
          const view = out.walletViews?.[String(p.userId)];
          if (view) emitWalletUpdate(p.userId, view);
        }
      }
      refunded += 1;
    } catch (err) {
      l.error({ contestId: String(c._id), err: err.message }, "SLA auto-refund failed");
    }
  }
  if (stale.length) l.info({ scanned: stale.length, refunded }, "SLA conflict sweep done");
  return refunded;
}

/** Force-expire an open battle from the admin panel. Nothing was held → no money moves. */
export async function expireContestById(contestId, actor = "admin") {
  return withLock(`contest:${contestId}`, () =>
    withTransaction(async (session) => {
      const contest = await Contest.findOne({ _id: contestId }).session(session);
      if (!contest) throw new NotFoundError("Battle not found");
      if (contest.status !== CONTEST_STATES.OPEN) {
        throw new ConflictError(`Only open battles can be expired (this one is "${contest.status}")`);
      }
      contest.transition(CONTEST_STATES.EXPIRED, { actor, note: "force-expired" });
      await contest.save({ session });
      await invalidateOpenList();
      return { contest, creatorId: contest.players[0].userId };
    })
  );
}

/** Refund all players of a running/cancel-requested battle (admin dispute path). */
export async function refundContestById(contestId, actor = "admin") {
  const out = await withLock(`contest:${contestId}`, () =>
    withTransaction(async (session) => {
      const fresh = await Contest.findOne({ _id: contestId }).session(session);
      if (!fresh) throw new NotFoundError("Battle not found");
      if (fresh.settlement?.settledAt) throw new ConflictError("Battle is already settled");
      if (TERMINAL_STATES.includes(fresh.status)) throw new ConflictError(`Battle is already ${fresh.status}`);
      const result = await refundAllContest({ contestId, settledBy: actor, session });
      result.contest.set("conflict.active", false);
      await result.contest.save({ session });
      return result;
    })
  );
  if (out && !out.alreadySettled) {
    emitContestUpdate(out.contest);
    for (const p of out.contest.players) {
      const view = out.walletViews?.[String(p.userId)];
      if (view) emitWalletUpdate(p.userId, view);
    }
  }
  return out;
}

/**
 * Expire open battles whose TTL elapsed without an opponent joining.
 * Open battles hold no stake, so this only flips the status. Also releases a
 * stale join_requested battle back to `open` (nothing was locked, and the
 * creator never accepted) so the joiner is not blocked forever.
 */
export async function expireStaleOpenContests() {
  const stale = await Contest.find({ status: CONTEST_STATES.OPEN, isDummy: { $ne: true }, expiresAt: { $lte: new Date() } })
    .limit(100)
    .select("_id")
    .lean();

  let expired = 0;
  for (const c of stale) {
    try {
      const result = await withLock(`contest:${c._id}`, () =>
        withTransaction(async (session) => {
          const fresh = await Contest.findOne({ _id: c._id }).session(session);
          if (!fresh || fresh.status !== CONTEST_STATES.OPEN) return null;
          fresh.transition(CONTEST_STATES.EXPIRED, { actor: "system", note: "expired: no opponent joined" });
          await fresh.save({ session });
          await invalidateOpenList();
          return { contest: fresh };
        })
      );
      if (result) emitContestUpdate(result.contest);
      expired += 1;
    } catch (err) {
      l.error({ contestId: String(c._id), err: err.message }, "open-battle expiry failed");
    }
  }
  if (stale.length) l.info({ scanned: stale.length, expired }, "open-battle expiry sweep done");

  // join requests the creator never accepted → back to `open` (drop seat 2)
  const staleRequests = await Contest.find({ status: CONTEST_STATES.JOIN_REQUESTED, expiresAt: { $lte: new Date() } })
    .limit(100)
    .select("_id")
    .lean();

  let reverted = 0;
  for (const c of staleRequests) {
    try {
      const result = await withLock(`contest:${c._id}`, () =>
        withTransaction(async (session) => {
          const fresh = await Contest.findOne({ _id: c._id }).session(session);
          if (!fresh || fresh.status !== CONTEST_STATES.JOIN_REQUESTED) return null;
          fresh.players = fresh.players.filter((p) => p.seat === 1);
          fresh.markModified("players");
          fresh.set("expiresAt", new Date(Date.now() + BATTLE_OPEN_TTL_MS));
          fresh.transition(CONTEST_STATES.OPEN, { actor: "system", note: "join request timed out" });
          await fresh.save({ session });
          await invalidateOpenList();
          return { contest: fresh };
        })
      );
      if (result) emitContestUpdate(result.contest);
      reverted += 1;
    } catch (err) {
      l.error({ contestId: String(c._id), err: err.message }, "join-request timeout failed");
    }
  }
  if (staleRequests.length) l.info({ scanned: staleRequests.length, reverted }, "join-request timeout sweep done");

  return expired + reverted;
}

/**
 * List currently-open contests for the lobby.
 * Read path is cached (fixes P2 — bounded, no writes on hot refresh): the full
 * open set is cached for OPEN_LIST_TTL seconds and invalidated on every write.
 * Cached entries are hydrated back into Mongoose documents so contestDto()
 * instance methods (isParticipant) keep working on cache hits.
 * @param {{ page: number, limit: number }} opts
 * @returns {Promise<{ items: mongoose.Document[], total: number }>}
 */
export async function listOpenContests({ page, limit }) {
  const cached = await readOpenListCache();

  let items, total;
  if (cached) {
    total = cached.total;
    const skip = (page - 1) * limit;
    const pageDocs = cached.items.slice(skip, skip + limit);
    items = pageDocs.map((doc) => Contest.hydrate(doc));
  } else {
    const filter = { status: CONTEST_STATES.OPEN, expiresAt: { $gt: new Date() } };
    total = await Contest.countDocuments(filter);
    const all = await Contest.find(filter).sort({ createdAt: -1 }).lean();
    if (all.length) await writeOpenListCache(all, total);
    const skip = (page - 1) * limit;
    const pageDocs = all.slice(skip, skip + limit);
    items = pageDocs.map((doc) => Contest.hydrate(doc));
  }

  return { items, total };
}

/**
 * List contests the given user participates in (any status), newest first.
 * @param {string} userId
 * @param {{ page: number, limit: number }} opts
 * @returns {Promise<{ items: mongoose.Document[], total: number }>}
 */
export async function listMyContests(userId, { page, limit }) {
  const filter = { "players.userId": userId };
  const [items, total] = await Promise.all([
    Contest.find(filter).sort({ createdAt: -1 }).select("+roomCode").populate("players.userId", "name")
      .skip((page - 1) * limit).limit(limit),
    Contest.countDocuments(filter),
  ]);
  return { items, total };
}

/** Cache helpers for the open list (fixes P2 — bounded, cached, no writes in the read path). */

/** Invalidate the open list cache — called on every write that affects open battles. */
export async function invalidateOpenList() {
  const { redis } = await import("../db/redis.js");
  await redis.del(OPEN_LIST_KEY);
}

async function readOpenListCache() {
  try {
    const { redis } = await import("../db/redis.js");
    const raw = await redis.get(OPEN_LIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { total: parsed.total, items: parsed.items };
  } catch {
    return null;
  }
}

async function writeOpenListCache(items, total) {
  try {
    const { redis } = await import("../db/redis.js");
    await redis.set(OPEN_LIST_KEY, JSON.stringify({ total, items }), "EX", OPEN_LIST_TTL);
  } catch {
    // cache write failure is non-fatal — the DB result still gets returned to the caller
  }
}

function conflictRefundHours() {
  return Number(process.env.CONFLICT_REFUND_HOURS || 12);
}

export { OPEN_LIST_KEY, OPEN_LIST_TTL };
