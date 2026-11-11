import React from "react";
import ReactDOM from "react-dom/client";
import Maintenance from "./Maintenance.jsx";
import "./index.css";

/**
 * MAINTENANCE MODE — the admin panel is replaced by a maintenance screen.
 * No app is mounted, so nobody can open the admin login or make any call.
 *
 * Bring the panel back by restoring the normal bootstrap from git history.
 */
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Maintenance />
  </React.StrictMode>
);
