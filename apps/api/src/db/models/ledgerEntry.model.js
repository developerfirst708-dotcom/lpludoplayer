import mongoose from "mongoose";

/**
 * LedgerEntry — append-only double-entry style money log (fixes C1–C13 at the root).
 *
 * Invariants:
 *  - Rows are never updated or deleted.
 *  - Every `amount` is signed: negative = money leaving the user, positive = money in.
 *  - `balanceAfter` is written by the same transaction that wrote the row, so the
 *    running balance is reconstructable and auditable.
 *  - `idempotencyKey` is unique — a retried payout/deposit cannot insert twice.
 *  - `walletId` always points at the wallet the row applies to.
 */
const ledgerEntrySchema = new mongoose.Schema(
  {
    walletId: { type: mongoose.Schema.Types.ObjectId, ref: "Wallet", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    /** signed integer paise — delta applied to wallet.totalPaise */
    amount: { type: Number, required: true },
    /** signed integer paise — delta applied to wallet.heldPaise (holds/refunds) */
    heldDelta: { type: Number, required: true, default: 0 },
    /** running balances AFTER this row (written in the same transaction) */
    balanceAfter: { type: Number, required: true, min: 0 },
    availableAfter: { type: Number, required: true, min: 0 },

    /** deposit | entry_fee_hold | entry_fee_release | entry_fee_refund | prize_win | withdrawal_hold | withdrawal_paid | withdrawal_refund | adjustment */
    type: { type: String, required: true, index: true },

    refType: { type: String, enum: ["contest", "deposit", "withdrawal", "admin", "system"], required: true, index: true },
    refId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    /** free-form detail, never contains secrets */
    note: { type: String, trim: true, maxlength: 300 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    /** deterministic key — see services/idempotency.js */
    idempotencyKey: { type: String, required: true },

    /** which admin/actor triggered it (null for system) */
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

ledgerEntrySchema.index({ idempotencyKey: 1 }, { unique: true });
ledgerEntrySchema.index({ userId: 1, createdAt: -1 }); // wallet history page
ledgerEntrySchema.index({ refType: 1, refId: 1 }); // all money rows for one contest
ledgerEntrySchema.index({ createdAt: -1 }); // reconciliation scans

/** Immutable by policy: reject updates/deletes at the driver level. */
ledgerEntrySchema.pre(["updateOne", "updateMany", "deleteOne", "deleteMany", "findOneAndUpdate"], function (next) {
  next(new Error("ledgerEntries are append-only and cannot be modified"));
});

export const LedgerEntry = mongoose.model("LedgerEntry", ledgerEntrySchema);
