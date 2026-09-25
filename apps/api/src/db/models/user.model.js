import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    // PII — not in open lists. Required for players; admins/agents may omit it
    // (sparse unique index allows multiple docs without a phone).
    phone: {
      type: String,
      required() { return this.role === "player"; },
      unique: true,
      sparse: true,
      index: true,
      select: false,
    },
    name: { type: String, trim: true, maxlength: 40 },
    avatarUrl: { type: String },

    role: { type: String, enum: ["player", "agent", "admin", "superadmin"], default: "player", index: true },
    status: { type: String, enum: ["active", "banned"], default: "active", index: true },
    banReason: { type: String },

    /** hashed with bcrypt(12) — never logged */
    passwordHash: { type: String, select: false }, // admin/agent login only
    email: { type: String, trim: true, lowercase: true, sparse: true },

    lastActiveAt: { type: Date, index: true },

    referral: {
      code: { type: String, unique: true, sparse: true, index: true },
      referredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      bonusPaidPaise: { type: Number, default: 0 },
    },

    /** player-set (used for withdrawals) and admin-verified flag */
    payoutUpi: { type: String },
    kyc: {
      status: { type: String, enum: ["not_submitted", "pending", "verified", "rejected"], default: "not_submitted", index: true },
      holderName: { type: String },
      upiId: { type: String },
      docFrontKey: { type: String },
      docBackKey: { type: String },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reviewedAt: { type: Date },
      rejectReason: { type: String },
    },

    /** token-version — bump to invalidate every refresh token at once */
    tokenVersion: { type: Number, default: 0, select: false },
  },
  { timestamps: true }
);

userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ name: "text", phone: "text" }, { name: "user_search" });

/**
 * A player's display name is an auto-generated unique 5-letter handle — the
 * partial index enforces that uniqueness at the DB level while leaving admins /
 * agents (who may share a title or have no name at all) out of the constraint.
 */
userSchema.index(
  { name: 1 },
  { unique: true, partialFilterExpression: { role: "player" }, name: "player_name_unique" }
);

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    name: this.name || "Player",
    avatarUrl: this.avatarUrl || null,
    kycStatus: this.kyc?.status,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model("User", userSchema);
