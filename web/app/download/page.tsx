import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import styles from "./download.module.css";

export const metadata: Metadata = {
  title: "Download Amber Notes for Mac",
  description: "The notes app your AI can actually use. Free for Mac; updates install themselves.",
  robots: { index: true, follow: true },
};

/// Written by scripts/release-mac.sh next to the DMG it uploads (public/downloads/<file>).
type Release = { version: string; build: string; size: number; date: string; file: string; sparkleFile?: string; minimumSystemVersion: string };

function latest(): Release | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "content", "release.json"), "utf8"));
  } catch {
    return null;
  }
}

const r = (i: number) => ({ "--i": i }) as React.CSSProperties;

export default function Download() {
  const release = latest();
  const size = release ? `${(release.size / 1_000_000).toFixed(1)} MB` : "";
  const date = release ? new Date(release.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
  const macos = release?.minimumSystemVersion.replace(/\.0$/, "") ?? "26";
  return (
    <div className={styles.wrap}>
      <section className={styles.hero}>
        <img className={`${styles.icon} rise`} style={r(0)} src="/mark.png" alt="" width={128} height={128} />
        <h1 className={`${styles.title} rise`} style={r(1)}>Download Amber Notes for Mac</h1>
        {release ? (
          <>
            <p className={`${styles.meta} rise`} style={r(2)}>
              Version {release.version} · {size} · {date}
            </p>
            <a className={`${styles.button} rise`} style={r(3)} href={`/downloads/${release.file}`} download={release.file}>
              <Apple /> Download for Mac
            </a>
            <p className={`${styles.req} rise`} style={r(4)}>Free · Requires macOS {macos} or later</p>
          </>
        ) : (
          <p className={`${styles.meta} rise`} style={r(2)}>The first Mac release is on its way.</p>
        )}
      </section>

      <section className={styles.steps} aria-label="How to install">
        <div className={`${styles.step} rise`} style={r(5)}>
          <div className={styles.art} aria-hidden="true">
            <div className={styles.dmg}><span>DMG</span></div>
          </div>
          <strong>1. Open the download</strong>
          <span>Double-click {release?.file ?? "the file"} in your Downloads.</span>
        </div>
        <div className={`${styles.step} rise`} style={r(6)}>
          <div className={styles.art} aria-hidden="true">
            <img src="/mark.png" alt="" width={48} height={48} />
            <svg width="44" height="16" viewBox="0 0 44 16" className={styles.arrow}><path d="M2 8h36m-6-6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <div className={styles.folder}><span>A</span></div>
          </div>
          <strong>2. Drag it to Applications</strong>
          <span>Drop Amber Notes on the Applications folder.</span>
        </div>
        <div className={`${styles.step} rise`} style={r(7)}>
          <div className={styles.art} aria-hidden="true">
            <div className={styles.signin}><i /><b><Apple /> Sign in</b></div>
          </div>
          <strong>3. Open it and sign in</strong>
          <span>With Apple or email. Your notes sync to your iPhone.</span>
        </div>
      </section>

      <section className={`${styles.more} rise`} style={r(8)}>
        <p><strong>Updates install themselves.</strong> Amber Notes checks once a day, or choose Amber Notes › Check for Updates…</p>
        <p><strong>Syncs with your iPhone.</strong> Your notes live in the cloud and sync with the iPhone app, coming soon to the App Store.</p>
        <p><a href="/changelog">See what's new in each version</a></p>
      </section>
    </div>
  );
}

function Apple() {
  return (
    <svg width="15" height="18" viewBox="0 0 15 18" aria-hidden="true" fill="currentColor">
      <path d="M12.3 9.6c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.4.8-.7 0-1.8-.8-2.9-.8C3.2 4.6 1.8 5.4 1 6.8c-1.6 2.8-.4 6.9 1.1 9.1.8 1.1 1.7 2.3 2.8 2.3 1.1 0 1.6-.7 2.9-.7 1.4 0 1.7.7 2.9.7 1.2 0 2-1.1 2.7-2.2.9-1.3 1.2-2.5 1.2-2.6 0 0-2.3-.9-2.3-3.8zM10.1 3c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.6.6-1.1 1.6-.9 2.6.9.1 1.9-.5 2.5-1.2z" />
    </svg>
  );
}
