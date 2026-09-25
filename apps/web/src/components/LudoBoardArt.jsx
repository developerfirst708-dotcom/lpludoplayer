import React, { useId } from "react";

/**
 * A ludo board + two dice, drawn to sit on the dark starfield thumbnail
 * (.game-thumb-container) used by the game cards.
 * Geometry: a 15×15 grid (cell = 20) inside a 320×320 viewBox with a 10px margin.
 */
export default function LudoBoardArt({ className = "" }) {
  const raw = useId();
  const uid = raw.replace(/[^a-zA-Z0-9]/g, "");
  const grid = `lpgrid-${uid}`;
  const shadow = `lpshadow-${uid}`;

  return (
    <svg className={className} viewBox="0 0 320 320" role="img" aria-label="Ludo board and dice">
      <defs>
        <pattern id={grid} width="20" height="20" patternUnits="userSpaceOnUse" x="10" y="10">
          <path d="M20 0 L0 0 L0 20" fill="none" stroke="#D1D5DB" strokeWidth="0.7" />
        </pattern>
        <filter id={shadow} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#000000" floodOpacity="0.55" />
        </filter>
      </defs>

      <g filter={`url(#${shadow})`}>
        <rect x="10" y="10" width="300" height="300" rx="14" fill="#F9FAFB" />

        {/* four corner homes */}
        <rect x="10" y="10" width="120" height="120" rx="10" fill="#EF4444" />
        <rect x="30" y="30" width="80" height="80" rx="8" fill="#FFFFFF" />
        <rect x="190" y="10" width="120" height="120" rx="10" fill="#22C55E" />
        <rect x="210" y="30" width="80" height="80" rx="8" fill="#FFFFFF" />
        <rect x="10" y="190" width="120" height="120" rx="10" fill="#3B82F6" />
        <rect x="30" y="210" width="80" height="80" rx="8" fill="#FFFFFF" />
        <rect x="190" y="190" width="120" height="120" rx="10" fill="#EAB308" />
        <rect x="210" y="210" width="80" height="80" rx="8" fill="#FFFFFF" />

        {/* four tokens parked in each home */}
        <g stroke="#FFFFFF" strokeWidth="2">
          <circle cx="50" cy="50" r="8" fill="#EF4444" />
          <circle cx="90" cy="50" r="8" fill="#EF4444" />
          <circle cx="50" cy="90" r="8" fill="#EF4444" />
          <circle cx="90" cy="90" r="8" fill="#EF4444" />
          <circle cx="230" cy="50" r="8" fill="#22C55E" />
          <circle cx="270" cy="50" r="8" fill="#22C55E" />
          <circle cx="230" cy="90" r="8" fill="#22C55E" />
          <circle cx="270" cy="90" r="8" fill="#22C55E" />
          <circle cx="50" cy="230" r="8" fill="#3B82F6" />
          <circle cx="90" cy="230" r="8" fill="#3B82F6" />
          <circle cx="50" cy="270" r="8" fill="#3B82F6" />
          <circle cx="90" cy="270" r="8" fill="#3B82F6" />
          <circle cx="230" cy="230" r="8" fill="#EAB308" />
          <circle cx="270" cy="230" r="8" fill="#EAB308" />
          <circle cx="230" cy="270" r="8" fill="#EAB308" />
          <circle cx="270" cy="270" r="8" fill="#EAB308" />
        </g>

        {/* cross arms */}
        <rect x="130" y="10" width="60" height="300" fill="#FFFFFF" />
        <rect x="10" y="130" width="300" height="60" fill="#FFFFFF" />

        {/* home lanes (5 cells each) */}
        <rect x="30" y="150" width="100" height="20" fill="#EF4444" />
        <rect x="150" y="30" width="20" height="100" fill="#22C55E" />
        <rect x="150" y="190" width="20" height="100" fill="#3B82F6" />
        <rect x="190" y="150" width="100" height="20" fill="#EAB308" />

        {/* start squares on the track */}
        <rect x="30" y="130" width="20" height="20" fill="#EF4444" />
        <rect x="170" y="30" width="20" height="20" fill="#22C55E" />
        <rect x="270" y="170" width="20" height="20" fill="#EAB308" />
        <rect x="130" y="270" width="20" height="20" fill="#3B82F6" />

        {/* centre home */}
        <polygon points="130,130 190,130 160,160" fill="#22C55E" />
        <polygon points="190,130 190,190 160,160" fill="#EAB308" />
        <polygon points="190,190 130,190 160,160" fill="#EF4444" />
        <polygon points="130,190 130,130 160,160" fill="#3B82F6" />
        <rect x="130" y="130" width="60" height="60" fill="none" stroke="#111827" strokeWidth="1.5" />

        {/* grid overlay + board edge */}
        <rect x="10" y="10" width="300" height="300" rx="14" fill={`url(#${grid})`} />
        <rect x="10" y="10" width="300" height="300" rx="14" fill="none" stroke="#111827" strokeWidth="3" />
      </g>

      {/* dice resting in front of the board */}
      <g transform="translate(48 232) rotate(-14)">
        <rect width="58" height="58" rx="12" fill="#FFFFFF" stroke="#111827" strokeWidth="3.5" />
        <g fill="#111827">
          <circle cx="17" cy="17" r="5" /><circle cx="41" cy="17" r="5" /><circle cx="29" cy="29" r="5" />
        </g>
      </g>
      <g transform="translate(206 224) rotate(12)">
        <rect width="72" height="72" rx="15" fill="#FFFFFF" stroke="#111827" strokeWidth="3.5" />
        <g fill="#111827">
          <circle cx="20" cy="20" r="6" /><circle cx="52" cy="20" r="6" /><circle cx="36" cy="36" r="6" />
          <circle cx="20" cy="52" r="6" /><circle cx="52" cy="52" r="6" />
        </g>
      </g>
    </svg>
  );
}
