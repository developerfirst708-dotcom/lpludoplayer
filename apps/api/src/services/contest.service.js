import { Contest, CONTEST_STATES } from "../db/models/contest.model.js";
import { withTransaction } from "../db/connect.js";
import { withLock } from "../db/redis.js";
import {
  computePrize, isTransitionAllowed, IllegalTransitionError,
  ConflictError, NotFoundError, ForbiddenError, BadRequestError, isValidStake,
  TERMINAL_STATES,
} from "@lpludo/shared";
import * as walletService from "./wallet.service.js";
import { emitContestUpdate, emitWalletUpdate } from "../realtime/io.js";
import { log } from "../config/logger.js";

const l = log("contest");

const OPEN_LIST_TTL = 3; // seconds — cache for /contests/open (fixes P2)
const OPEN_LIST_KEY = "contests:open:list:v1";
const BATTLE_OPEN_TTL_MS = 10 * 60 * 1000; // unjoined battles die in 10 min

/**
 * Create an open battle. The creator's stake is HELD (not spent) so an
 * unmatched/cancelled battle refunds it — semantics the reference app got wrong.
 */
export async function createContest({ userId, stakePaise, ip }) {
  if (!isValidStake(stakePaise)) throw new BadRequestError("Unknown stake amount");
  await walletService.assertAvailable(userId, stakePaise);

  return withLock(`wallet:${userId}`, () =>
    withTransaction(async (session) => {
      const [contest] = await Contest.create(
        [{
          stake: stakePaise,
          status: CONTEST_STATES.OPEN,
          players: [{ userId, seat: 1, joinedAt: new Date(), joinedIp: ip }],
          expiresAt: new Date(Date.now() + BATTLE_OPEN_TTL_MS),
        }],
        { session }
      );
      await walletService.holdEntryFee({ userId, contestId: contest._id, amountPaise: stakePaise, session });
      await invalidateOpenList();
      l.info({ contestId: String(contest._id), userId: String(userId), stakePaise }, "contest created");
      return contest;
    })
  );
}

/** Second player joins an open battle → running. Both holds exist before play. */
export async function joinContest({ userId, contestId, ip }) {
  return withLock(`contest:${contestId}`, () =>
    withLock(`wallet:${userId}`, () =>
      withTransaction(async (session) => {
        const contest = await Contest.findOne({ _id: contestId }).session(session);
        if (!contest) throw new NotFoundError("Battle not found");
        if (contest.status !== CONTEST_STATES.OPEN) throw new ConflictError("Battle is not open to join");
        if (contest.isParticipant(userId)) throw new ConflictError("You already own this battle");

        await walletService.assertAvailable(userId, contest.stake);
        await walletService.holdEntryFee({ userId, contestId, amountPaise: contest.stake, session });

        contest.players.push({ userId, seat: 2, joinedAt: new Date(), joinedIp: ip });
        contest.transition(CONTEST_STATES.JOIN_REQUESTED, { actor: userId, note: "second player seated" });
        contest.transition(CONTEST_STATES.RUNNING, { actor: userId, note: "battle live" });
        await contest.save({ session });

        await invalidateOpenList();
        l.info({ contestId: String(contestId), userId: String(userId), stake: contest.stake }, "contest joined");
        return contest;
      })
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
      if (!contest.isParticipant(userId)) throw new ForbiddenError("Not your battle");
      if (contest.status !== CONTEST_STATES.RUNNING) throw new ConflictError("Battle is not running");

      contest.set("roomCode", roomCode.trim());
      contest.set("roomCodeUp", roomCode.trim().toUpperCase());
      contest.set("roomSubmittedBy", userId);
      contest.set("roomSubmittedAt", new Date());
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

      const allowed = [CONTEST_STATES.RUNNING, CONTEST_STATES.ROOM_SUBMITTED, CONTEST_STATES.RESULT_SUBMITTED];
      if (!allowed.includes(contest.status)) {
        throw new ConflictError(`Cannot submit a result from status "${contest.status}"`);
      }

      if (outcome === "cancel") {
        contest.conflict = {
          active: true,
          raisedBy: userId,
          reason: "player requested cancel",
          autoRefundAt: new Date(Date.now() + conflictRefundHours() * 3600_000),
        };
        contest.markModified("conflict");
        contest.transition(CONTEST_STATES.CANCEL_REQUESTED, { actor: userId, note: "cancel requested" });
      } else {
        if (contest.status !== CONTEST_STATES.RESULT_SUBMITTED) {
          contest.transition(CONTEST_STATES.RESULT_SUBMITTED, { actor: userId, note: "result submitted" });
        }
        contest.set("winnerUserId", outcome === "won" ? userId : null);
      }

      // keep each player's own claim + proof screenshots (never trust a single side's word alone)
      contest.resultReports = contest.resultReports || [];
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
  await walletService.releaseEntryFee({ userId: winner.userId, contestId, amountPaise: contest.stake, session });
  const loserWallet = await walletService.consumeEntryFee({ userId: loser.userId, contestId, amountPaise: contest.stake, session });
  const wallet = await walletService.creditPrize({
    userId: winner.userId, contestId, amountPaise: b.prizePaise, settledBy, session,
  });

  contest.settlement = {
    prizePaise: b.prizePaise,
    commissionPaise: b.commissionPaise,
    settledAt: new Date(),
    settledBy,
  };
  contest.set("winnerUserId", winner.userId);
  contest.transition(CONTEST_STATES.APPROVED, { actor: settledBy, note: "settled" });
  await contest.save({ session });

  l.info({ contestId: String(contestId), winner: String(winner.userId), prizePaise: b.prizePaise, settledBy }, "contest settled");
  return { contest, wallet, loserWallet };
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
  }
  return result;
}

/** Cancel an open/unmatched battle — creator's hold is refunded. */
export async function cancelContest({ userId, contestId }) {
  return withLock(`contest:${contestId}`, () =>
    withTransaction(async (session) => {
      const contest = await Contest.findOne({ _id: contestId }).session(session);
      if (!contest) throw new NotFoundError("Battle not found");
      if (!contest.isParticipant(userId)) throw new ForbiddenError("Not your battle");
      if (!isTransitionAllowed(contest.status, CONTEST_STATES.CANCELLED)) {
        throw new ConflictError(`A battle in "${contest.status}" cannot be cancelled`);
      }
      contest.transition(CONTEST_STATES.CANCELLED, { actor: userId, note: "cancelled by player" });
      await contest.save({ session });
      await walletService.refundEntryFee({
        userId, contestId, amountPaise: contest.stake, note: "You cancelled the battle", session,
      });
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
  for (const p of contest.players) {
    const view = await walletService.refundEntryFee({
      userId: p.userId, contestId, amountPaise: contest.stake,
      note: "Battle cancelled — stake refunded", session,
    });
    walletViews[String(p.userId)] = view;
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

/** Force-expire an open battle from the admin panel. */
export async function expireContestById(contestId, actor = "admin") {
  return withLock(`contest:${contestId}`, () =>
    withTransaction(async (session) => {
      const contest = await Contest.findOne({ _id: contestId }).session(session);
      if (!contest) throw new NotFoundError("Battle not found");
      if (contest.status !== CONTEST_STATES.OPEN) {
        throw new ConflictError(`Only open battles can be expired (this one is "${contest.status}")`);
      }
      contest.transition(CONTEST_STATES.EXPIRED, { actor, note: "force-expired" });
      contest.set("entryHoldReleased", true);
      await contest.save({ session });
      const walletView = await walletService.refundEntryFee({
        userId: contest.players[0].userId, contestId, amountPaise: contest.stake,
        note: "Battle expired — stake refunded", session,
      });
      await invalidateOpenList();
      return { contest, walletView, creatorId: contest.players[0].userId };
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
 * Runs from the `contest.expire` sweep — refunds the creator's hold FIRST,
 * then flips the status (the reference app's TTL delete could strand the money).
 */
export async function expireStaleOpenContests() {
  const stale = await Contest.find({ status: CONTEST_STATES.OPEN, expiresAt: { $lte: new Date() } })
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
          fresh.set("entryHoldReleased", true);
          await fresh.save({ session });
          const walletView = await walletService.refundEntryFee({
            userId: fresh.players[0].userId, contestId: fresh._id, amountPaise: fresh.stake,
            note: "Battle expired — stake refunded", session,
          });
          await invalidateOpenList();
          return { contest: fresh, walletView, creatorId: fresh.players[0].userId };
        })
      );
      if (result) {
        emitContestUpdate(result.contest);
        emitWalletUpdate(result.creatorId, result.walletView);
      }
      expired += 1;
    } catch (err) {
      l.error({ contestId: String(c._id), err: err.message }, "open-battle expiry failed");
    }
  }
  if (stale.length) l.info({ scanned: stale.length, expired }, "open-battle expiry sweep done");
  return expired;
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
