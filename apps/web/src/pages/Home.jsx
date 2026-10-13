import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { socket } from "../lib/socket.js";
import { SectionTitle } from "../components/ui.jsx";

/**
 * Home — launcher layout with referral banner, game cards, and inline SVG WhatsApp support.
 */

/** One game card: poster visual on top with badge, white info footer below. */
function GameCard({ title, subtitle, cta, image, imageAlt, onPlay, disabled = false, badge }) {
  return (
    <article
      onClick={!disabled ? onPlay : undefined}
      className={`relative overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card transition-all ${
        !disabled ? "cursor-pointer hover:shadow-md" : ""
      }`}
      data-purpose="game-card"
    >
      <div className="relative h-44 w-full overflow-hidden bg-gray-100">
        <img src={image} alt={imageAlt} loading="lazy" className="h-full w-full object-cover" />
        {badge && <div className="absolute top-3 right-3">{badge}</div>}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-gray-50 bg-white px-4 py-3.5">
        <div className="min-w-0 space-y-0.5">
          <h3 className="truncate text-lg font-black tracking-tight text-ink">{title}</h3>
          <p className="text-xs font-semibold text-gray-500">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled && onPlay) onPlay();
          }}
          disabled={disabled}
          className={`shrink-0 rounded-full font-extrabold tracking-normal transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${
            disabled
              ? "bg-gray-200 px-3 py-1.5 text-[11px] text-gray-500 shadow-none"
              : "bg-brand-500 px-5 py-2.5 text-xs text-neutral-900 shadow-btn-gold hover:bg-[#E5A81E]"
          }`}
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

  // realtime socket connection to patch wallet/contest queries
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

  return (
    <div className="relative flex flex-col gap-6 pb-20">
      {/* Welcome banner with padding and top margin gap */}
      <section
        className="my-2 flex items-center justify-center rounded-xl border border-[#FAD655] bg-gradient-to-b from-[#FEF4BA] via-[#FDE88C] to-[#FCD95B] py-4 px-3 shadow-sm"
        data-purpose="promo-banner"
      >
        <p className="text-center text-[13.5px] font-extrabold leading-snug tracking-wider text-neutral-950 space-x-2">
          <span>WELCOME</span>
          <span>TO</span>
          <span>LPludoplayer</span>
        </p>
      </section>

      {/* Games header + cards */}
      <div className="flex flex-col gap-4">
        <SectionTitle title="Games" hint="Classic Web Ludo is live. More formats are on the way." />

        <GameCard
          title="Classic Manual Ludo"
          subtitle="Ludo King mode is now available"
          cta="Play Now"
          image="/ludo-classic-manual.jpg"
          imageAlt="Classic Web Ludo poster"
          onPlay={() => navigate("/play")}
          badge={
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-600/90 backdrop-blur-sm px-3 py-1 text-[11px] font-black uppercase text-white shadow-md animate-pulse">
              <span className="h-2 w-2 rounded-full bg-white animate-ping" />
              LIVE
            </span>
          }
        />
        <GameCard
          title="Classic Web Ludo"
          subtitle="Web ludo is coming soon !"
          cta="Coming Soon"
          image="/lp-ludo-player.jpg"
          imageAlt="Classic App Ludo poster"
          disabled
          badge={
            <span className="rounded-full bg-amber-500/90 backdrop-blur-sm px-2.5 py-0.5 text-[10px] font-black uppercase text-neutral-950 shadow-md">
              Coming Soon
            </span>
          }
        />
      </div>

    </div>
  );
}
