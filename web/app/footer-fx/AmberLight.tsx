"use client";

import { useCallback, useEffect, useRef } from "react";
import { NAME, loop, reduced, useArrival, useFit } from "./shared";

/// F: the name is a block of amber resin, dull until light passes through it. A warm light follows
/// the pointer across the letters (on a critically damped spring, so it glides rather than sticks);
/// where it falls the resin shows its colour, depth and grain. Without a pointer the light sweeps
/// in from the left on arrival and comes to rest between the words; a finger can drag it.
export default function AmberLight() {
  const box = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLDivElement>(null);
  const resin = useRef<HTMLDivElement>(null);
  const refs = useRef([base, resin]).current;
  useFit(refs);
  const sweep = useRef<(() => void) | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.setProperty("--grain", `url(${grain()})`);
    if (reduced()) { el.dataset.still = ""; return; }
    // Light position in fractions of the box; radius in fractions of the box width.
    let x = -0.15, y = 0.55, vx = 0, vy = 0, tx = x, ty = y, r = 0, rt = 0;
    const W = 9; // spring frequency: ~0.35 s to arrive, no overshoot
    const paint = () => {
      el.style.setProperty("--lx", `${(x * 100).toFixed(2)}%`);
      el.style.setProperty("--ly", `${(y * 100).toFixed(2)}%`);
      el.style.setProperty("--lr", r.toFixed(4));
      el.style.setProperty("--gx", `${(x * el.clientWidth).toFixed(1)}px`);
      el.style.setProperty("--gy", `${(y * el.clientHeight).toFixed(1)}px`);
    };
    paint();
    let sweepT = -1;
    const run = loop((dt) => {
      if (sweepT >= 0) {
        sweepT += dt / 2.6;
        const t = Math.min(1, sweepT);
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        tx = -0.15 + e * 0.65; // glide in from the left and come to rest between the words
        ty = 0.55;
        if (t >= 1) sweepT = -1;
      }
      vx += (W * W * (tx - x) - 2 * W * vx) * dt; x += vx * dt;
      vy += (W * W * (ty - y) - 2 * W * vy) * dt; y += vy * dt;
      r += (rt - r) * Math.min(1, dt * 4);
      paint();
      return sweepT >= 0 || Math.abs(tx - x) + Math.abs(ty - y) + Math.abs(vx) + Math.abs(vy) > 0.0008 || Math.abs(rt - r) > 0.001;
    });
    const at = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      sweepT = -1;
      tx = (e.clientX - b.left) / b.width;
      ty = (e.clientY - b.top) / b.height;
      rt = 1;
      run.wake();
    };
    const away = (e: PointerEvent) => {
      if (e.pointerType === "mouse") { rt = 0.55; run.wake(); }
    };
    el.addEventListener("pointermove", at);
    el.addEventListener("pointerdown", at);
    el.addEventListener("pointerleave", away);
    sweep.current = () => { sweepT = 0; rt = 1; run.wake(); };
    return () => {
      run.stop();
      el.removeEventListener("pointermove", at);
      el.removeEventListener("pointerdown", at);
      el.removeEventListener("pointerleave", away);
    };
  }, []);

  useArrival(box, useCallback(() => sweep.current?.(), []), 0.5);

  return (
    <div className="fx-floor">
      <div ref={box} className="fx-light" aria-hidden="true">
        <span className="fx-light-glow" />
        <div ref={base} className="fx-name">{NAME}</div>
        <div ref={resin} className="fx-name fx-resin">{NAME}</div>
      </div>
    </div>
  );
}

/// A small tile of soft grain for the resin, drawn once (no image to download).
function grain() {
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const g = c.getContext("2d");
  if (!g) return "";
  const img = g.createImageData(96, 96);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (rnd() - 0.5) * 70;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // A few darker inclusions, like the specks caught in real amber.
  for (let k = 0; k < 5; k++) {
    g.fillStyle = `rgba(60, 25, 0, ${0.25 + rnd() * 0.3})`;
    g.beginPath();
    g.arc(rnd() * 96, rnd() * 96, 0.6 + rnd() * 1.4, 0, Math.PI * 2);
    g.fill();
  }
  return c.toDataURL("image/png");
}
