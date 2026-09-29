"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./home.module.css";

// A small, real-feeling scene: pick something to ask, the AI answers, the note updates.
// No network, no AI: it's scripted, and says so by being a picker instead of a text box.

type Item = { text: string; done?: boolean; isNew?: boolean };
type Scene = { ask: string; answer: string; note: string; items: Item[] };

const BASE: Item[] = [
  { text: "Lemons" }, { text: "Coffee beans" }, { text: "Fresh basil" },
  { text: "Sourdough", done: true }, { text: "Eggs", done: true },
];

const SCENES: Scene[] = [
  {
    ask: "Add oat milk to my groceries",
    answer: "Done. Oat milk is on your Groceries list.",
    note: "Groceries",
    items: [{ text: "Oat milk", isNew: true }, ...BASE],
  },
  {
    ask: "Add what I need for Sunday's paella",
    answer: "Added paella rice, saffron, chorizo and prawns to Groceries.",
    note: "Groceries",
    items: [
      { text: "Paella rice", isNew: true }, { text: "Saffron", isNew: true },
      { text: "Chorizo", isNew: true }, { text: "Prawns", isNew: true }, ...BASE,
    ],
  },
  {
    ask: "What's still left to buy?",
    answer: "Lemons, coffee beans and fresh basil. Sourdough and eggs are already ticked off.",
    note: "Groceries",
    items: BASE,
  },
];

export default function Demo() {
  const [scene, setScene] = useState<number | null>(null);
  const [step, setStep] = useState(3); // 0 asked · 1 thinking · 2 answered · 3 note updated
  const timers = useRef<number[]>([]);
  const touched = useRef(false);

  function play(i: number) {
    timers.current.forEach(clearTimeout);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setScene(i);
    if (reduce) { setStep(3); return; }
    setStep(0);
    timers.current = [
      window.setTimeout(() => setStep(1), 450),
      window.setTimeout(() => setStep(2), 1400),
      window.setTimeout(() => setStep(3), 1750),
    ];
  }

  // Plays the first scene on its own once it's on screen, unless someone already clicked.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !touched.current) { play(0); io.disconnect(); }
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); timers.current.forEach(clearTimeout); };
  }, []);

  const s = scene === null ? null : SCENES[scene];
  const items = s && step >= 3 ? s.items : BASE;

  return (
    <div className={styles.demoWrap} ref={root}>
      <div className={styles.stage}>
        <div className={styles.window}>
          <div className={styles.chat}>
            <p className={styles.chatLabel}>Your AI</p>
            {s ? (
              <>
                <div key={`q${scene}`} className={styles.bubbleMe}>{s.ask}</div>
                {step === 1 && <div className={styles.typing} aria-label="Thinking"><i /><i /><i /></div>}
                {step >= 2 && <div key={`a${scene}`} className={styles.bubbleAi}>{s.answer}</div>}
              </>
            ) : (
              <p className={styles.chatEmpty}>Ask it something below.</p>
            )}
          </div>

          <div className={styles.note} aria-live="polite">
            <p className={styles.noteApp}><img src="/mark.png" alt="" width={16} height={16} /> Amber Notes</p>
            <h3 className={styles.noteTitle}>Groceries</h3>
            <ul className={styles.list}>
              {items.map((it) => (
                <li key={it.text} className={`${it.done ? styles.done : ""} ${it.isNew && step >= 3 ? styles.added : ""}`}>
                  <span className={`${styles.box} ${it.done ? styles.ticked : ""}`} />
                  {it.text}
                </li>
              ))}
            </ul>
            {s && step >= 3 && <p className={styles.synced}>Updated on your iPhone too</p>}
          </div>
        </div>
      </div>

      <div className={styles.picks} role="group" aria-label="Try asking">
        {SCENES.map((sc, i) => (
          <button
            key={sc.ask}
            type="button"
            className={styles.pick}
            aria-pressed={scene === i}
            onClick={() => { touched.current = true; play(i); }}
          >
            {sc.ask}
          </button>
        ))}
      </div>
      <p className={styles.psst}>Psst… it's interactive. Tap one.</p>
    </div>
  );
}
