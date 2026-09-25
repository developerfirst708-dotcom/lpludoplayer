import React from "react";

/**
 * Without a boundary, a single throwing component unmounts the whole admin
 * tree and leaves a blank screen (exactly how the ledger/contest crashes looked).
 * This keeps the shell alive, shows the error, and offers a retry.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("admin render error:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-[#f0c2d8] bg-white p-6 shadow-[0_2px_10px_rgba(219,39,119,0.05)]">
        <h2 className="text-lg font-black text-[#2a1520]">Something broke on this screen</h2>
        <p className="mt-1 text-sm text-[#7a3d58]">
          The rest of the panel still works — retry this section or switch to another tab.
        </p>
        <pre className="mt-3 max-h-40 overflow-auto rounded-xl bg-[#fdf1f7] p-3 text-[11px] text-[#be185d]">
          {String(this.state.error?.message || this.state.error)}
        </pre>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-4 rounded-xl bg-gradient-to-br from-[#ec4899] to-[#db2777] px-4 py-2 text-xs font-bold text-white shadow-[0_6px_14px_rgba(219,39,119,0.25)]"
        >
          Try again
        </button>
      </div>
    );
  }
}
