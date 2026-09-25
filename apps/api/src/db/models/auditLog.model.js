import mongoose from "mongoose";

/**
 * AuditLog — every privileged mutation lands here (S13: the reference app had
 * zero admin audit trail, so a wrong deposit approval was undebuggable).
 */
const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    action: { type: String, required: true, index: true },
    targetType: { type: String, enum: ["user", "contest", "deposit", "withdrawal", "settings", "system"], required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);