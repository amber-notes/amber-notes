"use client";

import { useEffect, useRef, useState } from "react";
import { AIGlyph } from "@/lib/ai-glyphs";
import d from "./demo.module.css";

// A mini Mac desktop: the real Amber Notes window (captured from the app with demo data), and a
// small AI chat window on top. The three scenes play through on their own and loop: each one types
// a question, the AI answers, and the window cross-fades to the capture of the app after that
// change, with the app's own amber tint on the lines the AI touched. The current scene's chip fills
// as it plays. Everything runs off one clock that pauses off-screen, in a hidden tab, and while the
// pointer rests on the chips. Scripted, no network.

type Shot = "before" | "paella" | "bought" | "left";
type Scene = { ask: string; answer: string; from: Shot; to: Shot };

// One story, each step building on the last.
const SCENES: Scene[] = [
  { ask: "Add what I need for Sunday's paella", answer: "Added paella rice, saffron, chorizo, chicken thighs and smoked paprika to your Groceries note.",
    from: "before", to: "paella" },
  { ask: "I got the lemons and coffee, tick them off", answer: "Done. Lemons and coffee beans are ticked off in Groceries.",
    from: "paella", to: "bought" },
  { ask: "What's still left to buy?", answer: "Eleven things: the paella rice, saffron, chorizo, chicken thighs and paprika, plus oat milk, basil, burrata, cherry tomatoes, olive oil and dark chocolate.",
    from: "bought", to: "left" },
];

const ALT: Record<Shot, string> = {
  before: "Amber Notes on a Mac, with the Groceries note open",
  paella: "The Groceries note with paella rice, saffron, chorizo, chicken thighs and smoked paprika just added, tinted amber",
  bought: "The Groceries note with lemons and coffee beans just ticked off, tinted amber",
  left: "The Groceries note with the eleven things still to buy tinted amber",
};

const SHOTS: Shot[] = ["before", "paella", "bought", "left"];

// The clock, per scene (ms): typing starts at TYPE_AT, one character every CHAR; then the message
// is sent, the AI thinks, answers, and the note updates. The chip is full at the scene's end, then
// holds for HOLD before the next scene starts.
const TYPE_AT = 150, CHAR = 30, SENT = 250, THINK = 650, ANSWER = 1500, UPDATE = 1850, SETTLE = 900, HOLD = 1500;
const timing = (s: Scene) => {
  const typed = TYPE_AT + s.ask.length * CHAR;
  const end = typed + UPDATE + SETTLE;
  return { typed, end, total: end + HOLD };
};

/// Where scene s is at time t: the step (0 idle · 1 typing · 2 sent · 3 thinking · 4 answered · 5 note updated) and the typed text.
function at(s: Scene, t: number): { step: number; typed: string } {
  const { typed } = timing(s);
  if (t < TYPE_AT) return { step: 1, typed: "" };
  if (t < typed + SENT) return { step: 1, typed: s.ask.slice(0, Math.min(s.ask.length, Math.floor((t - TYPE_AT) / CHAR) + 1)) };
  if (t < typed + THINK) return { step: 2, typed: "" };
  if (t < typed + ANSWER) return { step: 3, typed: "" };
  if (t < typed + UPDATE) return { step: 4, typed: "" };
  return { step: 5, typed: "" };
}

export default function Demo() {
  const [scene, setScene] = useState(0);
  const [view, setView] = useState({ step: 0, typed: "" });
  const [still, setStill] = useState(false); // reduced motion: end states only, no clock
  const clock = useRef({ scene: 0, t: 0, last: 0, started: false });
  const pause = useRef({ offscreen: true, hidden: false, hover: false });
  const outer = useRef<HTMLDivElement>(null);
  const chips = useRef<(HTMLButtonElement | null)[]>([]);

  // Paints the fill of the current chip, and clears the others.
  const paint = (i: number, p: number) => chips.current.forEach((c, k) => c?.style.setProperty("--p", k === i ? String(p) : "0"));

  /// Starts scene i from its first moment (its note shows the state before its change).
  const jump = (i: number) => {
    clock.current = { ...clock.current, scene: i, t: 0, started: true };
    setScene(i);
    if (still) { setView({ step: 5, typed: "" }); return; }
    setView(at(SCENES[i], 0));
    paint(i, 0);
  };

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) { setStill(true); setView({ step: 5, typed: "" }); return; }

    let raf = 0;
    const tick = (now: number) => {
      const c = clock.current;
      const paused = pause.current.offscreen || pause.current.hidden || pause.current.hover;
      const dt = c.last ? Math.min(100, now - c.last) : 0; // a long gap (tab switch) never skips ahead
      c.last = now;
      if (!paused && c.started) {
        c.t += dt;
        const s = SCENES[c.scene];
        if (c.t >= timing(s).total) {
          const next = (c.scene + 1) % SCENES.length;
          c.scene = next; c.t = 0;
          setScene(next);
        }
        const cur = SCENES[c.scene];
        const v = at(cur, c.t);
        setView((old) => (old.step === v.step && old.typed === v.typed ? old : v));
        paint(c.scene, Math.min(1, c.t / timing(cur).end));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const io = new IntersectionObserver(([e]) => {
      pause.current.offscreen = !e.isIntersecting;
      if (e.isIntersecting && !clock.current.started) clock.current.started = true;
    }, { threshold: 0.35 });
    if (outer.current) io.observe(outer.current);
    const vis = () => { pause.current.hidden = document.hidden; };
    document.addEventListener("visibilitychange", vis);
    return () => { cancelAnimationFrame(raf); io.disconnect(); document.removeEventListener("visibilitychange", vis); };
  }, []);

  const s = SCENES[scene];
  const { step, typed } = view;
  const done = step >= 5;
  const shown: Shot = done ? s.to : s.from;
  const hoverPause = (on: boolean) => { if (window.matchMedia("(hover: hover)").matches) pause.current.hover = on; };

  return (
    <div className={d.wrap}>
      <div ref={outer} className={d.fit}>
        <div className={d.desk}>
          <Wallpaper />

          <div className={d.app}>
            {SHOTS.map((k) => (
              <img key={k} src={`/demo/app-${k}.webp`} width={1180} height={720} alt={k === shown ? ALT[k] : ""}
                aria-hidden={k !== shown} className={d.shot} data-on={k === shown || undefined}
                loading="eager" decoding="async" draggable={false} />
            ))}
            {done && s.to !== "left" && <div key={`sync${scene}`} className={d.synced}>Updated on your iPhone too</div>}
          </div>

          <div className={d.chat} aria-label="An AI chat">
            <div className={d.chatBar}>
              <div className={d.lights}><i /><i /><i /></div>
              <span className={d.chatTitle}><AIGlyph name="openai" size={16} />ChatGPT</span>
            </div>
            <div className={d.msgs}>
              {step === 0 && <p className={d.hint}>What can I help with?</p>}
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
              <span>{typed || <em>Ask anything</em>}</span>{step === 1 && <i className={d.caret} />}
              <b className={d.send} aria-hidden="true">↑</b>
            </div>
          </div>
        </div>
      </div>

      <div className={d.picks} role="group" aria-label="Scenes" onPointerEnter={() => hoverPause(true)} onPointerLeave={() => hoverPause(false)}>
        {SCENES.map((sc, i) => (
          <button key={sc.ask} ref={(el) => { chips.current[i] = el; }} type="button" className={d.pick} aria-pressed={scene === i}
            onClick={() => jump(i)}>
            <span className={d.pickLabel}>{sc.ask}</span>
            <span className={d.pickFill} aria-hidden="true">{sc.ask}</span>
          </button>
        ))}
      </div>
      <p className={d.psst}>Tap one to jump to it.</p>
      <p className={d.live} aria-live="polite">{done ? s.answer : ""}</p>
    </div>
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
