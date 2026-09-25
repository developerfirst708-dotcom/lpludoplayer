import { createHash } from "crypto";

/** Normalize a UTR and derive a deterministic hash for duplicate detection. */
export function normalizeUtr(raw) {
  const utr = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  const utrHash = createHash("sha256").update(utr).digest("hex");
  return { utr, utrHash };
}