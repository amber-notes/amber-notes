import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site";
import styles from "../home.module.css";
import { changelog } from "@/lib/changelog";

export const dynamic = "force-static";
export const metadata: Metadata = pageMetadata({
  title: "Changelog · Amber Notes",
  description: "What's new in each version of Amber Notes for Mac and iPhone.",
  path: "/changelog",
});

const rise = (i: number) => ({ className: "rise", style: { "--i": i } as React.CSSProperties });

export default function Changelog() {
  const releases = changelog();
  return (
    <div className={styles.main}>
      <section className={styles.log}>
        <div className={styles.logHead}>
          <h1 className={`${styles.h2} rise`} style={{ "--i": 0 } as React.CSSProperties}>Changelog</h1>
          <p className={`${styles.lede} rise`} style={{ "--i": 1 } as React.CSSProperties}>
            What's new in each version. The Mac app updates itself; on iPhone, updates come from the App Store.
          </p>
        </div>
        {releases.map((r, n) => (
          <article key={r.version} className={`${styles.entry} rise`} style={{ "--i": 2 + n } as React.CSSProperties}>
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
    </div>
  );
}
