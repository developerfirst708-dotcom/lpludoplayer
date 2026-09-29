import jwt from "jsonwebtoken";
import { User } from "../db/models/user.model.js";
import { Wallet } from "../db/models/wallet.model.js";
import { Contest } from "../db/models/contest.model.js";
import { DepositRequest } from "../db/models/depositRequest.model.js";
import { WithdrawalRequest } from "../db/models/withdrawalRequest.model.js";
import { LedgerEntry } from "../db/models/ledgerEntry.model.js";
import { AuditLog } from "../db/models/auditLog.model.js";
import { getSettings } from "../db/models/settings.model.js";
import { adminLoginSchema, adminSettleSchema, adminReviewSchema } from "@lpludo/shared/schemas";
import {
  validate, adminUserActionSchema, adminKycReviewSchema, adminSettingsSchema,
  adminAccountCreateSchema, adminAccountUpdateSchema, adminAdjustmentSchema,
} from "../validation/extraSchemas.js";
import { sanitizePermissions } from "../utils/permissions.js";
import * as contestService from "../services/contest.service.js";
import * as walletService from "../services/wallet.service.js";
import { checkPassword, hashPassword } from "../services/auth.service.js";
import { issueTokens } from "../controllers/auth.controller.js";
import { writeAudit } from "../services/audit.service.js";
import { emitToUser, emitAdminRefresh, emitContestUpdate, emitWalletUpdate } from "../realtime/io.js";
import { UnauthorizedError, BadRequestError, NotFoundError, ConflictError, ForbiddenError } from "@lpludo/shared";
import { paginationSchema } from "@lpludo/shared/schemas";
import { log } from "../config/logger.js";

const l = log("admin.controller");

/** the shape every admin session hands to the panel (includes permissions) */
function adminView(u) {
  return {
    id: u._id, name: u.name, phone: u.phone || null, email: u.email || null,
    role: u.role, permissions: u.permissions || [],
  };
}

/* -------------------------------- auth -------------------------------- */

/** POST /admin/login — mobile number + password (superadmin / admin / agent) */
export async function login(req, res) {
  const { phone, password } = validate(adminLoginSchema, req.body);
  const user = await User.findOne({ phone }).select("+passwordHash +tokenVersion +phone");
  if (!user || !["admin", "superadmin", "agent"].includes(user.role)) {
    throw new UnauthorizedError("Incorrect mobile number or password");
  }
  await checkPassword(user, password);
  if (user.status === "banned") throw new UnauthorizedError("This account is banned");

  const tokens = issueTokens(res, user);
  await writeAudit(user._id, "admin.login", "user", user._id, { ip: req.ip });
  l.info({ adminId: String(user._id) }, "admin login");
  res.json({ accessToken: tokens.accessToken, admin: adminView(user) });
}

/** GET /admin/me — the current session (role + permissions) */
export async function me(req, res) {
  const u = await User.findById(req.user.id).select("+phone");
  if (!u) throw new NotFoundError("Admin not found");
  res.json({ admin: adminView(u) });
}

/* ----------------------------- dashboard ------------------------------ */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** midnight in IST, as a UTC Date (the reference panel's "today" window) */
function istDayStart() {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  const midnight = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()));
  return new Date(midnight.getTime() - IST_OFFSET_MS);
}

/** money metrics for one time window, straight from the ledger + settled contests */
async function rangeMetrics(fromDate) {
  const range = { createdAt: { $gte: fromDate } };
  const [dep, wd, bon, pen, ref, comm, matches] = await Promise.all([
    LedgerEntry.aggregate([{ $match: { type: "deposit", ...range } }, { $group: { _id: null, t: { $sum: "$amount" } } }]),
    LedgerEntry.aggregate([{ $match: { type: "withdrawal_paid", ...range } }, { $group: { _id: null, t: { $sum: { $multiply: ["$amount", -1] } } } }]),
    LedgerEntry.aggregate([{ $match: { type: "adjustment", "metadata.kind": "bonus", ...range } }, { $group: { _id: null, t: { $sum: "$amount" } } }]),
    LedgerEntry.aggregate([{ $match: { type: "adjustment", "metadata.kind": "penalty", ...range } }, { $group: { _id: null, t: { $sum: { $multiply: ["$amount", -1] } } } }]),
    LedgerEntry.aggregate([{ $match: { type: "referral_commission", ...range } }, { $group: { _id: null, t: { $sum: "$referralDelta" } } }]),
    Contest.aggregate([{ $match: { status: "approved", "settlement.settledAt": { $gte: fromDate } } }, { $group: { _id: null, t: { $sum: "$settlement.commissionPaise" } } }]),
    Contest.countDocuments({ status: "approved", "settlement.settledAt": { $gte: fromDate } }),
  ]);
  const s = (agg) => agg[0]?.t || 0;
  return {
    deposit: s(dep), withdraw: s(wd), bonus: s(bon), penalty: s(pen),
    referral: s(ref), commission: s(comm), matches,
  };
}

/**
 * GET /admin/dashboard?filter=all|today
 * Every card the panel shows: users, deposits, withdrawals, commission,
 * referral earnings, hold balance (money locked in running battles + pending
 * withdrawals), total wallet balance, matches, bonus and penalty. The `today`
 * block always carries today's window so the "Today" view is one fetch.
 */
export async function dashboardStats(req, res) {
  const filter = req.query.filter === "today" ? "today" : "all";
  const startOfDay = istDayStart();

  const [all, today, walletAgg, totalUsers, newUsers, pendingDeposits, pendingWithdrawals, pendingKyc, contestCounts, recentLedger] =
    await Promise.all([
      rangeMetrics(new Date(0)),
      rangeMetrics(startOfDay),
      Wallet.aggregate([{ $group: { _id: null, total: { $sum: "$totalPaise" }, held: { $sum: "$heldPaise" } } }]),
      User.countDocuments({ role: "player" }),
      User.countDocuments({ role: "player", createdAt: { $gte: startOfDay } }),
      DepositRequest.countDocuments({ status: "pending" }),
      WithdrawalRequest.countDocuments({ status: "requested" }),
      User.countDocuments({ "kyc.status": "pending" }),
      Contest.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
      LedgerEntry.find().sort({ createdAt: -1 }).limit(10).populate("userId", "name").lean(),
    ]);

  const byStatus = Object.fromEntries(contestCounts.map((r) => [r._id, r.n]));
  const running = (byStatus.running || 0) + (byStatus.room_submitted || 0) + (byStatus.result_submitted || 0);
  const completed = byStatus.approved || 0;
  const cancelled = (byStatus.cancelled || 0) + (byStatus.expired || 0);
  const pendingMatches = (byStatus.open || 0) + (byStatus.join_requested || 0) + (byStatus.cancel_requested || 0);
  const totalContests = Object.values(byStatus).reduce((a, b) => a + b, 0);

  res.json({
    filter,
    totalUsers,
    totalDeposit: all.deposit,
    totalWithdraw: all.withdraw,
    totalCommission: all.commission,
    totalReferral: all.referral,
    totalBonus: all.bonus,
    totalPenalty: all.penalty,
    totalMatches: all.matches,
    holdBalance: walletAgg[0]?.held || 0,
    walletBalance: walletAgg[0]?.total || 0,
    contests: { open: byStatus.open || 0, running, completed, cancelled, pending: pendingMatches, total: totalContests },
    pending: { deposits: pendingDeposits, withdrawals: pendingWithdrawals, kyc: pendingKyc },
    today: {
      newUsers,
      deposit: today.deposit,
      withdraw: today.withdraw,
      commission: today.commission,
      referral: today.referral,
      bonus: today.bonus,
      penalty: today.penalty,
      matches: today.matches,
    },
    recentLedger: recentLedger.map((r) => ({
      id: r._id, type: r.type, amountPaise: r.amount,
      userName: r.userId?.name || "unknown", createdAt: r.createdAt,
    })),
    generatedAt: new Date(),
  });
}

/* -------------------------------- users ------------------------------- */

export async function listUsers(req, res) {
  const { page, limit } = validate(paginationSchema, req.query);
  const q = String(req.query.q || "").trim();
  const filter = { role: "player" };
  // all | active | banned (blocked)
  const status = String(req.query.status || "");
  if (status === "active" || status === "banned") filter.status = status;
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: rx }, { phone: rx }];
  }
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select("+phone").lean(),
    User.countDocuments(filter),
  ]);
  const walletDocs = await Wallet.find({ userId: { $in: items.map((u) => u._id) } }).lean();
  const walletMap = new Map(walletDocs.map((w) => [String(w.userId), w]));
  res.json({
    items: items.map((u) => {
      const w = walletMap.get(String(u._id));
      return {
        id: u._id, name: u.name, phone: u.phone, status: u.status,
        kycStatus: u.kyc?.status || "not_submitted", createdAt: u.createdAt,
        lastActiveAt: u.lastActiveAt || null,
        wallet: w ? { totalPaise: w.totalPaise, heldPaise: w.heldPaise } : null,
      };
    }),
    total, page, limit,
  });
}

/** GET /admin/users/:id — one player's wallet, deposits/withdrawals, bonus/penalty, KYC */
export async function userDetail(req, res) {
  const user = await User.findById(req.params.id).select("+phone").lean();
  if (!user) throw new NotFoundError("User not found");

  const wallet = await Wallet.findOne({ userId: user._id }).lean();
  const [bonus, penalty] = await Promise.all([
    LedgerEntry.aggregate([
      { $match: { userId: user._id, type: "adjustment", "metadata.kind": "bonus" } },
      { $group: { _id: null, t: { $sum: "$amount" } } },
    ]),
    LedgerEntry.aggregate([
      { $match: { userId: user._id, type: "adjustment", "metadata.kind": "penalty" } },
      { $group: { _id: null, t: { $sum: { $multiply: ["$amount", -1] } } } },
    ]),
  ]);

  res.json({
    id: user._id,
    name: user.name,
    phone: user.phone || null,
    status: user.status,
    kycStatus: user.kyc?.status || "not_submitted",
    createdAt: user.createdAt,
    lastActiveAt: user.lastActiveAt || null,
    wallet: {
      availablePaise: wallet ? wallet.totalPaise - wallet.heldPaise : 0,
      totalPaise: wallet?.totalPaise || 0,
      heldPaise: wallet?.heldPaise || 0,
      referralPaise: wallet?.referralPaise || 0,
      wonPaise: wallet?.totals?.wonPaise || 0,
    },
    totals: {
      depositedPaise: wallet?.totals?.depositedPaise || 0,
      withdrawnPaise: wallet?.totals?.withdrawnPaise || 0,
      bonusPaise: bonus[0]?.t || 0,
      penaltyPaise: penalty[0]?.t || 0,
      battlesPlayed: wallet?.totals?.battlesPlayed || 0,
      battlesWon: wallet?.totals?.battlesWon || 0,
    },
  });
}

export async function userAction(req, res) {
  const { userId, action, reason } = validate(adminUserActionSchema, req.body);
  const user = await User.findById(userId).select("+tokenVersion");
  if (!user) throw new NotFoundError("User not found");
  if (["admin", "superadmin"].includes(user.role)) throw new BadRequestError("Cannot ban another admin");

  user.status = action === "ban" ? "banned" : "active";
  user.banReason = action === "ban" ? reason || "Policy violation" : undefined;
  if (action === "ban") user.tokenVersion += 1; // kills every live session instantly (S10)
  await user.save();
  await writeAudit(req.user.id, `user.${action}`, "user", user._id, { reason });
  emitAdminRefresh();
  res.json({ id: user._id, status: user.status });
}
/* --------------------------------- kyc -------------------------------- */

export async function listKyc(req, res) {
  const { page, limit } = validate(paginationSchema, req.query);
  // all | pending | approved(verified) | rejected | not_submitted
  const status = String(req.query.status || "all");
  const filter = { role: "player" };
  if (status === "approved") filter["kyc.status"] = "verified";
  else if (status && status !== "all") filter["kyc.status"] = status;
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select("+phone").lean(),
    User.countDocuments(filter),
  ]);
  res.json({
    items: items.map((u) => ({
      id: u._id, name: u.name, phone: u.phone,
      kyc: {
        status: u.kyc.status, holderName: u.kyc.holderName,
        dob: u.kyc.dob, docType: u.kyc.docType, docNumber: u.kyc.docNumber,
        docFrontKey: u.kyc.docFrontKey, docBackKey: u.kyc.docBackKey,
        rejectReason: u.kyc.rejectReason || null, reviewedAt: u.kyc.reviewedAt || null,
      },
      createdAt: u.createdAt,
    })),
    total, page, limit,
  });
}

export async function reviewKyc(req, res) {
  const { userId, action, note } = validate(adminKycReviewSchema, req.body);
  const user = await User.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  if (user.kyc?.status !== "pending") throw new ConflictError("This KYC is not pending review");

  user.kyc.status = action === "approve" ? "verified" : "rejected";
  user.kyc.reviewedBy = req.user.id;
  user.kyc.reviewedAt = new Date();
  user.kyc.rejectReason = action === "reject" ? note || "Documents not valid" : undefined;
  if (action === "approve") user.payoutUpi = user.payoutUpi || user.kyc.upiId;
  await user.save();

  await writeAudit(req.user.id, `kyc.${action}`, "user", user._id, { note });
  emitToUser(user._id, "kyc:updated", { status: user.kyc.status });
  emitAdminRefresh();
  res.json({ id: user._id, kycStatus: user.kyc.status });
}

/* ------------------------------ deposits ------------------------------ */

export async function listDeposits(req, res) {
  const { page, limit } = validate(paginationSchema, req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (["manual", "gateway"].includes(req.query.method)) filter.method = req.query.method;
  const [items, total] = await Promise.all([
    DepositRequest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate("userId", "name phone").lean(),
    DepositRequest.countDocuments(filter),
  ]);
  res.json({
    items: items.map((d) => ({
      id: d._id, amountPaise: d.amountPaise, status: d.status, method: d.method || "manual",
      utr: d.utr || d.gateway?.utr || null,
      proofImageKey: d.proofImageKey || null,
      user: d.userId ? { id: d.userId._id, name: d.userId.name, phone: d.userId.phone } : null,
      rejectReason: d.rejectReason || null, createdAt: d.createdAt,
      // gateway rows carry the order trail; `note` is set when a human must look
      // (e.g. the customer paid an amount different from the claim)
      gateway: d.method === "gateway"
        ? {
            orderId: d.gateway?.orderId || null,
            txnStatus: d.gateway?.txnStatus || null,
            note: d.gateway?.note || null,
            amountReportedPaise: d.gateway?.amountReportedPaise ?? null,
            payerApp: d.gateway?.payerApp || null,
            verifiedSource: d.gateway?.verifiedSource || null,
            verifiedAt: d.gateway?.verifiedAt || null,
          }
        : null,
    })),
    total, page, limit,
  });
}

export async function reviewDeposit(req, res) {
  const { id, action, note } = validate(adminReviewSchema, req.body);
  const deposit = await DepositRequest.findById(id);
  if (!deposit) throw new NotFoundError("Deposit not found");
  if (deposit.status !== "pending") throw new ConflictError("This deposit was already reviewed");

  if (action === "reject") {
    deposit.status = "rejected";
    deposit.reviewedBy = req.user.id;
    deposit.reviewedAt = new Date();
    deposit.rejectReason = note || "UTR not found / amount mismatch";
    await deposit.save();
    await writeAudit(req.user.id, "deposit.reject", "deposit", deposit._id, { note });
    emitToUser(deposit.userId, "deposit:updated", { id: deposit._id, status: "rejected" });
    emitAdminRefresh();
    return res.json({ id: deposit._id, status: "rejected" });
  }

  // approve = money moves FIRST (transactional + idempotent), status flips after (C2/C4)
  const reference = deposit.utr || deposit.gateway?.utr;
  const view = await walletService.creditDeposit({
    userId: deposit.userId,
    depositRequestId: deposit._id,
    amountPaise: deposit.amountPaise,
    actorId: req.user.id,
    note: `Deposit approved (${reference ? `UTR ${reference}` : `gateway order ${deposit.gateway?.orderId || "—"}`})`,
  });
  const row = await LedgerEntry.findOne({ idempotencyKey: `deposit:${deposit._id}` }).lean();
  deposit.status = "approved";
  deposit.reviewedBy = req.user.id;
  deposit.reviewedAt = new Date();
  deposit.ledgerEntryId = row?._id || null;
  await deposit.save();

  await writeAudit(req.user.id, "deposit.approve", "deposit", deposit._id, { amountPaise: deposit.amountPaise });
  emitToUser(deposit.userId, "deposit:updated", { id: deposit._id, status: "approved" });
  emitToUser(deposit.userId, "wallet:updated", view);
  emitAdminRefresh();
  res.json({ id: deposit._id, status: "approved", wallet: view });
}

/* ----------------------------- withdrawals ---------------------------- */

export async function listWithdrawals(req, res) {
  const { page, limit } = validate(paginationSchema, req.query);
  const filter = req.query.status ? { status: req.query.status } : {};
  const [items, total] = await Promise.all([
    WithdrawalRequest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate("userId", "name phone").lean(),
    WithdrawalRequest.countDocuments(filter),
  ]);
  res.json({
    items: items.map((w) => ({
      id: w._id, amountPaise: w.amountPaise, status: w.status, upiId: w.upiId,
      user: w.userId ? { id: w.userId._id, name: w.userId.name, phone: w.userId.phone } : null,
      providerRef: w.providerRef || null, rejectReason: w.rejectReason || null,
      createdAt: w.createdAt, paidAt: w.paidAt || null,
    })),
    total, page, limit,
  });
}

export async function reviewWithdrawal(req, res) {
  const { id, action, note } = validate(adminReviewSchema, req.body);
  const wd = await WithdrawalRequest.findById(id);
  if (!wd) throw new NotFoundError("Withdrawal not found");
  if (wd.status !== "requested") throw new ConflictError(`This withdrawal is already "${wd.status}"`);

  if (action === "reject") {
    // hold -> available again; the hold row already exists, refund is idempotent
    const view = await walletService.refundWithdrawal({
      userId: wd.userId, withdrawalId: wd._id, amountPaise: wd.amountPaise,
      actorId: req.user.id, reason: note || "rejected by admin",
    });
    const row = await LedgerEntry.findOne({ idempotencyKey: `w_refund:${wd._id}` }).lean();
    wd.status = "rejected";
    wd.refundLedgerId = row?._id || null;
    wd.reviewedBy = req.user.id;
    wd.reviewedAt = new Date();
    wd.rejectReason = note || "Rejected by admin";
    await wd.save();
    await writeAudit(req.user.id, "withdrawal.reject", "withdrawal", wd._id, { note });
    emitToUser(wd.userId, "withdrawal:updated", { id: wd._id, status: "rejected" });
    emitToUser(wd.userId, "wallet:updated", view);
    emitAdminRefresh();
    return res.json({ id: wd._id, status: "rejected" });
  }

  // action === "approve": admin confirms the UPI transfer — money moves FIRST,
  // status flips to "paid" only after the payout commits (fixes C5/C6 pattern
  // that the reference app had: status="paid" before money left the wallet).
  wd.reviewedBy = req.user.id;
  wd.reviewedAt = new Date();
  wd.providerRef = note || undefined;
  await wd.save();

  const view = await walletService.payWithdrawal({
    userId: wd.userId, withdrawalId: wd._id, amountPaise: wd.amountPaise,
    actorId: req.user.id, providerRef: note,
  });
  const row = await LedgerEntry.findOne({ idempotencyKey: `w_paid:${wd._id}` }).lean();
  wd.status = "paid";
  wd.paidAt = new Date();
  wd.paidLedgerId = row?._id || null;
  await wd.save();

  await writeAudit(req.user.id, "withdrawal.pay", "withdrawal", wd._id, { amountPaise: wd.amountPaise });
  emitToUser(wd.userId, "withdrawal:updated", { id: wd._id, status: "paid" });
  emitToUser(wd.userId, "wallet:updated", view);
  emitAdminRefresh();
  res.json({ id: wd._id, status: "paid" });
}

/* ------------------------------- contests ----------------------------- */

/** tab → contest statuses (reference panel's running / pending / completed / cancelled) */
const CONTEST_GROUPS = {
  running: ["running", "room_submitted", "result_submitted"],
  pending: ["open", "join_requested", "cancel_requested"],
  completed: ["approved"],
  cancelled: ["cancelled", "expired"],
};

export async function listContests(req, res) {
  const { page, limit } = validate(paginationSchema, req.query);
  const filter = {};
  const group = String(req.query.group || "");
  // pending matches are a separate grant for agents (on top of the matches section)
  if (group === "pending" && req.user.role === "agent" && !(req.user.doc?.permissions || []).includes("pending_matches")) {
    throw new ForbiddenError("You do not have access to pending matches");
  }
  if (CONTEST_GROUPS[group]) filter.status = { $in: CONTEST_GROUPS[group] };
  else if (req.query.status) filter.status = req.query.status;

  const [items, total, countsAgg] = await Promise.all([
    Contest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate("players.userId", "name phone").lean(),
    Contest.countDocuments(filter),
    Contest.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
  ]);

  const byStatus = Object.fromEntries(countsAgg.map((r) => [r._id, r.n]));
  const counts = {
    running: (byStatus.running || 0) + (byStatus.room_submitted || 0) + (byStatus.result_submitted || 0),
    pending: (byStatus.open || 0) + (byStatus.join_requested || 0) + (byStatus.cancel_requested || 0),
    completed: byStatus.approved || 0,
    cancelled: (byStatus.cancelled || 0) + (byStatus.expired || 0),
    total: Object.values(byStatus).reduce((a, b) => a + b, 0),
  };
  res.json({
    items: items.map((c) => ({
      id: c._id, stake: c.stake, status: c.status, createdAt: c.createdAt,
      settledAt: c.settlement?.settledAt || null, settledBy: c.settlement?.settledBy || null,
      prizePaise: c.settlement?.prizePaise || null,
      conflict: c.conflict?.active ? { raisedBy: c.conflict.raisedBy, reason: c.conflict.reason } : null,
      players: (c.players || []).map((p) => ({
        seat: p.seat, name: p.userId?.name || "deleted",
        phone: p.userId?.phone || null, id: p.userId?._id || p.userId,
      })),
      winnerUserId: c.winnerUserId || null,
    })),
    total, page, limit, counts,
  });
}

/** Full battle detail: reports, room code, and the per-user ledger trail */
export async function contestDetail(req, res) {
  const c = await Contest.findById(req.params.id)
    .select("+roomCode +roomCodeUp +roomSubmittedBy +roomSubmittedAt")
    .populate("players.userId", "name phone")
    .populate("conflict.raisedBy", "name")
    .populate("winnerUserId", "name");
  if (!c) throw new NotFoundError("Battle not found");

  const ledger = await contestService.contestLedger(c._id);
  const userIds = [...new Set([
    ...ledger.map((r) => String(r.userId)),
    ...(c.resultReports || []).map((r) => String(r.userId)),
  ])];
  const users = await User.find({ _id: { $in: userIds } }, "name phone").lean();
  const nameOf = Object.fromEntries(users.map((u) => [String(u._id), u.name || u.phone]));
  const wallets = await Wallet.find({ userId: { $in: userIds } }).lean();
  const contestTotals = Object.fromEntries(
    wallets.map((w) => [String(w.userId), (w.contestTotals || {})[String(c._id)] ?? null])
  );

  res.json({
    contest: {
      id: c._id, stake: c.stake, status: c.status, createdAt: c.createdAt,
      roomCode: c.roomCode || null,
      players: c.players.map((p) => ({
        seat: p.seat, id: p.userId?._id || p.userId,
        name: p.userId?.name || "deleted", phone: p.userId?.phone || null,
        netPaise: contestTotals[String(p.userId?._id || p.userId)] ?? null,
      })),
      winner: c.winnerUserId ? { id: c.winnerUserId._id, name: c.winnerUserId.name } : null,
      conflict: c.conflict?.active
        ? { raisedBy: c.conflict.raisedBy?.name || null, reason: c.conflict.reason, autoRefundAt: c.conflict.autoRefundAt }
        : null,
      settlement: c.settlement || null,
      resultReports: (c.resultReports || []).map((r) => ({
        userId: r.userId,
        name: nameOf[String(r.userId)] || null,
        outcome: r.outcome,
        reportedAt: r.reportedAt,
        screenshots: (r.screenshots || []).map((s) => ({ key: s.key, uploadedAt: s.uploadedAt })),
      })),
    },
    ledger: ledger.map((r) => ({
      id: r._id,
      user: { id: String(r.userId), name: nameOf[String(r.userId)] || null },
      type: r.type,
      amountPaise: r.amount, heldDeltaPaise: r.heldDelta, balanceAfterPaise: r.balanceAfter,
      note: r.note, createdAt: r.createdAt,
    })),
  });
}

/** POST /admin/contests/settle — pays the winner (the ONLY path that pays) */
export async function settleContest(req, res) {
  const { contestId, winnerUserId, note } = validate(adminSettleSchema, req.body);
  const { contest } = await contestService.decideContest({ contestId, winnerUserId, settledBy: "admin" });
  await writeAudit(req.user.id, "contest.settle", "contest", contest._id, {
    winnerUserId, prizePaise: contest.settlement?.prizePaise, note,
  });
  emitAdminRefresh();
  res.json({ id: contest._id, status: contest.status, prizePaise: contest.settlement?.prizePaise });
}

/** POST /admin/contests/:id/refund — returns every stake (disputes, dead rooms) */
export async function refundContest(req, res) {
  const { contest } = await contestService.refundContestById(req.params.id, "admin");
  await writeAudit(req.user.id, "contest.refund", "contest", contest._id, { note: req.body?.note });
  emitAdminRefresh();
  res.json({ id: contest._id, status: contest.status });
}

/** POST /admin/contests/:id/force-expire — kill an abandoned open battle */
export async function forceExpire(req, res) {
  const { contest, walletView, creatorId } = await contestService.expireContestById(req.params.id, "admin");
  await writeAudit(req.user.id, "contest.force_expire", "contest", contest._id, {});
  emitContestUpdate(contest);
  emitWalletUpdate(creatorId, walletView);
  emitAdminRefresh();
  res.json({ id: contest._id, status: contest.status });
}

/* --------------------------- ledger & audit --------------------------- */

export async function listLedgerAll(req, res) {
  const { page, limit } = validate(paginationSchema, req.query);
  const filter = {};
  if (req.query.type) filter.type = req.query.type;
  const [items, total] = await Promise.all([
    LedgerEntry.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate("userId", "name phone").lean(),
    LedgerEntry.countDocuments(filter),
  ]);
  res.json({
    items: items.map((r) => ({
      id: r._id, type: r.type, amountPaise: r.amount, heldDeltaPaise: r.heldDelta,
      balanceAfterPaise: r.balanceAfter, refType: r.refType, refId: r.refId,
      user: r.userId ? { id: r.userId._id, name: r.userId.name, phone: r.userId.phone } : null,
      note: r.note, createdAt: r.createdAt,
    })),
    total, page, limit,
  });
}

export async function listAudit(req, res) {
  const { page, limit } = validate(paginationSchema, req.query);
  const filter = {};
  if (req.query.actorId) filter.actorId = req.query.actorId;
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate("actorId", "name").lean(),
    AuditLog.countDocuments(filter),
  ]);
  res.json({
    items: items.map((a) => ({
      id: a._id, actor: a.actorId?.name || String(a.actorId), action: a.action,
      targetType: a.targetType, targetId: a.targetId, details: a.details, createdAt: a.createdAt,
    })),
    total, page, limit,
  });
}

/* ------------------------------ settings ------------------------------ */

/** GET /admin/settings — current platform settings (readable by any admin) */
export async function settingsDetail(_req, res) {
  const s = await getSettings();
  res.json({
    depositUpiId: s.depositUpiId || null,
    depositUpiName: s.depositUpiName || null,
    depositMinPaise: s.depositMinPaise,
    depositMaxPaise: s.depositMaxPaise,
    withdrawalMinPaise: s.withdrawalMinPaise,
    /** instant gateway is used BELOW this; manual UPI/UTR at or above it */
    depositGatewayMaxPaise: s.depositGatewayMaxPaise,
    maintenanceMode: Boolean(s.maintenanceMode),
    supportWhatsapp: s.supportWhatsapp || "",
    updatedAt: s.updatedAt,
  });
}

export async function updateSettings(req, res) {
  const data = validate(adminSettingsSchema, req.body);
  const s = await getSettings();
  if (data.depositUpiId !== undefined) s.depositUpiId = data.depositUpiId;
  if (data.depositUpiName !== undefined) s.depositUpiName = data.depositUpiName;
  if (data.depositMinPaise !== undefined) s.depositMinPaise = data.depositMinPaise;
  if (data.withdrawalMinPaise !== undefined) s.withdrawalMinPaise = data.withdrawalMinPaise;
  if (data.depositGatewayMaxPaise !== undefined) {
    if (data.depositGatewayMaxPaise <= s.depositMinPaise) {
      throw new BadRequestError("The instant-payment limit must be above the minimum deposit");
    }
    s.depositGatewayMaxPaise = data.depositGatewayMaxPaise;
  }
  if (data.maintenanceMode !== undefined) s.maintenanceMode = data.maintenanceMode;
  if (data.supportWhatsapp !== undefined) s.supportWhatsapp = data.supportWhatsapp;
  s.updatedBy = req.user.id;
  await s.save();
  await writeAudit(req.user.id, "settings.update", "settings", s._id, data);
  emitAdminRefresh();
  res.json({
    depositUpiId: s.depositUpiId,
    depositUpiName: s.depositUpiName,
    depositGatewayMaxPaise: s.depositGatewayMaxPaise,
    maintenanceMode: s.maintenanceMode,
    supportWhatsapp: s.supportWhatsapp || "",
  });
}

/* --------------------------- bonus / penalty -------------------------- */

/** find the target player by user id or mobile number */
async function resolveAdjustUser({ userId, phone }) {
  const user = userId
    ? await User.findById(userId).select("+phone")
    : await User.findOne({ phone }).select("+phone");
  if (!user) throw new NotFoundError("Player not found");
  return user;
}

/** POST /admin/bonus — credit an admin bonus to a player's wallet */
export async function addBonus(req, res) {
  const { userId, phone, amountPaise, note } = validate(adminAdjustmentSchema, req.body);
  const user = await resolveAdjustUser({ userId, phone });
  const view = await walletService.adminAdjustment({
    userId: user._id, amountPaise, kind: "bonus", note, actorId: req.user.id,
  });
  await writeAudit(req.user.id, "wallet.bonus", "user", user._id, { amountPaise, note });
  emitWalletUpdate(user._id, view);
  emitAdminRefresh();
  res.json({ id: user._id, wallet: view, message: "Bonus added" });
}

/** POST /admin/penalty — debit a penalty from a player's wallet */
export async function addPenalty(req, res) {
  const { userId, phone, amountPaise, note } = validate(adminAdjustmentSchema, req.body);
  const user = await resolveAdjustUser({ userId, phone });
  let view;
  try {
    view = await walletService.adminAdjustment({
      userId: user._id, amountPaise: -amountPaise, kind: "penalty", note, actorId: req.user.id,
    });
  } catch (err) {
    if (err?.name === "WalletError") throw new BadRequestError("The player does not have enough balance for this penalty");
    throw err;
  }
  await writeAudit(req.user.id, "wallet.penalty", "user", user._id, { amountPaise, note });
  emitWalletUpdate(user._id, view);
  emitAdminRefresh();
  res.json({ id: user._id, wallet: view, message: "Penalty applied" });
}

/** GET /admin/settings-report — bonus + penalty history (newest first) */
export async function settingsReport(_req, res) {
  const rows = await LedgerEntry.find({ type: "adjustment" })
    .sort({ createdAt: -1 })
    .limit(400)
    .populate("actorId", "name")
    .lean();

  const userIds = [...new Set(rows.map((r) => String(r.userId)))];
  const users = userIds.length ? await User.find({ _id: { $in: userIds } }).select("+phone name").lean() : [];
  const uMap = Object.fromEntries(users.map((u) => [String(u._id), u]));

  const map = (r) => ({
    id: r._id,
    name: uMap[String(r.userId)]?.name || "—",
    phone: uMap[String(r.userId)]?.phone || null,
    amountPaise: Math.abs(r.amount),
    reason: r.note || "",
    balanceAfterPaise: r.balanceAfter,
    adminName: r.actorId?.name || "Admin",
    createdAt: r.createdAt,
  });

  res.json({
    bonus: rows.filter((r) => r.metadata?.kind === "bonus").map(map),
    penalty: rows.filter((r) => r.metadata?.kind === "penalty").map(map),
  });
}

/* ------------------------- admin / agent control ---------------------- */

/** GET /admin/admin-list — every admin / agent account (superadmin only) */
export async function adminList(_req, res) {
  const admins = await User.find({ role: { $in: ["superadmin", "admin", "agent"] } })
    .select("+phone")
    .sort({ createdAt: -1 })
    .lean();
  res.json({ items: admins.map(adminView) });
}

/** POST /admin/create-admin — create an admin or a permission-scoped agent */
export async function createAdmin(req, res) {
  const data = validate(adminAccountCreateSchema, req.body);
  const exists = await User.findOne({ phone: data.phone }).select("+phone");
  if (exists) throw new ConflictError("That mobile number is already registered");

  const admin = new User({
    name: data.name,
    phone: data.phone,
    email: data.email || undefined,
    role: data.role,
    status: "active",
    passwordHash: await hashPassword(data.password),
    permissions: data.role === "agent" ? sanitizePermissions(data.permissions) : [],
  });
  await admin.save();
  await writeAudit(req.user.id, "admin.create", "user", admin._id, { role: data.role });
  emitAdminRefresh();
  res.status(201).json({ admin: adminView(admin) });
}

/** PATCH /admin/update/:id — edit an admin/agent (superadmin only) */
export async function updateAdmin(req, res) {
  const data = validate(adminAccountUpdateSchema, req.body);
  const target = await User.findById(req.params.id).select("+passwordHash +tokenVersion +phone");
  if (!target || !["superadmin", "admin", "agent"].includes(target.role)) {
    throw new NotFoundError("Admin / Agent not found");
  }
  if (String(target._id) === String(req.user.id) && data.role && data.role !== target.role) {
    throw new BadRequestError("You cannot change your own role");
  }

  if (data.name) target.name = data.name;
  if (data.phone && data.phone !== target.phone) {
    const dup = await User.findOne({ phone: data.phone, _id: { $ne: target._id } });
    if (dup) throw new ConflictError("That mobile number is already registered");
    target.phone = data.phone;
  }
  if (data.email !== undefined) target.email = data.email || undefined;
  if (data.role) target.role = data.role;
  if (data.password) {
    target.passwordHash = await hashPassword(data.password);
    target.tokenVersion = (target.tokenVersion || 0) + 1; // kill live sessions
  }
  target.permissions = target.role === "agent"
    ? sanitizePermissions(data.permissions ?? target.permissions)
    : [];

  await target.save();
  await writeAudit(req.user.id, "admin.update", "user", target._id, { role: target.role });
  emitAdminRefresh();
  res.json({ admin: adminView(target) });
}

/** DELETE /admin/delete/:id — remove an admin/agent (superadmin only) */
export async function deleteAdmin(req, res) {
  if (String(req.params.id) === String(req.user.id)) {
    throw new BadRequestError("You cannot delete your own account");
  }
  const target = await User.findById(req.params.id);
  if (!target || !["admin", "agent"].includes(target.role)) {
    throw new BadRequestError("Only admin / agent accounts can be deleted");
  }
  await User.findByIdAndDelete(target._id);
  await writeAudit(req.user.id, "admin.delete", "user", target._id, { role: target.role });
  emitAdminRefresh();
  res.json({ ok: true });
}

/** GET /admin/agent-report — per-admin/agent approvals, bonus and penalty */
export async function agentReport(_req, res) {
  const start = istDayStart();
  const rows = await LedgerEntry.aggregate([
    { $match: { actorId: { $ne: null }, type: { $in: ["deposit", "withdrawal_paid", "adjustment"] } } },
    {
      $group: {
        _id: "$actorId",
        totalDeposit: { $sum: { $cond: [{ $eq: ["$type", "deposit"] }, "$amount", 0] } },
        totalWithdraw: { $sum: { $cond: [{ $eq: ["$type", "withdrawal_paid"] }, { $multiply: ["$amount", -1] }, 0] } },
        totalBonus: { $sum: { $cond: [{ $and: [{ $eq: ["$type", "adjustment"] }, { $eq: ["$metadata.kind", "bonus"] }] }, "$amount", 0] } },
        totalPenalty: { $sum: { $cond: [{ $and: [{ $eq: ["$type", "adjustment"] }, { $eq: ["$metadata.kind", "penalty"] }] }, { $multiply: ["$amount", -1] }, 0] } },
        totalCount: { $sum: 1 },
        todayDeposit: { $sum: { $cond: [{ $and: [{ $eq: ["$type", "deposit"] }, { $gte: ["$createdAt", start] }] }, "$amount", 0] } },
        todayWithdraw: { $sum: { $cond: [{ $and: [{ $eq: ["$type", "withdrawal_paid"] }, { $gte: ["$createdAt", start] }] }, { $multiply: ["$amount", -1] }, 0] } },
      },
    },
    { $sort: { totalDeposit: -1 } },
  ]);

  const ids = rows.map((r) => r._id);
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select("+phone name email role").lean() : [];
  const uMap = Object.fromEntries(users.map((u) => [String(u._id), u]));

  res.json({
    items: rows.map((r) => {
      const u = uMap[String(r._id)] || {};
      return {
        id: r._id, name: u.name || "Unknown", phone: u.phone || null, email: u.email || null,
        role: u.role || "admin",
        totalDepositPaise: r.totalDeposit, totalWithdrawPaise: r.totalWithdraw,
        todayDepositPaise: r.todayDeposit, todayWithdrawPaise: r.todayWithdraw,
        totalBonusPaise: r.totalBonus, totalPenaltyPaise: r.totalPenalty,
        totalCount: r.totalCount,
      };
    }),
  });
}
