import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { rupeesToPaise } from "@lpludo/shared";
import { useToast } from "../components/Toast.jsx";
import { Button, Card, Input, Money, PageHeading, Skeleton, Table } from "../components/ui.jsx";

/**
 * Dummy battles — admin "social proof" tables shown in the player lobby.
 * A real player clicking one removes it (handled server-side).
 */
export default function DummyBattles() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [stake, setStake] = useState("");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");

  const list = useQuery({
    queryKey: ["dummy-contests"],
    queryFn: () => api("/admin/dummy-contests"),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["dummy-contests"] });

  const create = useMutation({
    mutationFn: () =>
      api("/admin/dummy-contests", {
        method: "POST",
        body: { stake: rupeesToPaise(stake), name: name.trim(), mobile: mobile.trim() || undefined },
      }),
    onSuccess: () => { toast.success("Dummy battle added"); setStake(""); setName(""); setMobile(""); invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id) => api(`/admin/dummy-contests/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("Dummy battle removed"); invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const items = list.data?.items || [];

  function add() {
    if (!name.trim()) return toast.error("Enter a player name");
    try {
      rupeesToPaise(stake);
    } catch {
      return toast.error("Enter a valid amount (₹50–₹1,00,000, multiples of ₹50)");
    }
    create.mutate();
  }

  return (
    <div className="space-y-4">
      <PageHeading title="Dummy battles" subtitle={`${items.length} social-proof tables`} />

      <Card>
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-[#7a3d58]">Add a dummy battle</p>
        <div className="grid gap-2 sm:grid-cols-4">
          <Input label="Player name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Rohit_99" />
          <Input label="Amount (₹)" value={stake} onChange={(e) => setStake(e.target.value)} placeholder="500" inputMode="numeric" />
          <Input label="Mobile (fake)" value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))} maxLength={10} placeholder="Optional" />
          <div className="flex items-end">
            <Button className="w-full" disabled={create.isPending} onClick={add}>{create.isPending ? "Adding…" : "Add"}</Button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-[#a56a83]">
          Dummies appear in the player lobby as open battles and vanish if a real player tries to join.
        </p>
      </Card>

      <Card>
        {list.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : list.isError ? (
          <p className="py-6 text-center text-sm font-bold text-rose-600">{list.error?.message}</p>
        ) : (
          <Table
            columns={[
              { key: "name", label: "Player", render: (r) => <span className="font-bold text-[#2a1520]">{r.name}</span> },
              { key: "mobile", label: "Mobile", render: (r) => r.mobile || "—" },
              { key: "stake", label: "Amount", render: (r) => <Money paise={r.stake} /> },
              { key: "createdAt", label: "Created", render: (r) => (r.createdAt ? new Date(r.createdAt).toLocaleString("en-IN") : "—") },
              { key: "_actions", label: "", render: (r) => <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(r.id)}>Remove</Button> },
            ]}
            data={items}
            empty="No dummy battles"
          />
        )}
      </Card>
    </div>
  );
}
