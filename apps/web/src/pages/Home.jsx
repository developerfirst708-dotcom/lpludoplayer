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

      {/* Floating WhatsApp Support Button (Direct Embedded Inline SVG) */}
      <a
        href="https://wa.me/919999999999"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-20 right-4 z-50 flex flex-col items-center gap-0.5 transition-transform hover:scale-105 active:scale-95"
        aria-label="WhatsApp Support"
      >
        <div className="flex h-13 w-13 items-center justify-center rounded-full bg-[#25D366] p-2.5 text-white shadow-xl ring-2 ring-white">
          <svg
            className="h-full w-full fill-current"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M12.012 2c-5.508 0-9.988 4.479-9.988 9.988 0 1.762.459 3.483 1.332 5.002L2 22l5.127-1.34c1.464.799 3.118 1.218 4.885 1.218 5.508 0 9.988-4.479 9.988-9.988 0-5.509-4.48-9.99-9.988-9.99zm5.834 14.152c-.244.688-1.229 1.309-1.996 1.439-.527.088-1.213.158-3.526-.8-2.959-1.228-4.862-4.237-5.011-4.435-.146-.198-1.206-1.606-1.206-3.064 0-1.458.763-2.176 1.034-2.471.271-.295.592-.369.789-.369.197 0 .394.002.566.012.182.01.428-.069.67.512.246.591.837 2.043.911 2.191.074.148.123.32.025.517-.099.197-.148.32-.295.492-.148.172-.31.385-.443.517-.148.148-.303.31-.131.606.172.295.766 1.264 1.644 2.046 1.129 1.006 2.081 1.318 2.376 1.466.295.148.468.123.641-.074.172-.1
