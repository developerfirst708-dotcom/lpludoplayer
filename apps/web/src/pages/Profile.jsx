import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { socket } from "../lib/socket.js";
import { formatPaise } from "@lpludo/shared";
import { useToast } from "../components/Toast.jsx";
import { Badge, Button, Empty, Panel, Skeleton } from "../components/ui.jsx";
import { NavIcon } from "../components/art.jsx";
import { logout } from "../lib/auth.js";

/**
 * Profile — the player's handle (edited inline on the name itself), the
 * battleludo option boxes (KYC shortcut, "have a referral code?", lifetime
 * stats) and logout. The KYC flow itself lives on its own /kyc page, reached
 * from the KYC shortcut box here.
 */
export default function Profile() {
  const toast = useToast();
  const qc = useQueryClient();
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
      {/* identity */}
      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-card">
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

        {/* lifetime stats (battleludo grid) */}
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-gray-50 px-2 py-2">
            <p className="text-[11px] font-bold text-slate-400">🏆 Total Won</p>
            <p className="text-sm font-black text-emerald-600">{formatPaise(totals.wonPaise ?? 0)}</p>
          </div>
          <div className="rounded-xl bg-gray-50 px-2 py-2">
            <p className="text-[11px] font-bold text-slate-400">🎮 Matches</p>
            <p className="text-sm font-black text-slate-700">{profile.data?.battlesPlayed ?? 0}</p>
          </div>
          <div className="rounded-xl bg-gray-50 px-2 py-2">
            <p className="text-[11px] font-bold text-slate-400">Balance</p>
            <p className="text-sm font-black text-slate-700">{formatPaise(profile.data?.wallet?.availablePaise ?? 0)}</p>
          </div>
        </div>
      </section>

      {/* KYC shortcut box — the verification flow itself lives on /kyc */}
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

      {/* referral box */}
      <div className="rounded-2xl border border-[#FAD655]/70 bg-white p-3.5 shadow-card">
        <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-amber-900">
          Have a referral code?
        </label>

        {profile.data?.referralApplied ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-[11px] font-bold text-emerald-800">
            ✓ Referral code applied to this account
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Enter code (e.g. LP7XK2Q)"
              value={refCode}
              onChange={(e) => setRefCode(e.target.value.toUpperCase())}
              className="min-w-0 flex-1 rounded-xl border border-[#FAD655]/60 bg-[#FEF4BA]/30 px-3 py-2 text-xs font-bold uppercase text-slate-800 outline-none focus:border-brand-500"
            />
            <Button className="shrink-0 px-4 py-2 text-xs" onClick={applyReferralCode} loading={applying} disabled={!refCode.trim()}>
              Apply
            </Button>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 text-[11px]">
          <span className="font-bold text-slate-500">Your code</span>
          <span className="font-mono text-xs font-black text-slate-700">{profile.data?.referralCode || "—"}</span>
        </div>
        <Link to="/refer" className="mt-2 block text-[11px] font-extrabold text-brand-600 hover:text-brand-500">
          Share your code — earn 2% of every battle your friends win →
        </Link>
      </div>

      {/* account + logout */}
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
