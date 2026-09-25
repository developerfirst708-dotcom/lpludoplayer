import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { formatPaise } from "@lpludo/shared";
import { useToast } from "../components/Toast.jsx";
import { Badge, Button, Card, Input, Modal, PageHeading, Pagination, Skeleton, Table } from "../components/ui.jsx";
import AuthedImage from "../components/AuthedImage.jsx";

const LIMIT = 15;
const FILTERS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "failed", label: "Failed" },
];
const METHODS = [
  { value: "", label: "Both rails" },
  { value: "gateway", label: "Instant (gateway)" },
  { value: "manual", label: "Manual UPI" },
];

/** Deposits — verify the UTR + proof, then credit or reject the claim. */
export default function Deposits() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("pending");
  const [method, setMethod] = useState("");
  const [review, setReview] = useState(null); // { row, action }
  const [note, setNote] = useState("");

  const deposits = useQuery({
    queryKey: ["deposits", page, status, method],
    queryFn: () =>
      api(`/admin/deposits?page=${page}&limit=${LIMIT}${status ? `&status=${status}` : ""}${method ? `&method=${method}` : ""}`),
    keepPreviousData: true,
  });

  const decide = useMutation({
    mutationFn: ({ id, action, note: why }) =>
      api("/admin/deposits/review", { method: "POST", body: { id, action, ...(why ? { note: why } : {}) } }),
    onSuccess: (_res, vars) => {
      toast.success(vars.action === "approve" ? "Deposit approved — wallet credited" : "Deposit rejected");
      setReview(null);
      setNote("");
      qc.invalidateQueries({ queryKey: ["deposits"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const items = deposits.data?.items || [];

  return (
    <div>
      <PageHeading
        title="Deposits"
        subtitle={`${deposits.data?.total ?? 0} deposit claims`}
        action={
          <div className="flex flex-col items-end gap-2">
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
            <div className="flex gap-1 rounded-xl border border-[#f0c2d8] bg-white p-1">
              {METHODS.map((m) => (
                <button
                  key={m.value}
                  onClick={() => { setMethod(m.value); setPage(1); }}
                  className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors ${
                    method === m.value
                      ? "bg-[#2a1520] text-white"
                      : "text-[#a56a83] hover:text-[#2a1520]"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <Card>
        {deposits.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : deposits.isError ? (
          <p className="py-6 text-center text-sm font-bold text-rose-600">{deposits.error?.message}</p>
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
                { key: "method", label: "Rail", render: (r) => (
                  <span className={`rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    r.method === "gateway"
                      ? "border-sky-200 bg-sky-50 text-sky-700"
                      : "border-[#f0c2d8] bg-[#fdf1f7] text-[#7a3d58]"
                  }`}>
                    {r.method === "gateway" ? "instant" : "manual"}
                  </span>
                ) },
                { key: "amountPaise", label: "Amount", render: (r) => (
                  <div>
                    <span className="font-bold">{formatPaise(r.amountPaise)}</span>
                    {/* amount mismatch / gateway remarks the admin must see */}
                    {r.gateway?.note && (
                      <p className="mt-0.5 max-w-[220px] text-[11px] font-semibold text-amber-700">{r.gateway.note}</p>
                    )}
                    {r.method === "gateway" && r.gateway?.orderId && !r.gateway?.note && (
                      <p className="mt-0.5 font-mono text-[10px] text-[#a56a83]">{r.gateway.orderId}</p>
                    )}
                  </div>
                ) },
                { key: "utr", label: "UTR / ref", render: (r) => <span className="font-mono text-xs">{r.utr || "—"}</span> },
                {
                  key: "proofImageKey",
                  label: "Proof",
                  render: (r) => (r.proofImageKey
                    ? <AuthedImage fileKey={r.proofImageKey} alt="deposit proof" className="h-12 w-12" />
                    : <span className="text-xs text-[#a56a83]">auto</span>),
                },
                { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
                {
                  key: "createdAt",
                  label: "Submitted",
                  render: (r) => (r.createdAt ? new Date(r.createdAt).toLocaleString("en-IN") : "—"),
                },
                {
                  key: "_actions",
                  label: "Actions",
                  render: (r) =>
                    r.status === "pending" ? (
                      <div className="flex gap-1">
                        <Button variant="success" onClick={() => setReview({ row: r, action: "approve" })}>Approve</Button>
                        <Button variant="danger" onClick={() => setReview({ row: r, action: "reject" })}>Reject</Button>
                      </div>
                    ) : (
                      <span className="text-xs text-[#a56a83]">{r.rejectReason || "reviewed"}</span>
                    ),
                },
              ]}
              data={items}
              empty="No deposits found"
            />
            <Pagination page={page} limit={LIMIT} total={deposits.data?.total || 0} onChange={setPage} />
          </>
        )}
      </Card>

      <Modal
        open={Boolean(review)}
        onClose={() => { setReview(null); setNote(""); }}
        title={review?.action === "approve" ? "Approve deposit" : "Reject deposit"}
        footer={
          <>
            <Button variant="subtle" onClick={() => { setReview(null); setNote(""); }}>Cancel</Button>
            <Button
              variant={review?.action === "approve" ? "success" : "danger"}
              disabled={decide.isPending}
              onClick={() => decide.mutate({ id: review.row.id, action: review.action, note })}
            >
              {decide.isPending ? "Working…" : review?.action === "approve" ? "Approve & credit" : "Reject"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-[#7a3d58]">
          {review?.row?.user?.name} claimed <b>{formatPaise(review?.row?.amountPaise ?? 0)}</b>
          {review?.row?.method === "gateway" ? (
            <>
              {" "}through the instant gateway (order <span className="font-mono">{review?.row?.gateway?.orderId}</span>
              {review?.row?.gateway?.txnStatus ? `, gateway says ${review.row.gateway.txnStatus}` : ""}).
            </>
          ) : (
            <> with UTR <span className="font-mono">{review?.row?.utr}</span>.</>
          )}
        </p>
        {review?.row?.gateway?.note && (
          <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            {review.row.gateway.note}
          </p>
        )}
        <div className="mt-3">
          <AuthedImage fileKey={review?.row?.proofImageKey} alt="deposit proof" className="h-48 w-48" />
        </div>
        <div className="mt-3">
          <Input
            label={review?.action === "approve" ? "Note (optional)" : "Rejection reason"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={review?.action === "approve" ? "Payment verified" : "UTR not found / amount mismatch"}
          />
        </div>
      </Modal>
    </div>
  );
}
