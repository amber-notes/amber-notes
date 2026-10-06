"use client";

import { useCallback, useEffect, useRef } from "react";
import { reduced, useArrival } from "./shared";

/// H: the end of a letter. When you reach the bottom, an amber wax seal with the leaf pressed into
/// it is stamped onto the end of the name: it comes down, squashes as it lands, and the name gives
/// under it. After that it tips a little toward the pointer, like a seal you could pick up.
export default function Seal() {
  const wrap = useRef<HTMLDivElement>(null);
  const seal = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = wrap.current, s = seal.current;
    if (!w || !s) return;
    if (reduced()) { w.dataset.sealed = ""; return; }
    const onMove = (e: PointerEvent) => {
      if (!("sealed" in w.dataset) || e.pointerType !== "mouse") return;
      const r = s.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / innerWidth;
      const dy = (e.clientY - (r.top + r.height / 2)) / innerHeight;
      s.style.setProperty("--rx", `${(-dy * 18).toFixed(2)}deg`);
      s.style.setProperty("--ry", `${(dx * 18).toFixed(2)}deg`);
    };
    const footer = w.closest("footer");
    footer?.addEventListener("pointermove", onMove);
    return () => footer?.removeEventListener("pointermove", onMove);
  }, []);

  useArrival(wrap, useCallback(() => { if (wrap.current) wrap.current.dataset.sealed = ""; }, []), 0.6);

  return (
    <div ref={wrap} className="fx-sealed">
      <svg className="site-wordmark fx-sealed-name" viewBox="0 0 1000 170" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
        <text x="500" y="160" textAnchor="middle" textLength="980" lengthAdjust="spacingAndGlyphs">Amber Notes</text>
      </svg>
      <div ref={seal} className="fx-seal" aria-hidden="true">
        <span className="fx-seal-press" />
        <svg viewBox="-60 -60 120 120">
          <defs>
            <radialGradient id="fx-wax" cx="38%" cy="32%" r="75%">
              <stop offset="0" stopColor="#ffc56a" />
              <stop offset="0.35" stopColor="#f19a2a" />
              <stop offset="0.8" stopColor="#c86a0c" />
              <stop offset="1" stopColor="#9b4d05" />
            </radialGradient>
            <radialGradient id="fx-wax-well" cx="50%" cy="45%" r="60%">
              <stop offset="0" stopColor="#e88b1d" />
              <stop offset="1" stopColor="#c46808" />
            </radialGradient>
          </defs>
          <path d={WAX} fill="url(#fx-wax)" />
          <circle r="35" fill="url(#fx-wax-well)" />
          <circle r="35" fill="none" stroke="#8f4604" strokeOpacity="0.45" strokeWidth="1.6" />
          <circle r="36.4" fill="none" stroke="#ffd79a" strokeOpacity="0.55" strokeWidth="1" />
          {/* The leaf, pressed in: a dark edge on top, a lit edge below, a lighter face. */}
          <g transform="rotate(-38)">
            <path d={LEAF} fill="#8f4604" fillOpacity="0.55" transform="translate(-0.8 -1.2)" />
            <path d={LEAF} fill="#ffd18a" fillOpacity="0.55" transform="translate(0.8 1.2)" />
            <path d={LEAF} fill="#eb901f" />
            <path d="M-21 0 L19 0" stroke="#a65305" strokeOpacity="0.7" strokeWidth="1.6" strokeLinecap="round" />
            {[-9, -1, 7].map((x) => (
              <g key={x} stroke="#a65305" strokeOpacity="0.55" strokeWidth="1.3" strokeLinecap="round">
                <path d={`M${x} -1.5 L${x + 6} -9`} />
                <path d={`M${x} 1.5 L${x + 6} 9`} />
              </g>
            ))}
          </g>
          <ellipse cx="-20" cy="-26" rx="14" ry="6" fill="#fff3d6" fillOpacity="0.28" transform="rotate(-30 -20 -26)" />
        </svg>
      </div>
    </div>
  );
}

// A leaf 46 units long, pointing right.
const LEAF = "M-23 0 C -15 -15, 8 -17, 23 0 C 8 17, -15 15, -23 0 Z";

// The wax: a circle of radius ~52 whose edge wanders the way poured wax does. Fixed, not random.
const WAX = (() => {
  const pts: string[] = [];
  const n = 120;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 51 + 2.6 * Math.sin(a * 5 + 0.6) + 1.8 * Math.sin(a * 9 + 2.1) + 1.2 * Math.sin(a * 13 + 4);
    pts.push(`${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts[0]} L${pts.slice(1).join(" L")} Z`;
})();
