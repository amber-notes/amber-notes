"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AIGlyph } from "@/lib/ai-glyphs";
import d from "./demo.module.css";

// A mini Mac desktop: the real Amber Notes window (frames captured from the app with demo data, one
// session) and a ChatGPT window beside it. One story in two parts, shown on the bar on the desk: you ask ChatGPT to plan Lisbon and it writes the whole note in Amber Notes (it lands tinted,
// with the app's receipt); you change your mind and it edits just those two lines. Then it resets
// and loops. One clock drives it; it pauses off-screen, in a hidden tab and under the pointer.

// The frames, named as captured. A recapture with the same names is a change to this constant.
// The tint frames were captured with the receipt showing; it's patched out of them (from the faded frame,
// plain white there) and laid back on top as its own crop of that capture, so it can animate.
const FRAMES = {
  dir: "/demo/lisbon/", h: 720,
  pill: { left: 670, top: 645, w: 310, h: 75 }, // the receipt crop's box in the window (pt), measured from the captures
};
type Shot = "before" | "listed" | "written" | "writtenPlain" | "edited" | "editedPlain";
const FILE: Record<Shot, string> = {
  before: "lisbon-0-before", listed: "lisbon-1-listed", written: "lisbon-1-tint", writtenPlain: "lisbon-1-faded", edited: "lisbon-2-tint", editedPlain: "lisbon-2-faded",
};
const SHOTS = Object.keys(FILE) as Shot[];
const src = (k: Shot) => `${FRAMES.dir}${FILE[k]}.webp`;
// Each frame also comes 1180 and 800 wide (cwebp -q 84 -resize), so a phone doesn't download the 2x
// capture. The window is 1180/1280 of the demo, which is the page column (at most 1200) wide.
const srcSet = (k: Shot) => `${FRAMES.dir}${FILE[k]}-800.webp 800w, ${FRAMES.dir}${FILE[k]}-1180.webp 1180w, ${src(k)} 2360w`;
const SIZES = "(min-width: 1240px) 1106px, 92vw";
const ALT: Record<Shot, string> = {
  before: "Amber Notes on a Mac",
  listed: "A new note, Lisbon, 4 days in May, arriving in the list marked Written by ChatGPT",
  written: "The new note, Lisbon, 4 days in May, that ChatGPT just wrote in Amber Notes, tinted amber",
  writtenPlain: "The Lisbon, 4 days in May note in Amber Notes",
  edited: "The Lisbon note with day 3 swapped for Sintra and a dinner spot added to the table, both tinted amber",
  editedPlain: "The Lisbon note after the edit",
};

type Ask = { ask: string; answer: string; land: Shot; plain: Shot; pill: string; pillAlt: string };
const ASKS: Ask[] = [
  { ask: "Plan 4 days in Lisbon for us and save it to my notes", answer: "Done. I wrote “Lisbon, 4 days in May” in Amber Notes: a day-by-day plan, where to eat and what to pack.",
    land: "written", plain: "writtenPlain", pill: "pill-chatgpt-wrote-note.webp", pillAlt: "ChatGPT wrote this note. Undo" },
  { ask: "Swap day 3 for a day trip to Sintra, and add a dinner spot", answer: "Changed day 3 to Sintra and added Cervejaria Trindade for dinner. Nothing else moved.",
    land: "edited", plain: "editedPlain", pill: "pill-chatgpt-2-lines.webp", pillAlt: "ChatGPT changed 2 lines. Undo" },
];
// The bar's two parts, as a screen reader hears them.
const PARTS = [{ aria: "ChatGPT writes a note" }, { aria: "ChatGPT edits it" }];

// The clock (ms). The app alone, then ChatGPT arrives; each ask is typed, sent, thought about and
// answered; the edit lands with its tint and the receipt; after a moment the tint fades as in the app.
// The first ask's note shows up in the list while ChatGPT is still at work (LISTED after it's sent).
const LISTED = 1100, ALONE = 500, ARRIVE = 600, CHAR = 36, SENT = 300, THINK = 700, ANSWER = 1500, LAND = 2000, PILL = 200, HOLD = 3200, BEAT = 900, END = 1800, RESET = 1400;
type Beat = { typeAt: number; typed: number; answer: number; land: number; faded: number; next: number };
const BEATS: Beat[] = (() => {
  let t = ALONE + ARRIVE;
  return ASKS.map((a) => {
    const typeAt = t, typed = typeAt + a.ask.length * CHAR, answer = typed + ANSWER, land = typed + LAND, faded = land + PILL + HOLD;
    t = faded + BEAT;
    return { typeAt, typed, answer, land, faded, next: t };
  });
})();
const TOTAL = BEATS[1].faded + END;
// Where each part starts (for the bar and jumping): the first ask through the note landing and its
// hold; then the second ask through the edit landing and its hold.
const PART_AT = [0, BEATS[1].typeAt, TOTAL];

type View = {
  chat: boolean; shot: Shot; typed: string; sent: number; thinking: boolean; answered: number; pill: number; pillOut: boolean; edit: boolean; reset: boolean;
};
function at(t: number): View {
  const v: View = { chat: t >= ALONE, shot: "before", typed: "", sent: 0, thinking: false, answered: 0, pill: -1, pillOut: false, edit: false, reset: false };
  if (t >= TOTAL) return { ...v, chat: false, reset: true, shot: "before" };
  ASKS.forEach((a, k) => {
    const b = BEATS[k];
    if (t >= b.typeAt && t < b.typed + SENT) v.typed = a.ask.slice(0, Math.min(a.ask.length, Math.floor((t - b.typeAt) / CHAR) + 1));
    if (t >= b.typed + SENT) v.sent = k + 1;
    if (t >= b.typed + THINK && t < b.answer) v.thinking = true;
    if (t >= b.answer) v.answered = k + 1;
    if (k === 0 && t >= b.typed + LISTED) v.shot = "listed";
    if (t >= b.land) { v.shot = t >= b.faded ? a.plain : a.land; v.edit = t < b.faded; }
    if (t >= b.land + PILL && t < b.faded + 400) { v.pill = k; v.pillOut = t >= b.faded; }
  });
  return v;
}

const W = 1280, KEY = 520; // design width; KEY = the top part of the desk that must fit the first view

export default function Demo() {
  const [view, setView] = useState<View>(at(0));
  const [still, setStill] = useState(false);
  const [fitW, setFitW] = useState<number | null>(null);
  const clock = useRef({ t: 0, last: 0, started: false });
  const pause = useRef({ offscreen: false, hidden: false, hover: false });
  const outer = useRef<HTMLDivElement>(null);
  const msgsRef = useRef<HTMLDivElement>(null);
  const segs = useRef<(HTMLButtonElement | null)[]>([]);

  // Wide screens: size the desk so the chat and the note fit the first view.
  useLayoutEffect(() => {
    const el = outer.current?.parentElement;
    if (!el || !outer.current) return;
    const fit = () => {
      const avail = el.clientWidth;
      if (window.innerWidth < 700) { setFitW(null); return; }
      const top = outer.current!.getBoundingClientRect().top + window.scrollY;
      const byHeight = ((window.innerHeight - top - 16) * W) / KEY;
      setFitW(Math.max(Math.min(avail, 760), Math.min(avail, W, byHeight)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const paintBar = (t: number) => {
    const p = Math.max(0, PART_AT.findIndex((s, k) => t >= s && t < PART_AT[k + 1]));
    segs.current.forEach((el, k) => {
      if (!el) return;
      const reset = t >= TOTAL;
      el.dataset.state = reset ? "next" : k < p ? "done" : k === p ? "now" : "next";
      el.style.setProperty("--p", String(!reset && k === p ? (t - PART_AT[k]) / (PART_AT[k + 1] - PART_AT[k]) : 0));
    });
  };
  const jump = (k: number) => { const c = clock.current; c.started = true; c.t = PART_AT[k]; };

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // No motion: the whole conversation and the final note.
      setStill(true); setView({ ...at(BEATS[1].faded + 500), pill: -1 }); return;
    }
    const ready = { done: false };
    Promise.all([...SHOTS.map(src), ...ASKS.map((a) => FRAMES.dir + a.pill)].map((u) => {
      // The same candidate the page's <img> picks, so nothing downloads twice.
      const i = new Image(); const k = SHOTS.find((s) => src(s) === u);
      if (k) { i.sizes = SIZES; i.srcset = srcSet(k); }
      i.src = u; return i.decode().catch(() => undefined);
    }))
      .then(() => { ready.done = true; });
    let raf = 0;
    const tick = (now: number) => {
      const c = clock.current;
      if (!ready.done) { c.last = now; raf = requestAnimationFrame(tick); return; }
      const paused = pause.current.offscreen || pause.current.hidden || pause.current.hover;
      const dt = c.last ? Math.min(100, now - c.last) : 0;
      c.last = now;
      if (!paused && c.started) {
        c.t += dt;
        if (c.t >= TOTAL + RESET) c.t = 0;
        const v = at(c.t);
        setView((o) => (JSON.stringify(o) === JSON.stringify(v) ? o : v));
        paintBar(c.t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const io = new IntersectionObserver(([e]) => { pause.current.offscreen = !e.isIntersecting; if (e.isIntersecting) clock.current.started = true; }, { threshold: 0.05 });
    if (outer.current) io.observe(outer.current);
    const vis = () => { pause.current.hidden = document.hidden; };
    document.addEventListener("visibilitychange", vis);
    return () => { cancelAnimationFrame(raf); io.disconnect(); document.removeEventListener("visibilitychange", vis); };
  }, []);

  useEffect(() => { const m = msgsRef.current; if (m) m.scrollTo({ top: m.scrollHeight, behavior: still ? "auto" : "smooth" }); }, [view.sent, view.answered, view.thinking, still]);

  // Frames fade in over the previous one, which stays opaque underneath (never both fading).
  const base = view.shot;
  const [under, setUnder] = useState<Shot | null>(null);
  const shownRef = useRef<Shot | null>(null);
  useEffect(() => {
    const prev = shownRef.current;
    shownRef.current = base;
    if (!prev || prev === base) return;
    setUnder(prev);
    const t = window.setTimeout(() => setUnder((u) => (u === prev ? null : u)), 1000);
    return () => window.clearTimeout(t);
  }, [base]);

  const hoverPause = (on: boolean) => { if (window.matchMedia("(hover: hover)").matches) pause.current.hover = on; };
  const typing = view.typed.length > 0;

  return (
    <div className={d.wrap}>
      <div ref={outer} className={d.fit} style={fitW ? { width: fitW, margin: "0 auto" } : undefined}
        onPointerEnter={() => hoverPause(true)} onPointerLeave={() => hoverPause(false)}>
        <div className={d.desk}>
          <Wallpaper />
          <div className={d.app} data-dim={(view.chat && !view.edit && (typing || view.thinking || view.sent > view.answered)) || undefined} data-edit={view.edit || undefined}
            data-instant={base === "listed" || undefined}>
            {SHOTS.map((k) => (
              <img key={k} src={src(k)} srcSet={srcSet(k)} sizes={SIZES} width={1180} height={FRAMES.h} alt={k === base ? ALT[k] : ""}
                aria-hidden={k !== base} className={d.shot} data-on={k === base || undefined} data-under={(k === under && k !== base) || undefined}
                loading="eager" fetchPriority={k === "before" ? "high" : "low"} decoding="async" draggable={false} />
            ))}
            {view.pill >= 0 && (
              <img key={`pill${view.pill}`} src={`${FRAMES.dir}${ASKS[view.pill].pill}`} alt={ASKS[view.pill].pillAlt} className={d.pill} data-out={view.pillOut || undefined}
                style={{ left: `calc(${FRAMES.pill.left} * var(--u))`, top: `calc(${FRAMES.pill.top} * var(--u))`, width: `calc(${FRAMES.pill.w} * var(--u))`, height: `calc(${FRAMES.pill.h} * var(--u))` }} />
            )}
          </div>

          <div className={d.chat} data-away={!view.chat || undefined} aria-label="An AI chat">
            <div className={d.chatBar}>
              <div className={d.lights}><i /><i /><i /></div>
              <span className={d.chatTitle}><AIGlyph name="openai" size={16} />ChatGPT</span>
            </div>
            <div ref={msgsRef} className={d.msgs} data-reset={view.reset || undefined}>
              {ASKS.map((a, k) => (
                <div key={a.ask} className={d.pair} hidden={view.sent <= k && !view.reset}>
                  {(view.sent > k || view.reset) && <div className={d.me}>{a.ask}</div>}
                  {view.thinking && view.sent === k + 1 && view.answered === k && <div className={d.thinking}><span className={d.tool}>Talking to Amber Notes…</span></div>}
                  {(view.answered > k || view.reset) && <div className={d.ai}><span className={d.tool}>Used Amber Notes</span><p>{a.answer}</p></div>}
                </div>
              ))}
            </div>
            <div className={d.input}>
              <b className={d.plus} aria-hidden="true">+</b>
              <span className={d.field} data-typing={typing || undefined}>
                <span className={d.typed}>{view.typed}</span>{view.chat && <i className={d.caret} data-idle={!typing || undefined} />}{!typing && <em>Ask anything</em>}
              </span>
              <b className={d.send} aria-hidden="true">↑</b>
            </div>
          </div>

          {!still && (
            <div className={d.story} role="group" aria-label="Demo progress">
              {PARTS.map((part, k) => (
                <button key={part.aria} type="button" ref={(el) => { segs.current[k] = el; }} className={d.seg} data-state={k === 0 ? "now" : "next"}
                  aria-label={`Part ${k + 1} of ${PARTS.length}: ${part.aria}`} onClick={() => jump(k)}><i /></button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function Wallpaper() {
  return (
    <svg className={d.wall} viewBox="0 0 1280 840" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="d0" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fde7c4" /><stop offset=".55" stopColor="#f9c98a" /><stop offset="1" stopColor="#e7964a" /></linearGradient>
        <radialGradient id="d1" cx="78%" cy="18%" r="40%"><stop offset="0" stopColor="#fff6e2" /><stop offset="1" stopColor="#fff6e2" stopOpacity="0" /></radialGradient>
        <linearGradient id="d2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#f4b36a" /><stop offset="1" stopColor="#e98a3c" /></linearGradient>
        <linearGradient id="d3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e27f35" /><stop offset="1" stopColor="#b9551f" /></linearGradient>
        <linearGradient id="d4" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c7612a" /><stop offset="1" stopColor="#8a3a14" /></linearGradient>
        <filter id="db"><feGaussianBlur stdDeviation="6" /></filter>
      </defs>
      <rect width="1280" height="840" fill="url(#d0)" />
      <rect width="1280" height="840" fill="url(#d1)" />
      <g filter="url(#db)">
        <path d="M-40 470C160 400 360 380 560 420s420 60 760-40v500H-40Z" fill="url(#d2)" opacity=".85" />
        <path d="M-40 590c240-110 500-140 760-70s380 50 600-50v420H-40Z" fill="url(#d3)" opacity=".9" />
        <path d="M-40 730c260-80 520-90 780-30s360 20 580-40v220H-40Z" fill="url(#d4)" />
      </g>
    </svg>
  );
}
