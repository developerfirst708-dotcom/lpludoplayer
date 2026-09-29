/**
 * Admin panel section permissions — mirrors the reference admin panel.
 *
 * A superadmin (the main admin) and any `admin` account see every section.
 * An `agent` sees only the sections explicitly granted here. The list is the
 * single source of truth shared by the create/update admin endpoints and the
 * `requirePermission` route guard.
 */
export const ALL_PERMISSIONS = [
  "dashboard",
  "matches",
  "pending_matches",
  "mobile",
  "user",
  "kyc",
  "deposit",
  "withdraw",
  "ledger",
  "audit",
  "setting",
];

/** keep only known, de-duplicated permission keys */
export function sanitizePermissions(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((p) => ALL_PERMISSIONS.includes(p)))];
}
