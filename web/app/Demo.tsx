"use client";

import { useEffect, useRef, useState } from "react";
import { AIGlyph } from "@/lib/ai-glyphs";
import d from "./demo.module.css";

// A mini Mac desktop: the real Amber Notes window (captured from the app with demo data), and a
// small AI chat window on top. Picking a prompt types it into the chat, the AI answers, and the
// window cross-fades to the capture of the app after that change, with the app's own amber tint
// on the lines the AI touched. Scripted, no network.

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

export default function Demo() {
  const [scene, setScene] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [step, setStep] = useState(0); // 0 idle · 1 typing · 2 sent · 3 thinking · 4 answered · 5 note updated
  const [run, setRun] = useState(0); // bumps on every play, so the chat and sync note animate again
  const timers = useRef<number[]>([]);
  const touched = useRef(false);
  const outer = useRef<HTMLDivElement>(null);

  const cancel = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  /// Plays scene i from its starting state. With `chain`, the next scenes follow.
  function play(i: number, chain = false) {
    cancel();
    const s = SCENES[i];
    setScene(i); setRun((r) => r + 1); setTyped("");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setStep(5); return; }
    setStep(1);
    let t = 120;
    for (let k = 1; k <= s.ask.length; k++) {
      t += 30;
      timers.current.push(window.setTimeout(() => setTyped(s.ask.slice(0, k)), t));
    }
    const at = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, t + ms));
    at(250, () => { setTyped(""); setStep(2); });
    at(650, () => setStep(3));
    at(1500, () => setStep(4));
    at(1850, () => setStep(5));
    if (chain && i + 1 < SCENES.length) at(4200, () => play(i + 1, true));
  }

  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !touched.current) { play(0, true); io.disconnect(); }
    }, { threshold: 0.45 });
    io.observe(el);
    return () => { io.disconnect(); cancel(); };
  }, []);

  const s = scene === null ? null : SCENES[scene];
  const done = s !== null && step >= 5;
  const shown: Shot = s ? (done ? s.to : s.from) : "before";
  const replay = () => {
    touched.current = true;
    if (scene === null || (scene === SCENES.length - 1 && done)) play(0, true);
    else play(scene);
  };

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
            {done && s && s.to !== "left" && <div key={`sync${run}`} className={d.synced}>Updated on your iPhone too</div>}
          </div>

          <div className={d.chat} aria-label="An AI chat">
            <div className={d.chatBar}>
              <div className={d.lights}><i /><i /><i /></div>
              <span className={d.chatTitle}><AIGlyph name="openai" size={16} />ChatGPT</span>
            </div>
            <div className={d.msgs}>
              {!s && <p className={d.hint}>What can I help with?</p>}
              {s && step >= 2 && <div key={`q${run}`} className={d.me}>{s.ask}</div>}
              {s && step === 3 && <div className={d.thinking}><span className={d.tool}>Talking to Amber Notes…</span></div>}
              {s && step >= 4 && (
                <div key={`a${run}`} className={d.ai}>
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

      <div className={d.picks} role="group" aria-label="Try asking">
        {SCENES.map((sc, i) => (
          <button key={sc.ask} type="button" className={d.pick} aria-pressed={scene === i}
            onClick={() => { touched.current = true; play(i); }}>{sc.ask}</button>
        ))}
        <button type="button" className={`${d.pick} ${d.replayPill}`} onClick={replay} aria-label="Replay the demo">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 8a5.5 5.5 0 1 0 1.7-4" /><path d="M2.5 2.2v2.6h2.6" /></svg>
          Replay
        </button>
      </div>
      <p className={d.psst}>Psst… it's interactive. Ask it something.</p>
      <p className={d.live} aria-live="polite">{done && s ? s.answer : ""}</p>
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
