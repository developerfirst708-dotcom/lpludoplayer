import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { useToast } from "../components/Toast.jsx";
import { Badge, Button, Card, Input, Modal, PageHeading, Pagination, Skeleton, Table } from "../components/ui.jsx";
import AuthedImage from "../components/AuthedImage.jsx";

const LIMIT = 15;
const FILTERS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "verified", label: "Verified" },
  { value: "rejected", label: "Rejected" },
];

/** KYC — review submitted documents, approve or reject with a note. */
export default function Kyc() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("pending");
  const [review, setReview] = useState(null); // { row, action }
  const [note, setNote] = useState("");

  const kyc = useQuery({
    queryKey: ["kyc", page, status],
    queryFn: () => api(`/admin/kyc?page=${page}&limit=${LIMIT}${status ? `&status=${status}` : ""}`),
    keepPreviousData: true,
  });

  const decide = useMutation({
    mutationFn: ({ userId, action, note: why }) =>
      api("/admin/kyc/review", { method: "POST", body: { userId, action, ...(why ? { note: why } : {}) } }),
    onSuccess: (_res, vars) => {
      toast.success(vars.action === "approve" ? "KYC approved" : "KYC rejected");
      setReview(null);
      setNote("");
      qc.invalidateQueries({ queryKey: ["kyc"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const items = kyc.data?.items || [];

  return (
    <div>
      <PageHeading
        title="KYC verification"
        subtitle={`${kyc.data?.total ?? 0} submissions`}
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
        {kyc.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : kyc.isError ? (
          <p className="py-6 text-center text-sm font-bold text-rose-600">{kyc.error?.message}</p>
        ) : (
          <>
            <Table
              columns={[
                { key: "name", label: "User", render: (r) => (
                  <div>
                    <p className="font-bold text-[#2a1520]">{r.name}</p>
                    <p className="text-[11px] text-[#a56a83]">{r.phone}</p>
                  </div>
                ) },
                { key: "holderName", label: "Holder", render: (r) => r.kyc?.holderName || "—" },
                { key: "upiId", label: "Payout UPI", render: (r) => <span className="font-mono text-xs">{r.kyc?.upiId || "—"}</span> },
                {
                  key: "docs",
                  label: "Documents",
                  render: (r) => (
                    <div className="flex gap-2">
                      <AuthedImage fileKey={r.kyc?.docFrontKey} alt="ID front" className="h-12 w-12" />
                      <AuthedImage fileKey={r.kyc?.docBackKey} alt="ID back" className="h-12 w-12" />
                    </div>
                  ),
                },
                { key: "status", label: "Status", render: (r) => <Badge status={r.kyc?.status} /> },
                {
                  key: "note",
                  label: "Note",
                  render: (r) => <span className="text-xs text-[#7a3d58]">{r.kyc?.rejectReason || "—"}</span>,
                },
                {
                  key: "_actions",
                  label: "Actions",
                  render: (r) =>
                    r.kyc?.status === "pending" ? (
                      <div className="flex gap-1">
                        <Button variant="success" onClick={() => setReview({ row: r, action: "approve" })}>Approve</Button>
                        <Button variant="danger" onClick={() => setReview({ row: r, action: "reject" })}>Reject</Button>
                      </div>
                    ) : (
                      <span className="text-xs text-[#a56a83]">reviewed</span>
                    ),
                },
              ]}
              data={items}
              empty="No KYC submissions"
            />
            <Pagination page={page} limit={LIMIT} total={kyc.data?.total || 0} onChange={setPage} />
          </>
        )}
      </Card>

      <Modal
        open={Boolean(review)}
        onClose={() => { setReview(null); setNote(""); }}
        title={review?.action === "approve" ? "Approve KYC" : "Reject KYC"}
        wide
        footer={
          <>
            <Button variant="subtle" onClick={() => { setReview(null); setNote(""); }}>Cancel</Button>
            <Button
              variant={review?.action === "approve" ? "success" : "danger"}
              disabled={decide.isPending}
              onClick={() => decide.mutate({ userId: review.row.id, action: review.action, note })}
            >
              {decide.isPending ? "Working…" : review?.action === "approve" ? "Approve" : "Reject"}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-[#7a3d58]">
          {review?.row?.name} · {review?.row?.phone} · UPI {review?.row?.kyc?.upiId}
        </p>
        <div className="mb-3 flex flex-wrap gap-3">
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#a56a83]">ID front</p>
            <AuthedImage fileKey={review?.row?.kyc?.docFrontKey} alt="ID front" className="h-40 w-40" />
          </div>
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#a56a83]">ID back</p>
            <AuthedImage fileKey={review?.row?.kyc?.docBackKey} alt="ID back" className="h-40 w-40" />
          </div>
        </div>
        <Input
          label={review?.action === "approve" ? "Note (optional)" : "Reason for rejection"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={review?.action === "approve" ? "Looks good" : "Documents not readable"}
        />
      </Modal>
    </div>
  );
}
