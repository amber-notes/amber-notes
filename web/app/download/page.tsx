import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import styles from "./download.module.css";

export const metadata: Metadata = {
  title: "Download Amber Notes for Mac",
  description: "Simple notes with markdown, checklists and tables. Your AI can use them too.",
  robots: { index: true, follow: true },
};

/// Written by scripts/release-mac.sh next to the DMG it uploads.
type Release = { version: string; build: string; size: number; date: string; file: string; minimumSystemVersion: string };

function latest(): Release | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "content", "release.json"), "utf8"));
  } catch {
    return null;
  }
}

export default function Download() {
  const release = latest();
  const size = release ? `${(release.size / 1_000_000).toFixed(1)} MB` : "";
  const date = release ? new Date(release.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
  return (
    <div className="shell">
      <main className={`page ${styles.wrap}`}>
        <img className={styles.icon} src="/mark.png" alt="" width={112} height={112} />
        <h1 className="title">Amber Notes for Mac</h1>
        <p className="lede">Simple notes with markdown, checklists and tables, synced to your iPhone. Your AI can use them too.</p>
        {release ? (
          <>
            <a className={styles.button} href={`/downloads/${release.file}`} download>
              Download for Mac
            </a>
            <p className={styles.meta}>
              Version {release.version} · {size} · {date} · macOS {release.minimumSystemVersion} or later
            </p>
            <ol className={styles.steps}>
              <li>Open the downloaded file and drag Amber Notes into Applications.</li>
              <li>Open Amber Notes and sign in with Apple, or with email.</li>
              <li>Updates install themselves: Amber Notes checks once a day, or choose Amber Notes › Check for Updates…</li>
            </ol>
          </>
        ) : (
          <p className={styles.meta}>The first Mac release is on its way.</p>
        )}
        <p className={styles.iphone}>On iPhone, Amber Notes is coming to the App Store.</p>
      </main>
    </div>
  );
}
