import mongoose from "mongoose";

const attachmentSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // storage key inside LOCAL_STORAGE_DIR
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    uploadedAt: { type: Date, default: Date.now },
    bytes: { type: Number },
    mime: { type: String },
  },
  { _id: false }
);

/**
 * Contest.resultReports — both players' own claims, kept for the dispute trail.
 * Auto-settle rule (open question #1): when both players report the SAME
 * winner, the system settles immediately; any disagreement becomes a conflict
 * that an admin (or the SLA auto-refund job) must resolve.
 */
const resultReportSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    outcome: { type: String, enum: ["won", "lost", "cancel"], required: true },
    reportedAt: { type: Date, default: Date.now },
    screenshots: { type: [attachmentSchema], default: [] },
  },
  { _id: false }
);

const contestSchemaExtra = {
  resultReports: { type: [resultReportSchema], default: [] },
};

export function applyContestSchemaExtras(schema) {
  schema.add(contestSchemaExtra);
  return schema;
}

export { attachmentSchema, resultReportSchema };