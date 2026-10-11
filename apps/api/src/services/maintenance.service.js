import { getSettings } from "../db/models/settings.model.js";

/**
 * Maintenance-mode gate. A superadmin toggles `settings.maintenanceMode` and
 * every player endpoint answers 503 (reference behaviour). The flag is cached
 * for a few seconds; `setMaintenanceCache` lets the settings writer refresh it
 * immediately so a toggle takes effect on the very next request.
 */
let cache = { at: 0, on: false };

export async function isMaintenanceOn() {
  if (Date.now() - cache.at < 5000) return cache.on;
  try {
    const s = await getSettings();
    cache = { at: Date.now(), on: Boolean(s.maintenanceMode) };
  } catch {
    cache = { at: Date.now(), on: false }; // never block on a settings read failure
  }
  return cache.on;
}

export function setMaintenanceCache(on) {
  cache = { at: Date.now(), on: Boolean(on) };
}
