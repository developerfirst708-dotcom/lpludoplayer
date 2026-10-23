import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Panel } from "../components/ui.jsx";
import { onInstallState, canInstall, promptInstall, isStandalone } from "../lib/installApp.js";

/**
 * App Download — installs the PWA shortcut / app.
 */
const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  !window.MSStream;

export default function AppDownload() {
  const [state, setState] = useState({ canPrompt: false, installed: isStandalone() });

  useEffect(() => onInstallState((s) => setState(s)), []);

  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");

  async function handleInstall() {
    setBusy(true);
    try {
      if (deferredNotReady()) await new Promise((r) => setTimeout(r, 400));
      const shown = await promptInstall();
      if (shown) return; // Native dialog appeared
      if (state.installed) {
        setHint("The app is already installed on this device.");
      } else if (isIOS()) {
        setHint("On iPhone/iPad, tap the Share button in Safari, then “Add to Home Screen”.");
      } else {
        setHint("The install option isn’t available on this device just yet — try again in a moment, or open this site in Chrome.");
      }
    } finally {
      setBusy(false);
    }
  }

  function deferredNotReady() {
    return !canInstall() && !state.installed;
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Download the LPLUDO app">
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <img src="/logo.png" alt="LPLUDO" className="h-20 w-auto object-contain" />
          <p className="text-lg font-black tracking-tight text-ink">LPLUDO for Android</p>
          <p className="max-w-xs text-xs font-semibold text-slate-500">
            Install the app shortcut on your phone and play anywhere. Deposits and withdrawals work exactly like the website.
          </p>

          {!state.installed && (
            <button
              type="button"
              onClick={handleInstall}
              disabled={busy}
              className="mt-2 inline-flex items-center gap-2.5 rounded-full border-2 border-[#1E1E1E] bg-[#FEF0B6] p-1.5 pr-6 shadow-md transition-all hover:brightness-95 active:scale-95 disabled:opacity-60"
            >
              {/* Green Circle Badge with Download Icon */}
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#48C79C]">
                <svg
                  className="h-4 w-4 text-white"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M7.5 12l4.5 4.5m0 0l4.5-4.5M12 16.5V3"
                  />
                </svg>
              </div>

              {/* Text Label */}
              <span className="text-sm font-black text-[#1E1E1E]">
                {busy ? "Preparing…" : "Download"}
              </span>
            </button>
          )}

          <p className="text-[11px] font-semibold text-slate-400">
            {state.installed
              ? "LPLUDO is already installed as an app on this device."
              : hint || "A popup will confirm installing the app on your device."}
          </p>

          <Link to="/" className="text-xs font-extrabold text-brand-600 hover:text-brand-500">
            ← Back to home
          </Link>
        </div>
      </Panel>
    </div>
  );
}
