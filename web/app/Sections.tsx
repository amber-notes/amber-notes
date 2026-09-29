"use client";

// The home page sections below the demo. Each one is complete at rest; the first time it scrolls into
// view it plays once (reduced motion: it stays complete and still).

import { useEffect, useRef, useState } from "react";
import { AIGlyph } from "@/lib/ai-glyphs";
import DownloadLink from "./DownloadLink";
import AiTiles from "./AiTiles";
import { Wallpaper } from "./Demo";
import a from "./sections.module.css";

const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/// True once, the first time the element is mostly on screen.
function useFirstView<T extends HTMLElement>(threshold = 0.5) {
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

const Tick = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>;

/* ───────────── Works with the AI you already use ───────────── */

type Job = { app: string; glyph: "openai" | "claude"; kind: "phone" | "desk" | "term"; ask: string; note: string; did: string };
const JOBS: Job[] = [
  { app: "ChatGPT", glyph: "openai", kind: "phone", ask: "Add oat milk to groceries", note: "Groceries", did: "1 line added" },
  { app: "Claude", glyph: "claude", kind: "desk", ask: "Turn my Lisbon notes into a packing list", note: "New note", did: "Packing list" },
  { app: "Claude Code", glyph: "claude", kind: "term", ask: "Write today's standup into my notes", note: "Standup notes", did: "6 lines" },
];

/// Three different jobs in three apps, each a request and what landed in Amber Notes.
export function AiSection() {
  const [option, setOption] = useState(0); // review only: ?ai=1..3
  useEffect(() => { const v = Number(new URLSearchParams(location.search).get("ai")); if (v >= 1 && v <= 3) setOption(v); }, []);
  const [ref, seen] = useFirstView<HTMLElement>();
  // Per card: how much of the request is typed, and whether the result is in. At rest: all complete.
  const [typed, setTyped] = useState(JOBS.map((j) => j.ask.length));
  const [done, setDone] = useState(JOBS.map(() => true));
  useEffect(() => {
    if (!seen || reduce()) return;
    setTyped(JOBS.map(() => 0)); setDone(JOBS.map(() => false));
    const ts: number[] = [];
    JOBS.forEach((j, k) => {
      const start = 250 + k * 700;
      for (let n = 1; n <= j.ask.length; n++) ts.push(window.setTimeout(() => setTyped((t) => t.map((v, i) => (i === k ? n : v))), start + n * 28));
      ts.push(window.setTimeout(() => setDone((d) => d.map((v, i) => (i === k ? true : v))), start + j.ask.length * 28 + 650));
    });
    return () => ts.forEach(clearTimeout);
  }, [seen]);

  if (option) return <AiTiles option={option as 1 | 2 | 3} />;
  return (
    <section ref={ref} className={a.section} aria-labelledby="ai">
      <div className={a.head}>
        <h2 id="ai" className={a.h2}>Works with the AI you already use</h2>
        <p className={a.lede}>Ask in the app you already use. The change lands in your notes, on every device.</p>
      </div>
      <div className={a.jobs}>
        {JOBS.map((j, k) => {
          const text = j.ask.slice(0, typed[k]);
          const typing = typed[k] < j.ask.length;
          return (
            <figure key={j.app} className={`${a.job} ${a[j.kind]}`} aria-label={`${j.app}: ${j.ask}. Result: ${j.note}, ${j.did}.`}>
              <figcaption className={a.jobBar} aria-hidden="true">
                {j.kind !== "phone" && <span className={a.lights}><i /><i /><i /></span>}
                <span className={a.jobApp}><AIGlyph name={j.glyph} size={13} />{j.app}</span>
              </figcaption>
              <div className={a.jobBody} aria-hidden="true">
                {j.kind === "term" ? (
                  <>
                    <p className={a.prompt}><span className={a.promptMark}>›</span>{text}{typing && <i className={a.caret} />}</p>
                    <p className={a.call} data-on={done[k] || undefined}><span>⏺</span> amber-notes · update_note</p>
                    <p className={a.termResult} data-on={done[k] || undefined}><Tick /> {j.note} · {j.did}</p>
                  </>
                ) : (
                  <>
                    <p className={a.bubble} data-on={typed[k] > 0 || undefined}>{text}{typing && <i className={a.caretDark} />}</p>
                    <p className={a.chip} data-on={done[k] || undefined}><Tick /> <b>{j.note}</b> · {j.did}</p>
                  </>
                )}
              </div>
            </figure>
          );
        })}
      </div>
      <p className={a.also}>Also Codex, and any app that supports MCP.</p>
    </section>
  );
}

/* ───────────── Bring all your Apple Notes in one click ───────────── */

/// The app's real import sheet (captured with a made-up library): ready, with every note picked; the
/// first time it's in view, Import is pressed and it fades to the sheet mid-import. The new frame
/// fades in over the old one, which stays opaque underneath.
export function ImportSection() {
  const [ref, seen] = useFirstView<HTMLElement>(0.55);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    if (!seen || reduce()) return;
    const t = window.setTimeout(() => setImporting(true), 900);
    return () => window.clearTimeout(t);
  }, [seen]);

  return (
    <section ref={ref} className={`${a.section} ${a.importSplit}`} aria-labelledby="import">
      <div className={a.head}>
        <h2 id="import" className={a.h2}>Bring all your Apple Notes in one click</h2>
        <p className={a.lede}>If you know Apple Notes, you already know Amber Notes.</p>
        <p className={a.lede}>
          Pick everything, or just the notes you want. Folders, checklists, tables and pins come along, and your Apple Notes stay untouched.
        </p>
        <p className={a.lede}>Import on your Mac. Everything's on your iPhone a second later.</p>
      </div>
      <figure className={a.sheetDesk}>
        <Wallpaper />
        <div className={a.sheet}>
          <img src="/import/sheet-ready.webp" width={540} height={640} alt="Amber Notes' Import from Apple Notes sheet, with all 1,284 notes picked and Import 1,284 Notes ready" draggable={false} />
          <img src="/import/sheet-importing.webp" width={540} height={640} alt="" aria-hidden="true" draggable={false} className={a.sheetNext} data-on={importing || undefined} />
        </div>
      </figure>
    </section>
  );
}

/* ───────────── The rest, in one line ───────────── */

export function AlsoLine() {
  return (
    <ul className={a.alsoTicks} aria-label="Also">
      <li><Tick /> Lists that tidy themselves</li><li><Tick /> Real tables</li><li><Tick /> Photos and files</li><li><Tick /> No ads, no tracking</li>
    </ul>
  );
}

/* ───────────── The ending ───────────── */

const Apple = () => <svg width="14" height="17" viewBox="0 0 15 18" aria-hidden="true" fill="currentColor"><path d="M12.3 9.6c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.4.8-.7 0-1.8-.8-2.9-.8C3.2 4.6 1.8 5.4 1 6.8c-1.6 2.8-.4 6.9 1.1 9.1.8 1.1 1.7 2.3 2.8 2.3 1.1 0 1.6-.7 2.9-.7 1.4 0 1.7.7 2.9.7 1.2 0 2-1.1 2.7-2.2.9-1.3 1.2-2.5 1.2-2.6 0 0-2.3-.9-2.3-3.8zM10.1 3c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.6.6-1.1 1.6-.9 2.6.9.1 1.9-.5 2.5-1.2z" /></svg>;

export function Closing() {
  return (
    <section className={a.band} aria-labelledby="closing">
      <div className={a.bandInner}>
        <img src="/mark.png" alt="" width={96} height={96} className={a.bandIcon} />
        <h2 id="closing" className={a.bandTitle}>Your notes deserve better than copy and paste.</h2>
        <p className={a.bandLede}>Free and open source, with no ads and no tracking. Import your Apple Notes, connect your AI, and get back to writing.</p>
        <div className={a.bandCtas}>
          <DownloadLink className={a.bandPrimary}><Apple /> Download for Mac</DownloadLink>
          <span className={a.bandSecondary}>iPhone · coming soon</span>
        </div>
        <p className={a.bandFine}>Requires macOS 26. Updates install themselves.</p>
      </div>
    </section>
  );
}
