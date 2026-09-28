import mongoose from "mongoose";
import { User } from "../db/models/user.model.js";
import { validate } from "@lpludo/shared/schemas";
import { kycSubmitSchema, updateProfileSchema } from "@lpludo/shared/schemas";
import { BadRequestError, ConflictError, NotFoundError } from "@lpludo/shared";
import { Wallet } from "../db/models/wallet.model.js";
import { LedgerEntry } from "../db/models/ledgerEntry.model.js";
import { listLedger } from "../services/ledger.service.js";
import { getOrCreateWallet } from "../services/wallet.service.js";
import { Contest } from "../db/models/contest.model.js";
import { emitAdminRefresh } from "../realtime/io.js";
import { referralApplySchema } from "../validation/extraSchemas.js";

/** GET /user/profile — everything the account screen needs in one call (F4) */
export async function getProfile(req, res) {
  const user = req.user.doc;
  const [wallet, ledger, battles] = await Promise.all([
    Wallet.findOne({ userId: user._id }).lean(),
    listLedger(user._id, { limit: 5 }),
    Contest.countDocuments({ "players.userId": user._id }),
  ]);

  res.json({
    user: user.toPublic(),
    phone: user.phone,
    payoutUpi: user.payoutUpi || null,
    referralCode: user.referral?.code || null,
    referralApplied: Boolean(user.referral?.referredBy),
    wallet: wallet
      ? {
          totalPaise: wallet.totalPaise,
          heldPaise: wallet.heldPaise,
          availablePaise: wallet.totalPaise - wallet.heldPaise,
          referralPaise: wallet.referralPaise || 0,
          totals: wallet.totals,
        }
      : null,
    recentLedger: ledger.map((r) => ({
      id: r._id, type: r.type, amountPaise: r.amount, note: r.note, createdAt: r.createdAt,
    })),
    battlesPlayed: battles,
  });
}

/** PATCH /user/profile */
export async function updateProfile(req, res) {
  const data = validate(updateProfileSchema, req.body);
  const user = req.user.doc;
  if (data.name !== undefined) user.name = data.name;
  if (data.avatarUrl !== undefined) user.avatarUrl = data.avatarUrl;
  if (data.payoutUpi !== undefined) user.payoutUpi = data.payoutUpi;
  try {
    await user.save();
  } catch (err) {
    // `player_name_unique` — a rename must not steal another player's handle
    if (err?.code === 11000) throw new ConflictError("That display name is already taken");
    throw err;
  }
  res.json({ user: user.toPublic() });
}

/**
 * POST /user/kyc — references ALREADY-UPLOADED keys (uploaded via /uploads first,
 * so the server never buffers a document stream inside this handler).
 * No admin can approve without documents now (S9).
 */
export async function submitKyc(req, res) {
  const data = validate(kycSubmitSchema, req.body);
  const user = req.user.doc;

  if (user.kyc?.status === "verified") throw new BadRequestError("KYC is already verified");
  if (user.kyc?.status === "pending") throw new BadRequestError("KYC is already under review");

  // the keys must belong to THIS user (upload controller prefixes by owner id)
  for (const k of [data.frontImageKey, data.backImageKey]) {
    if (!k.startsWith(`${user._id.toString()}/kyc/`)) {
      throw new BadRequestError("KYC images must be uploaded by your own account");
    }
  }

  user.kyc = {
    status: "pending",
    holderName: data.holderName,
    upiId: data.upiId,
    docFrontKey: data.frontImageKey,
    docBackKey: data.backImageKey,
  };
  await user.save();
  emitAdminRefresh();

  res.json({ status: "pending", message: "KYC submitted for review" });
}

/**
 * GET /user/referrals — referral code, redeemable balance, lifetime earnings
 * and the referred-players list (Refer + ReferHistory + Redeem screens).
 */
export async function getReferrals(req, res) {
  const userId = req.user.id;
  const [wallet, referred, earningRows] = await Promise.all([
    getOrCreateWallet(userId),
    User.find({ "referral.referredBy": userId }).select("name createdAt").sort({ createdAt: -1 }).limit(200).lean(),
    LedgerEntry.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId), type: "referral_commission" } },
      {
        $group: {
          _id: "$metadata.referredUserId",
          earnedPaise: { $sum: "$referralDelta" },
          commissions: { $sum: 1 },
        },
      },
    ]),
  ]);

  const byReferee = new Map(earningRows.map((r) => [String(r._id), r]));
  const items = referred.map((u) => {
    const earned = byReferee.get(String(u._id));
    return {
      id: u._id,
      name: u.name || "Player",
      joinedAt: u.createdAt,
      earnedPaise: earned?.earnedPaise || 0,
      commissions: earned?.commissions || 0,
    };
  });

  res.json({
    code: req.user.doc.referral?.code || null,
    referralPaise: wallet.referralPaise || 0,
    totalEarnedPaise: items.reduce((acc, r) => acc + r.earnedPaise, 0),
    totalReferred: items.length,
    items,
  });
}

/**
 * POST /user/referral — apply someone's referral code after signup.
 * Allowed once per account, never your own code.
 */
export async function applyReferral(req, res) {
  const { code } = validate(referralApplySchema, req.body);
  const user = req.user.doc;
  if (user.referral?.referredBy) {
    throw new ConflictError("A referral code is already applied to this account");
  }

  const normalized = code.trim().toUpperCase();
  if (user.referral?.code && user.referral.code.toUpperCase() === normalized) {
    throw new BadRequestError("You cannot apply your own referral code");
  }

  const referrer = await User.findOne({ "referral.code": normalized }).select("_id name");
  if (!referrer) throw new NotFoundError("That referral code does not exist");

  user.referral = user.referral || {};
  user.referral.referredBy = referrer._id;
  await user.save();

  res.json({ ok: true, referredBy: referrer.name || "Player" });
}