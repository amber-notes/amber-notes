import type { Metadata } from "next";
import styles from "./home.module.css";
import Demo from "./Demo";
import InView from "./InView";
import { AIGlyph } from "@/lib/ai-glyphs";

const APP_STORE_LIVE = false; // Flip when the iPhone app is approved.
const APP_STORE_URL = "https://apps.apple.com/app/id6817253103";

export const metadata: Metadata = {
  title: "Amber Notes: the notes app your AI can actually use",
  description:
    "As simple as the notes app you know. ChatGPT and Claude can read and update your notes, only when you say so. Free for Mac and iPhone.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "The notes app your AI can actually use",
    description: "Simple notes for Mac and iPhone that ChatGPT and Claude can read and update, with your approval. Free.",
    url: "https://amber-notes.vercel.app",
    siteName: "Amber Notes",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

const FEATURES: { icon: keyof typeof ICONS; title: string; line: string }[] = [
  { icon: "check", title: "Lists that tidy themselves", line: "Tick something off and it moves to the bottom." },
  { icon: "table", title: "Real tables", line: "Rows and columns, right inside a note." },
  { icon: "photo", title: "Photos and files", line: "Drop in pictures and PDFs. They sync too." },
  { icon: "shield", title: "No ads, no tracking", line: "Free and open source. Nothing is sold." },
];

const AIS: { name: string; glyph?: "openai" | "claude"; color: string }[] = [
  { name: "ChatGPT", glyph: "openai", color: "#0d0d0d" },
  { name: "Claude", glyph: "claude", color: "#d97757" },
  { name: "Claude Code", glyph: "claude", color: "#d97757" },
  { name: "Codex", glyph: "openai", color: "#0d0d0d" },
  { name: "Any MCP app", color: "#a85700" },
];

function Check() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>;
}

const PICKED = [
  { t: "Pasta night for eight", f: "Recipes" },
  { t: "Grandma's cardamom buns", f: "Recipes" },
  { t: "Porto in October", f: "Travel" },
  { t: "Packing list", f: "Travel" },
  { t: "Kitchen measurements", f: "Home" },
];
const FOLDERS = [{ name: "Recipes", n: 3 }, { name: "Travel", n: 3 }, { name: "Home", n: 3 }, { name: "Notes", n: 3 }];

/// The notes you pick in Apple Notes land in Amber Notes, sorted into the same folders. Drawn, not a screenshot.
function ImportVisual() {
  return (
    <InView className={styles.imp} label="Twelve notes picked in Apple Notes arrive in Amber Notes, in their folders">
      <div className={`${styles.impCard} ${styles.impFrom}`}>
        <p className={styles.impHead}>Apple Notes</p>
        <ul>{PICKED.map((n) => <li key={n.t}><i aria-hidden="true">✓</i><b>{n.t}</b></li>)}</ul>
        <p className={styles.impMore}>and 7 more</p>
      </div>
      <div className={styles.impArrow} aria-hidden="true">
        <span>12 notes</span>
        <svg viewBox="0 0 64 24" width="64" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h54M48 4l9 8-9 8" /></svg>
      </div>
      <div className={`${styles.impCard} ${styles.impTo}`}>
        <p className={styles.impHead}><img src="/mark.png" alt="" width={22} height={22} /> Amber Notes</p>
        <ul>{FOLDERS.map((f, i) => (
          <li key={f.name} style={{ "--k": i } as React.CSSProperties}>
            <FolderIcon /><b>{f.name}</b><em>{f.n}</em>
          </li>
        ))}</ul>
        <p className={styles.impDone}>Imported. Apple Notes is unchanged.</p>
      </div>
    </InView>
  );
}

function FolderIcon() {
  return <svg width="17" height="14" viewBox="0 0 17 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M1.5 3.5a1.5 1.5 0 0 1 1.5-1.5h3.2l1.5 1.6H14a1.5 1.5 0 0 1 1.5 1.5v6.4A1.5 1.5 0 0 1 14 13H3a1.5 1.5 0 0 1-1.5-1.5Z" /></svg>;
}

const rise = (i: number) => ({ style: { "--i": i } as React.CSSProperties });

export default function Home() {
  return (
    <div className={styles.main}>
      <section className={styles.hero}>
        <h1 className={`${styles.h1} rise`} {...rise(0)}>
          The notes app <mark className={styles.mark}>your AI</mark> can actually use.
        </h1>
        <p className={`${styles.lede} rise`} {...rise(1)}>
          Import your Apple Notes. Connect ChatGPT, Claude, Claude Code or Codex.
        </p>
        <div className={`${styles.ctas} rise`} {...rise(2)}>
          <a className={styles.primary} href="/download"><AppleGlyph /> Download for Mac</a>
          {APP_STORE_LIVE ? (
            <a className={styles.secondary} href={APP_STORE_URL}>Get it for iPhone</a>
          ) : (
            <span className={styles.secondary}>iPhone · coming soon</span>
          )}
        </div>
      </section>

      <div className="rise-soft" {...rise(3)}><Demo /></div>

      <section className={styles.aiSection} aria-labelledby="ai">
        <div className={styles.aiHead}>
          <h2 id="ai" className={styles.h2}>Works with the AI you already use</h2>
          <p className={styles.lede}>
            Connect ChatGPT, Claude, Claude Code, Codex or any app that supports MCP. You approve each one, and you can disconnect it anytime.
          </p>
        </div>
        <ul className={styles.strip} aria-label="Works with">
          {AIS.map((a) => (
            <li key={a.name}>
              <span className={styles.stripMark} style={{ color: a.color }}>
                {a.glyph ? <AIGlyph name={a.glyph} size={22} /> : <span className={styles.aiAny}>MCP</span>}
              </span>
              <strong>{a.name}</strong>
            </li>
          ))}
        </ul>
        <ul className={styles.promises}>
          <li><Check /> You approve every AI.</li>
          <li><Check /> Disconnect anytime.</li>
          <li><Check /> Changes reach your phone in a second.</li>
        </ul>
      </section>

      <section className={`${styles.split} ${styles.flip}`} aria-labelledby="import">
        <div className={styles.splitText}>
          <h2 id="import" className={styles.h2}>Bring all your Apple Notes in one click</h2>
          <p className={styles.lede}>
            Pick everything, or just the notes you want. Folders, checklists and tables come along. Your Apple Notes stay untouched.
          </p>
        </div>
        <ImportVisual />
      </section>

      <section className={styles.features} aria-label="What else you get">
        {FEATURES.map((f) => (
          <div key={f.title} className={styles.feature}>
            <span className={styles.icon} aria-hidden="true">{ICONS[f.icon]}</span>
            <h2>{f.title}</h2>
            <p>{f.line}</p>
          </div>
        ))}
      </section>

      <section className={styles.closing} aria-labelledby="closing">
        <h2 id="closing" className={styles.closingTitle}>Your notes deserve better than copy and paste.</h2>
        <p className={styles.lede}>Amber Notes is free and open source. Import your Apple Notes, connect your AI, and get back to writing.</p>
        <div className={styles.ctas}>
          <a className={styles.primary} href="/download"><AppleGlyph /> Download for Mac</a>
          {APP_STORE_LIVE ? (
            <a className={styles.outline} href={APP_STORE_URL}>Get it for iPhone</a>
          ) : (
            <span className={styles.outline}>iPhone · coming soon</span>
          )}
        </div>
        <p className={styles.fine}>Requires macOS 26. Updates install themselves.</p>
      </section>
    </div>
  );
}

function AppleGlyph() {
  return (
    <svg width="14" height="17" viewBox="0 0 15 18" aria-hidden="true" fill="currentColor">
      <path d="M12.3 9.6c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.4.8-.7 0-1.8-.8-2.9-.8C3.2 4.6 1.8 5.4 1 6.8c-1.6 2.8-.4 6.9 1.1 9.1.8 1.1 1.7 2.3 2.8 2.3 1.1 0 1.6-.7 2.9-.7 1.4 0 1.7.7 2.9.7 1.2 0 2-1.1 2.7-2.2.9-1.3 1.2-2.5 1.2-2.6 0 0-2.3-.9-2.3-3.8zM10.1 3c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.6.6-1.1 1.6-.9 2.6.9.1 1.9-.5 2.5-1.2z" />
    </svg>
  );
}

const s = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const ICONS = {
  check: <svg viewBox="0 0 48 48" {...s}><circle cx="13" cy="14" r="5" /><path d="M22 14h16M22 34h16" /><circle cx="13" cy="34" r="5" /><path d="m10.5 34 2 2 3.5-4" /></svg>,
  table: <svg viewBox="0 0 48 48" {...s}><rect x="7" y="10" width="34" height="28" rx="4" /><path d="M7 19h34M7 28h34M20 10v28" /></svg>,
  photo: <svg viewBox="0 0 48 48" {...s}><rect x="7" y="10" width="34" height="28" rx="4" /><circle cx="17" cy="19" r="3" /><path d="m7 33 10-9 8 7 5-4 11 9" /></svg>,
  shield: <svg viewBox="0 0 48 48" {...s}><path d="M24 6 9 12v11c0 9 6.5 16 15 19 8.5-3 15-10 15-19V12Z" /><path d="m17 24 5 5 9-10" /></svg>,
};
