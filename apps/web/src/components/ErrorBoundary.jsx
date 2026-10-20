import React from "react";

/** Catch render-time errors so a bad page never leaves a blank white screen. */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // keep the console visible for debugging
    // eslint-disable-next-line no-console
    console.error("[LPLUDO] render error:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen w-full max-w-[430px] flex-col items-center justify-center gap-3 bg-white px-6 text-center shadow-2xl">
          <img src="/logo.png" alt="LPLUDO" className="h-16 w-auto object-contain" />
          <p className="text-base font-black text-slate-800">Something went wrong on this page</p>
          <p className="text-xs font-semibold text-slate-500">
            {this.state.error?.message || "An unexpected error occurred. Please go back and try again."}
          </p>
          <a
            href="/"
            onClick={(e) => { e.preventDefault(); window.location.href = "/"; }}
            className="mt-1 inline-flex items-center gap-2 rounded-full bg-brand-500 px-5 py-2.5 text-xs font-extrabold uppercase tracking-wide text-neutral-900 shadow-btn-gold transition-all active:scale-95"
          >
            ← Back to home
          </a>
        </div>
      );
    }
    return this.props.children;
  }
}