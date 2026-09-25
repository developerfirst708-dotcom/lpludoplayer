import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { formatPaise } from "@lpludo/shared";
import { useToast } from "../components/Toast.jsx";
import { Badge, Button, Card, Input, Modal, PageHeading, Pagination, Skeleton, Table } from "../components/ui.jsx";

const LIMIT = 15;

/** Users — search by name/phone, see wallet + KYC state, ban/unban with a reason. */
export default function Users() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState(null); // user pending moderation
  const [reason, setReason] = useState("");

  const users = useQuery({
    queryKey: ["users", page, search],
    queryFn: () => api(`/admin/users?page=${page}&limit=${LIMIT}${search ? `&q=${encodeURIComponent(search)}` : ""}`),
    keepPreviousData: true,
  });

  const moderate = useMutation({
    mutationFn: ({ userId, action, reason: why }) =>
      api("/admin/users/action", { method: "POST", body: { userId, action, ...(why ? { reason: why } : {}) } }),
    onSuccess: (_res, vars) => {
      toast.success(vars.action === "ban" ? "User banned" : "User unbanned");
      setTarget(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
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
                    <Button
                      variant={r.status === "banned" ? "success" : "danger"}
                      onClick={() => setTarget(r)}
                    >
                      {r.status === "banned" ? "Unban" : "Ban"}
                    </Button>
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
    </div>
  );
}
