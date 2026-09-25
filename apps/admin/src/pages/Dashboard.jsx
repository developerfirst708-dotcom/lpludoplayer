import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { formatPaise } from "@lpludo/shared";
import { Card, LiveTag, Money, PageHeading, Panel, Skeleton, StatCard, Table } from "../components/ui.jsx";

/**
 * Dashboard — O(1) summary straight from /admin/dashboard/summary plus the two
 * activity trails (ledger + audit). Everything refreshes itself over the
 * `admin:refresh` socket event, so no manual reloads.
 */
export default function Dashboard() {
  const summary = useQuery({
    queryKey: ["summary"],
    queryFn: () => api("/admin/dashboard/summary"),
    refetchInterval: 30_000,
  });
  const audit = useQuery({
    queryKey: ["audit", 1, 8],
    queryFn: () => api("/admin/audit?page=1&limit=8"),
  });

  if (summary.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-56" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (summary.isError) {
    return <Card><p className="py-6 text-center text-sm font-bold text-rose-600">{summary.error?.message || "Could not load the dashboard"}</p></Card>;
  }

  const s = summary.data || {};
  const contests = s.contests || {};
  const pending = s.pending || {};

  return (
    <div>
      <PageHeading
        title={<>Dashboard <LiveTag /></>}
        subtitle="Real-time overview of the LPLUDO platform"
        action={
          <span className="text-[11px] font-semibold text-[#a56a83]">
            {s.generatedAt ? `Updated ${new Date(s.generatedAt).toLocaleTimeString("en-IN")}` : ""}
          </span>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Wallet balance (GAV)" value={formatPaise(s.gavPaise ?? 0)} tone="green" icon="₹" />
        <StatCard label="On hold" value={formatPaise(s.heldPaise ?? 0)} tone="amber" icon="⏸" />
        <StatCard label="Players" value={s.users ?? 0} tone="blue" icon="👤" />
        <StatCard label="Commission earned" value={formatPaise(s.commissionPaise ?? 0)} tone="violet" icon="%" />
        <StatCard label="Open battles" value={contests.open ?? 0} tone="amber" icon="◔" />
        <StatCard label="Running battles" value={contests.running ?? 0} tone="green" icon="▶" />
        <StatCard label="In dispute" value={contests.conflict ?? 0} tone="red" icon="!" />
        <StatCard label="Settled battles" value={contests.settled ?? 0} tone="pink" icon="✓" />
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <Link to="/deposits">
          <StatCard label="Pending deposits" value={pending.deposits ?? 0} tone="cyan" hint="Tap to review" icon="↓" />
        </Link>
        <Link to="/withdrawals">
          <StatCard label="Pending withdrawals" value={pending.withdrawals ?? 0} tone="amber" hint="Tap to review" icon="↑" />
        </Link>
        <Link to="/kyc">
          <StatCard label="Pending KYC" value={pending.kyc ?? 0} tone="violet" hint="Tap to review" icon="ID" />
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Recent ledger activity">
          <Table
            columns={[
              { key: "type", label: "Type", render: (r) => String(r.type || "").replace(/_/g, " ") },
              { key: "userName", label: "User" },
              { key: "amountPaise", label: "Amount", render: (r) => <Money paise={r.amountPaise} signed /> },
              { key: "createdAt", label: "Time", render: (r) => new Date(r.createdAt).toLocaleTimeString("en-IN") },
            ]}
            data={s.recentLedger || []}
            empty="No ledger activity"
          />
        </Panel>

        <Panel title="Recent admin activity">
          <Table
            columns={[
              { key: "action", label: "Action" },
              { key: "actor", label: "By" },
              { key: "targetType", label: "Target" },
              { key: "createdAt", label: "Time", render: (r) => new Date(r.createdAt).toLocaleString("en-IN") },
            ]}
            data={audit.data?.items || []}
            empty="No audit entries"
          />
        </Panel>
      </div>
    </div>
  );
}
