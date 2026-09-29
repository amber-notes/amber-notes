import type { Metadata } from "next";
import styles from "./home.module.css";
import Demo from "./Demo";
import { GITHUB_URL, recentCommits } from "@/lib/github";

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

const FEATURES: { icon: keyof typeof ICONS; title: string }[] = [
  { icon: "chat", title: "Works with ChatGPT and Claude" },
  { icon: "bolt", title: "Updates in a second" },
  { icon: "check", title: "Lists that tidy themselves" },
  { icon: "table", title: "Real tables" },
  { icon: "photo", title: "Photos and files" },
  { icon: "import", title: "Bring your Apple Notes" },
  { icon: "key", title: "You approve every AI" },
  { icon: "shield", title: "No ads, no tracking" },
];

export default async function Home() {
  const commits = await recentCommits(3);
  return (
    <div className={styles.main}>
      <section className={styles.hero}>
        <h1 className={`${styles.h1} rise`} style={{ "--i": 0 } as React.CSSProperties}>
          The notes app <mark className={styles.mark}>your AI</mark> can actually use.
        </h1>
        <p className={`${styles.lede} rise`} style={{ "--i": 1 } as React.CSSProperties}>
          As simple as the notes app you know. ChatGPT and Claude can read and update it, only when you say so.
        </p>
        <div className={`${styles.ctas} rise`} style={{ "--i": 2 } as React.CSSProperties}>
          <a className={styles.primary} href="/download"><AppleGlyph /> Download for Mac</a>
          {APP_STORE_LIVE ? (
            <a className={styles.secondary} href={APP_STORE_URL}>Get it for iPhone</a>
          ) : (
            <span className={styles.secondary}>iPhone · coming soon</span>
          )}
        </div>
      </section>

      <div className="rise-soft" style={{ "--i": 3 } as React.CSSProperties}><Demo /></div>

      <section className={styles.features} aria-label="What you get">
        {FEATURES.map((f) => (
          <div key={f.title} className={styles.feature}>
            <span className={styles.icon} aria-hidden="true">{ICONS[f.icon]}</span>
            <h2>{f.title}</h2>
          </div>
        ))}
      </section>

      <section className={styles.open} aria-labelledby="open">
        <div className={styles.openHead}>
          <h2 id="open" className={styles.h2}>Built in the open</h2>
          <p className={styles.lede}>
            Amber Notes is free and open source (MIT). Read the code, see exactly how your notes are stored, and help make it better.
          </p>
        </div>
        <div className={styles.ways}>
          <a className={styles.way} href={`${GITHUB_URL}/issues/new/choose`}>
            <strong>Report a bug</strong>
            <span>Something broken or odd? Tell us what happened and we'll look into it.</span>
          </a>
          <a className={styles.way} href={`${GITHUB_URL}/issues/new/choose`}>
            <strong>Suggest an idea</strong>
            <span>What would make your notes better? Ideas are welcome, big or small.</span>
          </a>
          <a className={styles.way} href={`${GITHUB_URL}/blob/main/CONTRIBUTING.md`}>
            <strong>Fix something small</strong>
            <span>Setup takes about 10 minutes. Small, focused fixes are the most likely to be merged.</span>
          </a>
        </div>
        {commits.length > 0 && (
          <div className={styles.recent}>
            <p className={styles.recentLabel}>Recently changed</p>
            <ul>
              {commits.map((c) => (
                <li key={c.url}><a href={c.url}>{c.title}</a></li>
              ))}
            </ul>
          </div>
        )}
        <a className={styles.primary} href={GITHUB_URL}><GitHubMark /> View on GitHub</a>
      </section>

      <section className={styles.last}>
        <a className={styles.primary} href="/download"><AppleGlyph /> Download for Mac</a>
      </section>
    </div>
  );
}

function GitHubMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
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
  chat: <svg viewBox="0 0 48 48" {...s}><path d="M8 12a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H20l-8 7v-7a4 4 0 0 1-4-4Z" /><circle cx="18" cy="20" r="1.6" fill="currentColor" /><circle cx="24" cy="20" r="1.6" fill="currentColor" /><circle cx="30" cy="20" r="1.6" fill="currentColor" /></svg>,
  bolt: <svg viewBox="0 0 48 48" {...s}><path d="M27 5 11 27h12l-3 16 17-23H25Z" /></svg>,
  check: <svg viewBox="0 0 48 48" {...s}><circle cx="13" cy="14" r="5" /><path d="M22 14h16M22 34h16" /><circle cx="13" cy="34" r="5" /><path d="m10.5 34 2 2 3.5-4" /></svg>,
  table: <svg viewBox="0 0 48 48" {...s}><rect x="7" y="10" width="34" height="28" rx="4" /><path d="M7 19h34M7 28h34M20 10v28" /></svg>,
  photo: <svg viewBox="0 0 48 48" {...s}><rect x="7" y="10" width="34" height="28" rx="4" /><circle cx="17" cy="19" r="3" /><path d="m7 33 10-9 8 7 5-4 11 9" /></svg>,
  import: <svg viewBox="0 0 48 48" {...s}><path d="M14 8h14l8 8v24a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z" /><path d="M24 20v14M18 28l6 6 6-6" /></svg>,
  key: <svg viewBox="0 0 48 48" {...s}><circle cx="16" cy="24" r="7" /><path d="M23 24h18M35 24v6M40 24v4" /></svg>,
  shield: <svg viewBox="0 0 48 48" {...s}><path d="M24 6 9 12v11c0 9 6.5 16 15 19 8.5-3 15-10 15-19V12Z" /><path d="m17 24 5 5 9-10" /></svg>,
};
