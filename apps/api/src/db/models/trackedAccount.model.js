import mongoose from "mongoose";

/**
 * TrackedAccount — a mobile number an operator wants to watch (reference app's
 * "client tracking"). The report joins these phones back to real users/contests.
 */
const trackedAccountSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, trim: true },
    name: { type: String, trim: true },
    note: { type: String, trim: true, maxlength: 300 },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

trackedAccountSchema.index({ phone: 1 }, { unique: true });

export const TrackedAccount = mongoose.model("TrackedAccount", trackedAccountSchema);
