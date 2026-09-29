import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { formatPaise } from "@lpludo/shared";
import { useToast } from "../components/Toast.jsx";
import { Badge, Button, Card, Input, Modal, PageHeading, Pagination, Skeleton, Table } from "../components/ui.jsx";

const LIMIT = 15;

const FILTERS = [
  { value: "all", label: "All Users", status: "" },
  { value: "active", label: "Active", status: "active" },
  { value: "blocked", label: "Blocked", status: "banned" },
];

/** Users — filter All / Active / Blocked, search, view wallet + KYC, ban/unban. */
export default function Users() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [sp] = useSearchParams();
  const filter = sp.get("filter") || "all";
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState(null); // user pending moderation
  const [reason, setReason] = useState("");
  const [viewId, setViewId] = useState(null); // user opened in the details modal

  useEffect(() => { setPage(1); }, [filter]);

  const statusParam = FILTERS.find((f) => f.value === filter)?.status || "";

  const users = useQuery({
    queryKey: ["users", page, filter, search],
    queryFn: () =>
      api(`/admin/users?page=${page}&limit=${LIMIT}${statusParam ? `&status=${statusParam}` : ""}${search ? `&q=${encodeURIComponent(search)}` : ""}`),
    keepPreviousData: true,
  });

  const detail = useQuery({
    queryKey: ["user", viewId],
    queryFn: () => api(`/admin/users/${viewId}`),
    enabled: Boolean(viewId),
  });

  const moderate = useMutation({
    mutationFn: ({ userId, action, reason: why }) =>
      api("/admin/users/action", { method: "POST", body: { userId, action, ...(why ? { reason: why } : {}) } }),
    onSuccess: (_res, vars) => {
      toast.success(vars.action === "ban" ? "User banned" : "User unbanned");
      setTarget(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const items = users.data?.items || [];

  function submitSearch(e) {
    e.preventDefault();
    setPage(1);
    setSearch(q.trim());
  }

  return (
    <div>
      <PageHeading
        title="Users"
        subtitle={`${users.data?.total ?? 0} registered players`}
        action={
          <form onSubmit={submitSearch} className="flex items-end gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name or phone…"
              className="!w-56"
            />
            <Button type="submit">Search</Button>
            {search && (
              <Button type="button" variant="subtle" onClick={() => { setQ(""); setSearch(""); setPage(1); }}>
                Clear
              </Button>
            )}
          </form>
        }
      />

      <div className="mb-3 flex flex-wrap gap-1 rounded-xl border border-[#f0c2d8] bg-white p-1">
        {FILTERS.map((f) => (
          <Link key={f.value} to={`/users?filter=${f.value}`}>
            <span
              className={`block rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                filter === f.value
                  ? "bg-gradient-to-br from-[#ec4899] to-[#db2777] text-white"
                  : "text-[#a56a83] hover:text-[#2a1520]"
              }`}
            >
              {f.label}
            </span>
          </Link>
        ))}
      </div>

      <Card>
        {users.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : users.isError ? (
          <p className="py-6 text-center text-sm font-bold text-rose-600">{users.error?.message}</p>
        ) : (
          <>
            <Table
              columns={[
                { key: "name", label: "Name" },
                { key: "phone", label: "Phone" },
                { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
                { key: "kycStatus", label: "KYC", render: (r) => <Badge status={r.kycStatus} /> },
                {
                  key: "wallet",
                  label: "Balance",
                  render: (r) => (
                    <span className="whitespace-nowrap">
                      {formatPaise(r.wallet?.totalPaise ?? 0)}
                      {r.wallet?.heldPaise ? (
                        <span className="ml-1 text-[11px] text-[#a56a83]">
                          ({formatPaise(r.wallet.heldPaise)} held)
                        </span>
                      ) : null}
                    </span>
                  ),
                },
                {
                  key: "lastActiveAt",
                  label: "Last active",
                  render: (r) => (r.lastActiveAt ? new Date(r.lastActiveAt).toLocaleDateString("en-IN") : "—"),
                },
                {
                  key: "createdAt",
                  label: "Joined",
                  render: (r) => (r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-IN") : "—"),
                },
                {
                  key: "_actions",
                  label: "Actions",
                  render: (r) => (
                    <div className="flex gap-1">
                      <Button variant="ghost" onClick={() => setViewId(r.id)}>View</Button>
                      <Button
                        variant={r.status === "banned" ? "success" : "danger"}
                        onClick={() => setTarget(r)}
                      >
                        {r.status === "banned" ? "Unban" : "Ban"}
                      </Button>
                    </div>
                  ),
                },
              ]}
              data={items}
              empty="No users found"
            />
            <Pagination page={page} limit={LIMIT} total={users.data?.total || 0} onChange={setPage} />
          </>
        )}
      </Card>

      <Modal
        open={Boolean(target)}
        onClose={() => { setTarget(null); setReason(""); }}
        title={target?.status === "banned" ? "Unban user" : "Ban user"}
        footer={
          <>
            <Button variant="subtle" onClick={() => { setTarget(null); setReason(""); }}>Cancel</Button>
            <Button
              variant={target?.status === "banned" ? "success" : "danger"}
              disabled={moderate.isPending}
              onClick={() => moderate.mutate({
                userId: target.id,
                action: target.status === "banned" ? "unban" : "ban",
                reason,
              })}
            >
              {moderate.isPending ? "Working…" : target?.status === "banned" ? "Unban" : "Ban"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-[#7a3d58]">
          {target?.status === "banned"
            ? `Restore access for ${target?.name} (${target?.phone})?`
            : `This instantly kills every live session for ${target?.name} (${target?.phone}).`}
        </p>
        {target?.status !== "banned" && (
          <div className="mt-3">
            <Input label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Policy violation" />
          </div>
        )}
      </Modal>

      <Modal open={Boolean(viewId)} onClose={() => setViewId(null)} title="User details" wide>
        {detail.isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : detail.isError ? (
          <p className="py-6 text-center text-sm font-bold text-rose-600">{detail.error?.message}</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="rounded-xl border border-[#f0c2d8] bg-[#fdf1f7] p-3">
              <p className="text-base font-black text-[#2a1520]">{detail.data?.name || "—"}</p>
              <p className="text-xs font-semibold text-[#a56a83]">{detail.data?.phone || "—"}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-[#a56a83]">KYC status</span>
                <Badge status={detail.data?.kycStatus} />
                <span className="text-xs font-semibold text-[#7a3d58]">
                  {detail.data?.kycStatus === "verified" ? "Complete" : "Not complete"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <DetailRow label="Wallet balance" paise={detail.data?.wallet?.availablePaise} />
              <DetailRow label="Winning wallet" paise={detail.data?.wallet?.wonPaise} />
              <DetailRow label="Total deposit" paise={detail.data?.totals?.depositedPaise} />
              <DetailRow label="Total withdrawal" paise={detail.data?.totals?.withdrawnPaise} />
              <DetailRow label="Total bonus" paise={detail.data?.totals?.bonusPaise} />
              <DetailRow label="Total penalty" paise={detail.data?.totals?.penaltyPaise} />
            </div>

            {(detail.data?.wallet?.heldPaise || detail.data?.wallet?.referralPaise) ? (
              <div className="grid grid-cols-2 gap-2.5">
                <DetailRow label="On hold" paise={detail.data?.wallet?.heldPaise} />
                <DetailRow label="Referral balance" paise={detail.data?.wallet?.referralPaise} />
              </div>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  );
}

function DetailRow({ label, paise }) {
  return (
    <div className="rounded-xl border border-[#f0c2d8] bg-white p-2.5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#a56a83]">{label}</p>
      <p className="mt-0.5 text-sm font-black text-[#2a1520]">{formatPaise(paise ?? 0)}</p>
    </div>
  );
}
