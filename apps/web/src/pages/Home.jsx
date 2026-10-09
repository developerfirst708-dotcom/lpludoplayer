import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { socket } from "../lib/socket.js";
import { SectionTitle } from "../components/ui.jsx";

/**
 * Home — launcher layout with referral banner and game cards.
 */

/** One game card: poster visual on top, white info footer below. */
function GameCard({ title, subtitle, cta, image, imageAlt, onPlay, disabled = false }) {
  return (
    <article
      onClick={!disabled ? onPlay : undefined}
      className={`overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card transition-all ${
        !disabled ? "cursor-pointer hover:shadow-md" : ""
      }`}
      data-purpose="game-card"
    >
      <div className="h-44 w-full overflow-hidden bg-gray-100">
        <img src={image} alt={imageAlt} loading="lazy" className="h-full w-full object-cover" />
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
    <div className="flex flex-col gap-4">
      {/* Welcome banner */}
      <section
        className="flex items-center justify-center rounded-xl border border-[#FAD655] bg-gradient-to-b from-[#FEF4BA] via-[#FDE88C] to-[#FCD95B] p-3.5 shadow-sm"
        data-purpose="promo-banner"
      >
        <p className="text-center text-[13.5px] font-extrabold leading-snug tracking-tight text-neutral-950">
          WELCOME   TO   LPLUDOPLAYER
        </p>
      </section>

      {/* Games header + cards */}
      <SectionTitle title="Games" hint="Classic Web Ludo is live. More formats are on the way." />

      <div className="flex flex-col gap-4">
        <GameCard
          title="Classic Manual Ludo"
          subtitle="Ludo King mode is now available"
          cta="Play Now"
          image="/ludo-classic-manual.jpg"
          imageAlt="Classic Web Ludo poster"
          onPlay={() => navigate("/play")}
        />
        <GameCard
          title="Classic Web Ludo"
          subtitle="Web ludo is coming soon !"
          cta="Coming Soon"
          image="/lp-ludo-player.jpg"
          imageAlt="Classic App Ludo poster"
          disabled
        />
      </div>
    </div>
  );
}
