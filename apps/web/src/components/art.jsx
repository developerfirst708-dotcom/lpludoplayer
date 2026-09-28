import React, { useId } from "react";

/**
 * Brand + game artwork, all inline SVG so the UI never depends on a remote
 * image host (the sample file pointed at temporary AI-art URLs). Every mark
 * reuses the palette from the sample: gold #F5B82E on near-black #090B10.
 */

/** LR monogram in a black disc with the little gold crown from the sample. */
export function Monogram({ className = "" }) {
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <div className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-neutral-700 bg-black shadow-md">
        <svg className="absolute top-1.5 w-4 h-3 text-brand-500" fill="currentColor" viewBox="0 0 24 16" aria-hidden="true">
          <polygon points="12 2 15.5 8 21 3 18.5 13 5.5 13 3 3 8.5 8" />
        </svg>
        <span className="mt-2 font-serif text-xl font-extrabold tracking-tight text-white">LR</span>
      </div>
    </div>
  );
}

/** Gold coin with a rupee mark — used inside the wallet balance pill. */
export function CoinIcon({ className = "h-5 w-5" }) {
  return (
    <div
      className={`flex items-center justify-center rounded-full bg-gradient-to-br from-brand-300 via-brand-500 to-[#C98509] text-xs font-bold text-white shadow-inner ${className}`}
      aria-hidden="true"
    >
      ₹
    </div>
  );
}

/** The 3D gift box from the referral banner. */
export function GiftIcon({ className = "h-9 w-9" }) {
  return (
    <svg className={`filter drop-shadow-sm ${className}`} fill="none" viewBox="0 0 48 48" aria-hidden="true">
      <rect fill="#F8A725" height="24" rx="3" stroke="#333" strokeWidth="2.5" width="36" x="6" y="18" />
      <rect fill="#FDBF38" height="8" rx="2" stroke="#333" strokeWidth="2.5" width="40" x="4" y="12" />
      <rect fill="#EC4899" height="30" stroke="#333" strokeWidth="2" width="6" x="21" y="12" />
      <path d="M21 12C17 6 10 7 12 12C15 12 19 12 21 12Z" fill="#F472B6" stroke="#333" strokeWidth="2" />
      <path d="M27 12C31 6 38 7 36 12C33 12 29 12 27 12Z" fill="#F472B6" stroke="#333" strokeWidth="2" />
    </svg>
  );
}

/** Small line icons for the bottom navigation. */
export function NavIcon({ name, className = "h-6 w-6" }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" };
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...common}>
      {name === "home" && (
        <>
          <path d="M3 10.5 12 3.5l9 7" />
          <path d="M5.5 9.5V20h13V9.5" />
          <path d="M10 20v-5h4v5" />
        </>
      )}
      {name === "wallet" && (
        <>
          <rect x="3" y="6" width="18" height="13" rx="3" />
          <path d="M3 10h18" />
          <circle cx="16.5" cy="14.5" r="1.4" fill="currentColor" stroke="none" />
        </>
      )}
      {name === "user" && (
        <>
          <circle cx="12" cy="8.5" r="3.8" />
          <path d="M4.5 20c1.2-3.7 4-5.6 7.5-5.6s6.3 1.9 7.5 5.6" />
        </>
      )}
      {name === "info" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5.5" />
          <circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none" />
        </>
      )}
      {name === "support" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M8.7 8.2c.25-.3.7-.35 1.03-.12l1.08.75c.3.2.42.58.28.92l-.35.84c.55 1.08 1.4 1.93 2.48 2.48l.84-.35c.34-.14.72-.02.92.28l.75 1.08c.23.33.18.78-.12 1.03-.39.32-.9.5-1.42.42-3.24-.52-5.8-3.08-6.32-6.32-.08-.52.1-1.03.42-1.42Z" />
        </>
      )}
      {name === "gift" && (
        <>
          <rect x="3.5" y="8.5" width="17" height="4" rx="1" />
          <path d="M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5" />
          <path d="M12 8.5V20.5" />
          <path d="M12 8.5C10.5 5 8 4.5 7 5.5S7.5 8.5 12 8.5c4.5 0 5.5-2 4.5-3s-3.5-.5-4.5 3Z" />
        </>
      )}
      {name === "play" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M10 9.4v5.2l4.2-2.6Z" />
        </>
      )}
      {name === "history" && (
        <>
          <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
          <path d="M3.5 4.5V9H8" />
          <path d="M12 8v4.4l2.8 1.8" />
        </>
      )}
      {name === "list" && (
        <>
          <rect x="4.5" y="4" width="15" height="16" rx="2.5" />
          <path d="M8.5 9h7M8.5 12.5h7M8.5 16h4" />
        </>
      )}
      {name === "download" && (
        <>
          <path d="M4 15.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5" />
          <path d="M12 3.5v10" />
          <path d="M8.5 10l3.5 3.5 3.5-3.5" />
        </>
      )}
      {name === "chevron" && <path d="M9 6l6 6-6 6" />}
      {name === "logout" && (
        <>
          <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
          <path d="M10 8l-4 4 4 4" />
          <path d="M6 12h9" />
        </>
      )}
    </svg>
  );
}
