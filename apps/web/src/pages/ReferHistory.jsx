import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { formatPaise } from "@lpludo/shared";
import { Empty, Panel, Skeleton } from "../components/ui.jsx";

/**
 * ReferHistory — every player who signed up with your code, with what their
 * winning battles have paid you so far (2% lifetime commission).
 */
export default function ReferHistory() {
  const referrals = useQuery({ queryKey: ["referrals"], queryFn: () => api("/user/referrals") });

  if (referrals.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const items = referrals.data?.items || [];

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Refer history" action={<span className="text-[11px] font-bold text-slate-400">{items.length} players</span>}>
        <div className="mb-3 flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2.5">
          <span className="text-xs font-bold text-slate-500">Lifetime commission</span>
          <span className="text-sm font-black text-emerald-600">{formatPaise(referrals.data?.totalEarnedPaise ?? 0)}</span>
        </div>

        {items.length === 0 ? (
          <Empty title="No referrals yet" hint="Share your code from the Refer tab — you earn 2% of every battle they win." />
        ) : (
          <ul className="divide-y divide-gray-100">
            {items.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-300 via-brand-500 to-[#C98509] text-sm font-black text-white">
                    {u.name?.[0]?.toUpperCase() || "P"}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-slate-700">{u.name}</p>
                    <p className="text-[11px] font-semibold text-slate-400">
                      Joined {u.joinedAt ? new Date(u.joinedAt).toLocaleDateString() : "—"} · {u.commissions} battle
                      {u.commissions === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                <span className={`shrink-0 text-sm font-black ${u.earnedPaise > 0 ? "text-emerald-600" : "text-slate-400"}`}>
                  {formatPaise(u.earnedPaise || 0)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="text-center">
        <Link to="/refer" className="text-xs font-extrabold text-brand-600 hover:text-brand-500">
          ← Back to refer &amp; earn
        </Link>
      </div>
    </div>
  );
}
