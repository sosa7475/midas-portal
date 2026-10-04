"use client";

import { useState } from "react";

/**
 * Midas brand mark. Uses the exact logo at /midas-logo.png as soon as that
 * file exists in /public; until then it falls back to an inline gold-chip "I" SVG so
 * nothing ever shows as a broken image.
 */
export function BrandMark({ height = 32 }: { height?: number }) {
  const [imgOk, setImgOk] = useState(true);
  if (imgOk) {
    return (
      <img
        src="/midas-logo.png"
        alt="Midas"
        onError={() => setImgOk(false)}
        style={{ height, width: "auto", display: "block", objectFit: "contain", flexShrink: 0 }}
      />
    );
  }
  return (
    <svg height={height} viewBox="0 0 72 64" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", flexShrink: 0, filter: "drop-shadow(0 3px 8px rgba(160,120,20,0.28))" }} aria-label="Midas">
      <defs>
        <linearGradient id="ig-gold" x1="6" y1="8" x2="60" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7c5c14" /><stop offset="0.35" stopColor="#f4d258" /><stop offset="0.6" stopColor="#d9a441" /><stop offset="1" stopColor="#6e4f10" />
        </linearGradient>
        <linearGradient id="ig-gold-edge" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffe9a8" /><stop offset="1" stopColor="#b98a24" />
        </linearGradient>
        <linearGradient id="ig-blue" x1="30" y1="16" x2="42" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#bcd6ff" /><stop offset="1" stopColor="#2f6df5" />
        </linearGradient>
        <linearGradient id="ig-panel" x1="20" y1="16" x2="52" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2a3552" /><stop offset="1" stopColor="#141c30" />
        </linearGradient>
      </defs>
      <g stroke="url(#ig-gold)" strokeWidth="2.2" fill="none" strokeLinecap="round">
        <path d="M18 22 H7 M18 32 H4 M18 42 H7" />
        <path d="M54 22 H65 M54 32 H68 M54 42 H65" />
      </g>
      <g fill="url(#ig-gold-edge)">
        <circle cx="5" cy="22" r="2.6" /><circle cx="3" cy="32" r="2.6" /><circle cx="5" cy="42" r="2.6" />
        <circle cx="67" cy="22" r="2.6" /><circle cx="69" cy="32" r="2.6" /><circle cx="67" cy="42" r="2.6" />
      </g>
      <rect x="17" y="11" width="38" height="42" rx="7" fill="url(#ig-gold)" stroke="url(#ig-gold-edge)" strokeWidth="1.2" />
      <rect x="21.5" y="15.5" width="29" height="33" rx="4" fill="url(#ig-panel)" />
      <g fill="#0b0f18"><circle cx="25.5" cy="19.5" r="1.6" /><circle cx="46.5" cy="19.5" r="1.6" /><circle cx="25.5" cy="44.5" r="1.6" /><circle cx="46.5" cy="44.5" r="1.6" /></g>
      <g fill="url(#ig-blue)">
        <rect x="29" y="20.5" width="14" height="4.8" rx="1.2" />
        <rect x="33.2" y="23" width="5.6" height="18" rx="1.2" />
        <rect x="29" y="38.7" width="14" height="4.8" rx="1.2" />
      </g>
    </svg>
  );
}
