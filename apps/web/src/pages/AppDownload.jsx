import React from "react";
import { Link } from "react-router-dom";
import { Panel } from "../components/ui.jsx";

/** App Download — serve the Android WebView wrapper (apps/android → app.apk). */
export default function AppDownload() {
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Download the LPLUDO app">
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <img src="/logo.png" alt="LPLUDO" className="h-20 w-auto object-contain" />
          <p className="text-lg font-black tracking-tight text-ink">LPLUDO for Android</p>
          <p className="max-w-xs text-xs font-semibold text-slate-500">
            Install the app on your phone and play anywhere. Deposits and withdrawals work exactly like the website.
          </p>

          <a
            href="/app.apk"
            download
            className="mt-1 inline-flex items-center gap-2 rounded-full bg-[#25D366] px-6 py-3 text-sm font-extrabold uppercase tracking-wide text-white shadow-md shadow-emerald-500/30 transition-all hover:bg-[#20bd5a] active:scale-95"
          >
            Download .APK (Android)
          </a>

          <p className="text-[11px] font-semibold text-slate-400">
            Allow "install from unknown sources" when prompted.
          </p>

          <Link to="/" className="text-xs font-extrabold text-brand-600 hover:text-brand-500">
            ← Back to home
          </Link>
        </div>
      </Panel>
    </div>
  );
}