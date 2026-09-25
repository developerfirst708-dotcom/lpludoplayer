import { formatPaise } from "@lpludo/shared";

/**
 * Shared admin primitives — light rose theme matching the reference admin panel
 * (white cards on a #fbe6ef canvas, #f0c2d8 borders, pink→magenta accents).
 */

/**
 * Ledger amounts are SIGNED. `signed` renders an explicit +/− and colours the
 * value, which is what an operator expects to see in a money column.
 */
export function Money({ paise, className = "", signed = false }) {
  const value = Number.isInteger(paise) ? paise : 0;
  if (!signed) {
    return <span className={className}>{formatPaise(value)}</span>;
  }
  const tone = value > 0 ? "text-emerald-600" : value < 0 ? "text-rose-600" : "text-[#a56a83]";
  return (
    <span className={`font-semibold tabular-nums ${tone} ${className}`}>
      {value > 0 ? "+" : ""}
      {formatPaise(value)}
    </span>
  );
}

export function Card({ children, className = "" }) {
  return (
    <div className={`rounded-2xl border border-[#f0c2d8] bg-white p-4 shadow-[0_2px_10px_rgba(219,39,119,0.05)] ${className}`}>
      {children}
    </div>
  );
}

export function Panel({ title, action, children, className = "" }) {
  return (
    <Card className={className}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h3 className="text-sm font-bold text-[#2a1520]">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </Card>
  );
}

export function Button({ children, className = "", variant = "primary", ...rest }) {
  const styles = {
    primary:
      "bg-gradient-to-br from-[#ec4899] to-[#db2777] text-white shadow-[0_6px_14px_rgba(219,39,119,0.25)] hover:brightness-[1.05]",
    ghost: "bg-[#fce4ee] text-[#be185d] hover:bg-[#f9d5e5]",
    danger: "bg-rose-600 text-white hover:bg-rose-500",
    success: "bg-emerald-600 text-white hover:bg-emerald-500",
    subtle: "bg-white text-[#7a3d58] border border-[#f0c2d8] hover:bg-[#fdf1f7]",
  };
  return (
    <button
      {...rest}
      className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Input({ label, value, onChange, placeholder, type = "text", className = "", hint, ...rest }) {
  return (
    <div className="space-y-1">
      {label && <label className="block text-xs font-semibold text-[#7a3d58]">{label}</label>}
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`w-full rounded-xl border border-[#f0c2d8] bg-white px-3 py-2 text-sm text-[#2a1520] placeholder-[#c99cb2] outline-none transition-colors focus:border-[#db2777] ${className}`}
        {...rest}
      />
      {hint && <p className="text-[11px] text-[#a56a83]">{hint}</p>}
    </div>
  );
}

export function Select({ label, value, onChange, options = [], placeholder, className = "", ...rest }) {
  return (
    <div className="space-y-1">
      {label && <label className="block text-xs font-semibold text-[#7a3d58]">{label}</label>}
      <select
        value={value}
        onChange={onChange}
        className={`w-full rounded-xl border border-[#f0c2d8] bg-white px-3 py-2 text-sm text-[#2a1520] outline-none transition-colors focus:border-[#db2777] ${className}`}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function Badge({ status, className = "" }) {
  const colors = {
    verified: "bg-emerald-50 text-emerald-700 border-emerald-200",
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
    paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
    running: "bg-emerald-50 text-emerald-700 border-emerald-200",
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    open: "bg-amber-50 text-amber-700 border-amber-200",
    hold: "bg-amber-50 text-amber-700 border-amber-200",
    requested: "bg-amber-50 text-amber-700 border-amber-200",
    join_requested: "bg-amber-50 text-amber-700 border-amber-200",
    result_submitted: "bg-violet-50 text-violet-700 border-violet-200",
    room_submitted: "bg-violet-50 text-violet-700 border-violet-200",
    settled: "bg-violet-50 text-violet-700 border-violet-200",
    cancel_requested: "bg-orange-50 text-orange-700 border-orange-200",
    rejected: "bg-rose-50 text-rose-700 border-rose-200",
    failed: "bg-slate-100 text-slate-600 border-slate-200",
    banned: "bg-rose-50 text-rose-700 border-rose-200",
    cancelled: "bg-[#fdf1f7] text-[#7a3d58] border-[#f0c2d8]",
    expired: "bg-[#fdf1f7] text-[#7a3d58] border-[#f0c2d8]",
    not_submitted: "bg-[#fdf1f7] text-[#7a3d58] border-[#f0c2d8]",
    disabled: "bg-[#fdf1f7] text-[#7a3d58] border-[#f0c2d8]",
    admin: "bg-[#fce4ee] text-[#be185d] border-[#f3cfe0]",
    superadmin: "bg-violet-50 text-violet-700 border-violet-200",
    player: "bg-sky-50 text-sky-700 border-sky-200",
  };
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
        colors[status] || "bg-[#fdf1f7] text-[#7a3d58] border-[#f0c2d8]"
      } ${className}`}
    >
      {String(status || "").replace(/_/g, " ")}
    </span>
  );
}

export function Empty({ title, hint }) {
  return (
    <div className="flex flex-col items-center gap-1 py-10 text-center">
      <p className="text-sm font-bold text-[#7a3d58]">{title}</p>
      {hint && <p className="text-xs text-[#a56a83]">{hint}</p>}
    </div>
  );
}

export function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded-xl bg-[#fce4ee] ${className}`} />;
}

/** Data table — white card, deep header, tinted row hover (reference Table.jsx). */
export function Table({ columns, data, onRowClick, empty, rowKey }) {
  if (!data || data.length === 0) {
    return <Empty title={empty || "No data"} hint="Nothing to show yet." />;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-[#f0c2d8] bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[#111827] text-left text-white">
            {columns.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-3 py-3 text-[11px] font-bold uppercase tracking-wider">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={rowKey ? rowKey(row) : row.id || row._id || i}
              className={`border-b border-[#fbe3ee] last:border-0 ${onRowClick ? "cursor-pointer" : ""} hover:bg-[#fdf1f7]`}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-2.5 align-middle text-[#3d1f2e]">
                  {c.render ? c.render(row) : row[c.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, limit, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  const nums = [];
  for (let p = 1; p <= pages; p += 1) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 2) nums.push(p);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-semibold text-[#a56a83]">
        {total} records · page {page} of {pages}
      </span>
      <div className="flex flex-wrap gap-1">
        <Button variant="subtle" disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</Button>
        {nums.map((p, i) =>
          p === "…" ? (
            <span key={`dots-${i}`} className="px-2 py-1 text-xs font-bold text-[#a56a83]">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onChange(p)}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${
                page === p
                  ? "bg-gradient-to-br from-[#ec4899] to-[#db2777] text-white"
                  : "border border-[#f0c2d8] bg-white text-[#7a3d58] hover:bg-[#fdf1f7]"
              }`}
            >
              {p}
            </button>
          )
        )}
        <Button variant="subtle" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide = false }) {
  if (!open) return null;
  return (
    <div className="fade-in fixed inset-0 z-[2000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#3d1f2e]/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={`relative max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-[#f0c2d8] bg-white p-5 shadow-2xl ${
          wide ? "max-w-3xl" : "max-w-lg"
        }`}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-base font-extrabold text-[#2a1520]">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#fce4ee] text-[#be185d] transition-colors hover:bg-[#f9d5e5]"
          >
            ✕
          </button>
        </div>
        {children}
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/** Dashboard stat card with a coloured icon chip (reference `.card`). */
export function StatCard({ label, value, tone = "pink", hint, icon }) {
  const tones = {
    pink: "bg-[rgba(219,39,119,0.12)] text-[#db2777]",
    blue: "bg-[rgba(59,130,246,0.12)] text-blue-600",
    green: "bg-[rgba(22,163,74,0.12)] text-green-600",
    amber: "bg-[rgba(217,119,6,0.12)] text-amber-600",
    violet: "bg-[rgba(124,58,237,0.12)] text-violet-600",
    cyan: "bg-[rgba(8,145,178,0.12)] text-cyan-600",
    red: "bg-[rgba(220,38,38,0.12)] text-rose-600",
    teal: "bg-[rgba(13,148,136,0.12)] text-teal-600",
  };
  return (
    <Card className="flex items-start gap-3">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-base font-black ${tones[tone]}`}>
        {icon || "•"}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[#7a3d58]">{label}</p>
        <p className="mt-1 truncate text-xl font-black text-[#2a1520]">{value}</p>
        {hint && <p className="mt-0.5 text-[11px] text-[#a56a83]">{hint}</p>}
      </div>
    </Card>
  );
}

/** Page heading used by every screen (reference `.heading`). */
export function PageHeading({ title, subtitle, action }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black text-[#2a1520]">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-[#7a3d58]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function LiveTag({ label = "Live" }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-600">
      <span className="pulse-dot h-[7px] w-[7px] rounded-full bg-emerald-500" />
      {label}
    </span>
  );
}
