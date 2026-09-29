"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import d from "./demo.module.css";

// A mini Mac desktop: the Amber Notes window behind, a small AI chat window on top.
// Scripted, no network. Picking a prompt types it into the chat, the AI answers, and the
// Groceries note updates with the new items glowing, the way the app shows AI edits.

type Item = { text: string; done?: boolean; isNew?: boolean };
type Scene = { ask: string; answer: string; add: string[] };

const BASE: Item[] = [
  { text: "Lemons" }, { text: "Coffee beans" }, { text: "Fresh basil" }, { text: "Burrata" },
  { text: "Sourdough", done: true }, { text: "Eggs", done: true },
];

const SCENES: Scene[] = [
  { ask: "Add oat milk to my groceries", answer: "Done. Oat milk is on your Groceries list in Amber Notes.", add: ["Oat milk"] },
  { ask: "Add what I need for Sunday's paella", answer: "Added paella rice, saffron, chorizo and prawns to Groceries.", add: ["Paella rice", "Saffron", "Chorizo", "Prawns"] },
  { ask: "What's still left to buy?", answer: "Lemons, coffee beans, fresh basil and burrata. Sourdough and eggs are ticked off.", add: [] },
];

const W = 1040, H = 640; // the desktop's design size; it scales down as one picture

export default function Demo() {
  const [scene, setScene] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [step, setStep] = useState(0); // 0 idle · 1 typing · 2 sent · 3 thinking · 4 answered · 5 note updated
  const timers = useRef<number[]>([]);
  const touched = useRef(false);
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const measure = (w: number) => setScale(Math.min(1, w / W));
    measure(el.clientWidth);
    const ro = new ResizeObserver(([e]) => measure(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
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
      t += 34;
      timers.current.push(window.setTimeout(() => setTyped(s.ask.slice(0, k)), t));
    }
    const at = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, t + ms));
    at(250, () => { setTyped(""); setStep(2); });
    at(650, () => setStep(3));
    at(1500, () => setStep(4));
    at(1900, () => setStep(5));
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
  const added = s && step >= 5 ? s.add : [];
  const items: Item[] = [...added.map((text) => ({ text, isNew: true })), ...BASE];
  const preview = added.length ? added.join(", ") : "For the weekend, and Sunday dinner with Sara and Jonas.";

  return (
    <div className={d.wrap}>
      <div ref={outer} className={d.fit} style={{ height: H * scale }}>
        <div className={d.desk} style={{ width: W, height: H, transform: `scale(${scale})` }} role="img" aria-label="A Mac with Amber Notes open and an AI chat window on top">
          <div className={d.menubar} aria-hidden="true">
            <AppleMark />
            <b>Amber Notes</b><span>File</span><span>Edit</span><span>Format</span><span>View</span><span>Window</span>
            <span className={d.clock}>Tue 29 Sep&nbsp;&nbsp;10:07</span>
          </div>

          <div className={d.app}>
            <aside className={d.sidebar}>
              <div className={d.lights}><i /><i /><i /></div>
              <div className={d.sbHead}><img src="/mark.png" alt="" width={18} height={18} /> Amber Notes</div>
              <div className={d.sbLabel}>Folders</div>
              <ul className={d.folders}>
                <li className={d.folderOn}><Folder /> Notes <em>6</em></li>
                <li><Folder /> Ideas <em>2</em></li>
                <li><Folder /> Travel <em>4</em></li>
                <li><Folder /> Work <em>3</em></li>
                <li><Trash /> Recently Deleted <em>0</em></li>
              </ul>
            </aside>
            <section className={d.listCol}>
              <div className={d.listBar}><div><b>Notes</b><small>6 notes</small></div><span className={d.dots}>•••</span></div>
              <div className={d.sec}>Pinned</div>
              <div className={`${d.row} ${d.rowOn}`}>
                <b>Groceries</b>
                <p><span>{added.length ? "Now" : "10:02"}</span> {preview}</p>
              </div>
              <div className={d.sec}>Today</div>
              <div className={d.row}><b>Lisbon in May</b><p><span>09:41</span> Four days of tiles, trams and pastries.</p></div>
              <div className={d.row}><b>Standup notes</b><p><span>08:29</span> Shipped the sync fix. Next up…</p></div>
              <div className={d.sec}>Yesterday</div>
              <div className={d.row}><b>Book club</b><p><span>Yesterday</span> The Remains of the Day</p></div>
            </section>
            <section className={d.noteCol}>
              <div className={d.noteBar} aria-hidden="true"><Compose /><span className={d.aa}>Aa</span><Check /><Table /><Clip /><span className={d.grow} /><Share /><span className={d.search}>Search</span></div>
              <div className={d.noteDate}>29 September 2026 at {added.length ? "10:07" : "10:02"}</div>
              <h3 className={d.noteTitle}>Groceries</h3>
              <p className={d.noteText}>For the weekend, and Sunday dinner with Sara and Jonas.</p>
              <ul className={d.check}>
                {items.map((it) => (
                  <li key={it.text} className={`${it.done ? d.done : ""} ${it.isNew ? d.isNew : ""}`}>
                    <span className={`${d.circle} ${it.done ? d.ticked : ""}`} />{it.text}
                  </li>
                ))}
              </ul>
              {added.length > 0 && <div className={d.synced}>Updated on your iPhone too</div>}
            </section>
          </div>

          <div className={d.chat}>
            <div className={d.chatBar}><div className={d.lights}><i /><i /><i /></div><span>ChatGPT</span></div>
            <div className={d.msgs}>
              {!s && <p className={d.hint}>Ask anything about your notes.</p>}
              {s && step >= 2 && <div key={`q${scene}`} className={d.me}>{s.ask}</div>}
              {s && step === 3 && <div className={d.dotsTyping}><i /><i /><i /></div>}
              {s && step >= 4 && <div key={`a${scene}`} className={d.ai}><span className={d.tool}>Used Amber Notes</span>{s.answer}</div>}
            </div>
            <div className={d.input}><span>{typed || <em>Message</em>}</span>{step === 1 && <i className={d.caret} />}<b aria-hidden="true">↑</b></div>
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

const ic = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function Folder() { return <svg width="17" height="14" viewBox="0 0 17 14" {...ic}><path d="M1.5 3.5a1.5 1.5 0 0 1 1.5-1.5h3.2l1.5 1.6H14a1.5 1.5 0 0 1 1.5 1.5v6.4A1.5 1.5 0 0 1 14 13H3a1.5 1.5 0 0 1-1.5-1.5Z" /></svg>; }
function Trash() { return <svg width="17" height="15" viewBox="0 0 17 15" {...ic}><path d="M3 4h11M6.5 4V2.5h4V4M4.5 4l.7 9.5h6.6l.7-9.5" /></svg>; }
function Compose() { return <svg width="18" height="18" viewBox="0 0 18 18" {...ic}><path d="M8 3H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-4M13.5 2.5l2 2L9 11l-2.6.6L7 9Z" /></svg>; }
function Check() { return <svg width="20" height="18" viewBox="0 0 20 18" {...ic}><circle cx="4" cy="5" r="2.2" /><circle cx="4" cy="13" r="2.2" /><path d="M9 5h9M9 13h9" /></svg>; }
function Table() { return <svg width="19" height="16" viewBox="0 0 19 16" {...ic}><rect x="1.5" y="1.5" width="16" height="13" rx="2" /><path d="M1.5 6h16M1.5 10.5h16M7 1.5v13" /></svg>; }
function Clip() { return <svg width="16" height="18" viewBox="0 0 16 18" {...ic}><path d="M13 8.5 7.8 13.7a3.2 3.2 0 0 1-4.5-4.5L9 3.5a2.1 2.1 0 0 1 3 3l-5.6 5.6a1 1 0 0 1-1.5-1.5l5-5" /></svg>; }
function Share() { return <svg width="16" height="18" viewBox="0 0 16 18" {...ic}><path d="M5 6H3.5A1.5 1.5 0 0 0 2 7.5v8A1.5 1.5 0 0 0 3.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 12.5 6H11M8 1v10M5 4l3-3 3 3" /></svg>; }
function AppleMark() { return <svg width="12" height="14" viewBox="0 0 15 18" fill="currentColor" aria-hidden="true"><path d="M12.3 9.6c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.4.8-.7 0-1.8-.8-2.9-.8C3.2 4.6 1.8 5.4 1 6.8c-1.6 2.8-.4 6.9 1.1 9.1.8 1.1 1.7 2.3 2.8 2.3 1.1 0 1.6-.7 2.9-.7 1.4 0 1.7.7 2.9.7 1.2 0 2-1.1 2.7-2.2.9-1.3 1.2-2.5 1.2-2.6 0 0-2.3-.9-2.3-3.8zM10.1 3c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.6.6-1.1 1.6-.9 2.6.9.1 1.9-.5 2.5-1.2z" /></svg>; }
