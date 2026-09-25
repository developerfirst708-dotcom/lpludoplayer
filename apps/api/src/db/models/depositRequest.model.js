import mongoose from "mongoose";

/**
 * DepositRequest — one row per deposit attempt, whichever rail it used:
 *
 *  - method "manual"  : user paid the UPI id and typed a UTR; an admin reviews it.
 *  - method "gateway" : IMB Pay hosted checkout. The order is auto-verified
 *    (webhook + server-to-server status check + the 60s sweep) and credited
 *    without an admin. A gateway row only stays `pending` when a human is
 *    genuinely needed (e.g. the customer paid a different amount than claimed).
 *
 * Money is ONLY credited by walletService.creditDeposit (transaction +
 * idempotency key `deposit:<id>`), so no path here can double-credit.
 */
const depositRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    amountPaise: { type: Number, required: true, min: 1000 }, // min ₹10

    method: { type: String, enum: ["manual", "gateway"], default: "manual", index: true },

    status: {
      type: String,
      // failed = gateway order that failed/expired/was cancelled (retryable: it
      // frees the one-pending-deposit slot). Manual rows never become `failed`.
      enum: ["pending", "approved", "rejected", "failed"],
      default: "pending",
      index: true,
    },

    utr: { type: String, trim: true, index: true }, // bank reference (typed by user, or filled from the gateway)
    utrHash: { type: String, index: true }, // normalized, for duplicate detection
    proofImageKey: { type: String },

    /** gateway (IMB Pay) bookkeeping — only set for method "gateway" */
    gateway: {
      /** our order id sent to IMB (`LPL<depositId>`) — the webhook/status key */
      orderId: { type: String, index: true },
      paymentUrl: { type: String },
      checkLink: { type: String },
      txnStatus: { type: String }, // raw txnStatus from the gateway
      utr: { type: String }, // gateway-reported UPI reference
      amountReportedPaise: { type: Number }, // what the customer actually paid (if different)
      payerName: { type: String },
      payerVpa: { type: String },
      payerApp: { type: String },
      note: { type: String, trim: true, maxlength: 300 }, // e.g. amount-mismatch reason shown to admins
      lastCheckedAt: { type: Date },
      verifiedAt: { type: Date },
      verifiedSource: { type: String, enum: ["webhook", "poll", "sweep", "admin"] },
      createError: { type: String }, // create-order failure, kept for support
    },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    rejectReason: { type: String, trim: true, maxlength: 200 },

    /** set when the ledger row is written — proves the money actually moved */
    ledgerEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry" },
  },
  { timestamps: true }
);

depositRequestSchema.index({ status: 1, createdAt: -1 });
depositRequestSchema.index({ userId: 1, createdAt: -1 });
/** one pending claim per user at a time */
depositRequestSchema.index({ userId: 1, status: 1 }, { unique: true, partialFilterExpression: { status: "pending" } });

export const DepositRequest = mongoose.model("DepositRequest", depositRequestSchema);
