import { getSettings } from "../db/models/settings.model.js";

/**
 * GET /settings/public — the handful of values the player app reads without
 * logging in (currently the support contact). Never returns deposit/withdrawal
 * configuration or anything an unauthenticated caller should not see.
 */
export async function publicSettings(_req, res) {
  const s = await getSettings();
  res.json({
    supportWhatsapp: s.supportWhatsapp || null,
  });
}
