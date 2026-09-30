import type { Metadata } from "next";
import { published } from "@/lib/guides";
import { pageMetadata } from "@/lib/site";
import legal from "@/lib/legal.module.css";
import styles from "./guides.module.css";

// Drafts stay reachable by their address for review, but aren't listed here.
export const dynamic = "force-static";
export const metadata: Metadata = pageMetadata({
  title: "Guides · Amber Notes",
  shareTitle: "Amber Notes guides",
  description: "How to connect ChatGPT, Claude, Claude Code and Codex to your notes, move from Apple Notes, and compare notes apps that work with AI.",
  path: "/guides",
});

export default function Page() {
  return (
    <div className={legal.main}>
      <div className={legal.col}>
        <header className={`${legal.head} rise`} style={{ "--i": 0 } as React.CSSProperties}>
          <h1 className={legal.title}>Guides</h1>
          <p className={legal.updated}>Getting set up, moving your notes over, and getting the most out of your AI.</p>
        </header>
        <ul className={`${styles.list} rise`} style={{ "--i": 1 } as React.CSSProperties}>
          {published().map((g) => (
            <li key={g.slug}>
              <a className={styles.card} href={`/guides/${g.slug}`}>
                <span className={styles.title}>{g.title}</span>
                <span className={styles.desc}>{g.description}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
