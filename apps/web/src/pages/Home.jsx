import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { socket } from "../lib/socket.js";
import { Money, Panel, SectionTitle, StatusBadge } from "../components/ui.jsx";
import { GiftIcon } from "../components/art.jsx";
import LudoBoardArt from "../components/LudoBoardArt.jsx";

const LIVE_STATUSES = ["open", "running", "room_submitted", "result_submitted", "cancel_requested"];

/**
 * Home — the layout follows sample_ui_code/Home_page.txt: referral banner,
 * "Games" header, then game cards with the dark starfield thumbnail and a gold
 * "Play Now" pill. Play Now opens the Classic Web Ludo arena (/play) which
 * holds the stake picker + open battles. Home itself stays a pure launcher
 * with the referral banner, game cards and your live battles.
 */

/** One game card: dark starfield visual on top, white info footer below. */
function GameCard({ title, subtitle, cta, onPlay, disabled = false }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card" data-purpose="game-card">
      <div className="game-thumb-container flex h-44 w-full items-center justify-center">
        <LudoBoardArt className="h-[168px] w-auto drop-shadow-2xl" />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-gray-50 bg-white px-4 py-3.5">
        <div className="min-w-0 space-y-0.5">
          <h3 className="truncate text-lg font-black tracking-tight text-ink">{title}</h3>
          <p className="text-xs font-semibold text-gray-500">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onPlay}
          disabled={disabled}
          className="shrink-0 rounded-full bg-brand-500 px-5 py-2.5 text-xs font-extrabold tracking-normal text-neutral-900 shadow-btn-gold transition-all hover:bg-[#E5A81E] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {cta}
        </button>
      </div>
    </article>
  );
}

export default function Home() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const mine = useQuery({ queryKey: ["contests", "mine"], queryFn: () => api("/contests/mine") });

  // realtime: socket deltas patch the queries instead of refetch storms (P1/F2)
  useEffect(() => {
    if (!socket.connected) socket.connect();
    function resubscribe() {
      socket.emit("subscribe:contests", {}, () => {});
    }
    socket.on("connect", resubscribe);
    socket.on("contest:list-changed", () => {
      qc.invalidateQueries({ queryKey: ["contests"] });
    });
    socket.on("wallet:updated", (view) => qc.setQueryData(["wallet"], view));
    resubscribe();
    return () => {
      socket.off("connect");
      socket.off("contest:list-changed");
      socket.off("wallet:updated");
    };
  }, [qc]);

  const liveBattles = (mine.data?.items || []).filter((c) => LIVE_STATUSES.includes(c.status));

  return (
    <div className="flex flex-col gap-4">
      {/* Referral banner (verbatim from the sample) */}
      <section
        className="flex items-center gap-3 rounded-xl border border-[#FAD655] bg-gradient-to-b from-[#FEF4BA] via-[#FDE88C] to-[#FCD95B] p-3.5 shadow-sm"
        data-purpose="promo-banner"
      >
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
          <GiftIcon className="h-9 w-9" />
        </div>
        <div className="flex-1">
          <p className="text-[13.5px] font-extrabold leading-snug tracking-tight text-neutral-950">
            Refer and Earn 5% Commission Lifetime!!
          </p>
        </div>
      </section>

      {/* Games header + cards */}
      <SectionTitle title="Games" hint="Classic Web Ludo is live. More formats are on the way." />

      <div className="flex flex-col gap-4">
        <GameCard
          title="Classic Web Ludo"
          subtitle="Play the Most Popular Ludo Game Format"
          cta="Play Now"
          onPlay={() => navigate("/play")}
        />
        <GameCard title="Classic App Ludo" subtitle="Ludo King Mode is now available!" cta="Coming Soon" disabled />
      </div>

      {/* ---- live battle ---- */}
      {liveBattles.length > 0 && (
        <Panel title="Your live battles" className="border-brand-500/40 bg-brand-500/5">
          <div className="flex flex-col divide-y divide-gray-100">
            {liveBattles.map((c) => (
              <Link
                key={c.id}
                to={`/battle/${c.id}`}
                className="flex items-center justify-between py-2.5 text-sm font-bold text-slate-700"
              >
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" />
                  Stake <Money paise={c.stake} />
                </span>
                <StatusBadge status={c.status} />
              </Link>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

