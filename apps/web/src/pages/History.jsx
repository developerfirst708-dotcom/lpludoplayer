import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { formatPaise } from "@lpludo/shared";
import { Empty, Skeleton, Tabs, TabsButton, TabsList, TabsPanel } from "../components/ui.jsx";

/**
 * History — the reference's four ledgers on real data:
 *   Game     → battles you played (won / lost / cancelled)
 *   Wallet   → deposits + withdrawals (the ledger rows)
 *   Penalty  → negative admin adjustments
 *   Bonus    → referral commissions + positive adjustments
 */

const SETTLED = ["approved", "cancelled", "expired"];
const WITHDRAWAL_TYPES = ["withdrawal_hold", "withdrawal_paid", "withdrawal_refund"];

function statusPill(status) {
  const tone =
    status === "WON"
      ? "bg-emerald-100 text-emerald-800 border-emerald-300"
      : status === "LOSS"
        ? "bg-rose-100 text-rose-800 border-rose-300"
        : status === "Cancelled"
          ? "bg-slate-100 text-slate-700 border-slate-300"
          : "bg-amber-100 text-amber-800 border-amber-300";
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${tone}`}>
      {status}
    </span>
  );
}

export default function History() {
  const [tab, setTab] = useState("game");
  const [walletTab, setWalletTab] = useState("deposit");

  const mine = useQuery({
    queryKey: ["contests", "mine", "history"],
    queryFn: () => api("/contests/mine?limit=50"),
  });
  const ledger = useQuery({
    queryKey: ["wallet", "history", "100"],
    queryFn: () => api("/wallet/history?limit=100"),
  });

  const rows = ledger.data?.items || [];
  const deposits = rows.filter((r) => r.type === "deposit");
  const withdrawals = rows.filter((r) => WITHDRAWAL_TYPES.includes(r.type));
  const penalties = rows.filter((r) => r.type === "admin_adjustment" && r.amountPaise < 0);
  const bonuses = rows.filter(
    (r) => r.type === "referral_commission" || (r.type === "admin_adjustment" && r.amountPaise > 0)
  );

  const games = (mine.data?.items || []).filter((c) => SETTLED.includes(c.status));

  const loading = mine.isLoading || ledger.isLoading;

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <h1 className="text-xl font-black uppercase tracking-wide text-ink">History</h1>
        <p className="text-xs font-semibold text-slate-500">
          Your gameplay, wallet transactions, bonuses and penalties
        </p>
      </div>

      <Tabs value={tab} onChange={setTab}>
        <TabsList>
          <TabsButton value="game" activeValue={tab} onChange={setTab}>Game</TabsButton>
          <TabsButton value="wallet" activeValue={tab} onChange={setTab}>Wallet</TabsButton>
          <TabsButton value="penalty" activeValue={tab} onChange={setTab}>Penalty</TabsButton>
          <TabsButton value="bonus" activeValue={tab} onChange={setTab}>Bonus</TabsButton>
        </TabsList>

        {/* ---------------- game history ---------------- */}
        <TabsPanel match={tab} value="game">
          <div className="space-y-3">
            {loading && <Skeleton className="h-28 w-full" />}
            {!loading && games.length === 0 && <Empty title="No game history" hint="Played battles appear here once settled." />}

            {games.map((c) => {
              const me = c.players?.find((p) => p.isYou);
              const opponent = c.players?.find((p) => !p.isYou);
              const won = c.winnerUserId && me && String(c.winnerUserId) === String(me.userId);
              const status = c.status === "approved" ? (won ? "WON" : "LOSS") : "Cancelled";

              return (
                <div key={c.id} className="rounded-2xl border border-gray-100 bg-white p-3.5 shadow-card">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-[10px] font-bold text-slate-400">
                      🕒 {new Date(c.createdAt).toLocaleString()}
                    </span>
                    {statusPill(status)}
                  </div>

                  <div className="my-2 flex items-center justify-between">
                    <div className="flex-1 rounded-xl border border-gray-100 bg-gray-50 px-2 py-1.5 text-center">
                      <span className="block text-[10px] font-extrabold uppercase text-slate-400">You</span>
                      <span className="block truncate text-xs font-black text-slate-800">{me?.name || "You"}</span>
                    </div>
                    <span className="px-2 text-xs font-black uppercase italic text-brand-500">vs</span>
                    <div className="flex-1 rounded-xl border border-gray-100 bg-gray-50 px-2 py-1.5 text-center">
                      <span className="block text-[10px] font-extrabold uppercase text-slate-400">Opponent</span>
                      <span className="block truncate text-xs font-black text-slate-800">{opponent?.name || "—"}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-xl bg-brand-500/5 p-2 text-center">
                    <div>
                      <span className="block text-[9px] font-bold uppercase text-slate-500">Game Amount</span>
                      <span className="text-xs font-black text-amber-900">{formatPaise(c.stake)}</span>
                    </div>
                    <div>
                      <span className="block text-[9px] font-bold uppercase text-slate-500">Won Amount</span>
                      <span className={`text-xs font-black ${won ? "text-emerald-600" : "text-slate-400"}`}>
                        {formatPaise(won ? c.prize || 0 : 0)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </TabsPanel>

        {/* ---------------- wallet history ---------------- */}
        <TabsPanel match={tab} value="wallet">
          <div>
            <div className="mb-3 flex gap-2">
              {[["deposit", "Deposit"], ["withdrawal", "Withdrawal"]].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setWalletTab(value)}
                  className={`flex-1 rounded-xl border py-1.5 text-xs font-black uppercase tracking-wider transition ${
                    walletTab === value
                      ? "border-ink bg-ink text-white"
                      : "border-gray-200 bg-white text-slate-600 hover:bg-gray-50"
                  }`}
                >
                  {label} History
                </button>
              ))}
            </div>

            <div className="space-y-2.5">
              {loading && <Skeleton className="h-20 w-full" />}
              {!loading && (walletTab === "deposit" ? deposits : withdrawals).length === 0 && (
                <Empty title={`No ${walletTab} history`} />
              )}

              {(walletTab === "deposit" ? deposits : withdrawals).map((r) => {
                const positive = walletTab === "deposit";
                return (
                  <div key={r.id} className="rounded-2xl border border-gray-100 bg-white p-3.5 shadow-card">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <span className="text-[10px] font-bold text-slate-400">🕒 {new Date(r.createdAt).toLocaleString()}</span>
                      <span className="truncate text-[10px] font-extrabold text-slate-500">{r.note || r.type}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between rounded-xl bg-gray-50 px-2.5 py-2">
                      <div>
                        <span className="block text-[10px] font-bold uppercase text-slate-500">
                          {positive ? "Deposit Amount" : "Withdrawal Amount"}
                        </span>
                        <span className={`text-sm font-black ${positive ? "text-emerald-600" : "text-rose-600"}`}>
                          {positive ? "+" : "−"}
                          {formatPaise(Math.abs(r.amountPaise))}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="block text-[10px] font-bold uppercase text-slate-500">Closing Balance</span>
                        <span className="text-sm font-black text-slate-800">{formatPaise(r.balanceAfterPaise ?? 0)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </TabsPanel>

        {/* ---------------- penalty history ---------------- */}
        <TabsPanel match={tab} value="penalty">
          <div className="space-y-3">
            {loading && <Skeleton className="h-20 w-full" />}
            {!loading && penalties.length === 0 && <Empty title="No penalty history" hint="Admin deductions would appear here." />}
            {penalties.map((r) => (
              <div key={r.id} className="rounded-2xl border border-rose-200 bg-white p-3.5 shadow-card">
                <div className="flex items-center justify-between border-b border-rose-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400">🕒 {new Date(r.createdAt).toLocaleString()}</span>
                </div>
                <div className="mt-2 rounded-xl bg-rose-50/60 p-2">
                  <span className="block text-[10px] font-bold uppercase text-rose-800">Reason by admin</span>
                  <p className="mt-0.5 text-xs font-bold text-slate-700">{r.note || "Penalty"}</p>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div>
                    <span className="block text-[10px] font-bold uppercase text-slate-500">Penalty cut</span>
                    <span className="text-sm font-black text-rose-600">{formatPaise(r.amountPaise)}</span>
                  </div>
                  <div className="text-right">
                    <span className="block text-[10px] font-bold uppercase text-slate-500">Closing balance</span>
                    <span className="text-sm font-black text-slate-800">{formatPaise(r.balanceAfterPaise ?? 0)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </TabsPanel>

        {/* ---------------- bonus history ---------------- */}
        <TabsPanel match={tab} value="bonus">
          <div className="space-y-3">
            {loading && <Skeleton className="h-20 w-full" />}
            {!loading && bonuses.length === 0 && (
              <Empty title="No bonus history" hint="Referral commissions and admin bonuses land here." />
            )}
            {bonuses.map((r) => (
              <div key={r.id} className="rounded-2xl border border-emerald-200 bg-white p-3.5 shadow-card">
                <div className="flex items-center justify-between border-b border-emerald-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400">🕒 {new Date(r.createdAt).toLocaleString()}</span>
                </div>
                <div className="mt-2 rounded-xl bg-emerald-50/60 p-2">
                  <span className="block text-[10px] font-bold uppercase text-emerald-800">Bonus note</span>
                  <p className="mt-0.5 text-xs font-bold text-slate-700">{r.note || "Bonus"}</p>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div>
                    <span className="block text-[10px] font-bold uppercase text-slate-500">Bonus added</span>
                    <span className="text-sm font-black text-emerald-600">
                      +{formatPaise(Math.max(r.referralDeltaPaise || r.amountPaise, 0))}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="block text-[10px] font-bold uppercase text-slate-500">Closing balance</span>
                    <span className="text-sm font-black text-slate-800">{formatPaise(r.balanceAfterPaise ?? 0)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </TabsPanel>
      </Tabs>
    </div>
  );
}
