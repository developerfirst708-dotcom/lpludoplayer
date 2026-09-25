import { User } from "../db/models/user.model.js";
import { validate } from "@lpludo/shared/schemas";
import { kycSubmitSchema, updateProfileSchema } from "@lpludo/shared/schemas";
import { BadRequestError, ConflictError } from "@lpludo/shared";
import { Wallet } from "../db/models/wallet.model.js";
import { listLedger } from "../services/ledger.service.js";
import { Contest } from "../db/models/contest.model.js";
import { emitAdminRefresh } from "../realtime/io.js";

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
    wallet: wallet
      ? {
          totalPaise: wallet.totalPaise,
          heldPaise: wallet.heldPaise,
          availablePaise: wallet.totalPaise - wallet.heldPaise,
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