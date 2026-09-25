import mongoose from "mongoose";
import { CONTEST_STATES, TERMINAL_STATES, isTransitionAllowed, IllegalTransitionError } from "@lpludo/shared";
import { applyContestSchemaExtras } from "./contest.extras.js";

/**
 * Contest = one 1v1 battle.
 * Status ONLY ever changes via `contest.transition(next)` — direct `status`
 * writes throw (the reference app mutated it from ~7 controllers, which is
 * exactly how money got stuck).
 */
const contestSchema = new mongoose.Schema(
  {
    stake: { type: Number, required: true, min: 1 }, // integer paise
    status: {
      type: String,
      enum: Object.values(CONTEST_STATES),
      default: CONTEST_STATES.OPEN,
      index: true,
    },
    players: [
      {
        _id: false,
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        seat: { type: Number, enum: [1, 2], required: true },
        joinedAt: { type: Date },
        joinedIp: { type: String },
      },
    ],

    // Ludo King room code — returned only to the two participants
    roomCode: { type: String, trim: true, select: false },
    /** uppercase mirror for case-insensitive participant lookup (schema keeps original case) */
    roomCodeUp: { type: String, trim: true, select: false },
    roomSubmittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", select: false },
    roomSubmittedAt: { type: Date, select: false },

    // result / settlement
    winnerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    settlement: {
      prizePaise: { type: Number },
      commissionPaise: { type: Number },
      settledAt: { type: Date },
      settledBy: { type: String, enum: ["system", "admin", "sla"] },
      payoutLedgerId: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry" },
      refundLedgerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry" }],
    },

    // dispute handling
    conflict: {
      active: { type: Boolean, default: false },
      raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reason: { type: String, trim: true, maxlength: 300 },
      autoRefundAt: { type: Date },
    },

    entryHoldReleased: { type: Boolean, default: false },
    expiresAt: { type: Date },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, optimisticConcurrency: true }
);

// resultReports + attachment subschema (dispute trail / auto-settle evidence)
applyContestSchemaExtras(contestSchema);

/** Dual-index expiry: open battles auto-expire without a cron sweep. */
contestSchema.index({ status: 1, createdAt: -1 }); // /contests/open (fixes P2)
// NOTE: deliberately NO TTL index on `expiresAt`. A TTL delete would remove an
// open battle while the creator's stake is still HELD — the exact stuck-money
// bug (C1) this rebuild exists to fix. Expiry is done by the `contest.expire`
// sweep job, which transitions the battle to `expired` and refunds FIRST.
contestSchema.index({ "players.userId": 1, createdAt: -1 }); // "my battles"
contestSchema.index({ status: 1, "conflict.active": 1, "conflict.autoRefundAt": 1 }); // SLA sweep

/**
 * Atomic, guarded status change.
 * Call inside a transaction so the bump and the money move commit together.
 * @returns the previous status
 */
contestSchema.methods.transition = function transition(next, { actor, note } = {}) {
  const from = this.status;
  if (!isTransitionAllowed(from, next)) {
    throw new IllegalTransitionError(from, next);
  }
  this.set("status", next);
  this.version += 1;
  this.__transitionMeta = { from, actor, note };
  return from;
};

/** Convenience: is this user one of the two players? Works for both ObjectId
 *  references (un-populated) and populated Mongoose documents. */
contestSchema.methods.isParticipant = function isParticipant(userId) {
  return this.players.some(
    (p) => p.userId && String(p.userId._id || p.userId) === String(userId)
  );
};

export const Contest = mongoose.model("Contest", contestSchema);
export { CONTEST_STATES, TERMINAL_STATES };
