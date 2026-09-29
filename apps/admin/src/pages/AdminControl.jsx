import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { useToast } from "../components/Toast.jsx";
import { Badge, Button, Card, Input, Modal, Money, PageHeading, Panel, Select, Skeleton, Table } from "../components/ui.jsx";
import { PERMISSIONS } from "../lib/permissions.js";

const TABS = [
  { value: "add", label: "Add Admin / Agent" },
  { value: "data", label: "Admin / Agent Data" },
];

/** Admin Control — create admin / agent accounts and see their activity. */
export default function AdminControl() {
  const [sp] = useSearchParams();
  const tab = TABS.some((t) => t.value === sp.get("tab")) ? sp.get("tab") : "add";

  return (
    <div>
      <PageHeading title="Admin Control" subtitle="Create admin / agent accounts and review their work" />

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-[#f0c2d8] bg-white p-1">
        {TABS.map((t) => (
          <Link key={t.value} to={`/admin-control?tab=${t.value}`}>
            <span
              className={`block rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                tab === t.value
                  ? "bg-gradient-to-br from-[#ec4899] to-[#db2777] text-white"
                  : "text-[#a56a83] hover:text-[#2a1520]"
              }`}
            >
              {t.label}
            </span>
          </Link>
        ))}
      </div>

      {tab === "add" ? <AddAdmin /> : <AdminData />}
    </div>
  );
}

function PermissionChips({ role, value, onChange, disabled }) {
  const isAgent = role === "agent";
  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold text-[#7a3d58]">
        Permissions {isAgent ? "(agent)" : "(admins get everything)"}
      </label>
      <div className="flex flex-wrap gap-1.5">
        {PERMISSIONS.map((p) => {
          const checked = !isAgent || value.includes(p.key);
          return (
            <button
              key={p.key}
              type="button"
              disabled={disabled || !isAgent}
              onClick={() => onChange(value.includes(p.key) ? value.filter((k) => k !== p.key) : [...value, p.key])}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                checked
                  ? "border-[#db2777] bg-[#fce4ee] text-[#be185d]"
                  : "border-[#f0c2d8] bg-white text-[#a56a83]"
              } ${disabled || !isAgent ? "opacity-70" : ""}`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AddAdmin() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "", role: "agent", permissions: [] });

  const create = useMutation({
    mutationFn: () => api("/admin/create-admin", {
      method: "POST",
      body: {
        name: form.name.trim(),
        phone: form.phone,
        email: form.email.trim() || undefined,
        password: form.password,
        role: form.role,
        permissions: form.role === "agent" ? form.permissions : [],
      },
    }),
    onSuccess: () => {
      toast.success(`${form.role === "agent" ? "Agent" : "Admin"} created`);
      setForm({ name: "", phone: "", email: "", password: "", role: "agent", permissions: [] });
      qc.invalidateQueries({ queryKey: ["admin-list"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const valid = form.name.trim().length >= 2 && /^[6-9]\d{9}$/.test(form.phone) && form.password.length >= 8;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Add Admin / Agent">
        <div className="space-y-3">
          <Input label="Name" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Full name" />
          <Input label="Mobile number (login id)" value={form.phone} onChange={(e) => set({ phone: e.target.value.replace(/\D/g, "") })} placeholder="10-digit mobile" inputMode="numeric" maxLength={10} />
          <Input label="Email (optional)" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="name@example.com" />
          <Input label="Password" type="password" value={form.password} onChange={(e) => set({ password: e.target.value })} placeholder="Minimum 8 characters" />
          <Select
            label="Role"
            value={form.role}
            onChange={(e) => set({ role: e.target.value, permissions: e.target.value === "agent" ? form.permissions : [] })}
            options={[{ value: "agent", label: "Agent" }, { value: "admin", label: "Admin" }]}
          />
          <PermissionChips role={form.role} value={form.permissions} onChange={(permissions) => set({ permissions })} />
          <Button className="w-full py-2.5 text-sm" disabled={!valid || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "Creating…" : "Create account"}
          </Button>
        </div>
      </Panel>

      <Panel title="Roles explained">
        <ul className="list-disc space-y-1.5 pl-4 text-xs font-semibold text-[#7a3d58]">
          <li><b>Admin</b> — full access to every section (same as the main admin, except platform settings).</li>
          <li><b>Agent</b> — sees only the sections you tick above.</li>
          <li>Accounts sign in on the login page with their <b>mobile number + password</b>.</li>
          <li>You can edit names, numbers, passwords and permissions later from “Admin / Agent Data”.</li>
        </ul>
      </Panel>
    </div>
  );
}

function AdminData() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(null);

  const list = useQuery({ queryKey: ["admin-list"], queryFn: () => api("/admin/admin-list") });
  const report = useQuery({ queryKey: ["agent-report"], queryFn: () => api("/admin/agent-report") });

  const remove = useMutation({
    mutationFn: (id) => api(`/admin/delete/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Account deleted");
      qc.invalidateQueries({ queryKey: ["admin-list"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const rows = list.data?.items || [];
  const reportRows = report.data?.items || [];

  return (
    <div className="space-y-4">
      <Panel title="Admin / Agent accounts">
        {list.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : list.isError ? (
          <p className="py-6 text-center text-sm font-bold text-rose-600">{list.error?.message}</p>
        ) : (
          <Table
            columns={[
              { key: "name", label: "Name", render: (r) => <span className="font-bold text-[#2a1520]">{r.name}</span> },
              { key: "phone", label: "Mobile", render: (r) => r.phone || "—" },
              { key: "email", label: "Email", render: (r) => r.email || "—" },
              { key: "role", label: "Role", render: (r) => <Badge status={r.role} /> },
              {
                key: "permissions",
                label: "Permissions",
                render: (r) =>
                  r.role === "agent" ? (
                    <span className="text-xs text-[#7a3d58]">
                      {r.permissions?.length
                        ? r.permissions.map((p) => PERMISSIONS.find((x) => x.key === p)?.label || p).join(", ")
                        : "None"}
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-[#be185d]">All</span>
                  ),
              },
              {
                key: "_actions",
                label: "Actions",
                render: (r) =>
                  r.role === "superadmin" ? (
                    <span className="text-xs text-[#a56a83]">main admin</span>
                  ) : (
                    <div className="flex gap-1">
                      <Button variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
                      <Button
                        variant="danger"
                        disabled={remove.isPending}
                        onClick={() => { if (window.confirm(`Delete ${r.name}? This cannot be undone.`)) remove.mutate(r.id); }}
                      >
                        Delete
                      </Button>
                    </div>
                  ),
              },
            ]}
            data={rows}
            empty="No admin / agent accounts"
          />
        )}
      </Panel>

      <Panel title="Admin / Agent activity">
        <p className="mb-3 text-[11px] font-semibold text-[#a56a83]">
          Approvals and bonus/penalty amounts handled by each account.
        </p>
        {report.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : report.isError ? (
          <p className="py-6 text-center text-sm font-bold text-rose-600">{report.error?.message}</p>
        ) : (
          <Table
            columns={[
              { key: "name", label: "Name", render: (r) => (
                <div>
                  <p className="font-bold text-[#2a1520]">{r.name}</p>
                  <p className="text-[11px] text-[#a56a83]">{r.phone || r.email || "—"}</p>
                </div>
              ) },
              { key: "role", label: "Role", render: (r) => <Badge status={r.role} /> },
              { key: "totalDepositPaise", label: "Deposits", render: (r) => <Money paise={r.totalDepositPaise ?? 0} /> },
              { key: "totalWithdrawPaise", label: "Withdrawals", render: (r) => <Money paise={r.totalWithdrawPaise ?? 0} /> },
              { key: "todayDepositPaise", label: "Today deposit", render: (r) => <Money paise={r.todayDepositPaise ?? 0} /> },
              { key: "todayWithdrawPaise", label: "Today withdraw", render: (r) => <Money paise={r.todayWithdrawPaise ?? 0} /> },
              { key: "totalBonusPaise", label: "Bonus", render: (r) => <Money paise={r.totalBonusPaise ?? 0} /> },
              { key: "totalPenaltyPaise", label: "Penalty", render: (r) => <Money paise={r.totalPenaltyPaise ?? 0} /> },
              { key: "totalCount", label: "Actions" },
            ]}
            data={reportRows}
            empty="No activity yet"
          />
        )}
      </Panel>

      <EditAdminModal account={editing} onClose={() => setEditing(null)} qc={qc} toast={toast} />
    </div>
  );
}

function EditAdminModal({ account, onClose, qc, toast }) {
  const [form, setForm] = useState(null);

  // re-seed the form whenever a new account is opened
  React.useEffect(() => {
    if (account) {
      setForm({
        name: account.name || "",
        phone: account.phone || "",
        email: account.email || "",
        password: "",
        role: account.role === "admin" ? "admin" : "agent",
        permissions: account.permissions || [],
      });
    } else {
      setForm(null);
    }
  }, [account]);

  const save = useMutation({
    mutationFn: () => api(`/admin/update/${account.id}`, {
      method: "PATCH",
      body: {
        name: form.name.trim(),
        phone: form.phone,
        email: form.email.trim() || "",
        ...(form.password ? { password: form.password } : {}),
        role: form.role,
        permissions: form.role === "agent" ? form.permissions : [],
      },
    }),
    onSuccess: () => {
      toast.success("Account updated");
      qc.invalidateQueries({ queryKey: ["admin-list"] });
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  if (!account || !form) return null;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${account.name}`}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input label="Name" value={form.name} onChange={(e) => set({ name: e.target.value })} />
        <Input label="Mobile number (login id)" value={form.phone} onChange={(e) => set({ phone: e.target.value.replace(/\D/g, "") })} maxLength={10} inputMode="numeric" />
        <Input label="Email (optional)" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
        <Input label="New password" type="password" value={form.password} onChange={(e) => set({ password: e.target.value })} placeholder="Leave blank to keep current" />
        <Select
          label="Role"
          value={form.role}
          onChange={(e) => set({ role: e.target.value })}
          options={[{ value: "agent", label: "Agent" }, { value: "admin", label: "Admin" }]}
        />
        <PermissionChips role={form.role} value={form.permissions} onChange={(permissions) => set({ permissions })} />
      </div>
    </Modal>
  );
}
