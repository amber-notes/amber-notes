"use client";

// Design alternatives for the two home page sections above the privacy card, picked with ?ai=a|b|c and
// ?import=a|b|c. Each is complete at rest; the first time it scrolls into view it plays once
// (reduced motion: it stays complete and still).

import { useEffect, useRef, useState } from "react";
import { AIGlyph } from "@/lib/ai-glyphs";
import h from "./home-alts.module.css";

const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function useFirstView<T extends HTMLElement>(threshold = 0.45) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, seen] as const;
}

const Check = () => <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>;
const Replay = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 8a5.5 5.5 0 1 0 1.7-4M2.5 2.5v3h3" /></svg>;

function Also() {
  return <p className={h.also}>Also Codex, <a href="https://incredible.one" rel="noopener">Incredible</a>, and any app that supports MCP. <a href="/blog/connect-chatgpt-to-your-notes">How to connect</a></p>;
}

/* ═════════════ Works with the AI you already use ═════════════ */

type Line = { text: string; kind: "check" | "done" | "bullet" | "para"; added?: boolean; was?: string };
type Scene = { app: string; glyph: "openai" | "claude"; surface: "phone" | "desk" | "term"; ask: string; title: string; date: string; lines: Line[]; receipt: string };
const SCENES: Scene[] = [
  {
    app: "ChatGPT", glyph: "openai", surface: "phone", ask: "Add what I need for paella on Sunday", title: "Groceries", date: "", receipt: "ChatGPT changed 3 lines",
    lines: [
      ...["Paella rice", "Saffron", "Chorizo"].map((text) => ({ text, kind: "check" as const, added: true })),
      { text: "Oat milk", kind: "check" }, { text: "Sourdough", kind: "done" },
    ],
  },
  {
    app: "Claude", glyph: "claude", surface: "desk", ask: "Swap day 3 for a day trip to Sintra", title: "Lisbon, 4 days in May", date: "", receipt: "Claude changed 1 line",
    lines: [
      { text: "Day 1: Alfama and the castle", kind: "bullet" },
      { text: "Day 2: Belém and pastéis de nata", kind: "bullet" },
      { text: "Day 3: Day trip to Sintra", kind: "bullet", was: "Day 3: LX Factory and the river" },
      { text: "Day 4: Time Out Market, then fly home", kind: "bullet" },
    ],
  },
  {
    app: "Claude Code", glyph: "claude", surface: "term", ask: "Write today's standup into my notes", title: "Standup notes", date: "", receipt: "Claude Code changed 3 lines",
    lines: [
      { text: "Mon: reviewed the sync pull request", kind: "bullet" },
      { text: "Tue: fixed the share link on iPhone", kind: "bullet", added: true },
      { text: "Tue: paired on the import sheet", kind: "bullet", added: true },
      { text: "Next: plan Friday's release", kind: "bullet", added: true },
    ],
  },
];

type Phase = "asking" | "landed" | "undone";

/// A. Try the undo: pick an app, watch its edit land in a note, tinted, then press Undo yourself.
export function AiTryUndo() {
  const [ref, seen] = useFirstView<HTMLElement>();
  const [k, setK] = useState(0);
  const [typed, setTyped] = useState(SCENES[0].ask.length);
  const [phase, setPhase] = useState<Phase>("landed"); // complete at rest
  const timers = useRef<number[]>([]);
  const s = SCENES[k];

  function play(i: number) {
    timers.current.forEach(clearTimeout); timers.current = [];
    setK(i);
    if (reduce()) { setTyped(SCENES[i].ask.length); setPhase("landed"); return; }
    const ask = SCENES[i].ask;
    setTyped(0); setPhase("asking");
    for (let n = 1; n <= ask.length; n++) timers.current.push(window.setTimeout(() => setTyped(n), 200 + n * 26));
    timers.current.push(window.setTimeout(() => setPhase("landed"), 200 + ask.length * 26 + 700));
  }
  useEffect(() => { if (seen) play(0); }, [seen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const ask = s.ask.slice(0, typed);
  const typing = typed < s.ask.length;
  return (
    <section ref={ref} className={`${h.section} ${h.compact}`} aria-labelledby="ai">
      <div className={h.head}>
        <h2 id="ai" className={h.h2}>Works with the AI you already use</h2>
        <p className={h.lede}>Ask ChatGPT, Claude or Claude Code. The edit lands tinted, with Undo. Try it.</p>
      </div>
      <div className={h.tryStage}>
        <div className={h.tryLeft}>
          <div className={h.appTabs} role="group" aria-label="Choose an AI app">
            {SCENES.map((x, i) => (
              <button key={x.app} type="button" aria-pressed={i === k} onClick={() => play(i)}><AIGlyph name={x.glyph} size={15} />{x.app}</button>
            ))}
          </div>
          <div className={`${h.askCard} ${h[s.surface]}`} aria-label={`${s.app}: ${s.ask}`}>
            <p className={h.askBar} aria-hidden="true"><AIGlyph name={s.glyph} size={13} />{s.app}</p>
            {s.surface === "term" ? (
              <div className={h.askBody} aria-hidden="true">
                <p className={h.prompt}><span>›</span>{ask}{typing && <i className={h.caretLight} />}</p>
                <p className={h.call} data-on={phase !== "asking" || undefined}><span>⏺</span> amber-notes · update_note</p>
              </div>
            ) : (
              <div className={h.askBody} aria-hidden="true">
                <p className={h.bubble} data-on={typed > 0 || undefined}>{ask}{typing && <i className={h.caretDark} />}</p>
                <p className={h.reply} data-on={phase !== "asking" || undefined}>Done. I updated &ldquo;{s.title}&rdquo; in Amber Notes.</p>
              </div>
            )}
          </div>
        </div>
        <figure className={h.noteWin} aria-label={`${s.title} in Amber Notes. ${phase === "undone" ? "The edit was undone." : `${s.receipt}, with Undo.`}`}>
          <h3 className={h.noteTitle} aria-hidden="true">{s.title}</h3>
          <ul className={h.noteLines} aria-hidden="true">
            {s.lines.map((l) => {
              const shown = phase === "landed" ? l.text : l.was ?? l.text;
              const gone = l.added && phase !== "landed";
              const tint = phase === "landed" && (l.added || l.was);
              return (
                <li key={l.text} className={h[l.kind]} data-gone={gone || undefined} data-tint={tint || undefined}>
                  <span>{(l.kind === "check" || l.kind === "done") && <i className={h.circle}>{l.kind === "done" && <Check />}</i>}{shown}</span>
                </li>
              );
            })}
          </ul>
          <div className={h.receiptSlot}>
            <p className={h.receipt} data-on={phase === "landed" || undefined}>
              <AIGlyph name={s.glyph} size={14} /><span>{s.receipt}</span><i aria-hidden="true" />
              <button type="button" onClick={() => setPhase("undone")} tabIndex={phase === "landed" ? 0 : -1}>Undo</button>
            </p>
            <p className={h.undone} data-on={phase === "undone" || undefined} aria-live="polite">
              {phase === "undone" && <>The note is back the way it was. <button type="button" onClick={() => play(k)}><Replay /> Play again</button></>}
            </p>
          </div>
        </figure>
      </div>
      <Also />
    </section>
  );
}

/// B. The real thing, in three captures: it writes, you see it, you can take it back.
export function AiCaptures() {
  return (
    <section className={h.section} aria-labelledby="ai">
      <div className={h.head}>
        <h2 id="ai" className={h.h2}>Works with the AI you already use</h2>
        <p className={h.lede}>Ask ChatGPT, Claude or Claude Code to change a note. Here is what you see in Amber Notes.</p>
      </div>
      <ol className={h.beats}>
        <li className={h.beatPhone}>
          <img src="/blog/iphone-groceries.webp" alt="A Groceries checklist in Amber Notes on iPhone. The five items ChatGPT just added are tinted, and a bar says ChatGPT changed 5 lines, with Undo." width={1206} height={2622} loading="lazy" />
          <p><b><span>1</span>It lands, tinted</b>Every line the AI wrote is marked, with Undo right there.</p>
        </li>
        <li className={h.beatPhone}>
          <img src="/blog/iphone-list.webp" alt="Amber Notes on iPhone: the note list, with Groceries marked Edited by ChatGPT, Standup notes Edited by Claude Code and Lisbon Edited by Claude." width={1206} height={2622} loading="lazy" />
          <p><b><span>2</span>You see who changed what</b>The list marks each note an AI edited, and which AI.</p>
        </li>
        <li className={h.beatWide}>
          <img src="/blog/history.webp" alt="Version history for a Groceries note in Amber Notes on a Mac: versions by you on iPhone and Mac, ChatGPT and Claude Code, with the lines that differ tinted and a Restore This Version button." width={1800} height={1200} loading="lazy" />
          <p><b><span>3</span>Go back to any version</b>Every change keeps the previous version, so you can restore any of them.</p>
        </li>
      </ol>
      <Also />
    </section>
  );
}

type Version = { when: string; day: string; by: string; glyph?: "openai" | "claude"; device?: string; lines: { text: string; done?: boolean; diff?: boolean }[] };
const BASE = ["Oat milk", "Lemons", "Coffee beans", "Fresh basil", "Burrata", "Cherry tomatoes", "Olive oil", "Dark chocolate"].map((text) => ({ text }));
// As in the app's history: each version is shown whole, with the lines that differ from the current note tinted.
const VERSIONS: Version[] = [
  { when: "Current version", day: "Today", by: "You on iPhone, 6:35", device: "phone", lines: [...BASE, { text: "Sourdough", done: true }] },
  { when: "4:35", day: "Today", by: "ChatGPT", glyph: "openai", lines: [...BASE, { text: "Sourdough", done: true }, { text: "Eggs", diff: true }, { text: "Spinach", diff: true }] },
  { when: "13:35", day: "Yesterday", by: "You on Mac · 3 edits", device: "mac", lines: [...BASE.slice(0, 6), { text: "Parmesan", diff: true }, { text: "Sourdough", done: true }] },
  { when: "1:30", day: "Sunday", by: "Claude Code", glyph: "claude", lines: [...BASE.slice(0, 4), { text: "Espresso beans", diff: true }, { text: "Sourdough" , diff: true }] },
];

/// C. Every edit is a version: the history panel, live. It steps through once; then it's yours to click.
export function AiHistory() {
  const [ref, seen] = useFirstView<HTMLElement>();
  const [v, setV] = useState(1); // at rest: ChatGPT's edit
  const auto = useRef(true);
  useEffect(() => {
    if (!seen || reduce()) return;
    const order = [0, 1, 3, 1];
    const ts = order.map((i, n) => window.setTimeout(() => { if (auto.current) setV(i); }, 300 + n * 1500));
    return () => ts.forEach(clearTimeout);
  }, [seen]);
  const cur = VERSIONS[v];
  const differ = cur.lines.filter((l) => l.diff).length;
  return (
    <section ref={ref} className={h.section} aria-labelledby="ai">
      <div className={h.headRow}>
        <div className={h.head}>
          <h2 id="ai" className={h.h2}>Let your AI edit. Every change can be undone.</h2>
          <p className={h.lede}>ChatGPT, Claude and Claude Code write straight into your notes. Each edit shows who made it, and the previous version is kept, so you can go back to any of them.</p>
        </div>
        <ul className={h.appRow} aria-label="Works with">
          <li><AIGlyph name="openai" size={16} />ChatGPT</li><li><AIGlyph name="claude" size={16} />Claude</li><li><AIGlyph name="claude" size={16} />Claude Code</li>
        </ul>
      </div>
      <div className={h.histWin}>
        <div className={h.histList} role="listbox" aria-label="Versions of Groceries">
          <p className={h.histHead}>Version History<span>Groceries</span></p>
          {VERSIONS.map((x, i) => (
            <div key={i}>
              {(i === 0 || VERSIONS[i - 1].day !== x.day) && <p className={h.histDay}>{x.day}</p>}
              <button type="button" role="option" aria-selected={i === v} onClick={() => { auto.current = false; setV(i); }}>
                <b>{x.when}</b>
                <span>{x.glyph ? <AIGlyph name={x.glyph} size={12} /> : <i className={h.dev} data-kind={x.device} />}{x.by}</span>
              </button>
            </div>
          ))}
        </div>
        <div className={h.histNote}>
          <p className={h.histMeta}>{v === 0 ? "The note as it is now" : <><i className={h.swatch} /> {differ} {differ === 1 ? "line differs" : "lines differ"} from the current note</>}</p>
          <h3 className={h.noteTitle}>Groceries</h3>
          <ul className={h.noteLines} key={v}>
            {cur.lines.map((l) => (
              <li key={l.text} className={l.done ? h.done : h.check} data-tint={(v !== 0 && l.diff) || undefined}>
                <span><i className={h.circle}>{l.done && <Check />}</i>{l.text}</span>
              </li>
            ))}
          </ul>
          <p className={h.histFoot}><span className={h.btnGhost}>Done</span><span className={h.btnAmber} data-off={v === 0 || undefined}>Restore This Version</span></p>
        </div>
      </div>
      <Also />
    </section>
  );
}
