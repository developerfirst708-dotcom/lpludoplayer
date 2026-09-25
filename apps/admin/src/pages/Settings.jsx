import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { rupeesToPaise, formatPaise } from "@lpludo/shared";
import { useToast } from "../components/Toast.jsx";
import { Badge, Button, Card, Input, PageHeading, Panel, Skeleton } from "../components/ui.jsx";
import { authState } from "../lib/auth.js";

/** paise -> the rupee string an operator types (25000 -> "250.00") */
const toRupees = (paise) => (Number.isInteger(paise) ? (paise / 100).toFixed(2) : "");

/**
 * Settings — deposit UPI + limits + maintenance mode. Readable by any admin;
 * only a superadmin may save (the API enforces this too).
 */
export default function Settings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isSuperadmin = authState().user?.role === "superadmin";

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api("/admin/settings"),
  });

  const [form, setForm] = useState(null);

  useEffect(() => {
    if (settings.data) {
      setForm({
        depositUpiId: settings.data.depositUpiId || "",
        depositUpiName: settings.data.depositUpiName || "",
        depositMin: toRupees(settings.data.depositMinPaise),
        withdrawalMin: toRupees(settings.data.withdrawalMinPaise),
        gatewayMax: toRupees(settings.data.depositGatewayMaxPaise),
        maintenanceMode: Boolean(settings.data.maintenanceMode),
      });
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        depositUpiName: form.depositUpiName.trim() || undefined,
        depositMinPaise: form.depositMin ? rupeesToPaise(form.depositMin) : undefined,
        withdrawalMinPaise: form.withdrawalMin ? rupeesToPaise(form.withdrawalMin) : undefined,
        depositGatewayMaxPaise: form.gatewayMax ? rupeesToPaise(form.gatewayMax) : undefined,
        maintenanceMode: form.maintenanceMode,
      };
      if (form.depositUpiId.trim()) body.depositUpiId = form.depositUpiId.trim();
      return api("/admin/settings", { method: "POST", body });
    },
    onSuccess: () => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
    },
    onError: (err) => toast.error(err.message),
  });

  if (settings.isLoading || !form) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (settings.isError) {
    return <Card><p className="py-6 text-center text-sm font-bold text-rose-600">{settings.error?.message}</p></Card>;
  }

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div>
      <PageHeading
        title="Settings"
        subtitle="Deposit account, limits and platform mode"
        action={<Badge status={form.maintenanceMode ? "banned" : "active"} />}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Deposit account">
          <div className="space-y-3">
            <Input
              label="UPI ID"
              value={form.depositUpiId}
              onChange={(e) => set({ depositUpiId: e.target.value })}
              placeholder="lpludo@upi"
              disabled={!isSuperadmin}
            />
            <Input
              label="Account holder name"
              value={form.depositUpiName}
              onChange={(e) => set({ depositUpiName: e.target.value })}
              placeholder="LPLUDO"
              disabled={!isSuperadmin}
            />
            <p className="rounded-xl bg-[#fdf1f7] px-3 py-2 text-[11px] font-semibold text-[#7a3d58]">
              Players see this UPI ID on the deposit screen — double-check it before saving.
            </p>
          </div>
        </Panel>

        <Panel title="Limits & mode">
          <div className="space-y-3">
            <Input
              label="Minimum deposit (₹)"
              value={form.depositMin}
              onChange={(e) => set({ depositMin: e.target.value })}
              placeholder="10.00"
              inputMode="decimal"
              disabled={!isSuperadmin}
              hint={settings.data?.depositMinPaise ? `currently ${formatPaise(settings.data.depositMinPaise)}` : undefined}
            />
            <Input
              label="Instant UPI limit (₹)"
              value={form.gatewayMax}
              onChange={(e) => set({ gatewayMax: e.target.value })}
              placeholder="5000.00"
              inputMode="decimal"
              disabled={!isSuperadmin}
              hint="Amounts below this are paid on the IMB Pay gateway and credited automatically. At or above it, players pay to the UPI ID above and you verify the UTR."
            />
            <Input
              label="Minimum withdrawal (₹)"
              value={form.withdrawalMin}
              onChange={(e) => set({ withdrawalMin: e.target.value })}
              placeholder="1000.00"
              inputMode="decimal"
              disabled={!isSuperadmin}
              hint={settings.data?.withdrawalMinPaise ? `currently ${formatPaise(settings.data.withdrawalMinPaise)}` : undefined}
            />
            <label className={`flex items-center justify-between rounded-xl border border-[#f0c2d8] px-3 py-2.5 ${isSuperadmin ? "" : "opacity-60"}`}>
              <span className="text-sm font-bold text-[#2a1520]">Maintenance mode</span>
              <input
                type="checkbox"
                checked={form.maintenanceMode}
                onChange={(e) => set({ maintenanceMode: e.target.checked })}
                disabled={!isSuperadmin}
                className="h-4 w-4 accent-[#db2777]"
              />
            </label>
            <p className="text-[11px] text-[#a56a83]">
              Max deposit is currently {formatPaise(settings.data?.depositMaxPaise ?? 0)}.
              {settings.data?.updatedAt ? ` Last updated ${new Date(settings.data.updatedAt).toLocaleString("en-IN")}.` : ""}
            </p>
          </div>
        </Panel>
      </div>

      {isSuperadmin ? (
        <div className="mt-4">
          <Button className="px-5 py-2.5 text-sm" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-[#f0c2d8] bg-white px-4 py-3 text-xs font-semibold text-[#7a3d58]">
          Read-only — only a superadmin can change platform settings.
        </p>
      )}
    </div>
  );
}
