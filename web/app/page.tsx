import type { Metadata } from "next";
import styles from "./home.module.css";
import Demo from "./Demo";
import DownloadLink from "./DownloadLink";
import { AiSection, AlsoLine, Closing, ImportSection, SyncSection } from "./Sections";

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
          <DownloadLink className={styles.primary}><AppleGlyph /> Download for Mac</DownloadLink>
          {APP_STORE_LIVE ? (
            <a className={styles.secondary} href={APP_STORE_URL}>Get it for iPhone</a>
          ) : (
            <span className={styles.secondary}>iPhone · coming soon</span>
          )}
        </div>
        <p className={`${styles.sync} rise`} {...rise(2)}><CloudGlyph /> Stored in the cloud, synced between Mac and iPhone as you type.</p>
      </section>

      <div className="rise-soft" {...rise(3)}><Demo /></div>

      <AiSection />
      <ImportSection />
      <AlsoLine />
      <SyncSection iphoneLive={APP_STORE_LIVE} />
      <Closing />
    </div>
  );
}

function CloudGlyph() {
  return (
    <svg width="18" height="13" viewBox="0 0 18 13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M4.6 12.2h9.1a3.4 3.4 0 0 0 .5-6.8A5 5 0 0 0 4.6 4.5a3.9 3.9 0 0 0 0 7.7Z" />
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
