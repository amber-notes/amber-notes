"use client";

import { useCallback, useEffect, useRef } from "react";
import { loop, reduced, useArrival } from "./shared";

// The wordmark's own geometry (SiteChrome.tsx): a 1000 x 170 box, baseline at 160, caps from ~33.
const N = 72; // surface points across the box
const REST = 84; // resting honey level: a little over half the letters' height
const EMPTY = 178;

/// G: honey settles in the letters, and it is liquid. It pours in on arrival; afterwards the
/// pointer stirs the surface where it passes, and scrolling sloshes it (a quick flick tips it to
/// one side, then it rocks back). A small wave sim, run only while the surface is still moving.
export default function Honey() {
  const svg = useRef<SVGSVGElement>(null);
  const body = useRef<SVGPathElement>(null);
  const shine = useRef<SVGPathElement>(null);
  const glow = useRef<SVGPathElement>(null);
  const pour = useRef<(() => void) | null>(null);

  useEffect(() => {
    const s = svg.current, b = body.current, sh = shine.current, gl = glow.current;
    if (!s || !b || !sh || !gl) return;
    const still = reduced();
    const h = new Float64Array(N); // surface displacement (down is positive)
    const v = new Float64Array(N);
    let level = still ? REST : EMPTY, lv = 0, target = still ? REST : EMPTY;
    const dx = 1000 / (N - 1);
    const draw = () => {
      let top = `M0 ${(level + h[0]).toFixed(2)}`;
      for (let i = 1; i < N; i++) {
        // Midpoint quadratic smoothing keeps the surface round at any amplitude.
        const x0 = (i - 1) * dx, x1 = i * dx;
        const y0 = level + h[i - 1], y1 = level + h[i];
        top += ` Q${x0.toFixed(1)} ${y0.toFixed(2)} ${((x0 + x1) / 2).toFixed(1)} ${((y0 + y1) / 2).toFixed(2)}`;
      }
      top += ` L1000 ${(level + h[N - 1]).toFixed(2)}`;
      b.setAttribute("d", `${top} V200 H0 Z`);
      sh.setAttribute("d", top);
      gl.setAttribute("d", top);
    };
    draw();
    if (still) return;
    const C = 900, K = 3, DAMP = 1.6;
    const run = loop((dt) => {
      // Level: an under-damped spring, so the pour overshoots a touch and settles.
      lv += (40 * (target - level) - 7 * lv) * dt;
      level += lv * dt;
      let energy = Math.abs(target - level) + Math.abs(lv);
      // Surface: a damped wave equation with fixed ends (the walls of the letters).
      for (let step = 0; step < 2; step++) {
        const d = dt / 2;
        for (let i = 1; i < N - 1; i++) v[i] += ((C * (h[i - 1] + h[i + 1] - 2 * h[i])) / (dx * dx) * 40 - K * h[i] - DAMP * v[i]) * d;
        for (let i = 1; i < N - 1; i++) { h[i] += v[i] * d; energy += Math.abs(v[i]) * 0.02 + Math.abs(h[i]) * 0.02; }
      }
      draw();
      return energy > 0.02;
    });
    // Nudges: a Gaussian push centred on x (0..1000), in surface units per second.
    const push = (x: number, amount: number, width = 60) => {
      for (let i = 1; i < N - 1; i++) {
        const d = (i * dx - x) / width;
        v[i] += amount * Math.exp(-d * d);
      }
      run.wake();
    };
    let poured = false;
    pour.current = () => {
      target = REST;
      poured = true;
      // The stream lands left of centre; the surface ripples out from there as it fills.
      [0, 180, 360, 540].forEach((t, k) => window.setTimeout(() => push(330 + k * 40, 70 - k * 12, 50), t));
      run.wake();
    };
    let px = -1, pt = 0;
    const onMove = (e: PointerEvent) => {
      if (!poured) return;
      const r = s.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 1000;
      const now = e.timeStamp;
      if (px >= 0 && now > pt) {
        const speed = Math.min(2.5, Math.abs(x - px) / (now - pt)); // units per ms
        push(x, speed * 26, 45);
      }
      px = x; pt = now;
    };
    const onLeave = () => { px = -1; };
    // Scroll tips the honey: the surface tilts against the scroll's acceleration, then rocks back.
    let sy = scrollY, st = performance.now(), sv = 0;
    const onScroll = () => {
      if (!poured) return;
      const now = performance.now();
      const nv = (scrollY - sy) / Math.max(1, now - st);
      const accel = Math.max(-3, Math.min(3, nv - sv));
      sy = scrollY; st = now; sv = nv;
      if (Math.abs(accel) < 0.05) return;
      for (let i = 1; i < N - 1; i++) v[i] += accel * 14 * ((i / (N - 1)) - 0.5) * 2;
      run.wake();
    };
    s.addEventListener("pointermove", onMove);
    s.addEventListener("pointerleave", onLeave);
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      run.stop();
      s.removeEventListener("pointermove", onMove);
      s.removeEventListener("pointerleave", onLeave);
      removeEventListener("scroll", onScroll);
    };
  }, []);

  useArrival(svg, useCallback(() => pour.current?.(), []), 0.5);

  const word = <text x="500" y="160" textAnchor="middle" textLength="980" lengthAdjust="spacingAndGlyphs">Amber Notes</text>;
  return (
    <svg ref={svg} className="site-wordmark fx-honey" viewBox="0 0 1000 170" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <defs>
        <clipPath id="fx-honey-letters">{word}</clipPath>
        <linearGradient id="fx-honey-fill" gradientUnits="userSpaceOnUse" x1="0" y1="40" x2="0" y2="170">
          <stop offset="0" stopColor="#ffb948" />
          <stop offset="0.45" stopColor="#f29a26" />
          <stop offset="1" stopColor="#c8680a" />
        </linearGradient>
      </defs>
      {word}
      <g clipPath="url(#fx-honey-letters)">
        <path ref={body} fill="url(#fx-honey-fill)" />
        {/* A lit band just under the surface, then the bright meniscus line itself. */}
        <path ref={glow} className="fx-honey-glow" fill="none" transform="translate(0 7)" />
        <path ref={shine} className="fx-honey-shine" fill="none" />
      </g>
    </svg>
  );
}
