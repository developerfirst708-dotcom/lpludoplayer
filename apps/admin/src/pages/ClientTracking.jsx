import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { useToast } from "../components/Toast.jsx";
import { Badge, Button, Card, Input, Money, PageHeading, Skeleton, Table } from "../components/ui.jsx";

/**
 * Client tracking — watch specific mobile numbers and see their battle activity.
 * Add/remove numbers, then read the joined report (registered + battle counts).
 */
export default function ClientTracking() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");

  const tracked = useQuery({ queryKey: ["tracked-accounts"], queryFn: () => api("/admin/tracked-accounts") });
  const report = useQuery({ queryKey: ["tracked-report"], queryFn: () => api("/admin/tracked-accounts/report") });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tracked-accounts"] });
    qc.invalidateQueries({ queryKey: ["tracked-report"] });
  };

  const add = useMutation({
    mutationFn: () => api("/admin/tracked-accounts", { method: "POST", body: { phone: phone.trim(), note: note.trim() || undefined } }),
    onSuccess: () => { toast.success("Number tracked"); setPhone(""); setNote(""); invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id) => api(`/admin/tracked-accounts/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("Removed"); invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  function onAdd() {
    if (!/^[6-9]\d{9}$/.test(phone.trim())) return toast.error("Enter a valid 10-digit mobile number");
    add.mutate();
  }

  const trackedItems = tracked.data?.items || [];
  const rows = report.data?.items || [];

  return (
    <div className="space-y-4">
      <PageHeading title="Client tracking" subtitle={`${trackedItems.length} tracked numbers`} />

      <Card>
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-[#7a3d58]">Track a number</p>
        <div className="grid gap-2 sm:grid-cols-4">
          <Input label="Mobile number" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} maxLength={10} placeholder="10-digit number" />
          <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Client ID 2" />
          <div className="flex items-end">
            <Button disabled={add.isPending} onClick={onAdd}>{add.isPending ? "Adding…" : "Track"}</Button>
          </div>
        </div>
        {trackedItems.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {trackedItems.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-2 rounded-full border border-[#f0c2d8] bg-[#fdf1f7] px-3 py-1 text-xs font-bold text-[#7a3d58]">
                {t.phone}{t.note ? ` — ${t.note}` : ""}
                <button type="button" className="text-rose-500" onClick={() => remove.mutate(t.id)}>×</button>
              </span>
            ))}
          </div>
        )}
      </Card>

      <Card>
        {report.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : report.isError ? (
          <p className="py-6 text-center text-sm font-bold text-rose-600">{report.error?.message}</p>
        ) : (
          <Table
            columns={[
              { key: "name", label: "Player", render: (r) => (
                <div>
                  <p className="font-bold text-[#2a1520]">{r.name || "—"}</p>
                  <p className="text-[11px] text-[#a56a83]">{r.phone}</p>
                </div>
              ) },
              { key: "registered", label: "Registered", render: (r) => (r.registered ? <Badge status="active" /> : <span className="text-xs text-[#a56a83]">not yet</span>) },
              { key: "totalBattles", label: "Battles", render: (r) => r.totalBattles },
              { key: "completedBattles", label: "Completed", render: (r) => r.completedBattles },
              { key: "cancelledBattles", label: "Cancelled", render: (r) => r.cancelledBattles },
              { key: "stakedPaise", label: "Amount", render: (r) => <Money paise={r.stakedPaise} /> },
              { key: "joinedAt", label: "Joined", render: (r) => (r.joinedAt ? new Date(r.joinedAt).toLocaleString("en-IN") : "—") },
            ]}
            data={rows}
            empty="No tracked accounts"
          />
        )}
      </Card>
    </div>
  );
}
