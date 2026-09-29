"use client";

import { useEffect, useRef, useState } from "react";
import { AIGlyph } from "@/lib/ai-glyphs";
import d from "./demo.module.css";

// A mini Mac desktop: the real Amber Notes window (captured from the app with demo data), and a
// small AI chat window on top. Picking a prompt types it into the chat, the AI answers, and the
// window cross-fades to the capture of the app after that change, with the app's own amber tint
// on the lines the AI touched. Scripted, no network.

type Shot = "before" | "paella" | "bought";
type Scene = { ask: string; answer: string; shot: Shot };

const SCENES: Scene[] = [
  { ask: "Add what I need for Sunday's paella", answer: "Added paella rice, saffron, chorizo, chicken thighs and smoked paprika to your Groceries note.", shot: "paella" },
  { ask: "I got the lemons and coffee, tick them off", answer: "Done. Lemons and coffee beans are ticked off in Groceries.", shot: "bought" },
  { ask: "What's still left to buy?", answer: "Oat milk, lemons, coffee beans, fresh basil, burrata, cherry tomatoes, olive oil and dark chocolate.", shot: "before" },
];

const ALT: Record<Shot, string> = {
  before: "Amber Notes on a Mac, with the Groceries note open",
  paella: "The Groceries note with paella rice, saffron, chorizo, chicken thighs and smoked paprika just added, tinted amber",
  bought: "The Groceries note with lemons and coffee beans just ticked off, tinted amber",
};

export default function Demo({ wall = "dune" }: { wall?: "dune" | "ember" }) {
  const [scene, setScene] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [step, setStep] = useState(0); // 0 idle · 1 typing · 2 sent · 3 thinking · 4 answered · 5 note updated
  const [wallpaper, setWallpaper] = useState(wall);
  const timers = useRef<number[]>([]);
  const touched = useRef(false);
  const outer = useRef<HTMLDivElement>(null);

  // Preview the other wallpaper with ?wall=ember.
  useEffect(() => {
    const w = new URLSearchParams(location.search).get("wall");
    if (w === "dune" || w === "ember") setWallpaper(w);
  }, []);

  function play(i: number) {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const s = SCENES[i];
    setScene(i);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setTyped(""); setStep(5); return; }
    setStep(1); setTyped("");
    let t = 0;
    for (let k = 1; k <= s.ask.length; k++) {
      t += 32;
      timers.current.push(window.setTimeout(() => setTyped(s.ask.slice(0, k)), t));
    }
    const at = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, t + ms));
    at(250, () => { setTyped(""); setStep(2); });
    at(650, () => setStep(3));
    at(1500, () => setStep(4));
    at(1850, () => setStep(5));
  }

  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !touched.current) { play(0); io.disconnect(); }
    }, { threshold: 0.45 });
    io.observe(el);
    return () => { io.disconnect(); timers.current.forEach(clearTimeout); };
  }, []);

  const s = scene === null ? null : SCENES[scene];
  const shown: Shot = s && step >= 5 ? s.shot : "before";

  return (
    <div className={d.wrap}>
      <div ref={outer} className={d.fit}>
        <div className={d.desk} data-wall={wallpaper}>
          <Wallpaper kind={wallpaper} />

          <div className={d.app}>
            {(["before", "paella", "bought"] as Shot[]).map((k) => (
              <img key={k} src={`/demo/app-${k}.webp`} width={1180} height={720} alt={k === shown ? ALT[k] : ""}
                aria-hidden={k !== shown} className={d.shot} data-on={k === shown || undefined}
                loading={k === "before" ? "eager" : "lazy"} decoding="async" draggable={false} />
            ))}
            {s && step >= 5 && s.shot !== "before" && <div key={`sync${scene}`} className={d.synced}>Updated on your iPhone too</div>}
          </div>

          <div className={d.chat} aria-label="An AI chat">
            <div className={d.chatBar}><div className={d.lights}><i /><i /><i /></div><span className={d.chatTitle}><AIGlyph name="openai" size={16} />ChatGPT</span></div>
            <div className={d.msgs}>
              {!s && <p className={d.hint}>What can I help with?</p>}
              {s && step >= 2 && <div key={`q${scene}`} className={d.me}>{s.ask}</div>}
              {s && step === 3 && <div className={d.thinking}><span className={d.tool}>Talking to Amber Notes…</span></div>}
              {s && step >= 4 && (
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

      <div className={d.picks} role="group" aria-label="Try asking">
        {SCENES.map((sc, i) => (
          <button key={sc.ask} type="button" className={d.pick} aria-pressed={scene === i}
            onClick={() => { touched.current = true; play(i); }}>{sc.ask}</button>
        ))}
      </div>
      <p className={d.psst}>Psst… it's interactive. Tap one.</p>
      <p className={d.live} aria-live="polite">{s && step >= 5 ? s.answer : ""}</p>
    </div>
  );
}

/// Generated, warm, macOS-like wallpapers (no photos, nothing of Apple's).
function Wallpaper({ kind }: { kind: "dune" | "ember" }) {
  if (kind === "ember") {
    return (
      <svg className={d.wall} viewBox="0 0 1280 840" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <radialGradient id="e0" cx="30%" cy="20%" r="95%"><stop offset="0" stopColor="#ffb25a" /><stop offset=".45" stopColor="#c8561c" /><stop offset="1" stopColor="#3a1408" /></radialGradient>
          <linearGradient id="e1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffd08a" stopOpacity=".9" /><stop offset="1" stopColor="#e0662a" stopOpacity="0" /></linearGradient>
          <linearGradient id="e2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7a2410" /><stop offset="1" stopColor="#ff9c45" stopOpacity=".7" /></linearGradient>
          <filter id="eb"><feGaussianBlur stdDeviation="28" /></filter>
        </defs>
        <rect width="1280" height="840" fill="url(#e0)" />
        <g filter="url(#eb)">
          <path d="M-100 520C200 360 420 300 700 360s520 40 700-120v600H-100Z" fill="url(#e2)" />
          <path d="M-80 260C180 120 480 90 760 180s420 60 620-40v220c-240 120-460 120-700 40S140 360-80 460Z" fill="url(#e1)" opacity=".75" />
          <path d="M-100 760c300-140 600-160 900-80s420 20 580-60v320H-100Z" fill="#4a1a0a" opacity=".7" />
        </g>
      </svg>
    );
  }
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
