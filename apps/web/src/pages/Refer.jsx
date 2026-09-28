import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { formatPaise } from "@lpludo/shared";
import { useToast } from "../components/Toast.jsx";
import { Button, Panel, Skeleton } from "../components/ui.jsx";

/**
 * Refer — the referral code, the invite link, a WhatsApp share and the live
 * earnings. The payout itself is the 2% lifetime commission credited to the
 * referrer's referral balance whenever a referred player wins a battle.
 */
export default function Refer() {
  const toast = useToast();
  const [copied, setCopied] = useState("");

  const referrals = useQuery({ queryKey: ["referrals"], queryFn: () => api("/user/referrals") });

  const code = referrals.data?.code || "";
  const link = code ? `${window.location.origin}/login?ref=${code}` : "";

  async function copy(value, what) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      toast.success(`${what} copied`);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      toast.info(value);
    }
  }

  const shareText = encodeURIComponent(
    `Play Ludo and win real cash! 🎲💰 Use my referral code *${code}* to sign up.\nJoin now: ${link}`
  );

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
      <Panel title="Your referral code">
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-1.5">
            <span className="flex-1 truncate px-2 font-mono text-sm font-black tracking-widest text-slate-800">
              {code || "—"}
            </span>
            <Button variant="ghost" className="shrink-0 px-3.5 py-2 text-xs" onClick={() => copy(code, "Code")} disabled={!code}>
              {copied === "Code" ? "Copied ✓" : "Copy Code"}
            </Button>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-1.5">
            <span className="flex-1 truncate px-2 text-[11px] font-semibold text-slate-600">{link || "—"}</span>
            <Button variant="ghost" className="shrink-0 px-3.5 py-2 text-xs" onClick={() => copy(link, "Link")} disabled={!link}>
              {copied === "Link" ? "Copied ✓" : "Copy Link"}
            </Button>
          </div>

          <a
            href={`https://wa.me/?text=${shareText}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-full bg-[#25D366] px-5 py-3 text-xs font-extrabold uppercase tracking-wide text-white shadow-md transition-all hover:bg-[#20bd5a] active:scale-95"
          >
            <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
            </svg>
            Share via WhatsApp
          </a>
        </div>
      </Panel>

      <Panel title="Earnings">
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3 text-center">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">👥 Total Referrals</p>
            <p className="mt-1 text-lg font-black text-slate-800">
              {referrals.data?.totalReferred ?? 0}
              <span className="ml-1 text-[10px] font-semibold text-slate-500">players</span>
            </p>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3 text-center">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">💰 Total Earning</p>
            <p className="mt-1 text-lg font-black text-emerald-600">{formatPaise(referrals.data?.totalEarnedPaise ?? 0)}</p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-xl bg-brand-500/10 px-3 py-2.5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">Redeemable balance</p>
            <p className="text-sm font-black text-slate-800">{formatPaise(referrals.data?.referralPaise ?? 0)}</p>
          </div>
          <Link to="/redeem" className="rounded-full bg-brand-500 px-4 py-2 text-xs font-extrabold text-neutral-900 shadow-btn-gold active:scale-95">
            Redeem
          </Link>
        </div>

        <Link to="/refer-history" className="mt-3 block text-center text-xs font-extrabold text-brand-600 hover:text-brand-500">
          View refer history →
        </Link>
      </Panel>
    </div>
  );
}
