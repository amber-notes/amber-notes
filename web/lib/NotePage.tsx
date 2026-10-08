import Link from "next/link";
import { renderNote, withoutTitle } from "./render";
import type { SharedFile } from "./render";
import { avatarURL, copyAppLink, copyLink, type SharedNote } from "./shared";
import { APP_TEMPLATES } from "./site";
import OpenInApp from "../app/OpenInApp";
import { sharerLabel, type Sharer } from "./sharer";
import { Shell, TopBar, ui } from "./ui";
import s from "./note-page.module.css";

function Avatar({ by, size }: { by: Sharer | null | undefined; size: number }) {
  const photo = avatarURL(by?.avatar);
  return photo
    ? <img className={s.avatar} src={photo} alt="" width={size} height={size} referrerPolicy="no-referrer" />
    : <span className={`${s.avatar} ${s.initials}`} style={{ width: size, height: size }} aria-hidden="true">{sharerLabel(by).initials}</span>;
}

function edited(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/// The one mention of the app on someone's shared note: after the note, never over it.
function GetAmberNotes() {
  return (
    <aside className={s.get} aria-label="About Amber Notes">
      <img src="/mark-256.png" alt="" width={44} height={44} />
      <p>
        <strong>Shared from Amber Notes</strong>
        <span>A notes app for iPhone and Mac that ChatGPT and Claude can read and edit.</span>
      </p>
      <a className={ui.secondary} href="/">Get Amber Notes</a>
    </aside>
  );
}

/// A shared note: the page is the note, as in the app. The bar holds only the logo and "Use this note";
/// who shared it sits under the title.
export function NotePage({ slug, note, files, page, sealed = false, editHref = null }: {
  slug: string; note: SharedNote; files: Record<string, SharedFile>;
  /** The note's page, shown above its text (sealed links, prototype). */
  page?: React.ReactNode;
  /** A sealed link (/s/<id>#…): the copy opened in this browser; no Use this note or report link yet. */
  sealed?: boolean;
  /** An Edit link: where the app opens it to join the note. */
  editHref?: string | null;
}) {
  const html = renderNote(withoutTitle(note.body), {
    files,
    subNoteHref: (id) => (note.include_subnotes ? `/n/${slug}/${id}` : null),
  });
  const linkedInBody = new Set([...note.body.matchAll(/pane-note:([0-9a-f-]{36})/gi)].map((m) => m[1].toLowerCase()));
  const moreSubnotes = note.subnotes.filter((n) => !linkedInBody.has(n.id));
  const { name, email } = sharerLabel(note.shared_by);

  const parent = note.is_sub && (
    <Link className={s.parent} href={`/n/${slug}`}>
      <span aria-hidden="true">‹</span> {note.root_title}
    </Link>
  );
  const subnotes = moreSubnotes.length > 0 && (
    <nav className="subnotes" aria-label="Sub-notes">
      <h2>Sub-notes</h2>
      {moreSubnotes.map((n) => (
        <Link key={n.id} className="subnote-chip" href={`/n/${slug}/${n.id}`}>
          <span className="subnote-icon" />
          <span>{n.title}</span>
        </Link>
      ))}
    </nav>
  );
  // Copies the whole note into the visitor's own Amber Notes, opened from this page. A sealed
  // link (collaboration) offers Edit in Amber Notes instead, or nothing yet.
  const use = editHref
    ? <a className={s.use} href={editHref}>Edit in Amber Notes</a>
    : !sealed && APP_TEMPLATES.live && <OpenInApp className={s.use} href={copyLink(slug)} app={copyAppLink(slug)} auto>Use this note</OpenInApp>;

  return (
    <Shell className={s.plain}>
      <TopBar href={sealed ? "/" : `/n/${slug}`}>{use}</TopBar>
      <main className={s.plainMain}>
        {parent}
        {page ? (
          // A note with an app: the app shows the note's title itself, so the page doesn't repeat it.
          <p className={s.sharedLine} title={email ? `${name} · ${email}` : name}>
            <span className={s.sharerLabel}>Shared by </span><b>{name}</b> · Edited {edited(note.updated_at)}
          </p>
        ) : (
          <>
            <h1 className={s.bigTitle}>{note.title}</h1>
            <div className={s.byline} title={email ? `${name} · ${email}` : name}>
              <Avatar by={note.shared_by} size={36} />
              <p>
                <span className={s.bylineName}><span className={s.sharerLabel}>Shared by </span>{name}</span>
                <span className={s.bylineDate}>Edited {edited(note.updated_at)}</span>
              </p>
            </div>
          </>
        )}
        {page}
        <article className="note" dangerouslySetInnerHTML={{ __html: html }} />
        {subnotes}
        <GetAmberNotes />
      </main>
      {!sealed && (
        <footer className={s.foot}>
          <Link href={`/report/${slug}`}>Report this page</Link>
        </footer>
      )}
    </Shell>
  );
}
