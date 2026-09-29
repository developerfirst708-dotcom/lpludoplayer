/**
 * Admin panel section permissions — mirrors apps/api/src/utils/permissions.js.
 * superadmin / admin see every section; an agent sees only what it is granted.
 */
export const PERMISSIONS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "matches", label: "Matches" },
  { key: "user", label: "Users" },
  { key: "kyc", label: "KYC" },
  { key: "deposit", label: "Deposits" },
  { key: "withdraw", label: "Withdrawals" },
  { key: "ledger", label: "Ledger" },
  { key: "audit", label: "Audit" },
  { key: "setting", label: "Settings" },
];

export function isFullAdmin(admin) {
  return admin?.role === "superadmin" || admin?.role === "admin";
}

/** can this session see a section? */
export function canSee(admin, perm) {
  if (!admin) return false;
  if (isFullAdmin(admin)) return true;
  return (admin.permissions || []).includes(perm);
}
