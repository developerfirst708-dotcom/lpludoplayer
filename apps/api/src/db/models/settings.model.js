import mongoose from "mongoose";

/**
 * Singleton settings doc — the ONLY place UPI ids for deposits live.
 * The reference app hardcoded the VPA in its Flutter constants, so no admin
 * could ever change it without a redeploy.
 */
const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "global" },
    depositUpiId: { type: String, trim: true },
    depositUpiName: { type: String, trim: true },
    depositMinPaise: { type: Number, default: 1000 },   // ₹10
    depositMaxPaise: { type: Number, default: 5000000 }, // ₹50,000
    withdrawalMinPaise: { type: Number, default: 30000 }, // ₹300
    /**
     * Hybrid deposits: amounts BELOW this go through the IMB Pay gateway
     * (auto-verified), amounts at/above it use the manual UPI + UTR flow.
     * ₹5000 default — editable by a superadmin without a redeploy.
     */
    depositGatewayMaxPaise: { type: Number, default: 500000 },
    maintenanceMode: { type: Boolean, default: false },
    /**
     * Support WhatsApp number shown on the Support screen (digits with country
     * code, e.g. 919876543210). Empty = the screen tells players support is
     * not configured yet instead of opening a dead chat.
     */
    supportWhatsapp: { type: String, trim: true, default: "" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const Settings = mongoose.model("Settings", settingsSchema);

/**
 * The withdrawal minimum default moved from ₹1,000 to ₹300 after launch. The
 * singleton settings doc on existing installs still carries the old value, so
 * upgrade it in place — but only while it holds that exact legacy default, so a
 * deliberately configured admin value is never overwritten.
 */
const LEGACY_WITHDRAWAL_MIN_PAISE = 100000; // old ₹1,000 default
const DEFAULT_WITHDRAWAL_MIN_PAISE = 30000; // new ₹300 default

export async function getSettings() {
  let doc = await Settings.findOne({ key: "global" });
  if (!doc) {
    doc = await Settings.create({ key: "global" });
  } else if (doc.withdrawalMinPaise === LEGACY_WITHDRAWAL_MIN_PAISE) {
    doc.withdrawalMinPaise = DEFAULT_WITHDRAWAL_MIN_PAISE;
    await doc.save();
  }
  return doc;
}