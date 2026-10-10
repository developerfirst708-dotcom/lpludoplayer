import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { socket } from "../lib/socket.js";
import { formatPaise } from "@lpludo/shared";
import { useToast } from "../components/Toast.jsx";
import { Badge, Button, Empty, Panel, Skeleton } from "../components/ui.jsx";
import { NavIcon } from "../components/art.jsx";
import { logout } from "../lib/auth.js";

/**
 * Profile — player details, KYC shortcut, referral code application,
 * quick navigation menu (History, My Wallet, Refer & Earn, Support), and account management.
 */
export default function Profile() {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [refCode, setRefCode] = useState("");
  const [applying, setApplying] = useState(false);

  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api("/user/profile") });

  // realtime: admin KYC verdicts + wallet movements land without a reload (F2)
  useEffect(() => {
    if (!socket.connected) socket.connect();
    function refresh() {
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
    }
    socket.on("kyc:updated", refresh);
    socket.on("wallet:updated", refresh);
    return () => {
      socket.off("kyc:updated", refresh);
      socket.off("wallet:updated", refresh);
    };
  }, [qc]);

  useEffect(() => {
    if (profile.data?.user?.name) setName(profile.data.user.name);
  }, [profile.data]);

  const u = profile.data?.user || {};
  const kycStatus = u.kycStatus || "not_submitted";
  const kycVerified = kycStatus === "verified";

  async function saveName() {
    setSavingName(true);
    try {
      await api("/user/profile", { method: "PATCH", body: { name } });
      toast.success("Display name updated");
      setEditingName(false);
      qc.invalidateQueries({ queryKey: ["profile"] });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingName(false);
    }
  }

  async function applyReferralCode() {
    setApplying(true);
    try {
      await api("/user/referral", { method: "POST", body: { code: refCode.trim() } });
      toast.success("Referral code applied");
      setRefCode("");
      qc.invalidateQueries({ queryKey: ["profile"] });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setApplying(false);
    }
  }

  if (profile.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (profile.isError) return <Empty title="Profile unavailable" hint={profile.error?.message} />;

  const totals = profile.data?.wallet?.totals || {};

  return (
    <div className="space-y-4">
      {/* Identity Card with Dynamic Yellow Border */}
      <section className="rounded-2xl border border-[#FAD655] bg-white p-4 shadow-card">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-300 via-brand-500 to-[#C98509] text-xl font-black text-white shadow-inner">
            {u.name?.[0]?.toUpperCase() || "L"}
          </div>
          <div className="min-w-0">
            {editingName ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  placeholder="Your player name"
                  className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm font-bold text-slate-900 outline-none focus:border-brand-500 focus:bg-white"
                />
                <button
                  type="button"
                  onClick={saveName}
                  disabled={savingName || !name.trim() || name === u.name}
                  className="shrink-0 rounded-lg bg-brand-500 px-2.5 py-1.5 text-[11px] font-black uppercase text-neutral-900 shadow-btn-gold transition-all active:scale-95 disabled:opacity-50"
                >
                  {savingName ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setName(u.name || "");
                    setEditingName(false);
                  }}
                  aria-label="Cancel rename"
                  className="shrink-0 rounded-lg bg-gray-100 px-2 py-1.5 text-[11px] font-black text-slate-500 transition-all active:scale-95"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <p className="truncate text-lg font-black tracking-tight text-ink">{u.name || "—"}</p>
                <button
                  type="button"
                  onClick={() => setEditingName(true)}
                  aria-label="Edit display name"
                  className="shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-gray-100 hover:text-brand-600 active:scale-95"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                  </svg>
                </button>
              </div>
            )}
            <p className="text-xs font-semibold text-slate-400">+91 {profile.data?.phone || "—"}</p>
          </div>
          <div className="ml-auto">
            <Badge status={kycStatus} />
          </div>
        </div>

        {/* Lifetime Stats */}
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {/* Total Won: Light Yellow */}
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-2 py-2">
            <p className="text-[11px] font-bold text-amber-800">🏆 Total Won</p>
            <p className="text-sm font-black text-emerald-600">{formatPaise(totals.wonPaise ?? 0)}</p>
          </div>
          {/* Matches: Light Sky Blue */}
          <div className="rounded-xl border border-sky-200 bg-sky-50/80 px-2 py-2">
            <p className="text-[11px] font-bold text-sky-800">🎮 Matches</p>
            <p className="text-sm font-black text-slate-700">{profile.data?.battlesPlayed ?? 0}</p>
          </div>
          {/* Balance: Light Green */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-2 py-2">
            <p className="text-[11px] font-bold text-emerald-800">Balance</p>
            <p className="text-sm font-black text-slate-700">{formatPaise(profile.data?.wallet?.availablePaise ?? 0)}</p>
          </div>
        </div>
      </section>

      {/* KYC Shortcut Box */}
      <Link
        to="/kyc"
        className="flex items-center justify-between rounded-2xl border border-[#FAD655]/70 bg-white p-3.5 shadow-card transition-all active:scale-[0.99]"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500/15 text-base">🆔</div>
          <div>
            <h4 className="text-xs font-black uppercase tracking-wide text-slate-800">KYC Verification</h4>
            <p className="mt-0.5 text-[10px] font-semibold text-slate-500">
              {kycVerified ? "Identity verified" : "Required for withdrawals"}
            </p>
          </div>
        </div>

        {kycVerified ? (
          <span className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-[10px] font-extrabold uppercase text-emerald-800">
            ✓ Verified
          </span>
        ) : (
          <span className="rounded-xl bg-brand-500 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-neutral-900 shadow-btn-gold">
            {kycStatus === "pending" ? "Under review" : "Complete KYC"}
          </span>
        )}
      </Link>

      {/* Referral Code Box (Matching KYC Box Size) */}
      <div className="rounded-2xl border border-[#FAD655]/70 bg-white p-3.5 shadow-card">
        {profile.data?.referralApplied ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2 text-center text-xs font-bold text-emerald-800">
            ✓ Referral code applied
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Have a referral code?"
              value={refCode}
              onChange={(e) => setRefCode(e.target.value.toUpperCase())}
              className="min-w-0 flex-1 rounded-xl border border-[#FAD655]/60 bg-[#FEF4BA]/30 px-3 py-2 text-xs font-bold uppercase text-slate-800 outline-none focus:border-brand-500"
            />
            <Button
              className="shrink-0 px-4 py-2 text-xs"
              onClick={applyReferralCode}
              loading={applying}
              disabled={!refCode.trim()}
            >
              Apply
            </Button>
          </div>
        )}
      </div>

      {/* Profile Navigation List with Light Yellow Border */}
      <div className="overflow-hidden rounded-2xl border border-[#FAD655]/70 bg-white shadow-card">
        <div className="divide-y divide-gray-100">
          {/* History -> Redirects to /history (slider history) */}
          <button
            type="button"
            onClick={() => navigate("/history")}
            className="flex w-full items-center justify-between px-4 py-3.5 transition-colors hover:bg-gray-50 active:bg-gray-100"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <span className="text-sm font-bold text-slate-800">History</span>
            </div>
            <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* My Wallet */}
          <button
            type="button"
            onClick={() => navigate("/wallet")}
            className="flex w-full items-center justify-between px-4 py-3.5 transition-colors hover:bg-gray-50 active:bg-gray-100"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="text-sm font-bold text-slate-800">My Wallet</span>
            </div>
            <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* Refer & Earn */}
          <button
            type="button"
            onClick={() => navigate("/refer")}
            className="flex w-full items-center justify-between px-4 py-3.5 transition-colors hover:bg-gray-50 active:bg-gray-100"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V6a2 2 0 10-2 2h2zm0 13C10.832 21 2 13.582 2 8c0-2.21 1.79-4 4-4 2.21 0 4 1.79 4 4 0 5.582-8.832 13-10 13z" />
                </svg>
              </div>
              <span className="text-sm font-bold text-slate-800">Refer & Earn</span>
            </div>
            <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* Support */}
          <button
            type="button"
            onClick={() => navigate("/support")}
            className="flex w-full items-center justify-between px-4 py-3.5 transition-colors hover:bg-gray-50 active:bg-gray-100"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <span className="text-sm font-bold text-slate-800">Support</span>
            </div>
            <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Account Info & Logout */}
      <Panel title="Account">
        <div className="space-y-2.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-slate-500">Account ID</span>
            <span className="truncate font-mono text-xs text-slate-600">{u.id}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-500">Member since</span>
            <span className="font-bold text-slate-600">
              {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
            </span>
          </div>
          <button
            type="button"
            onClick={logout}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-full bg-gray-100 py-2.5 text-sm font-extrabold text-rose-600 transition-all hover:bg-rose-50 active:scale-95"
          >
            <NavIcon name="logout" className="h-4 w-4" />
            Log out
          </button>
        </div>
      </Panel>
    </div>
  );
}
