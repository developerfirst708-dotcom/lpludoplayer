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
    withdrawalMinPaise: { type: Number, default: 100000 }, // ₹1,000
    /**
     * Hybrid deposits: amounts BELOW this go through the IMB Pay gateway
     * (auto-verified), amounts at/above it use the manual UPI + UTR flow.
     * ₹5000 default — editable by a superadmin without a redeploy.
     */
    depositGatewayMaxPaise: { type: Number, default: 500000 },
    maintenanceMode: { type: Boolean, default: false },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const Settings = mongoose.model("Settings", settingsSchema);

export async function getSettings() {
  let doc = await Settings.findOne({ key: "global" });
  if (!doc) doc = await Settings.create({ key: "global" });
  return doc;
}