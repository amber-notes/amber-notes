"use client";

import { useEffect, type RefObject } from "react";
import "./footer-fx.css";

/// Shared pieces of the footer effects D to H (lib/footer-fx.ts picks one).

export const NAME = "Amber Notes";

export const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/// Sizes one or more copies of the name so the first fills `share` of its parent's width, like
/// the SVG wordmark does with textLength. Each element must be `width: max-content`.
export function useFit(refs: RefObject<HTMLElement | null>[], share = 0.98) {
  useEffect(() => {
    const first = refs[0].current;
    const parent = first?.parentElement;
    if (!first || !parent) return;
    const fit = () => {
      for (const r of refs) if (r.current) r.current.style.fontSize = "100px";
      const natural = first.getBoundingClientRect().width;
      if (!natural) return;
      const size = `${(100 * parent.clientWidth * share) / natural}px`;
      for (const r of refs) if (r.current) r.current.style.fontSize = size;
    };
    fit();
    document.fonts?.ready.then(fit);
    const ro = new ResizeObserver(fit);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [refs, share]);
}

/// Calls `go` once, the first time `share` of the element is in view.
export function useArrival(ref: RefObject<Element | null>, go: () => void, share = 0.4) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      go();
    }, { threshold: share });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, go, share]);
}

/// A frame loop that runs only while `step` says something is still moving, at the frame's
/// timestamp (never performance.now() mid-frame), with dt capped so a background tab can't explode it.
export function loop(step: (dt: number) => boolean) {
  let raf = 0;
  let last = 0;
  const tick = (now: number) => {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    raf = step(dt) ? requestAnimationFrame(tick) : 0;
    if (!raf) last = 0;
  };
  return {
    wake() { if (!raf) raf = requestAnimationFrame(tick); },
    stop() { cancelAnimationFrame(raf); raf = 0; last = 0; },
  };
}
