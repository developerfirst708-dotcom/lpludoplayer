import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Card, Money, PageHeading, Pagination, Skeleton, Table } from "../components/ui.jsx";

const LIMIT = 25;

const TYPES = [
  "", "deposit", "entry_fee_hold", "entry_fee_release", "entry_fee_paid",
  "entry_fee_refund", "prize_win", "withdrawal_hold", "withdrawal_paid",
  "withdrawal_refund", "referral_bonus", "admin_adjustment",
];

/**
 * Ledger — every money movement, newest first. Amounts are SIGNED (negative =
 * money leaving the user), which is exactly what Money's `signed` mode renders.
 */
export default function Ledger() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState("");

  const ledger = useQuery({
    queryKey: ["ledger", page, type],
    queryFn: () => api(`/admin/ledger?page=${page}&limit=${LIMIT}${type ? `&type=${type}` : ""}`),
    keepPreviousData: true,
  });

  const items = ledger.data?.items || [];

  return (
    <div>
      <PageHeading
        title="Ledger"
        subtitle={`${ledger.data?.total ?? 0} entries across every wallet`}
        action={
          <select
            value={type}
            onChange={(e) => { setType(e.target.value); setPage(1); }}
            className="rounded-xl border border-[#f0c2d8] bg-white px-3 py-2 text-xs font-bold text-[#7a3d58] outline-none focus:border-[#db2777]"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>{t ? t.replace(/_/g, " ") : "All types"}</option>
            ))}
          </select>
        }
      />

      <Card>
        {ledger.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : ledger.isError ? (
          <p className="py-6 text-center text-sm font-bold text-rose-600">{ledger.error?.message}</p>
        ) : (
          <>
            <Table
              columns={[
                { key: "type", label: "Type", render: (r) => <span className="font-semibold">{String(r.type || "").replace(/_/g, " ")}</span> },
                {
                  key: "user",
                  label: "User",
                  render: (r) => (
                    <div>
                      <p className="font-bold text-[#2a1520]">{r.user?.name || "—"}</p>
                      <p className="text-[11px] text-[#a56a83]">{r.user?.phone || ""}</p>
                    </div>
                  ),
                },
                { key: "amountPaise", label: "Amount", render: (r) => <Money paise={r.amountPaise ?? 0} signed /> },
                { key: "heldDeltaPaise", label: "Held Δ", render: (r) => <Money paise={r.heldDeltaPaise ?? 0} signed /> },
                { key: "balanceAfterPaise", label: "Balance after", render: (r) => <Money paise={r.balanceAfterPaise ?? 0} /> },
                { key: "note", label: "Note", render: (r) => <span className="text-xs text-[#7a3d58]">{r.note || "—"}</span> },
                {
                  key: "createdAt",
                  label: "Time",
                  render: (r) => (r.createdAt ? new Date(r.createdAt).toLocaleString("en-IN") : "—"),
                },
              ]}
              data={items}
              empty="No ledger entries"
            />
            <Pagination page={page} limit={LIMIT} total={ledger.data?.total || 0} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
