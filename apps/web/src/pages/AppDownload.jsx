import React from "react";
import { Link } from "react-router-dom";
import { Panel } from "../components/ui.jsx";

/** App Download — the Android wrapper is published separately from the web app. */
export default function AppDownload() {
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Download the LPLUDO app">
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <img src="/logo.png" alt="LPLUDO" className="h-20 w-auto object-contain" />
          <p className="text-lg font-black tracking-tight text-ink">LPLUDO for Android</p>
          <p className="max-w-xs text-xs font-semibold text-slate-500">
            The app download link will be published here soon. Until then, keep playing right here in your browser —
            everything works the same.
          </p>
          <span className="rounded-full bg-gray-100 px-4 py-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">
            Coming soon
          </span>
          <Link to="/" className="text-xs font-extrabold text-brand-600 hover:text-brand-500">
            ← Back to home
          </Link>
        </div>
      </Panel>
    </div>
  );
}
