"use client";

// The home page sections below the demo. Each one is complete at rest; the first time it scrolls into
// view it plays once (reduced motion: it stays complete and still).

import { useEffect, useRef, useState } from "react";
import { AIGlyph } from "@/lib/ai-glyphs";
import { CLAUDE_DIRECTORY_URL } from "@/lib/facts";
import { HOME_PRIVACY, PRIVACY_PATH } from "@/lib/privacy";
import DownloadLink from "./DownloadLink";
import PlatformInterest from "./PlatformInterest";
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
      <p className={a.also}>Also Codex, <a href="https://incredible.one" rel="noopener">Incredible</a>, and any app that supports MCP. <a href={CLAUDE_DIRECTORY_URL} rel="noopener">Available in Claude&apos;s connector directory</a> · <a href="/blog/connect-chatgpt-to-your-notes">How to connect</a> · <a href="/templates">Start from a template</a></p>
    </section>
  );
}

/* ───────────── Bring all your Apple Notes over in one go ───────────── */

const FOLDERS = [{ name: "Notes", n: 612 }, { name: "Recipes", n: 188 }, { name: "Work", n: 241 }, { name: "Travel", n: 97 }, { name: "Home", n: 146 }];
const TOTAL = FOLDERS.reduce((s, f) => s + f.n, 0); // 1,284
const PINNED = 12;

/// The import, run once: a thin amber bar fills while folders count up; then the total.
export function ImportSection() {
  const [ref, seen] = useFirstView<HTMLElement>(0.45);
  const [p, setP] = useState(1); // complete at rest
  useEffect(() => {
    if (!seen || reduce()) return;
    let raf = 0, start = 0;
    const tick = (now: number) => {
      if (!start) start = now + 250;
      const t = Math.max(0, Math.min(1, (now - start) / 3600));
      setP(1 - Math.pow(1 - t, 3));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    setP(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen]);
  const full = p >= 1;
  const count = (n: number, k: number, of: number) => Math.round(Math.max(0, Math.min(1, (p - k / of) * of)) * n);

  return (
    <section ref={ref} className={a.section} aria-labelledby="import">
      <div className={a.head}>
        <h2 id="import" className={a.h2}>Bring all your Apple Notes over in one go</h2>
        <p className={a.lede}>If you know Apple Notes, you already know Amber Notes.</p>
        <p className={a.lede}>
          Pick everything, or just the notes you want. Folders, checklists and tables come along, pins too if you allow Full Disk Access, and your Apple Notes stay untouched.
          Import on your Mac. Everything's on your iPhone a second later.
        </p>
        <p className={a.lede}>Your notes live in the cloud and sync between iPhone and Mac.</p>
      </div>
      <div className={a.run} aria-label={`Imported ${TOTAL.toLocaleString("en")} notes from Apple Notes, with ${PINNED} pinned. Folders kept, Apple Notes unchanged.`}>
        <p className={a.runTitle} aria-hidden="true">
          <img src="/apple-notes.webp" alt="" width={30} height={30} />
          {full ? "Imported from Apple Notes" : "Importing from Apple Notes…"}
        </p>
        <div className={a.bar} aria-hidden="true">
          <i style={{ transform: `scaleX(${p})` }} />
          <span className={a.barDone} data-on={full || undefined}><Tick /></span>
        </div>
        <ul className={a.folders} aria-hidden="true">
          {FOLDERS.map((f, k) => (
            <li key={f.name} data-on={p > k / (FOLDERS.length + 1) || undefined}>
              <FolderIcon /><b>{f.name}</b><span className={a.num}>{count(f.n, k, FOLDERS.length + 1).toLocaleString("en")}</span>
            </li>
          ))}
          <li data-on={p > FOLDERS.length / (FOLDERS.length + 1) || undefined} className={a.pinned}>
            <PinIcon /><b>Pinned</b><span className={a.num}>{count(PINNED, FOLDERS.length, FOLDERS.length + 1)}</span>
          </li>
        </ul>
        <div className={a.runEnd} data-on={full || undefined} aria-hidden="true">
          <p className={a.big}><span className={a.num}>{TOTAL.toLocaleString("en")}</span> notes</p>
          <ul className={a.ticks}><li><Tick /> Folders kept</li><li><Tick /> Apple Notes unchanged</li></ul>
        </div>
      </div>
    </section>
  );
}

function FolderIcon() {
  return <svg width="17" height="14" viewBox="0 0 17 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M1.5 3.5a1.5 1.5 0 0 1 1.5-1.5h3.2l1.5 1.6H14a1.5 1.5 0 0 1 1.5 1.5v6.4A1.5 1.5 0 0 1 14 13H3a1.5 1.5 0 0 1-1.5-1.5Z" /></svg>;
}
function PinIcon() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M10.2 1.3a1 1 0 0 1 1.4 0l3.1 3.1a1 1 0 0 1 0 1.4l-1 1a1 1 0 0 1-1 .25l-2.1 2.1.3 2.3a1 1 0 0 1-.3.85l-.7.7a.8.8 0 0 1-1.1 0L6.3 10.5 2.6 14.2a.6.6 0 0 1-.85-.85L5.5 9.7 3 7.2a.8.8 0 0 1 0-1.1l.7-.7a1 1 0 0 1 .85-.3l2.3.3 2.1-2.1a1 1 0 0 1 .25-1Z" /></svg>;
}

/* ───────────── The rest, in one line ───────────── */

export function AlsoLine() {
  return (
    <ul className={a.alsoTicks} aria-label="Also">
      <li><Tick /> Lists that tidy themselves</li><li><Tick /> Real tables</li><li><Tick /> Photos and files</li><li><Tick /> No ads, no tracking in the app</li>
    </ul>
  );
}

/* ───────────── Private by design: one claim, a brass lock ───────────── */

/// Stand-in ciphertext: as long as the text, with no word breaks left, and the same on the server and in the browser.
function cipher(text: string, seed: number) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let h = (seed * 2654435761) >>> 0;
  return [...text].map((ch, i) => {
    h = Math.imul(h ^ (ch.charCodeAt(0) + i), 2246822507) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return abc[h % 64];
  }).join("");
}
const WALL = Array.from({ length: 22 }, (_, i) => cipher("Lisbon, 4 days in May. Day 3: Sintra. Dinner at Trindade. Pack light. Groceries: oat milk, lemons, bread. Standup: ship the import, fix the share link, plan Friday.", i + 3));

export function PrivacySection() {
  const v = HOME_PRIVACY;
  const [ref, seen] = useFirstView<HTMLElement>();
  // Complete at rest. With motion allowed, the shackle waits open (off screen) and settles closed on first view.
  const [shut, setShut] = useState(true);
  useEffect(() => { if (!reduce()) setShut(false); }, []);
  useEffect(() => {
    if (!seen) return;
    const t = window.setTimeout(() => setShut(true), 180);
    return () => clearTimeout(t);
  }, [seen]);
  return (
    <section ref={ref} className={a.vault} aria-labelledby="privacy">
      <div className={a.cipherWall} aria-hidden="true">{WALL.map((l, i) => <p key={i}>{l}</p>)}</div>
      <div className={a.vaultText}>
        <p className={a.eyebrow}>{v.eyebrow}</p>
        <h2 id="privacy" className={a.vaultTitle}>{v.title}</h2>
        <p className={a.vaultLede}>{v.text}</p>
        <a className={a.vaultLink} href={PRIVACY_PATH}>{v.link.replace(/ \S+$/, " ")}<span className={a.nowrap}>{v.link.split(" ").pop()}<Arrow /></span></a>
      </div>
      <div className={a.lock} data-shut={shut || undefined} aria-hidden="true"><Padlock /></div>
    </section>
  );
}

const Arrow = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>;

/// A brass padlock on a 160 x 200 grid: a 12-unit shackle over a 116 x 96 body with 24-unit corners,
/// the keyhole a little below centre.
const SHACKLE = "M52 98V64a28 28 0 0 1 56 0v34";
const KEYHOLE = "M80 117a10.5 10.5 0 0 1 5.6 19.4l2.2 14.6a3 3 0 0 1-3 3.5h-9.6a3 3 0 0 1-3-3.5l2.2-14.6A10.5 10.5 0 0 1 80 117Z";
function Padlock() {
  return (
    <svg viewBox="0 0 160 200">
      <defs>
        <linearGradient id="brassBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd28a" /><stop offset="0.18" stopColor="#f5b04a" />
          <stop offset="0.62" stopColor="#dc8a1e" /><stop offset="1" stopColor="#a65a0c" />
        </linearGradient>
        <linearGradient id="brassBevel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3d6" stopOpacity="0.9" /><stop offset="0.25" stopColor="#fff3d6" stopOpacity="0" />
          <stop offset="0.8" stopColor="#5a2e04" stopOpacity="0" /><stop offset="1" stopColor="#5a2e04" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id="brassShackle" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8a5a1e" /><stop offset="0.3" stopColor="#ffe2ab" />
          <stop offset="0.55" stopColor="#d9a24e" /><stop offset="1" stopColor="#6e420e" />
        </linearGradient>
        <radialGradient id="brassSheen" cx="0.3" cy="0.12" r="0.6">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="brassHole" cx="0.5" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#3a1f08" /><stop offset="1" stopColor="#140800" />
        </radialGradient>
        <clipPath id="brassClip"><rect x="22" y="88" width="116" height="96" rx="24" /></clipPath>
        <filter id="brassSoft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" /></filter>
      </defs>
      <g className={a.shackle}>
        <path d={SHACKLE} fill="none" stroke="#3b2510" strokeWidth="14" strokeLinecap="round" />
        <path d={SHACKLE} fill="none" stroke="url(#brassShackle)" strokeWidth="11" strokeLinecap="round" />
        <path d={SHACKLE} fill="none" stroke="#fff6e6" strokeOpacity="0.5" strokeWidth="1.4" strokeLinecap="round" transform="translate(-1.8 -0.8)" />
      </g>
      <rect x="22" y="88" width="116" height="96" rx="24" fill="url(#brassBody)" />
      <g clipPath="url(#brassClip)">
        {/* a soft shadow inside the lower edge, and a sheen on the upper left */}
        <rect x="22" y="88" width="116" height="96" rx="24" fill="none" stroke="#6b3604" strokeOpacity="0.5" strokeWidth="8" filter="url(#brassSoft)" transform="translate(0 -4)" />
        <ellipse cx="62" cy="96" rx="58" ry="26" fill="url(#brassSheen)" />
      </g>
      <rect x="22.75" y="88.75" width="114.5" height="94.5" rx="23.25" fill="none" stroke="url(#brassBevel)" strokeWidth="1.5" />
      <path d={KEYHOLE} fill="#ffe2ae" fillOpacity="0.55" transform="translate(0 1.4)" />
      <path d={KEYHOLE} fill="url(#brassHole)" />
    </svg>
  );
}

/* ───────────── The ending ───────────── */

const Apple = () => <svg width="14" height="17" viewBox="0 0 15 18" aria-hidden="true" fill="currentColor"><path d="M12.3 9.6c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.4.8-.7 0-1.8-.8-2.9-.8C3.2 4.6 1.8 5.4 1 6.8c-1.6 2.8-.4 6.9 1.1 9.1.8 1.1 1.7 2.3 2.8 2.3 1.1 0 1.6-.7 2.9-.7 1.4 0 1.7.7 2.9.7 1.2 0 2-1.1 2.7-2.2.9-1.3 1.2-2.5 1.2-2.6 0 0-2.3-.9-2.3-3.8zM10.1 3c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.6.6-1.1 1.6-.9 2.6.9.1 1.9-.5 2.5-1.2z" /></svg>;

export function Closing() {
  return (
    <section className={a.band} aria-labelledby="closing">
      <div className={a.bandInner}>
        <img src="/mark-256.png" alt="" width={96} height={96} className={a.bandIcon} />
        <h2 id="closing" className={a.bandTitle}>Your notes deserve better than copy and paste.</h2>
        <p className={a.bandLede}>Free and open source, with no ads and no tracking in the app. Import your Apple Notes, connect your AI, and get back to writing.</p>
        <div className={`${a.bandCtas} pi-apple pi-not-ios`}>
          <DownloadLink className={a.bandPrimary}><Apple /> Download for Mac</DownloadLink>
          <span className={a.bandSecondary}>iPhone · coming soon</span>
        </div>
        <PlatformInterest place="band" />
        <p className={`${a.bandFine} pi-apple pi-not-ios`}>Requires macOS 26. Updates install themselves.</p>
      </div>
    </section>
  );
}
