import { AuditLog } from "../db/models/auditLog.model.js";
import { log } from "../config/logger.js";

const l = log("audit");

/**
 * Write an audit row for a privileged action. NEVER throws into the request
 * path — a failed audit write must not fail the money operation, but it must
 * be loud in the logs.
 */
export async function writeAudit(actorId, action, targetType, targetId, details = {}) {
  try {
    await AuditLog.create({ actorId, action, targetType, targetId, details });
  } catch (err) {
    l.error({ err: err.message, action, targetId: String(targetId) }, "audit write FAILED");
  }
}