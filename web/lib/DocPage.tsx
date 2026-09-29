import { readFileSync } from "node:fs";
import { join } from "node:path";
import styles from "./legal.module.css";
import { renderNote } from "./render";

/** A markdown page from content/ (privacy, terms, support): its first heading is the title. */
export function readDoc(file: string): { title: string; body: string } {
  const markdown = readFileSync(join(process.cwd(), "content", file), "utf8");
  return { title: markdown.match(/^#\s+(.+)$/m)?.[1] ?? "Amber Notes", body: markdown.replace(/^#\s+.+\n+/, "") };
}

export function DocPage({ title, body }: { title: string; body: string }) {
  const html = renderNote(body, { files: {}, subNoteHref: () => null });
  return (
    <div className={styles.main}>
      <div className={`${styles.head} rise`} style={{ "--i": 0 } as React.CSSProperties}>
        <h1 className={styles.title}>{title}</h1>
      </div>
      <article className={`${styles.article} rise`} style={{ "--i": 1 } as React.CSSProperties} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
