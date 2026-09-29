import type { Metadata } from "next";
import styles from "./home.module.css";

const APP_STORE_LIVE = false; // Flip when the iPhone app is approved: apps.apple.com/app/id6817253103
const APP_STORE_URL = "https://apps.apple.com/app/id6817253103";
const GITHUB_URL = "https://github.com/emilwagman/amber-notes";

export const metadata: Metadata = {
  title: "Amber Notes: the notes app your AI can actually use",
  description:
    "As simple as the notes app you know. ChatGPT and Claude can read and update your notes, only when you say so. Free for Mac and iPhone.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "The notes app your AI can actually use",
    description: "Simple notes for Mac and iPhone that ChatGPT and Claude can read and update, with your approval.",
    url: "https://amber-notes.vercel.app",
    siteName: "Amber Notes",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <a className={styles.brand} href="/">
          <img src="/mark.png" alt="" width={28} height={28} />
          Amber Notes
        </a>
        <a className={styles.topLink} href={GITHUB_URL}>GitHub</a>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroText}>
            <img className={styles.heroIcon} src="/mark.png" alt="" width={72} height={72} />
            <h1 className={styles.h1}>The notes app your AI can actually use.</h1>
            <p className={styles.lede}>
              As simple as the notes app you know. ChatGPT and Claude can read and update it, only when you say so.
            </p>
            <div className={styles.ctas}>
              <a className={styles.primary} href="/download">
                <AppleGlyph /> Download for Mac
              </a>
              {APP_STORE_LIVE ? (
                <a className={styles.secondary} href={APP_STORE_URL}>Get it on the App Store</a>
              ) : (
                <span className={styles.secondary} aria-disabled="true">iPhone app coming soon</span>
              )}
            </div>
            <p className={styles.fine}>Free · macOS 26 and iOS 26 · Open source</p>
          </div>

          <figure className={styles.scene} aria-label="Asking an AI to add oat milk to the Groceries note">
            <div className={styles.request}>
              <span className={styles.requestLabel}>You, in ChatGPT</span>
              Add oat milk to my groceries
            </div>
            <div className={styles.phone}>
              <picture>
                <source srcSet="/hero-groceries-dark.jpg" media="(prefers-color-scheme: dark)" />
                <img src="/hero-groceries.jpg" alt="The Groceries note in Amber Notes, with Oat milk just added" width={720} height={1564} />
              </picture>
              <span className={styles.added} aria-hidden="true" />
            </div>
            <figcaption className={styles.caption}>It's on your phone before you put it down.</figcaption>
          </figure>
        </section>

        <section className={styles.pillars} aria-label="Why Amber Notes">
          <div>
            <h2>Feels familiar</h2>
            <p>Folders, checklists that tidy themselves, tables and photos. Nothing to learn.</p>
          </div>
          <div>
            <h2>Your AI can use it</h2>
            <p>ChatGPT and Claude can read and edit your notes. Changes show on every device in about a second.</p>
          </div>
          <div>
            <h2>Yours</h2>
            <p>You approve every AI connection, read-only or read and edit. No ads, no tracking, open source.</p>
          </div>
        </section>

        <section className={styles.steps} aria-labelledby="how">
          <h2 id="how" className={styles.h2}>Up and running in five minutes</h2>
          <ol>
            <li>
              <strong>Download</strong>
              <span>Free for Mac, and soon on the App Store for iPhone.</span>
            </li>
            <li>
              <strong>Bring your notes</strong>
              <span>Import from Apple Notes in one step, or start fresh.</span>
            </li>
            <li>
              <strong>Connect your AI</strong>
              <span>Paste one address into ChatGPT or Claude, then approve it in Amber Notes.</span>
            </li>
          </ol>
        </section>

        <section className={styles.privacy} aria-labelledby="privacy">
          <h2 id="privacy" className={styles.h2}>Private by design</h2>
          <ul>
            <li>An AI sees your notes only after you approve it in the app, and you can disconnect it at any time.</li>
            <li>Every change an AI makes keeps the previous version, so nothing is lost.</li>
            <li>No ads, no tracking, no analytics SDKs. Delete your account and everything in it from Settings.</li>
            <li>The whole app is open source, so anyone can check.</li>
          </ul>
          <p><a href="/privacy">Read the privacy policy</a></p>
        </section>
      </main>

      <footer className={styles.foot}>
        <a href={GITHUB_URL}>GitHub</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/support">Support</a>
        <span>Works with ChatGPT and Claude. Not affiliated with Apple, OpenAI or Anthropic.</span>
      </footer>
    </div>
  );
}

function AppleGlyph() {
  return (
    <svg width="15" height="18" viewBox="0 0 15 18" aria-hidden="true" fill="currentColor">
      <path d="M12.3 9.6c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.4.8-.7 0-1.8-.8-2.9-.8C3.2 4.6 1.8 5.4 1 6.8c-1.6 2.8-.4 6.9 1.1 9.1.8 1.1 1.7 2.3 2.8 2.3 1.1 0 1.6-.7 2.9-.7 1.4 0 1.7.7 2.9.7 1.2 0 2-1.1 2.7-2.2.9-1.3 1.2-2.5 1.2-2.6 0 0-2.3-.9-2.3-3.8zM10.1 3c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.6.6-1.1 1.6-.9 2.6.9.1 1.9-.5 2.5-1.2z" />
    </svg>
  );
}
