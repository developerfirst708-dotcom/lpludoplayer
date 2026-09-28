import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { formatPaise, rupeesToPaise } from "@lpludo/shared";
import { useToast } from "../components/Toast.jsx";
import { Button, Input, Panel, Skeleton } from "../components/ui.jsx";

const MIN_REDEEM_RUPEES = 200;
const MAX_REDEEM_RUPEES = 10000;

/**
 * Redeem — move referral earnings into the playable/withdrawable balance.
 * Limits are same-to-same as Adda Ludo: ₹200 minimum, ₹10,000 maximum, never
 * more than the referral balance itself.
 */
export default function Redeem() {
  const toast = useToast();
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const referrals = useQuery({ queryKey: ["referrals"], queryFn: () => api("/user/referrals") });
  const balancePaise = referrals.data?.referralPaise ?? 0;

  async function redeem() {
    const rupees = Number(amount);
    if (!rupees) {
      toast.error("Enter an amount");
      return;
    }
    if (rupees < MIN_REDEEM_RUPEES) {
      toast.error(`Minimum redeem is ₹${MIN_REDEEM_RUPEES}`);
      return;
    }
    if (rupees > MAX_REDEEM_RUPEES) {
      toast.error(`Maximum redeem is ₹${MAX_REDEEM_RUPEES.toLocaleString("en-IN")}`);
      return;
    }

    let paise;
    try {
      paise = rupeesToPaise(rupees);
    } catch (err) {
      toast.error(err.message || "Enter a valid amount");
      return;
    }
    if (paise > balancePaise) {
      toast.error("Insufficient referral balance");
      return;
    }

    setBusy(true);
    try {
      await api("/payments/referral/redeem", { method: "POST", body: { amountPaise: paise } });
      toast.success("Referral earnings moved to your wallet");
      setAmount("");
      qc.invalidateQueries({ queryKey: ["referrals"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (referrals.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* headline */}
      <section className="rounded-2xl border border-[#FAD655] bg-gradient-to-b from-[#FFFDF5] to-white p-4 text-center shadow-card">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700">Referral balance</p>
        <p className="mt-1 text-3xl font-black tracking-tight text-ink">{formatPaise(balancePaise)}</p>
        <p className="mt-1 text-[11px] font-semibold text-slate-500">
          Earned lifetime: {formatPaise(referrals.data?.totalEarnedPaise ?? 0)}
        </p>
      </section>

      <Panel title="Redeem to wallet">
        <div className="space-y-3">
          <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-slate-300 px-3 py-2.5">
            <span className="mt-0.5 shrink-0 text-slate-400">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2.5" />
                <line x1="9" y1="9" x2="15" y2="15" />
                <line x1="15" y1="9" x2="9" y2="15" />
              </svg>
            </span>
            <p className="text-[11px] font-bold leading-snug text-slate-600">
              TDS (0%) will be deducted after annual referral earnings of ₹15,000.
            </p>
          </div>

          <Input
            label={`Amount (min ₹${MIN_REDEEM_RUPEES} · max ₹${MAX_REDEEM_RUPEES.toLocaleString("en-IN")})`}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="0"
            inputMode="numeric"
            hint={`Minimum redeem is ₹${MIN_REDEEM_RUPEES}. Redeemed money goes to your playable balance.`}
          />

          <Button className="w-full" onClick={redeem} loading={busy} disabled={!amount || balancePaise < MIN_REDEEM_RUPEES}>
            REDEEM NOW
          </Button>

          {balancePaise < MIN_REDEEM_RUPEES && (
            <p className="rounded-xl bg-gray-50 px-3 py-2.5 text-[11px] font-semibold text-slate-500">
              You need at least {formatPaise(MIN_REDEEM_RUPEES * 100)} of referral balance to redeem. Keep sharing your
              code — every battle your friends win pays you 2%.
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}
