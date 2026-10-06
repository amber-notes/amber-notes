"use client";

import { useCallback, useEffect, useRef } from "react";
import { NAME, loop, reduced, useArrival, useFit } from "./shared";

/// E: the letters of the name drop onto the page's bottom edge one after another, land on springs
/// and cool from warm amber to the quiet ink of the wordmark. Afterwards each letter lifts and warms toward amber as the pointer (or a finger) passes,
/// its neighbours a little less, and settles back when it leaves.
export default function SpringName() {
  const name = useRef<HTMLDivElement>(null);
  const refs = useRef([name]).current;
  useFit(refs);
  const sim = useRef<{ drop: () => void } | null>(null);

  useEffect(() => {
    const el = name.current;
    if (!el || reduced()) return;
    const letters = [...el.querySelectorAll<HTMLSpanElement>("span")];
    const n = letters.length;
    // Positions in em (positive is down), velocities, targets, warmth.
    const y = new Float64Array(n).fill(-1.1);
    const v = new Float64Array(n);
    const target = new Float64Array(n).fill(-1.1);
    const warm = new Float64Array(n).fill(1);
    const warmTo = new Float64Array(n).fill(1);
    let warmRate = 9; // per second: quick under the pointer, slow while the dropped letters cool
    const tilt = new Float64Array(n);
    const tiltTo = new Float64Array(n);
    const paint = () => {
      for (let i = 0; i < n; i++) {
        const s = letters[i].style;
        s.transform = `translate3d(0, ${y[i].toFixed(4)}em, 0) rotate(${tilt[i].toFixed(2)}deg)`;
        s.opacity = String(Math.max(0, Math.min(1, 1 + y[i] * 1.6)));
        s.setProperty("--w", warm[i].toFixed(3));
      }
    };
    paint();
    // Stiff enough to land in ~0.5 s, under-damped enough to show one soft rebound.
    const K = 210, D = 15;
    const run = loop((dt) => {
      let moving = false;
      for (let i = 0; i < n; i++) {
        v[i] += (K * (target[i] - y[i]) - D * v[i]) * dt;
        y[i] += v[i] * dt;
        warm[i] += (warmTo[i] - warm[i]) * Math.min(1, dt * warmRate);
        tilt[i] += (tiltTo[i] - tilt[i]) * Math.min(1, dt * 10);
        if (Math.abs(v[i]) > 0.002 || Math.abs(target[i] - y[i]) > 0.002 || Math.abs(warmTo[i] - warm[i]) > 0.004 || Math.abs(tiltTo[i] - tilt[i]) > 0.02) moving = true;
      }
      paint();
      return moving;
    });
    const timers: number[] = [];
    let landed = false;
    sim.current = {
      drop() {
        letters.forEach((_, i) => {
          if (NAME[i] === " ") { target[i] = 0; y[i] = 0; return; }
          timers.push(window.setTimeout(() => { target[i] = 0; run.wake(); }, i * 55));
          timers.push(window.setTimeout(() => { warmTo[i] = 0; run.wake(); }, i * 55 + 650));
        });
        warmRate = 1.6;
        timers.push(window.setTimeout(() => { landed = true; warmRate = 9; }, n * 55 + 1900));
      },
    };
    const centers = () => letters.map((l) => { const r = l.getBoundingClientRect(); return r.left + r.width / 2; });
    let cx: number[] = [];
    const onMove = (e: PointerEvent) => {
      if (!landed) return;
      if (!cx.length) cx = centers();
      const sigma = el.getBoundingClientRect().width / n;
      for (let i = 0; i < n; i++) {
        if (NAME[i] === " ") continue;
        const d = (e.clientX - cx[i]) / sigma;
        const g = Math.exp(-d * d);
        target[i] = -0.13 * g;
        warmTo[i] = g;
        tiltTo[i] = Math.max(-1, Math.min(1, -d)) * 4 * g;
      }
      run.wake();
    };
    const onLeave = () => {
      target.fill(0); warmTo.fill(0); tiltTo.fill(0);
      run.wake();
    };
    const resetCenters = () => { cx = []; };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointercancel", onLeave);
    addEventListener("resize", resetCenters);
    addEventListener("scroll", resetCenters, { passive: true });
    return () => {
      run.stop();
      timers.forEach(clearTimeout);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointercancel", onLeave);
      removeEventListener("resize", resetCenters);
      removeEventListener("scroll", resetCenters);
    };
  }, []);

  useArrival(name, useCallback(() => sim.current?.drop(), []), 0.3);

  return (
    <div className="fx-floor">
      <div ref={name} className="fx-name fx-spring" aria-hidden="true">
        {[...NAME].map((c, i) => <span key={i}>{c === " " ? " " : c}</span>)}
      </div>
    </div>
  );
}
