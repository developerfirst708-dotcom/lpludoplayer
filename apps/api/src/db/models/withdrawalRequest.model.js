import mongoose from "mongoose";

/**
 * WithdrawalRequest — user asks to cash out.
 * Flow (fixes C5/C6, where the flag flipped to "paid" before the money moved):
 *   requested -> approved(hold released -> paid ledger) -> paid
 *             -> rejected(hold released back to balance)
 */
const withdrawalRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    amountPaise: { type: Number, required: true, min: 20000 }, // min ₹200

    /** payout rail — UPI for small amounts, bank required above ₹2000 */
    method: { type: String, enum: ["upi", "bank"], default: "upi", required: true },
    upiId: { type: String, trim: true },
    bank: {
      accountName: { type: String, trim: true },
      accountNumber: { type: String, trim: true },
      ifsc: { type: String, trim: true, uppercase: true },
    },
    status: {
      type: String,
      enum: ["requested", "approved", "paid", "rejected", "failed"],
      default: "requested",
      index: true,
    },

    /** ledger rows written at each step (traceable, idempotent) */
    holdLedgerId: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry" },
    paidLedgerId: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry" },
    refundLedgerId: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry" },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    paidAt: { type: Date },
    rejectReason: { type: String, trim: true, maxlength: 200 },
    providerRef: { type: String }, // UPI/transfer reference from the payout
  },
  { timestamps: true }
);

withdrawalRequestSchema.index({ status: 1, createdAt: -1 });
withdrawalRequestSchema.index({ userId: 1, createdAt: -1 });
/** one pending withdrawal per user at a time (reference rule) */
withdrawalRequestSchema.index(
  { userId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "requested" } }
);

export const WithdrawalRequest = mongoose.model("WithdrawalRequest", withdrawalRequestSchema);
