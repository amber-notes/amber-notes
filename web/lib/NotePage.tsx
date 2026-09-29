import Link from "next/link";
import { renderNote, withoutTitle } from "./render";
import type { SharedFile } from "./render";
import type { SharedNote } from "./shared";

function edited(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function NotePage({ slug, note, files }: { slug: string; note: SharedNote; files: Record<string, SharedFile> }) {
  const html = renderNote(withoutTitle(note.body), {
    files,
    subNoteHref: (id) => (note.include_subnotes ? `/n/${slug}/${id}` : null),
  });
  const linkedInBody = new Set([...note.body.matchAll(/pane-note:([0-9a-f-]{36})/gi)].map((m) => m[1].toLowerCase()));
  const moreSubnotes = note.subnotes.filter((s) => !linkedInBody.has(s.id));
  return (
    <div className="shell">
      <header className="bar">
        <Link href={`/n/${slug}`} className="brand" aria-label="Amber Notes">
          <img src="/mark.png" alt="" width={22} height={22} />
          <span>Amber Notes</span>
        </Link>
      </header>
      <main className="page">
        {note.is_sub && (
          <Link className="parent" href={`/n/${slug}`}>
            <span aria-hidden="true">‹</span> {note.root_title}
          </Link>
        )}
        <p className="date">Edited {edited(note.updated_at)}</p>
        <h1 className="title">{note.title}</h1>
        <article className="note" dangerouslySetInnerHTML={{ __html: html }} />
        {moreSubnotes.length > 0 && (
          <nav className="subnotes" aria-label="Sub-notes">
            <h2>Sub-notes</h2>
            {moreSubnotes.map((s) => (
              <Link key={s.id} className="subnote-chip" href={`/n/${slug}/${s.id}`}>
                <span className="subnote-icon" />
                <span>{s.title}</span>
              </Link>
            ))}
          </nav>
        )}
      </main>
      <footer className="foot">Shared from Amber Notes</footer>
    </div>
  );
}
