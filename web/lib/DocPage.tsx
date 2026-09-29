import { readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { renderNote } from "./render";

/** A markdown page from content/ (privacy, terms, support): its first heading is the title. */
export function readDoc(file: string): { title: string; body: string } {
  const markdown = readFileSync(join(process.cwd(), "content", file), "utf8");
  return { title: markdown.match(/^#\s+(.+)$/m)?.[1] ?? "Amber Notes", body: markdown.replace(/^#\s+.+\n+/, "") };
}

export function DocPage({ title, body }: { title: string; body: string }) {
  const html = renderNote(body, { files: {}, subNoteHref: () => null });
  return (
    <div className="shell">
      <header className="bar">
        <Link href="/" className="brand" aria-label="Amber Notes">
          <img src="/mark.png" alt="" width={22} height={22} />
          <span>Amber Notes</span>
        </Link>
      </header>
      <main className="page">
        <h1 className="title">{title}</h1>
        <article className="note" dangerouslySetInnerHTML={{ __html: html }} />
      </main>
      <footer className="foot">
        <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> · <Link href="/support">Support</Link>
      </footer>
    </div>
  );
}
