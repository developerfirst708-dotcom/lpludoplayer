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
import { Spinner } from "./components/ui.jsx";
import { Monogram, CoinIcon, NavIcon } from "./components/art.jsx";

/**
 * App shell reproduced from sample_ui_code/Home_page.txt: a 430px "device"
 * column (centred on desktop, full-bleed on mobile) with the LR monogram header
 * on the left and the gold wallet pill on the right. Log out now lives on the
 * Profile screen so the header stays identical to the reference design.
 */

const NAV = [
  { to: "/", label: "Home", icon: "home" },
  { to: "/wallet", label: "Wallet", icon: "wallet" },
  { to: "/profile", label: "Profile", icon: "user" },
];

function WalletPill() {
  const { data } = useQuery({ queryKey: ["wallet"], queryFn: () => api("/wallet") });
  const available = data?.availablePaise;
  return (
    <Link
      to="/wallet"
      aria-label="Wallet balance"
      className="flex items-center gap-2 rounded-full border-2 border-[#F6C64D] bg-white px-3.5 py-1 shadow-sm transition-transform active:scale-95"
    >
      <CoinIcon className="h-5 w-5" />
      <span className="text-sm font-bold tracking-wide text-gray-900">
        {available === undefined ? "—" : formatPaise(available, { withSymbol: false })}
      </span>
    </Link>
  );
}

function AppHeader() {
  return (
    <section className="flex items-center justify-between px-5 py-2.5">
      <Link to="/" aria-label="LPLUDO home" className="transition-transform active:scale-95">
        <Monogram />
      </Link>
      <WalletPill />
    </section>
  );
}

function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-center">
      <div className="w-full max-w-[430px] border-t border-gray-200 bg-white/95 backdrop-blur">
        <div className="grid grid-cols-3">
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

  useEffect(() => {
    tryResume();
    return subscribe(setAuth);
  }, []);

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
      <AppHeader />
      <main className="flex-1 space-y-4 px-4 pb-28 pt-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/play" element={<Play />} />
          <Route path="/battle/:id" element={<Battle />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  );
}
