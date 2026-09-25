import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { formatPaise } from "@lpludo/shared";
import { useToast } from "../components/Toast.jsx";
import { Badge, Button, Card, Input, Modal, PageHeading, Pagination, Skeleton, Table } from "../components/ui.jsx";

const LIMIT = 15;
const FILTERS = [
  { value: "", label: "All" },
  { value: "requested", label: "Pending" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
];

/** Withdrawals — money is already on hold; approving releases the payout. */
export default function Withdrawals() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("requested");
  const [review, setReview] = useState(null); // { row, action }
  const [note, setNote] = useState("");

  const withdrawals = useQuery({
    queryKey: ["withdrawals", page, status],
    queryFn: () => api(`/admin/withdrawals?page=${page}&limit=${LIMIT}${status ? `&status=${status}` : ""}`),
    keepPreviousData: true,
  });

  const decide = useMutation({
    mutationFn: ({ id, action, note: why }) =>
      api("/admin/withdrawals/review", { method: "POST", body: { id, action, ...(why ? { note: why } : {}) } }),
    onSuccess: (_res, vars) => {
      toast.success(vars.action === "approve" ? "Withdrawal marked paid" : "Withdrawal rejected — funds returned");
      setReview(null);
      setNote("");
      qc.invalidateQueries({ queryKey: ["withdrawals"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const items = withdrawals.data?.items || [];
  const needsRef = review?.action === "approve";

  return (
    <div>
      <PageHeading
        title="Withdrawals"
        subtitle={`${withdrawals.data?.total ?? 0} payout requests`}
        action={
          <div className="flex gap-1 rounded-xl border border-[#f0c2d8] bg-white p-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => { setStatus(f.value); setPage(1); }}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                  status === f.value
                    ? "bg-gradient-to-br from-[#ec4899] to-[#db2777] text-white"
                    : "text-[#a56a83] hover:text-[#2a1520]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      />

      <Card>
        {withdrawals.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : withdrawals.isError ? (
          <p className="py-6 text-center text-sm font-bold text-rose-600">{withdrawals.error?.message}</p>
        ) : (
          <>
            <Table
              columns={[
                { key: "user", label: "User", render: (r) => (
                  <div>
                    <p className="font-bold text-[#2a1520]">{r.user?.name || "—"}</p>
                    <p className="text-[11px] text-[#a56a83]">{r.user?.phone || ""}</p>
                  </div>
                ) },
                { key: "amountPaise", label: "Amount", render: (r) => <span className="font-bold">{formatPaise(r.amountPaise)}</span> },
                { key: "upiId", label: "Pay to", render: (r) => <span className="font-mono text-xs">{r.upiId}</span> },
                { key: "providerRef", label: "Ref", render: (r) => r.providerRef || "—" },
                { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
                {
                  key: "createdAt",
                  label: "Requested",
                  render: (r) => (r.createdAt ? new Date(r.createdAt).toLocaleString("en-IN") : "—"),
                },
                {
                  key: "_actions",
                  label: "Actions",
                  render: (r) =>
                    r.status === "requested" ? (
                      <div className="flex gap-1">
                        <Button variant="success" onClick={() => setReview({ row: r, action: "approve" })}>Pay</Button>
                        <Button variant="danger" onClick={() => setReview({ row: r, action: "reject" })}>Reject</Button>
                      </div>
                    ) : (
                      <span className="text-xs text-[#a56a83]">{r.rejectReason || (r.paidAt ? "paid" : "reviewed")}</span>
                    ),
                },
              ]}
              data={items}
              empty="No withdrawal requests"
            />
            <Pagination page={page} limit={LIMIT} total={withdrawals.data?.total || 0} onChange={setPage} />
          </>
        )}
      </Card>

      <Modal
        open={Boolean(review)}
        onClose={() => { setReview(null); setNote(""); }}
        title={review?.action === "approve" ? "Confirm payout" : "Reject withdrawal"}
        footer={
          <>
            <Button variant="subtle" onClick={() => { setReview(null); setNote(""); }}>Cancel</Button>
            <Button
              variant={review?.action === "approve" ? "success" : "danger"}
              disabled={decide.isPending || (needsRef && !note.trim())}
              onClick={() => decide.mutate({ id: review.row.id, action: review.action, note })}
            >
              {decide.isPending ? "Working…" : review?.action === "approve" ? "Mark as paid" : "Reject & refund"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-[#7a3d58]">
          Pay <b>{formatPaise(review?.row?.amountPaise ?? 0)}</b> to{" "}
          <span className="font-mono">{review?.row?.upiId}</span> for {review?.row?.user?.name}. The amount is already
          on hold — approving consumes it.
        </p>
        <div className="mt-3">
          <Input
            label={needsRef ? "UPI transaction reference (required)" : "Reason for rejection"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={needsRef ? "e.g. 402912345678" : "Wrong UPI id"}
          />
        </div>
      </Modal>
    </div>
  );
}
