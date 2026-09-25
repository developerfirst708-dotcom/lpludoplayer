import React, { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { formatPaise } from "@lpludo/shared";
import { useToast } from "./Toast.jsx";
import { Button, Spinner } from "./ui.jsx";

/**
 * "Verifying your payment" card shown after the gateway redirect
 * (`/wallet?deposit=<id>`).
 *
 * It polls our own API, which in turn asks the gateway server-to-server — so
 * the card settles even when the gateway's webhook cannot reach us. Credit is
 * only ever applied by the backend (single ledger row, idempotent).
 */

const FAST_MS = 4000; // while it is fresh we poll quickly…
const SLOW_MS = 20_000; // …then back off so we do not burn gateway credits
const FAST_WINDOW_MS = 2 * 60_000;

export default function GatewayDepositCard({ depositId, onClose }) {
  const qc = useQueryClient();
  const toast = useToast();
  const startedAt = useRef(Date.now());

  const deposit = useQuery({
    queryKey: ["deposit", depositId],
    queryFn: () => api(`/payments/deposit/${depositId}`),
    enabled: Boolean(depositId),
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d || d.status !== "pending") return false;
      return Date.now() - startedAt.current < FAST_WINDOW_MS ? FAST_MS : SLOW_MS;
    },
  });

  const cancel = useMutation({
    mutationFn: () => api(`/payments/deposit/${depositId}/cancel`, { method: "POST" }),
    onSuccess: (res) => {
      if (res.status === "approved") toast.success("Payment verified — wallet credited");
      else toast.info("Deposit cancelled");
      qc.invalidateQueries({ queryKey: ["wallet"] });
      qc.invalidateQueries({ queryKey: ["wallet", "history"] });
      qc.invalidateQueries({ queryKey: ["deposits", "mine"] });
      onClose?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const status = deposit.data?.status;

  useEffect(() => {
    if (status === "approved") {
      toast.success("Payment received — wallet credited");
      qc.invalidateQueries({ queryKey: ["wallet"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["wallet", "history"] });
      qc.invalidateQueries({ queryKey: ["deposits", "mine"] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (deposit.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-4 text-sm font-bold text-slate-500">
        <Spinner /> Checking your payment…
      </div>
    );
  }

  if (deposit.isError) {
    return (
      <div className="space-y-2 rounded-xl border border-rose-100 bg-rose-50 px-3 py-3">
        <p className="text-sm font-bold text-rose-700">Could not load this deposit</p>
        <p className="text-[11px] text-rose-600">{deposit.error?.message}</p>
        <Button variant="ghost" className="text-xs" onClick={onClose}>Close</Button>
      </div>
    );
  }

  const d = deposit.data;
  const amount = formatPaise(d.amountPaise);

  if (d.status === "pending") {
    const underReview = Boolean(d.gatewayNote);
    return (
      <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-3">
        <div className="flex items-center gap-2">
          {!underReview && <Spinner />}
          <p className="text-sm font-black text-amber-900">
            {underReview ? "We are checking your payment" : "Waiting for payment confirmation…"}
          </p>
        </div>
        <p className="text-xs font-semibold text-amber-800">
          {underReview
            ? d.gatewayNote
            : `${amount} · pay on the gateway page if you have not yet. This screen updates by itself — usually within a few seconds of the payment going through.`}
        </p>
        {d.utr && <p className="font-mono text-[11px] text-amber-800">UTR {d.utr}</p>}
        <div className="flex gap-2">
          {d.paymentUrl && !underReview && (
            <a
              href={d.paymentUrl}
              className="flex-1 rounded-xl bg-brand-600 px-3 py-2 text-center text-xs font-bold text-white"
            >
              Open payment page
            </a>
          )}
          {!underReview && (
            <Button
              variant="ghost"
              className="flex-1 text-xs"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              {cancel.isPending ? "Cancelling…" : "Cancel deposit"}
            </Button>
          )}
          <Button variant="ghost" className="text-xs" onClick={onClose}>Hide</Button>
        </div>
      </div>
    );
  }

  if (d.status === "approved") {
    return (
      <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
        <p className="text-sm font-black text-emerald-800">Payment successful</p>
        <p className="text-xs font-semibold text-emerald-700">
          {amount} added to your wallet{d.utr ? ` · UTR ${d.utr}` : ""}.
        </p>
        <Button variant="success" className="text-xs" onClick={onClose}>Done</Button>
      </div>
    );
  }

  // failed | rejected
  return (
    <div className="space-y-2 rounded-xl border border-rose-100 bg-rose-50 px-3 py-3">
      <p className="text-sm font-black text-rose-700">
        {d.status === "failed" ? "Payment not completed" : "Deposit rejected"}
      </p>
      <p className="text-xs font-semibold text-rose-600">
        {d.rejectReason || "The payment was not completed in time."} Nothing was deducted.
      </p>
      <Button variant="ghost" className="text-xs" onClick={onClose}>Try again</Button>
    </div>
  );
}
