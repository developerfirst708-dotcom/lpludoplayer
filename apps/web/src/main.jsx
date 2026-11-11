import React from "react";
import { createRoot } from "react-dom/client";
import Maintenance from "./Maintenance.jsx";
import "./index.css";

/**
 * MAINTENANCE MODE — the entire app is replaced by a maintenance screen.
 * No app is mounted, no router is created, no API call can be made from the
 * UI: visitors only ever see the maintenance page and nobody can log in.
 *
 * Bring the site back by restoring the normal bootstrap from git history.
 */
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Maintenance />
  </React.StrictMode>
);

// Keep the service worker registered so the bumped worker (sw.js v2) replaces
// cached copies of the old app shell on every visitor's device.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
