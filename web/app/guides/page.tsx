import type { Metadata } from "next";
import { guides } from "@/lib/guides";
import { pageMetadata } from "@/lib/site";
import legal from "@/lib/legal.module.css";
import styles from "./guides.module.css";

export const dynamic = "force-static";
export const metadata: Metadata = pageMetadata({
  title: "Guides",
  description: "How to connect ChatGPT and Claude to your notes, move from Apple Notes, and more.",
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
          {guides.map((g) => (
            <li key={g.slug}>
              <a className={styles.card} href={`/guides/${g.slug}`}>
                <span className={styles.title}>
                  {g.title}
                  {g.draft && <span className={styles.draft}>Draft</span>}
                </span>
                <span className={styles.desc}>{g.description}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
