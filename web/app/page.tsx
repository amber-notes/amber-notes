import type { Metadata } from "next";
import styles from "./home.module.css";
import Demo from "./Demo";
import { latestVersion } from "@/lib/changelog";

const APP_STORE_LIVE = false; // Flip when the iPhone app is approved.
const APP_STORE_URL = "https://apps.apple.com/app/id6817253103";
const GITHUB_URL = "https://github.com/emilwagman/amber-notes";

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

export default function Home() {
  const version = latestVersion();
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <a className={styles.brand} href="/">
          <img src="/mark.png" alt="" width={30} height={30} />
          Amber Notes
          {version && <span className={styles.badge}>v{version}</span>}
        </a>
        <nav className={styles.nav}>
          <a href="/changelog">Changelog</a>
          <a href="/support">Help</a>
          <a className={styles.navCta} href="/download"><AppleGlyph /> Download</a>
        </nav>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <h1 className={styles.h1}>
            The notes app <mark className={styles.mark}>your AI</mark> can actually use.
          </h1>
          <p className={styles.lede}>
            As simple as the notes app you know. ChatGPT and Claude can read and update it, only when you say so.
          </p>
          <div className={styles.ctas}>
            <a className={styles.primary} href="/download"><AppleGlyph /> Download for Mac</a>
            {APP_STORE_LIVE ? (
              <a className={styles.secondary} href={APP_STORE_URL}>Get it for iPhone</a>
            ) : (
              <span className={styles.secondary}>iPhone · coming soon</span>
            )}
          </div>
        </section>

        <Demo />

        <section className={styles.features} aria-label="What you get">
          {FEATURES.map((f) => (
            <div key={f.title} className={styles.feature}>
              <span className={styles.icon} aria-hidden="true">{ICONS[f.icon]}</span>
              <h2>{f.title}</h2>
            </div>
          ))}
        </section>

        <section className={styles.free}>
          <h2 className={styles.h2}>Free. And it stays that way.</h2>
          <p className={styles.lede}>
            No subscription, no ads, nothing sold. Amber Notes is open source, so anyone can see exactly what it does with your notes.
          </p>
          <a className={styles.link} href={GITHUB_URL}>See it on GitHub</a>
        </section>

        <section className={styles.last}>
          <a className={styles.primary} href="/download"><AppleGlyph /> Download for Mac</a>
        </section>
      </main>

      <footer className={styles.foot}>
        <nav>
          <a href="/changelog">Changelog</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/support">Help</a>
          <a href={GITHUB_URL}>GitHub</a>
        </nav>
        <p>Works with ChatGPT and Claude. Not affiliated with Apple, OpenAI or Anthropic.</p>
        <div className={styles.wordmark} aria-hidden="true">Amber Notes</div>
      </footer>
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
  chat: <svg viewBox="0 0 48 48" {...s}><path d="M8 12a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H20l-8 7v-7a4 4 0 0 1-4-4Z" /><circle cx="18" cy="20" r="1.6" fill="currentColor" /><circle cx="24" cy="20" r="1.6" fill="currentColor" /><circle cx="30" cy="20" r="1.6" fill="currentColor" /></svg>,
  bolt: <svg viewBox="0 0 48 48" {...s}><path d="M27 5 11 27h12l-3 16 17-23H25Z" /></svg>,
  check: <svg viewBox="0 0 48 48" {...s}><circle cx="13" cy="14" r="5" /><path d="M22 14h16M22 34h16" /><circle cx="13" cy="34" r="5" /><path d="m10.5 34 2 2 3.5-4" /></svg>,
  table: <svg viewBox="0 0 48 48" {...s}><rect x="7" y="10" width="34" height="28" rx="4" /><path d="M7 19h34M7 28h34M20 10v28" /></svg>,
  photo: <svg viewBox="0 0 48 48" {...s}><rect x="7" y="10" width="34" height="28" rx="4" /><circle cx="17" cy="19" r="3" /><path d="m7 33 10-9 8 7 5-4 11 9" /></svg>,
  import: <svg viewBox="0 0 48 48" {...s}><path d="M14 8h14l8 8v24a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z" /><path d="M24 20v14M18 28l6 6 6-6" /></svg>,
  key: <svg viewBox="0 0 48 48" {...s}><circle cx="16" cy="24" r="7" /><path d="M23 24h18M35 24v6M40 24v4" /></svg>,
  shield: <svg viewBox="0 0 48 48" {...s}><path d="M24 6 9 12v11c0 9 6.5 16 15 19 8.5-3 15-10 15-19V12Z" /><path d="m17 24 5 5 9-10" /></svg>,
};
