"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AIGlyph } from "@/lib/ai-glyphs";
import d from "./demo.module.css";

// A mini Mac desktop showing the real Amber Notes window (frames captured from the app with demo
// data, all from one session) and a ChatGPT window. It opens with the app alone while you type the
// last two items of the Groceries note; then ChatGPT arrives and one conversation plays: each
// request is answered, and the edit lands in the note already tinted amber, with the app's receipt
// pill, as the app shows it. Then it resets and loops. One clock drives it; it pauses off-screen, in
// a hidden tab and while the pointer is over it. Scripted, no network.

// The frames, named as captured. A recapture with the same names is a change to this constant.
// `h` is the window height in points, `pillTop` where the receipt PNG's top-left sits in the window.
const FRAMES = { dir: "/demo/720/", h: 720, pillTop: 646 };

type Shot = "pre" | "pre1" | "before" | "1-tint" | "1-faded" | "2-tint" | "2-faded" | "3-tint";
const FILE: Record<Shot, string> = {
  pre: "demo-intro-pretype", pre1: "demo-intro-pretype1", before: "demo-0-before",
  "1-tint": "demo-1-tint", "1-faded": "demo-1-faded", "2-tint": "demo-2-tint", "2-faded": "demo-2-faded", "3-tint": "demo-3-tint",
};
const SHOTS = Object.keys(FILE) as Shot[];
const src = (k: Shot) => `${FRAMES.dir}${FILE[k]}.webp`;
const ALT: Record<Shot, string> = {
  pre: "Amber Notes on a Mac, with the Groceries note open",
  pre1: "Amber Notes on a Mac, with the Groceries note open",
  before: "Amber Notes on a Mac, with the Groceries note open",
  "1-tint": "The Groceries note with paella rice, saffron, chorizo, chicken thighs and smoked paprika just added, tinted amber",
  "1-faded": "The Groceries note with the paella ingredients added",
  "2-tint": "The Groceries note with lemons and coffee beans just ticked off, tinted amber",
  "2-faded": "The Groceries note with lemons and coffee beans ticked off",
  "3-tint": "The Groceries note with the eleven things still to buy tinted amber",
};

type Scene = { ask: string; answer: string; from: Shot; plain: Shot; tint: Shot; pill?: 5 | 2 };
const SCENES: Scene[] = [
  { ask: "Add what I need for Sunday's paella", answer: "Added paella rice, saffron, chorizo, chicken thighs and smoked paprika to Groceries.",
    from: "before", plain: "1-faded", tint: "1-tint", pill: 5 },
  { ask: "I got the lemons and coffee, tick them off", answer: "Done. Lemons and coffee beans are ticked off.",
    from: "1-faded", plain: "2-faded", tint: "2-tint", pill: 2 },
  { ask: "What's still left to buy?", answer: "Eleven things. I've marked them in Groceries.",
    from: "2-faded", plain: "2-faded", tint: "3-tint" },
];

// Scene clock (ms): typing starts at TYPE_AT, one character every CHAR; then the message is sent, the
// AI thinks and answers, and at LAND the edit lands (rows and tint together) and the pill follows.
const TYPE_AT = 400, CHAR = 45, SENT = 350, THINK = 800, ANSWER = 1800, LAND = 2500, PILL_AFTER = 250, PILL_HOLD = 3000, AFTER = 1300;
const RESET = 1600; // after the last scene: the conversation fades and ChatGPT leaves before the loop
const timing = (s: Scene, last: boolean) => {
  const typed = TYPE_AT + s.ask.length * CHAR;
  const pill = typed + LAND + PILL_AFTER;
  return { typed, pill, total: pill + PILL_HOLD + AFTER + (last ? 1000 : 0) };
};

// 1 typing · 2 sent · 3 thinking · 4 answered · 6 landed. pill: the receipt is up; faded: the tint
// has faded, as it does in the app after a moment.
type View = { step: number; typed: string; pill: boolean; faded: boolean; intro?: Intro };
function at(s: Scene, t: number): View {
  const k = timing(s, false);
  const v: View = { step: 1, typed: "", pill: false, faded: false };
  if (t < TYPE_AT) return v;
  if (t < k.typed + SENT) return { ...v, typed: s.ask.slice(0, Math.min(s.ask.length, Math.floor((t - TYPE_AT) / CHAR) + 1)) };
  if (t < k.typed + THINK) return { ...v, step: 2 };
  if (t < k.typed + ANSWER) return { ...v, step: 3 };
  if (t < k.typed + LAND) return { ...v, step: 4 };
  return { ...v, step: 6, pill: t >= k.pill && t < k.pill + PILL_HOLD, faded: t >= k.pill + PILL_HOLD };
}

// The intro: the app alone, then you type the note's last two items at a human pace and press
// Return as the app does (an instant swap to the next capture). Positions are in capture points,
// measured from the frames: the text starts at x 513, rows are 23.5 pt apart.
const TYPE_X = 513;
const INTRO_ROWS = [
  { text: "Olive oil", top: 318.1, end: 559 },
  { text: "Dark chocolate", top: 341.6, end: 603 },
];
// The real caret (captured): 2×16 pt, #F4AD33, its top 3.9 pt above the row's text.
const CARET_START = { x: 614.3, top: 294.6 }; // after "Cherry tomatoes"
const I_ALONE = 600, I_BEFORE_RET = 250, I_AFTER_RET = 200, I_SETTLE = 300, I_CHAT = 900;
const charGaps = (text: string, seed: number) => [...text].map((_, i) => 45 + ((i * 37 + seed * 11) % 11));
const GAPS = INTRO_ROWS.map((r, k) => charGaps(r.text, k + 1));
const typedSpan = (k: number) => GAPS[k].reduce((a, b) => a + b, 0);
const ret1 = I_ALONE + I_BEFORE_RET;
const introEnd1 = ret1 + I_AFTER_RET + typedSpan(0);
const introStart2 = introEnd1 + I_BEFORE_RET;
const introEnd2 = introStart2 + I_AFTER_RET + typedSpan(1);
const CHAT_IN = introEnd2 + I_SETTLE;
const INTRO = CHAT_IN + I_CHAT;
function typedChars(k: number, ms: number) {
  let t = I_AFTER_RET, n = 0;
  for (const g of GAPS[k]) { t += g; if (ms >= t) n++; else break; }
  return n;
}
type Intro = { shot: Shot; row: number; n: number; chat: boolean };
function introAt(t: number): Intro {
  if (t < ret1) return { shot: "pre", row: -1, n: 0, chat: false };
  if (t < introStart2) return { shot: "pre1", row: 0, n: typedChars(0, t - ret1), chat: false };
  if (t < CHAT_IN) return { shot: "before", row: 1, n: typedChars(1, t - introStart2), chat: false };
  return { shot: "before", row: 2, n: 0, chat: true };
}

const PARTS = ["You write a note", "Add what you need for paella", "Tick off lemons and coffee", "What's still left to buy"];

const W = 1280, KEY = 500; // design width; KEY = the top part of the desk that must fit the first view

export default function Demo() {
  const [scene, setScene] = useState(0);
  const [view, setView] = useState<View>({ step: -2, typed: "", pill: false, faded: false, intro: introAt(0) });
  const [still, setStill] = useState(false);
  const [fitW, setFitW] = useState<number | null>(null);
  const clock = useRef({ scene: 0, t: -INTRO, last: 0, started: false });
  const segs = useRef<(HTMLButtonElement | null)[]>([]);
  // The story bar: part 0 is the intro, parts 1–3 the scenes. Painted straight from the clock.
  const paintBar = (scene: number, t: number) => {
    const part = t < 0 ? 0 : scene + 1;
    const p = t < 0 ? Math.max(0, Math.min(1, (t + INTRO) / INTRO)) : Math.min(1, t / timing(SCENES[scene], scene === SCENES.length - 1).total);
    const resetting = t < -INTRO;
    segs.current.forEach((el, k) => {
      if (!el) return;
      el.dataset.state = resetting ? "next" : k < part ? "done" : k === part ? "now" : "next";
      el.style.setProperty("--p", String(k === part && !resetting ? p : 0));
    });
  };
  /// Jumps to a part of the story from its start: 0 the intro, 1–3 the scenes.
  const jump = (part: number) => {
    const c = clock.current;
    c.started = true;
    c.scene = part === 0 ? 0 : part - 1;
    c.t = part === 0 ? -INTRO : 0;
    setScene(c.scene);
  };
  const pause = useRef({ offscreen: false, hidden: false, hover: false });
  const outer = useRef<HTMLDivElement>(null);
  const msgsRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLSpanElement>(null);

  // Wide screens: size the desk so the chat and the changed rows fit the first view.
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

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // No motion: the whole conversation and the last note state.
      setStill(true); setScene(SCENES.length - 1); setView({ step: 6, typed: "", pill: false, faded: false }); return;
    }
    // Every frame is decoded before anything plays, so a swap never shows an undecoded image.
    const ready = { done: false };
    Promise.all(SHOTS.map((k) => { const i = new Image(); i.src = src(k); return i.decode().catch(() => undefined); }))
      .then(() => { ready.done = true; });

    let raf = 0;
    const tick = (now: number) => {
      const c = clock.current;
      if (!ready.done) { c.last = now; raf = requestAnimationFrame(tick); return; }
      const paused = pause.current.offscreen || pause.current.hidden || pause.current.hover;
      const dt = c.last ? Math.min(100, now - c.last) : 0; // a long gap (tab switch) never skips ahead
      c.last = now;
      if (!paused && c.started) {
        c.t += dt;
        const last = c.scene === SCENES.length - 1;
        if (c.t >= timing(SCENES[c.scene], last).total) {
          c.scene = (c.scene + 1) % SCENES.length;
          c.t = c.scene === 0 ? -RESET - INTRO : 0;
          setScene(c.scene);
        }
        const v: View = c.t < 0
          ? (c.t >= -INTRO ? { step: -2, typed: "", pill: false, faded: false, intro: introAt(c.t + INTRO) } : { step: -1, typed: "", pill: false, faded: false })
          : at(SCENES[c.scene], c.t);
        paintBar(c.scene, c.t);
        setView((o) => (o.step === v.step && o.typed === v.typed && o.pill === v.pill && o.faded === v.faded
          && o.intro?.shot === v.intro?.shot && o.intro?.n === v.intro?.n && o.intro?.row === v.intro?.row && o.intro?.chat === v.intro?.chat ? o : v));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Plays as soon as any of it is on screen (already true on load for most laptops).
    const io = new IntersectionObserver(([e]) => {
      pause.current.offscreen = !e.isIntersecting;
      if (e.isIntersecting) clock.current.started = true;
    }, { threshold: 0.05 });
    if (outer.current) io.observe(outer.current);
    const vis = () => { pause.current.hidden = document.hidden; };
    document.addEventListener("visibilitychange", vis);
    return () => { cancelAnimationFrame(raf); io.disconnect(); document.removeEventListener("visibilitychange", vis); };
  }, []);

  // Keep the newest exchange in view, like a real chat.
  useEffect(() => {
    const m = msgsRef.current;
    if (m) m.scrollTo({ top: m.scrollHeight, behavior: still ? "auto" : "smooth" });
  }, [scene, view.step, still]);
  // The input scrolls like a real single-line field, so the caret after the text stays in view.
  useEffect(() => { const f = fieldRef.current; if (f) f.scrollLeft = f.scrollWidth; }, [view.typed]);

  const s = SCENES[scene];
  const { step, typed, pill, faded, intro } = view;
  const landed = step >= 6;
  const base: Shot = intro ? intro.shot : step === -1 ? "pre" : landed ? (faded ? s.plain : s.tint) : s.from;
  const chatAway = Boolean(intro && !intro.chat) || step === -1;

  // Frames never cross-fade both ways (that lets the desk show through for a moment): the previous
  // frame stays fully opaque underneath until the new one has faded in over it.
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

  return (
    <div className={d.wrap}>
      <div ref={outer} className={d.fit} style={fitW ? { width: fitW, margin: "0 auto" } : undefined}
        onPointerEnter={() => hoverPause(true)} onPointerLeave={() => hoverPause(false)}>
        <div className={d.desk}>
          <Wallpaper />
          <div className={d.app} data-dim={(step >= 1 && step <= 4) || undefined} data-instant={intro ? true : undefined} data-edit={(landed && !faded) || undefined}>
            {SHOTS.map((k) => (
              <img key={k} src={src(k)} width={1180} height={FRAMES.h} alt={k === base ? ALT[k] : ""}
                aria-hidden={k !== base} className={d.shot} data-on={k === base || undefined} data-under={(k === under && k !== base) || undefined}
                loading="eager" decoding="async" draggable={false} />
            ))}
            {intro && <IntroTyping intro={intro} />}
            {/* The app's receipt pill, as captured, springing in over the note pane. */}
            {s.pill && landed && (pill || faded) && (
              <img key={`pill${scene}`} src={`${FRAMES.dir}pill-chatgpt-${s.pill}-lines@2x.png`} width={295} height={78}
                alt={`ChatGPT changed ${s.pill} lines. Undo`} className={d.pill} data-out={faded || undefined}
                style={{ top: `calc(${FRAMES.pillTop} * var(--u))` }} />
            )}
          </div>

          <div className={d.chat} data-away={chatAway || undefined} data-dim={landed || undefined} aria-label="An AI chat">
            <div className={d.chatBar}>
              <div className={d.lights}><i /><i /><i /></div>
              <span className={d.chatTitle}><AIGlyph name="openai" size={16} />ChatGPT</span>
            </div>
            <div ref={msgsRef} className={d.msgs} data-reset={step === -1 || undefined}>
              {/* Earlier exchanges stay in the conversation (all three while it fades out to loop). */}
              {SCENES.slice(0, step === -1 ? SCENES.length : scene).map((p) => (
                <div key={p.ask} className={d.pair}>
                  <div className={d.me}>{p.ask}</div>
                  <div className={d.ai}><span className={d.tool}>Used Amber Notes</span><p>{p.answer}</p></div>
                </div>
              ))}
              {step >= 2 && <div key={`q${scene}`} className={d.me}>{s.ask}</div>}
              {step === 3 && <div className={d.thinking}><span className={d.tool}>Talking to Amber Notes…</span></div>}
              {step >= 4 && (
                <div key={`a${scene}`} className={d.ai}>
                  <span className={d.tool}>Used Amber Notes</span>
                  <p>{s.answer}</p>
                </div>
              )}
            </div>
            <div className={d.input}>
              <b className={d.plus} aria-hidden="true">+</b>
              {/* The caret sits right after the typed text (or at the start, before the placeholder); it blinks only while idle. */}
              <span ref={fieldRef} className={d.field}>
                {typed}{step === 1 && <i className={d.caret} data-idle={!typed || undefined} />}{!typed && <em>Ask anything</em>}
              </span>
              <b className={d.send} aria-hidden="true">↑</b>
            </div>
          </div>
        </div>
      </div>
      {!still && (
        <div className={d.story} role="group" aria-label="Demo progress">
          {PARTS.map((name, k) => (
            <button key={name} type="button" ref={(el) => { segs.current[k] = el; }} className={d.seg} data-state={k === 0 ? "now" : "next"}
              aria-label={`Part ${k + 1} of ${PARTS.length}: ${name}`} onClick={() => jump(k)}><i /></button>
          ))}
        </div>
      )}
      <p className={d.live} aria-live="polite">{landed ? s.answer : ""}</p>
    </div>
  );
}

/// The last two items being typed. The capture already holds the full text; a note-white cover
/// hides what hasn't been "typed" yet, ending exactly where the browser's SF metrics put the next
/// character. The caret is drawn in the app's accent at the app's size.
function IntroTyping({ intro }: { intro: Intro }) {
  const [measure, setMeasure] = useState<((text: string, n: number) => number) | null>(null);
  useEffect(() => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return;
    ctx.font = '13px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui';
    setMeasure(() => (text: string, n: number) => ctx.measureText(text.slice(0, n)).width / ctx.measureText(text).width);
  }, []);
  const rows = INTRO_ROWS.map((r, k) => {
    if (k < intro.row || intro.row === 2) return null; // typed already
    if (k > intro.row) return null; // not in the capture yet
    const frac = measure ? measure(r.text, intro.n) : intro.n / r.text.length;
    const x = TYPE_X + frac * (r.end - TYPE_X);
    return { k, x, top: r.top, end: r.end };
  }).filter(Boolean) as { k: number; x: number; top: number; end: number }[];
  const caret = intro.row === -1 ? { x: CARET_START.x, top: CARET_START.top } : rows[0] ? { x: rows[0].x + 0.5, top: rows[0].top } : null;
  return (
    <>
      {rows.map((r) => (
        <span key={r.k} className={d.cover} style={{ left: `calc(${r.x} * var(--u))`, top: `calc(${r.top} * var(--u))`, width: `calc(${r.end - r.x + 6} * var(--u))` }} />
      ))}
      {caret && <i className={d.appCaret} style={{ left: `calc(${caret.x} * var(--u))`, top: `calc(${caret.top} * var(--u))` }} />}
    </>
  );
}

/// A generated, warm, macOS-like wallpaper (no photo, nothing of Apple's).
function Wallpaper() {
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
