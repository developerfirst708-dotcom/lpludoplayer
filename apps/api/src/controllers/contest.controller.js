import * as contestService from "../services/contest.service.js";
import { walletView } from "../services/wallet.service.js";
import { Contest, CONTEST_STATES } from "../db/models/contest.model.js";
import { User } from "../db/models/user.model.js";
import { createContestSchema, submitRoomSchema, submitResultSchema } from "@lpludo/shared/schemas";
import { NotFoundError, ForbiddenError, ConflictError, BadRequestError } from "@lpludo/shared";
import { validate } from "@lpludo/shared/schemas";
import { emitContestUpdate, emitWalletUpdate } from "../realtime/io.js";
import { log } from "../config/logger.js";

const l = log("contest.controller");

/**
 * The public DTO: room code + phone numbers never leave this function's
 * participant gate (fixes S2/S3). Prize is included so the client never
 * computes money itself (F13).
 */
function contestDto(contest, { userId, includeRoomCode = false } = {}) {
  const isParticipant = userId && contest.isParticipant(userId);
  return {
    id: contest._id,
    stake: contest.stake,
    status: contest.status,
    createdAt: contest.createdAt,
    expiresAt: contest.expiresAt || null,
    winnerUserId: contest.winnerUserId || null,
    players: contest.players.map((p) => ({
      seat: p.seat,
      userId: p.userId?._id || p.userId,
      name: p.userId?.name || null,
      isYou: Boolean(userId && String(p.userId._id || p.userId) === String(userId)),
    })),
    prize: contest.stake * 2 - Math.floor((contest.stake * 2 * 500) / 10000), // winner's credit
    conflict: contest.conflict?.active ? { raisedBy: contest.conflict.raisedBy } : null,
    roomCode: includeRoomCode && isParticipant ? contest.roomCode || null : null, // only the 2 players
    // both players' result claims + proof screenshot keys — participants only
    resultReports: isParticipant
      ? (contest.resultReports || []).map((r) => ({
          userId: r.userId,
          outcome: r.outcome,
          reportedAt: r.reportedAt,
          screenshots: (r.screenshots || []).map((s) => s.key),
        }))
      : [],
  };
}

/** GET /contests/open */
export async function listOpen(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
  const { items, total } = await contestService.listOpenContests({ page, limit });
  res.json({ items: items.map((c) => contestDto(c, { userId: req.user.id })), total, page, limit });
}

/** GET /contests/mine */
export async function listMine(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const { items, total } = await contestService.listMyContests(req.user.id, { page, limit });
  const dtos = [];
  for (const c of items) {
    const isParticipant = c.isParticipant(req.user.id);
    dtos.push(contestDto(c, { userId: req.user.id, includeRoomCode: isParticipant }));
  }
  res.json({ items: dtos, total, page, limit });
}

/** POST /contests { stake } — creator's stake is HELD, not spent */
export async function create(req, res) {
  const { stake } = validate(createContestSchema, req.body);
  const contest = await contestService.createContest({
    userId: req.user.id, stakePaise: stake, ip: req.ip,
  });
  const fresh = await Contest.findById(contest._id).select("+roomCode").populate("players.userId", "name");
  emitContestUpdate(fresh || contest);
  emitWalletUpdate(req.user.id, await walletView(req.user.id));
  res.status(201).json({ contest: contestDto(fresh || contest, { userId: req.user.id, includeRoomCode: true }) });
}

/** POST /contests/:id/join */
export async function join(req, res) {
  const contest = await contestService.joinContest({ userId: req.user.id, contestId: req.params.id, ip: req.ip });
  const fresh = await Contest.findById(contest._id).select("+roomCode").populate("players.userId", "name"); // re-read with room code + player names
  emitContestUpdate(fresh || contest);
  emitWalletUpdate(req.user.id, await walletView(req.user.id));
  res.json({ contest: contestDto(fresh || contest, { userId: req.user.id, includeRoomCode: true }) });
}

/** POST /contests/:id/room { roomCode } */
export async function submitRoom(req, res) {
  const { roomCode } = validate(submitRoomSchema, { ...req.body, contestId: req.params.id });
  const ok = await contestService.submitRoomCode({ userId: req.user.id, contestId: req.params.id, roomCode });
  const fresh = await Contest.findById(req.params.id).select("+roomCode").populate("players.userId", "name");
  if (fresh) emitContestUpdate(fresh);
  res.json({ ok, roomCode });
}

/**
 * POST /contests/:id/result { outcome: won|lost|cancel }
 * Auto-settles when both players reported the same winner (open question #1: yes).
 */
export async function submitResult(req, res) {
  const { outcome, screenshotKeys } = validate(submitResultSchema, { ...req.body, contestId: req.params.id });

  // proof-of-result: a win claim MUST carry a screenshot, and every key must be
  // one of the caller's own uploads (same ownership rule as KYC docs)
  if (outcome === "won" && screenshotKeys.length === 0) {
    throw new BadRequestError("A winning screenshot is required");
  }
  for (const key of screenshotKeys) {
    if (!key.startsWith(`${req.user.id}/battle/`)) {
      throw new BadRequestError("Screenshots must be uploaded by your own account");
    }
  }

  const contest = await contestService.submitResult({
    userId: req.user.id, contestId: req.params.id, outcome, screenshotKeys,
  });

  let settled = null;
  if (contest.status === CONTEST_STATES.RESULT_SUBMITTED) {
    const reports = contest.resultReports || [];
    if (reports.length === 2) {
      // each report implies a winner: "won" -> the reporter, "lost" -> the other player
      const seats = contest.players.map((p) => String(p.userId));
      const implied = reports.map((r) =>
        r.outcome === "won" ? String(r.userId) : seats.find((id) => id !== String(r.userId))
      );
      if (implied[0] && implied[0] === implied[1]) {
        settled = await contestService.decideContest({ contestId: contest._id, winnerUserId: implied[0], settledBy: "system" });
      }
    }
  }

  const fresh = await Contest.findById(contest._id).select("+roomCode").populate("players.userId", "name");
  emitContestUpdate(fresh || contest);
  const out = { contest: contestDto(fresh || contest, { userId: req.user.id, includeRoomCode: true }) };
  if (settled) out.settled = true;
  res.json(out);
}

/** GET /contests/:id — full detail for one contest */
export async function getContest(req, res) {
  const contest = await Contest.findById(req.params.id).select("+roomCode").populate("players.userId", "name");
  if (!contest) throw new NotFoundError("Battle not found");
  res.json({ contest: contestDto(contest, { userId: req.user.id, includeRoomCode: true }) });
}

/** POST /contests/:id/cancel */
export async function cancel(req, res) {
  const contest = await contestService.cancelContest({ userId: req.user.id, contestId: req.params.id });
  const fresh = await Contest.findById(contest._id).select("+roomCode").populate("players.userId", "name");
  emitContestUpdate(fresh || contest);
  emitWalletUpdate(req.user.id, await walletView(req.user.id));
  res.json({ contest: contestDto(fresh || contest, { userId: req.user.id }) });
}