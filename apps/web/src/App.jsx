import React, { useEffect, useState } from "react";
import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatPaise } from "@lpludo/shared";
import { subscribe, tryResume, authState } from "./lib/auth.js";
import { api } from "./lib/api.js";
import Home from "./pages/Home.jsx";
import Play from "./pages/Play.jsx";
import Battle from "./pages/Battle.jsx";
import Wallet from "./pages/Wallet.jsx";
import Profile from "./pages/Profile.jsx";
import Login from "./pages/Login.jsx";
import Support from "./pages/Support.jsx";
import Refer from "./pages/Refer.jsx";
import ReferHistory from "./pages/ReferHistory.jsx";
import History from "./pages/History.jsx";
import Redeem from "./pages/Redeem.jsx";
import AppDownload from "./pages/AppDownload.jsx";
import { Spinner } from "./components/ui.jsx";
import { NavIcon } from "./components/art.jsx";

/**
 * App shell reproduced from sample_ui_code/Home_page.txt: a 430px "device"
 * column (centred on desktop, full-bleed on mobile). The header now carries the
 * app logo, the deposit balance chip and the referral (coins) chip plus the
 * navigation drawer with every option the reference sidebar had.
 */

const NAV = [
  { to: "/support", label: "Support", icon: "support" },
  { to: "/refer", label: "Refer", icon: "gift" },
  { to: "/", label: "Home", icon: "home" },
  { to: "/wallet", label: "Wallet", icon: "wallet" },
  { to: "/profile", label: "Profile", icon: "user" },
];

const DRAWER_ITEMS = [
  { to: "/profile", label: "My Profile", icon: "user", tone: "text-blue-600" },
  { to: "/play", label: "Play Game", icon: "play", tone: "text-indigo-600" },
  { to: "/wallet", label: "My Wallet", icon: "wallet", tone: "text-emerald-600" },
  { to: "/refer", label: "Refer and Earn", icon: "gift", tone: "text-amber-600" },
  { to: "/history", label: "History", icon: "history", tone: "text-purple-600" },
  { to: "/refer-history", label: "Refer History", icon: "list", tone: "text-teal-600" },
  { to: "/support", label: "Support", icon: "support", tone: "text-rose-600" },
  { to: "/app-download", label: "App Download", icon: "download", tone: "text-sky-600" },
];

function useWalletView() {
  const { data } = useQuery({ queryKey: ["wallet"], queryFn: () => api("/wallet") });
  return data;
}

function AppHeader({ onOpenMenu }) {
  const wallet = useWalletView();
  const available = wallet?.availablePaise;

  return (
    <section className="flex items-center gap-2.5 px-4 py-2.5" data-purpose="app-header">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-800 transition-colors hover:bg-gray-100 active:scale-95"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 stroke-current" fill="none" viewBox="0 0 24 24" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <Link to="/" aria-label="LPLUDO home" className="flex items-center transition-transform active:scale-95">
        <img src="/logo.jpg" alt="LPLUDO" className="h-9 w-auto max-w-[130px] object-contain" />
      </Link>

      <div className="ml-auto flex items-center gap-1.5">
        {/* deposit balance */}
        <Link
          to="/wallet"
          aria-label="Wallet balance"
          className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-1 shadow-sm transition-transform active:scale-95"
        >
          <span className="text-sm leading-none">💵</span>
          <span className="text-sm font-extrabold tracking-wide text-slate-900">
            {available === undefined ? "—" : formatPaise(available, { withSymbol: false })}
          </span>
        </Link>

        {/* referral (coins) balance -> redeem */}
        <Link
          to="/redeem"
          aria-label="Referral balance"
          className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-1 shadow-sm transition-transform active:scale-95"
        >
          <span className="text-sm leading-none">🪙</span>
          <span className="text-sm font-extrabold tracking-wide text-slate-900">
            {formatPaise(wallet?.referralPaise ?? 0, { withSymbol: false })}
          </span>
        </Link>
      </div>
    </section>
  );
}

function Drawer({ open, onClose }) {
  return (
    <>
      {open && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] transition-opacity"
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[80%] flex-col bg-slate-50 shadow-2xl transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <img src="/logo.jpg" alt="LPLUDO" className="h-7 w-auto object-contain" />
            <h2 className="text-base font-black tracking-tight text-slate-800">Menu</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-xl p-1.5 text-slate-500 transition-colors hover:bg-slate-200/60"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 space-y-2.5 overflow-y-auto p-4">
          {DRAWER_ITEMS.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              onClick={onClose}
              className="group flex w-full items-center justify-between rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm transition-all hover:border-brand-500/60 hover:shadow-md active:scale-[0.98]"
            >
              <span className="flex items-center gap-3">
                <span className="rounded-xl border border-slate-100 bg-slate-50 p-2 transition-colors group-hover:bg-brand-500/10">
                  <NavIcon name={item.icon} className={`h-5 w-5 ${item.tone}`} />
                </span>
                <span className="text-sm font-bold text-slate-700 group-hover:text-slate-900">{item.label}</span>
              </span>
              <svg className="h-4 w-4 text-slate-400 transition-all group-hover:translate-x-1 group-hover:text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
}

function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-center">
      <div className="w-full max-w-[430px] border-t border-gray-200 bg-white/95 backdrop-blur">
        <div className="grid grid-cols-5">
          {NAV.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-bold transition-colors ${
                  active ? "text-brand-600" : "text-slate-400 hover:text-slate-600"
                }`}
              >
                <NavIcon name={item.icon} className="h-6 w-6" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

export default function App() {
  const [auth, setAuth] = useState(authState());
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    tryResume();
    return subscribe(setAuth);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (!auth.ready) {
    return (
      <div className="flex min-h-screen w-full max-w-[430px] items-center justify-center bg-white shadow-2xl">
        <Spinner />
      </div>
    );
  }

  if (!auth.user) {
    return (
      <div className="flex min-h-screen w-full max-w-[430px] flex-col bg-white shadow-2xl">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen w-full max-w-[430px] flex-col bg-white shadow-2xl">
      <AppHeader onOpenMenu={() => setMenuOpen(true)} />
      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} />
      <main className="flex-1 space-y-4 px-4 pb-28 pt-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/play" element={<Play />} />
          <Route path="/battle" element={<Battle />} />
          <Route path="/battle/:id" element={<Battle />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/support" element={<Support />} />
          <Route path="/refer" element={<Refer />} />
          <Route path="/refer-history" element={<ReferHistory />} />
          <Route path="/history" element={<History />} />
          <Route path="/redeem" element={<Redeem />} />
          <Route path="/app-download" element={<AppDownload />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  );
}
