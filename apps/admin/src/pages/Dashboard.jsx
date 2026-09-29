import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { formatPaise } from "@lpludo/shared";
import { Button, Card, LiveTag, Money, PageHeading, Panel, Skeleton, StatCard, Table } from "../components/ui.jsx";

/**
 * Dashboard — "All Time" and "Today" views over /admin/dashboard?filter=.
 * Every card the operator asked for: users, deposits, withdrawals, commission,
 * referral earnings, hold balance, total wallet balance, matches, bonus and
 * penalty. Refreshes itself over the `admin:refresh` socket event.
 */
export default function Dashboard() {
  const [sp] = useSearchParams();
  const filter = sp.get("filter") === "today" ? "today" : "all";
  const isToday = filter === "today";

  const summary = useQuery({
    queryKey: ["dashboard", filter],
    queryFn: () => api(`/admin/dashboard?filter=${filter}`),
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
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (summary.isError) {
    return <Card><p className="py-6 text-center text-sm font-bold text-rose-600">{summary.error?.message || "Could not load the dashboard"}</p></Card>;
  }

  const s = summary.data || {};
  const t = s.today || {};
  const contests = s.contests || {};
  const pending = s.pending || {};

  const cards = [
    { label: isToday ? "New Users Today" : "Total Users", value: isToday ? t.newUsers : s.totalUsers, count: true, tone: "blue", icon: "👤" },
    { label: isToday ? "Today Deposit" : "Total Deposit", value: isToday ? t.deposit : s.totalDeposit, money: true, tone: "green", icon: "↓" },
    { label: isToday ? "Today Withdrawal" : "Total Withdrawal", value: isToday ? t.withdraw : s.totalWithdraw, money: true, tone: "amber", icon: "↑" },
    { label: isToday ? "Today Commission" : "Total Commission", value: isToday ? t.commission : s.totalCommission, money: true, tone: "pink", icon: "%" },
    { label: isToday ? "Today Referral Earning" : "Total Referral Earning", value: isToday ? t.referral : s.totalReferral, money: true, tone: "cyan", icon: "🔗" },
    { label: isToday ? "Today Bonus" : "Total Bonus", value: isToday ? t.bonus : s.totalBonus, money: true, tone: "violet", icon: "🎁" },
    { label: isToday ? "Today Penalty" : "Total Penalty", value: isToday ? t.penalty : s.totalPenalty, money: true, tone: "red", icon: "⚖" },
    { label: "Hold Balance", value: s.holdBalance, money: true, tone: "teal", icon: "⏸", hint: "Locked in running battles + pending withdrawals" },
    { label: "Total Wallet Balance", value: s.walletBalance, money: true, tone: "green", icon: "₹", hint: "Sum of every player wallet" },
    { label: isToday ? "Today Matches" : "Total Matches", value: isToday ? t.matches : s.totalMatches, count: true, tone: "violet", icon: "🎮" },
  ];

  return (
    <div>
      <PageHeading
        title={<>Dashboard <LiveTag /></>}
        subtitle={isToday ? "Today's activity (IST)" : "All-time overview of the LPLUDO platform"}
        action={
          <div className="flex items-center gap-2">
            <div className="flex gap-1 rounded-xl border border-[#f0c2d8] bg-white p-1">
              <Link to="/dashboard?filter=all">
                <Button variant={!isToday ? "primary" : "subtle"}>Total</Button>
              </Link>
              <Link to="/dashboard?filter=today">
                <Button variant={isToday ? "primary" : "subtle"}>Today</Button>
              </Link>
            </div>
            {s.generatedAt && (
              <span className="hidden text-[11px] font-semibold text-[#a56a83] sm:inline">
                Updated {new Date(s.generatedAt).toLocaleTimeString("en-IN")}
              </span>
            )}
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <StatCard
            key={c.label}
            label={c.label}
            value={c.count ? Number(c.value || 0).toLocaleString("en-IN") : formatPaise(c.value ?? 0)}
            tone={c.tone}
            icon={c.icon}
            hint={c.hint}
          />
        ))}
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Link to="/deposits"><StatCard label="Pending deposits" value={pending.deposits ?? 0} tone="cyan" hint="Tap to review" icon="↓" /></Link>
        <Link to="/withdrawals"><StatCard label="Pending withdrawals" value={pending.withdrawals ?? 0} tone="amber" hint="Tap to review" icon="↑" /></Link>
        <Link to="/kyc?status=pending"><StatCard label="Pending KYC" value={pending.kyc ?? 0} tone="violet" hint="Tap to review" icon="ID" /></Link>
        <Link to="/matches?tab=running"><StatCard label="Running matches" value={contests.running ?? 0} tone="green" hint={`${contests.open ?? 0} open`} icon="▶" /></Link>
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
