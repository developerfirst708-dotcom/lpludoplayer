import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { useToast } from "../components/Toast.jsx";
import { Badge, Button, Card, Input, Modal, Money, PageHeading, Pagination, Select, Skeleton, Table } from "../components/ui.jsx";
import AuthedImage from "../components/AuthedImage.jsx";

const LIMIT = 15;
const FILTERS = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "running", label: "Running" },
  { value: "result_submitted", label: "Result in" },
  { value: "cancel_requested", label: "Disputed" },
  { value: "approved", label: "Settled" },
  { value: "cancelled", label: "Cancelled" },
  { value: "expired", label: "Expired" },
];

const shortId = (v) => String(v ?? "").slice(-6) || "—";

/**
 * Matches — the 1v1 battle ledger for operators. Detail view shows both
 * players' claims and the proof screenshots they uploaded, with the three
 * money-moving actions: settle (pays the winner), refund, force-expire.
 */
export default function Matches() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [winner, setWinner] = useState("");
  const [note, setNote] = useState("");
  const [previewKey, setPreviewKey] = useState(null);

  const contests = useQuery({
    queryKey: ["contests", page, status],
    queryFn: () => api(`/admin/contests?page=${page}&limit=${LIMIT}${status ? `&status=${status}` : ""}`),
    keepPreviousData: true,
  });

  const detail = useQuery({
    queryKey: ["contest", selectedId],
    queryFn: () => api(`/admin/contests/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["contests"] });
    qc.invalidateQueries({ queryKey: ["contest", selectedId] });
    qc.invalidateQueries({ queryKey: ["summary"] });
  };

  const settle = useMutation({
    mutationFn: () => api("/admin/contests/settle", {
      method: "POST",
      body: { contestId: selectedId, winnerUserId: winner, ...(note.trim() ? { note: note.trim() } : {}) },
    }),
    onSuccess: () => { toast.success("Battle settled — prize paid"); invalidateAll(); setNote(""); },
    onError: (err) => toast.error(err.message),
  });

  const refund = useMutation({
    mutationFn: () => api(`/admin/contests/${selectedId}/refund`, {
      method: "POST",
      body: note.trim() ? { note: note.trim() } : {},
    }),
    onSuccess: () => { toast.success("Both stakes refunded"); invalidateAll(); setNote(""); },
    onError: (err) => toast.error(err.message),
  });

  const forceExpire = useMutation({
    mutationFn: () => api(`/admin/contests/${selectedId}/force-expire`, { method: "POST", body: {} }),
    onSuccess: () => { toast.success("Open battle expired — stake refunded"); invalidateAll(); },
    onError: (err) => toast.error(err.message),
  });

  const items = contests.data?.items || [];
  const c = detail.data?.contest;
  const ledger = detail.data?.ledger || [];
  const players = c?.players || [];
  const terminal = ["approved", "cancelled", "expired"].includes(c?.status);
  const busy = settle.isPending || refund.isPending || forceExpire.isPending;

  function closeDetail() {
    setSelectedId(null);
    setWinner("");
    setNote("");
  }

  return (
    <div>
      <PageHeading
        title="Matches"
        subtitle={`${contests.data?.total ?? 0} battles`}
        action={
          <div className="flex max-w-full flex-wrap gap-1 rounded-xl border border-[#f0c2d8] bg-white p-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => { setStatus(f.value); setPage(1); }}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors ${
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
        {contests.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : contests.isError ? (
          <p className="py-6 text-center text-sm font-bold text-rose-600">{contests.error?.message}</p>
        ) : (
          <>
            <Table
              columns={[
                { key: "id", label: "Battle", render: (r) => <span className="font-mono text-xs">{shortId(r.id)}</span> },
                { key: "stake", label: "Stake", render: (r) => <span className="font-bold"><Money paise={r.stake} /></span> },
                {
                  key: "players",
                  label: "Players",
                  render: (r) => (
                    <div className="space-y-0.5">
                      {(r.players || []).map((p) => (
                        <p key={p.seat} className="text-xs">
                          <span className="font-bold text-[#2a1520]">{p.name || "—"}</span>
                          <span className="ml-1 text-[#a56a83]">{p.phone || ""}</span>
                        </p>
                      ))}
                      {(r.players || []).length < 2 && <p className="text-[11px] text-[#a56a83]">seat open</p>}
                    </div>
                  ),
                },
                { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
                {
                  key: "winnerUserId",
                  label: "Winner",
                  render: (r) => {
                    const w = (r.players || []).find((p) => String(p.id) === String(r.winnerUserId));
                    return w ? <span className="font-bold text-emerald-600">{w.name}</span> : "—";
                  },
                },
                {
                  key: "createdAt",
                  label: "Created",
                  render: (r) => (r.createdAt ? new Date(r.createdAt).toLocaleString("en-IN") : "—"),
                },
                {
                  key: "_actions",
                  label: "View",
                  render: (r) => <Button onClick={() => setSelectedId(r.id)}>View</Button>,
                },
              ]}
              data={items}
              empty="No battles found"
            />
            <Pagination page={page} limit={LIMIT} total={contests.data?.total || 0} onChange={setPage} />
          </>
        )}
      </Card>

      <Modal open={Boolean(selectedId)} onClose={closeDetail} title="Battle details" wide>
        {detail.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : detail.isError ? (
          <p className="py-6 text-center text-sm font-bold text-rose-600">{detail.error?.message}</p>
        ) : c ? (
          <div className="space-y-4">
            {/* summary */}
            <div className="grid grid-cols-2 gap-x-5 gap-y-1.5 rounded-xl border border-[#f0c2d8] bg-[#fdf1f7] p-3 text-xs sm:grid-cols-3">
              <p><b>Battle:</b> <span className="font-mono">{c.id}</span></p>
              <p className="flex items-center gap-1"><b>Status:</b> <Badge status={c.status} /></p>
              <p><b>Stake:</b> <Money paise={c.stake} /></p>
              <p><b>Prize:</b> <Money paise={c.settlement?.prizePaise ?? 0} /></p>
              <p><b>Room code:</b> <span className="font-mono">{c.roomCode || "—"}</span></p>
              <p><b>Winner:</b> {c.winner?.name || "—"}</p>
              <p><b>Created:</b> {c.createdAt ? new Date(c.createdAt).toLocaleString("en-IN") : "—"}</p>
              <p><b>Settled by:</b> {c.settlement?.settledBy || "—"}</p>
              <p><b>Settled at:</b> {c.settlement?.settledAt ? new Date(c.settlement.settledAt).toLocaleString("en-IN") : "—"}</p>
            </div>

            {c.conflict?.active && (
              <p className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-xs font-bold text-orange-700">
                Dispute opened{c.conflict.raisedBy ? ` by ${c.conflict.raisedBy}` : ""} — {c.conflict.reason || "no reason given"}
                {c.conflict.autoRefundAt ? ` · auto-refunds ${new Date(c.conflict.autoRefundAt).toLocaleString("en-IN")}` : ""}
              </p>
            )}

            {/* players + proof */}
            <div className="grid gap-3 sm:grid-cols-2">
              {[1, 2].map((seat) => {
                const p = players.find((x) => x.seat === seat);
                const report = (c.resultReports || []).find((r) => String(r.userId) === String(p?.id));
                return (
                  <div key={seat} className="rounded-xl border border-[#f0c2d8] bg-white p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#a56a83]">Seat {seat}</p>
                    <p className="mt-0.5 font-bold text-[#2a1520]">{p?.name || "Waiting…"}</p>
                    <p className="text-[11px] text-[#a56a83]">{p?.phone || "—"}</p>
                    <p className="mt-1 text-xs">
                      <b>Reported:</b>{" "}
                      {report ? (
                        <Badge status={report.outcome === "won" ? "approved" : report.outcome === "lost" ? "rejected" : "cancel_requested"} />
                      ) : (
                        <span className="text-[#a56a83]">not yet</span>
                      )}
                    </p>
                    {p?.netPaise !== null && p?.netPaise !== undefined && (
                      <p className="mt-1 text-xs text-[#7a3d58]">
                        Net for this battle: <Money paise={p.netPaise ?? 0} signed />
                      </p>
                    )}
                    <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-[#a56a83]">Proof screenshot</p>
                    <div className="mt-1">
                      {report?.screenshots?.length ? (
                        <div className="flex flex-wrap gap-2">
                          {report.screenshots.map((shot) => (
                            <AuthedImage
                              key={shot.key}
                              fileKey={shot.key}
                              alt="match proof"
                              className="h-24 w-24"
                              onClick={() => setPreviewKey(shot.key)}
                            />
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-[#a56a83]">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* actions */}
            {!terminal && (
              <div className="space-y-3 rounded-xl border border-[#f0c2d8] bg-[#fdf1f7] p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-[#7a3d58]">Resolve</p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[220px] flex-1">
                    <Select
                      label="Declare winner"
                      value={winner}
                      onChange={(e) => setWinner(e.target.value)}
                      placeholder="Select winner…"
                      options={players.filter((p) => p.id).map((p) => ({
                        value: String(p.id),
                        label: `${p.name || "player"} (seat ${p.seat})`,
                      }))}
                    />
                  </div>
                  <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="min-w-[180px] flex-1" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="success" disabled={busy || !winner} onClick={() => settle.mutate()}>
                    {settle.isPending ? "Settling…" : "Settle & pay winner"}
                  </Button>
                  <Button variant="danger" disabled={busy} onClick={() => refund.mutate()}>
                    {refund.isPending ? "Refunding…" : "Refund both"}
                  </Button>
                  {c.status === "open" && (
                    <Button variant="subtle" disabled={busy} onClick={() => forceExpire.mutate()}>
                      {forceExpire.isPending ? "Expiring…" : "Force-expire"}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* money trail */}
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#7a3d58]">Ledger trail</p>
              <Table
                columns={[
                  { key: "type", label: "Type", render: (r) => String(r.type || "").replace(/_/g, " ") },
                  { key: "user", label: "User", render: (r) => r.user?.name || r.user?.id || "—" },
                  { key: "amountPaise", label: "Amount", render: (r) => <Money paise={r.amountPaise ?? 0} signed /> },
                  { key: "heldDeltaPaise", label: "Held Δ", render: (r) => <Money paise={r.heldDeltaPaise ?? 0} signed /> },
                  { key: "createdAt", label: "Time", render: (r) => (r.createdAt ? new Date(r.createdAt).toLocaleString("en-IN") : "—") },
                ]}
                data={ledger}
                empty="No ledger entries"
              />
            </div>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-[#a56a83]">Battle not found.</p>
        )}
      </Modal>

      {/* full-size proof viewer */}
      <Modal open={Boolean(previewKey)} onClose={() => setPreviewKey(null)} title="Match proof" wide>
        <AuthedImage fileKey={previewKey} alt="match proof" className="max-h-[70vh] w-full !cursor-default object-contain" />
      </Modal>
    </div>
  );
}
