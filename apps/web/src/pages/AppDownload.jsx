import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Panel } from "../components/ui.jsx";
import { onInstallState, canInstall, promptInstall, isStandalone } from "../lib/installApp.js";

/**
 * App Download — installs the PWA shortcut instead of a real APK.
 * Clicking the button shows the browser's native "Install app / Add to Home
 * Screen" dialog (driven by beforeinstallprompt + the service worker).
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
      // wait one tick so the service worker update / installability is settled
      if (deferredNotReady()) await new Promise((r) => setTimeout(r, 400));
      const shown = await promptInstall();
      if (shown) return; // the native dialog appeared
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

  // beforeinstallprompt often fires a beat after we capture state — re-check once
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
              className="mt-1 inline-flex items-center gap-2 rounded-full bg-[#25D366] px-6 py-3 text-sm font-extrabold uppercase tracking-wide text-white shadow-md shadow-emerald-500/30 transition-all hover:bg-[#20bd5a] active:scale-95 disabled:opacity-60"
            >
              {busy ? "Preparing…" : "Download App"}
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