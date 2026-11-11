import React from "react";

/**
 * Maintenance screen — the ONLY thing rendered while the site is under
 * maintenance. No router, no auth, no API calls: nothing else mounts, so
 * nobody can reach the login or play a game.
 *
 * To bring the app back, restore the normal bootstrap in main.jsx.
 */
const STARS = Array.from({ length: 42 }, (_, i) => ({
  left: `${(i * 37 + 13) % 100}%`,
  top: `${(i * 53 + 7) % 100}%`,
  size: i % 4 === 0 ? 3 : i % 3 === 0 ? 2 : 1.5,
  delay: `${(i % 9) * 0.4}s`,
}));

export default function Maintenance() {
  return (
    <div
      className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#090b10] px-6"
      style={{ fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif" }}
    >
      <style>{`
        @keyframes lp-twinkle {
          0%, 100% { opacity: 0.15; transform: scale(0.8); }
          50% { opacity: 0.9; transform: scale(1.15); }
        }
      `}</style>

      {/* starfield backdrop */}
      {STARS.map((s, i) => (
        <span
          key={i}
          className="pointer-events-none absolute rounded-full bg-white/70"
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            animation: `lp-twinkle 2.8s ease-in-out ${s.delay} infinite`,
          }}
        />
      ))}

      <div className="relative z-10 w-full max-w-md rounded-3xl border border-white/10 bg-[#111827]/90 p-8 text-center shadow-2xl ring-1 ring-black/40">
        {/* brand mark */}
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-[#f5b82e] shadow-[0_0_14px_rgba(245,184,46,0.8)]" />
          <span className="text-2xl font-extrabold tracking-[0.18em] text-[#f5b82e]">LPLUDO</span>
        </div>

        {/* wrench badge */}
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/5 text-3xl shadow-inner">
          🔧
        </div>

        <h1 className="text-2xl font-extrabold text-white sm:text-3xl">Site Under Maintenance</h1>

        <div className="mx-auto mt-4 h-px w-16 bg-gradient-to-r from-transparent via-[#f5b82e]/70 to-transparent" />

        <p className="mt-5 text-base font-medium leading-relaxed text-gray-300 sm:text-lg">
          कुछ नया अपडेट आ रहा है इसलिए कुछ समय के लिए website बंद रहेगी 🙏
        </p>

        <p className="mt-5 text-sm text-gray-500">
          We're working on something new — please check back shortly.
        </p>
      </div>
    </div>
  );
}
