import mongoose from "mongoose";

/**
 * Wallet — a thin balance holder. The truth is LedgerEntry; the balance is a
 * cached aggregate maintained inside the same transaction as every write.
 *
 * available = total - heldInContests - heldInWithdrawals
 */
const walletSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    currency: { type: String, default: "INR", enum: ["INR"] },

    totalPaise: { type: Number, required: true, min: 0, default: 0 },
    heldPaise: { type: Number, required: true, min: 0, default: 0 },

    /** counter fields for the dashboard, updated by the ledger service */
    totals: {
      depositedPaise: { type: Number, default: 0 },
      withdrawnPaise: { type: Number, default: 0 },
      wonPaise: { type: Number, default: 0 },
      lostPaise: { type: Number, default: 0 },
      battlesPlayed: { type: Number, default: 0 },
      battlesWon: { type: Number, default: 0 },
    },

    /** per-contest running net total (admin dispute screen) — key = contestId */
    contestTotals: { type: mongoose.Schema.Types.Mixed, default: {} },

    version: { type: Number, default: 0 },
  },
  { timestamps: true, optimisticConcurrency: true }
);

walletSchema.virtual("availablePaise").get(function () {
  return this.totalPaise - this.heldPaise;
});

walletSchema.index({ totalPaise: -1 }); // top-players dashboard query

export const Wallet = mongoose.model("Wallet", walletSchema);
