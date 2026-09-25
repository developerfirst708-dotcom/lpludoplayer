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
} from "../validation/extraSchemas.js";
import * as contestService from "../services/contest.service.js";
import * as walletService from "../services/wallet.service.js";
import { checkPassword } from "../services/auth.service.js";
import { issueTokens } from "../controllers/auth.controller.js";
import { writeAudit } from "../services/audit.service.js";
import { emitToUser, emitAdminRefresh, emitContestUpdate, emitWalletUpdate } from "../realtime/io.js";
import { UnauthorizedError, BadRequestError, NotFoundError, ConflictError } from "@lpludo/shared";
import { paginationSchema } from "@lpludo/shared/schemas";
import { log } from "../config/logger.js";

const l = log("admin.controller");

/* -------------------------------- auth -------------------------------- */

export async function login(req, res) {
  const { email, password } = validate(adminLoginSchema, req.body);
  const user = await User.findOne({ email: email.toLowerCase() }).select("+passwordHash +tokenVersion");
  if (!user || !["admin", "superadmin"].includes(user.role)) {
    throw new UnauthorizedError("Incorrect email or password");
  }
  await checkPassword(user, password);
  if (user.status === "banned") throw new UnauthorizedError("This admin is banned");

  const tokens = issueTokens(res, user);
  await writeAudit(user._id, "admin.login", "user", user._id, { ip: req.ip });
  l.info({ adminId: String(user._id) }, "admin login");
  res.json({
    accessToken: tokens.accessToken,
    admin: { id: user._id, name: user.name, email: user.email, role: user.role },
  });
}

/* ----------------------------- dashboard ------------------------------ */

/** O(1)-ish summary (fixes P5: no more ~20 scans every 10s) */
export async function dashboardSummary(_req, res) {
  const [walletAgg, userCount, contestCounts, pendingDeposits, pendingWithdrawals, pendingKyc, recentLedger] =
    await Promise.all([
      Wallet.aggregate([{ $group: { _id: null, gav: { $sum: { $subtract: ["$totalPaise", "$heldPaise"] } }, held: { $sum: "$heldPaise" } } }]),
      User.countDocuments({ role: "player" }),
      Contest.aggregate([{ $group: { _id: "$status", n: { $sum: 1 }, stake: { $sum: "$stake" } } }]),
      DepositRequest.countDocuments({ status: "pending" }),
      WithdrawalRequest.countDocuments({ status: "requested" }),
      User.countDocuments({ "kyc.status": "pending" }),
      LedgerEntry.find().sort({ createdAt: -1 }).limit(10).populate("userId", "name").lean(),
    ]);

  const byStatus = Object.fromEntries(contestCounts.map((r) => [r._id, { n: r.n, stakePaise: r.stake }]));
  const settled = byStatus.approved || { n: 0, stakePaise: 0 };
  const commissionPaise = Math.floor((settled.stakePaise * 2 * 500) / 10000);

  res.json({
    gavPaise: walletAgg[0]?.gav || 0,
    heldPaise: walletAgg[0]?.held || 0,
    users: userCount,
    contests: {
      open: byStatus.open?.n || 0,
      running: (byStatus.running?.n || 0) + (byStatus.room_submitted?.n || 0) + (byStatus.result_submitted?.n || 0),
      conflict: byStatus.cancel_requested?.n || 0,
      settled: settled.n,
    },
    commissionPaise,
    pending: { deposits: pendingDeposits, withdrawals: pendingWithdrawals, kyc: pendingKyc },
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
  const filter = { "kyc.status": { $in: ["pending", "verified", "rejected"] } };
  if (req.query.status) filter["kyc.status"] = req.query.status;
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select("+phone").lean(),
    User.countDocuments(filter),
  ]);
  res.json({
    items: items.map((u) => ({
      id: u._id, name: u.name, phone: u.phone,
      kyc: {
        status: u.kyc.status, holderName: u.kyc.holderName, upiId: u.kyc.upiId,
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

export async function listContests(req, res) {
  const { page, limit } = validate(paginationSchema, req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const [items, total] = await Promise.all([
    Contest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate("players.userId", "name phone").lean(),
    Contest.countDocuments(filter),
  ]);
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
    total, page, limit,
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
  s.updatedBy = req.user.id;
  await s.save();
  await writeAudit(req.user.id, "settings.update", "settings", s._id, data);
  emitAdminRefresh();
  res.json({
    depositUpiId: s.depositUpiId,
    depositUpiName: s.depositUpiName,
    depositGatewayMaxPaise: s.depositGatewayMaxPaise,
    maintenanceMode: s.maintenanceMode,
  });
}
