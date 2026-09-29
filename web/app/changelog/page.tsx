import type { Metadata } from "next";
import styles from "../home.module.css";
import { changelog } from "@/lib/changelog";

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "Changelog · Amber Notes",
  description: "What's new in each version of Amber Notes.",
  robots: { index: true, follow: true },
};

export default function Changelog() {
  const releases = changelog();
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <a className={styles.brand} href="/">
          <img src="/mark.png" alt="" width={30} height={30} />
          Amber Notes
        </a>
        <nav className={styles.nav}>
          <a href="/support">Help</a>
          <a className={styles.navCta} href="/download">Download</a>
        </nav>
      </header>
      <main className={styles.main}>
        <section className={styles.log}>
          <div className={styles.logHead}>
            <h1 className={styles.h2}>Changelog</h1>
            <p className={styles.lede}>What's new in each version. The Mac app updates itself; on iPhone, updates come from the App Store.</p>
          </div>
          {releases.map((r) => (
            <article key={r.version} className={styles.entry}>
              <div className={styles.entryMeta}>
                <span className={styles.entryVersion}>{r.version}</span>
                <time className={styles.entryDate} dateTime={r.date}>
                  {new Date(r.date + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                </time>
              </div>
              <div className={styles.entryBody}>
                <h2>{r.title}</h2>
                <ul>{r.items.map((i) => <li key={i}>{i}</li>)}</ul>
              </div>
            </article>
          ))}
        </section>
      </main>
      <footer className={styles.foot}>
        <nav>
          <a href="/">Home</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/support">Help</a>
        </nav>
        <div className={styles.wordmark} aria-hidden="true">Amber Notes</div>
      </footer>
    </div>
  );
}
