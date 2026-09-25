import React from "react";
import { formatPaise } from "@lpludo/shared";

/**
 * Shared UI kit — one light/gold theme everywhere, matching the reference
 * screen in sample_ui_code/Home_page.txt (white cards, shadow-card, brand gold).
 * Money is ALWAYS rendered by the shared formatter, never computed here (F13).
 */

export function Money({ paise, className = "" }) {
  return <span className={className}>{formatPaise(paise)}</span>;
}

/** White rounded card with the sample's soft shadow. */
export function Card({ children, className = "" }) {
  return <div className={`rounded-2xl border border-gray-100 bg-white p-4 shadow-card ${className}`}>{children}</div>;
}

export function Panel({ title, action, children, className = "" }) {
  return (
    <div className={`rounded-2xl border border-gray-100 bg-white p-4 shadow-card ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h3 className="text-base font-black tracking-tight text-ink">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

const BUTTON_VARIANTS = {
  primary: "bg-brand-500 text-neutral-900 hover:bg-[#E5A81E] shadow-btn-gold",
  secondary: "bg-ink text-white hover:bg-neutral-800",
  ghost: "bg-gray-100 text-slate-700 hover:bg-gray-200",
  danger: "bg-rose-600 text-white hover:bg-rose-500",
  success: "bg-emerald-600 text-white hover:bg-emerald-500",
};

export function Button({ children, className = "", variant = "primary", loading = false, disabled, ...rest }) {
  const tone = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary;
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-extrabold tracking-normal transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${tone} ${className}`}
    >
      {loading && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70" aria-hidden="true" />
      )}
      {children}
    </button>
  );
}

export function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded-xl bg-gray-200 ${className}`} />;
}

export function Empty({ title, hint }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-gray-300 bg-white/60 px-4 py-10 text-center">
      <p className="text-sm font-bold text-slate-700">{title}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-10" role="status" aria-label="loading">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-brand-500" />
    </div>
  );
}

/** Section heading with the sample's info dot. */
export function SectionTitle({ title, hint, action }) {
  return (
    <div className="flex items-center justify-between px-1 pt-1">
      <div className="flex items-center gap-2">
        <h2 className="text-2xl font-black tracking-tight text-ink-soft">{title}</h2>
        {hint && (
          <span
            title={hint}
            className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-500 font-serif text-[10px] font-bold italic text-white opacity-75"
          >
            i
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

export function Input({ label, value, onChange, placeholder, type = "text", className = "", hint, ...rest }) {
  return (
    <div className="space-y-1">
      {label && <label className="block text-xs font-bold text-slate-500">{label}</label>}
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition-colors focus:border-brand-500 focus:bg-white disabled:text-slate-400 ${className}`}
        {...rest}
      />
      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

export function Tabs({ value, onChange, children }) {
  return <div className="space-y-3">{children}</div>;
}

export function TabsList({ children }) {
  return <div className="flex gap-1.5 overflow-x-auto border-b border-gray-200 pb-2">{children}</div>;
}

export function TabsButton({ value, children, onChange, activeValue }) {
  const active = value === activeValue;
  return (
    <button
      type="button"
      onClick={() => onChange?.(value)}
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all ${
        active ? "border border-brand-500/40 bg-brand-500/15 text-brand-600" : "text-slate-500 hover:text-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

export function TabsPanel({ value, children, match }) {
  if (match !== value) return null;
  return <div className="animate-rise">{children}</div>;
}

const STATUS_STYLES = {
  open: "bg-amber-50 text-amber-700 border-amber-200",
  join_requested: "bg-sky-50 text-sky-700 border-sky-200",
  running: "bg-emerald-50 text-emerald-700 border-emerald-200",
  room_submitted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  result_submitted: "bg-violet-50 text-violet-700 border-violet-200",
  cancel_requested: "bg-orange-50 text-orange-700 border-orange-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  settled: "bg-emerald-50 text-emerald-700 border-emerald-200",
  result: "bg-violet-50 text-violet-700 border-violet-200",
  cancelled: "bg-gray-100 text-slate-500 border-gray-200",
  expired: "bg-gray-100 text-slate-500 border-gray-200",
  failed: "bg-gray-100 text-slate-500 border-gray-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
};

export function StatusBadge({ status }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
        STATUS_STYLES[status] || "border-gray-200 bg-gray-100 text-slate-600"
      }`}
    >
      {String(status || "").replace(/_/g, " ")}
    </span>
  );
}

export function Badge({ status, amountPaise }) {
  if (amountPaise !== undefined) {
    // ledger amounts are signed integer paise (credits positive, debits negative)
    const isCredit = amountPaise > 0;
    return (
      <span className={`text-xs font-bold ${isCredit ? "text-emerald-600" : "text-rose-600"}`}>
        {isCredit ? "+" : amountPaise < 0 ? "−" : ""}
        {formatPaise(Math.abs(amountPaise))}
      </span>
    );
  }
  const colors = {
    verified: "bg-emerald-50 text-emerald-700 border-emerald-200",
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    joined: "bg-brand-500/15 text-brand-600 border-brand-500/40",
    left: "bg-gray-100 text-slate-500 border-gray-200",
    approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
    rejected: "bg-rose-50 text-rose-700 border-rose-200",
    failed: "bg-gray-100 text-slate-500 border-gray-200",
    not_submitted: "bg-gray-100 text-slate-500 border-gray-200",
  };
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
        colors[status] || "border-gray-200 bg-gray-100 text-slate-600"
      }`}
    >
      {String(status || "").replace(/_/g, " ")}
    </span>
  );
}

