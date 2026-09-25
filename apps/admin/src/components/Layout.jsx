import React, { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { socket } from "../lib/socket.js";
import { logout } from "../lib/auth.js";

/**
 * App shell for the admin panel — 260px white sidebar + rose canvas content,
 * mirroring the reference panel (lpludo/refrence_project/admin). On mobile the
 * sidebar becomes a drawer with a fixed topbar and hamburger button.
 */

const ICONS = {
  dashboard: <path d="M3 3h8v8H3V3Zm10 0h8v5h-8V3ZM3 13h8v8H3v-8Zm10 4h8v4h-8v-4Z" />,
  users: <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M13 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.87M11 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />,
  kyc: <path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5M14 3l7 7v11a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM14 3v7h7M8 13h4M8 17h4" />,
  deposit: <path d="M12 5v14M5 12l7 7 7-7" />,
  withdraw: <path d="M12 19V5M5 12l7-7 7 7" />,
  matches: <path d="M6 12h4M8 10v4M15 13h.01M18 11h.01M17.32 5H6.68a4 4 0 0 0-3.98 3.6l-.5 5A4 4 0 0 0 6.18 18a3.5 3.5 0 0 0 2.79-1.38L10 15h4l1.03 1.62A3.5 3.5 0 0 0 17.82 18a4 4 0 0 0 3.98-4.4l-.5-5A4 4 0 0 0 17.32 5Z" />,
  ledger: <path d="M4 4h16v16H4V4Zm3 4h10M7 12h10M7 16h6" />,
  audit: <path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3ZM9.5 12l1.8 1.8L14.5 10" />,
  settings: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-2-1.2L14.4 3h-4l-.5 2.5a7.6 7.6 0 0 0-2 1.2l-2.5-1-2 3.5 2.1 1.6a7.4 7.4 0 0 0 0 2.4L3.4 14.8l2 3.5 2.5-1a7.6 7.6 0 0 0 2 1.2l.5 2.5h4l.5-2.5a7.6 7.6 0 0 0 2-1.2l2.5 1 2-3.5-2.1-1.6c.07-.4.1-.8.1-1.2Z" />,
};

function Icon({ name, size = 18 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name] || ICONS.dashboard}
    </svg>
  );
}

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { to: "/matches", label: "Matches", icon: "matches" },
  { to: "/users", label: "Users", icon: "users" },
  { to: "/kyc", label: "KYC", icon: "kyc" },
  { to: "/deposits", label: "Deposits", icon: "deposit" },
  { to: "/withdrawals", label: "Withdrawals", icon: "withdraw" },
  { to: "/ledger", label: "Ledger", icon: "ledger" },
  { to: "/audit", label: "Audit", icon: "audit" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

const PAGE_TITLES = Object.fromEntries(NAV.map((n) => [n.to, n.label]));

export default function Layout({ children, admin }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // one listener for the whole panel: any server-side change invalidates every
  // cached query, so no screen ever needs a manual refresh
  useEffect(() => {
    if (!socket.connected) socket.connect();
    const refresh = () => qc.invalidateQueries();
    socket.on("admin:refresh", refresh);
    socket.on("connect", refresh);
    return () => {
      socket.off("admin:refresh", refresh);
      socket.off("connect", refresh);
    };
  }, [qc]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="flex min-h-screen">
      {/* mobile overlay */}
      <div
        className={`fixed inset-0 z-[999] bg-[#3d1f2e]/45 backdrop-blur-[2px] md:hidden ${open ? "block" : "hidden"}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      <aside
        className={`fixed inset-y-0 left-0 z-[1000] flex w-[270px] max-w-[85vw] flex-col overflow-y-auto border-r border-[#f0c2d8] bg-white px-3.5 pb-5 pt-5 transition-transform duration-300 md:sticky md:top-0 md:h-screen md:translate-x-0 md:rounded-none ${
          open ? "translate-x-0 rounded-r-2xl shadow-2xl" : "-translate-x-[105%]"
        }`}
      >
        <div className="mb-3 flex items-center gap-2.5 border-b border-[#fbe3ee] px-2 pb-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#ec4899] to-[#db2777] text-sm font-black text-white shadow-[0_6px_16px_rgba(219,39,119,0.3)]">
            LP
          </span>
          <h2 className="text-lg font-extrabold leading-tight text-[#2a1520]">LPLUDO Admin</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#fce4ee] text-[#be185d] md:hidden"
          >
            ✕
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all active:scale-[0.985] ${
                  isActive
                    ? "bg-gradient-to-br from-[#ec4899] to-[#db2777] text-white shadow-[0_8px_18px_rgba(219,39,119,0.25)]"
                    : "text-[#7a3d58] hover:bg-[#fce4ee] hover:text-[#2a1520]"
                }`
              }
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="mt-4 shrink-0 border-t border-[#fbe3ee] pt-4">
          <div className="mb-3 flex items-center gap-2.5 px-1">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#fce4ee] text-sm font-black text-[#be185d]">
              {(admin?.name || "A")[0].toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-[#2a1520]">{admin?.name || "Admin"}</p>
              <p className="truncate text-[11px] text-[#a56a83]">{admin?.role || "admin"}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full rounded-xl bg-[#ef4444] px-3 py-3 text-sm font-extrabold text-white transition-colors hover:bg-[#dc2626]"
          >
            Logout
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-3.5 pb-7 pt-[76px] md:px-6 md:py-6">
        <header className="fixed inset-x-0 top-0 z-[900] flex items-center gap-3 border-b border-[#f0c2d8] bg-white/95 px-3.5 py-2.5 backdrop-blur md:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#ec4899] to-[#db2777] text-white shadow-[0_6px_14px_rgba(219,39,119,0.3)]"
          >
            <span className="flex h-3.5 w-5 flex-col justify-between">
              <span className="block h-0.5 w-full rounded bg-white" />
              <span className="block h-0.5 w-full rounded bg-white" />
              <span className="block h-0.5 w-full rounded bg-white" />
            </span>
          </button>
          <div className="min-w-0">
            <h3 className="truncate text-base font-extrabold text-[#2a1520]">
              {PAGE_TITLES[location.pathname] || "Admin"}
            </h3>
            <span className="text-[11px] font-semibold text-[#a56a83]">Admin Panel</span>
          </div>
        </header>

        <div className="fade-in mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
