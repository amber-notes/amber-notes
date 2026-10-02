import Link from "next/link";
import { renderNote, withoutTitle } from "./render";
import type { SharedFile } from "./render";
import { avatarURL, copyLink, type SharedNote } from "./shared";
import { APP_TEMPLATES } from "./site";
import { sharerLabel, type Sharer } from "./sharer";
import { Shell, TopBar, ui } from "./ui";
import s from "./note-page.module.css";

/// The two candidate looks of a shared note. "sheet": the note on the app's white paper, on the
/// site's cream (leaf brown in dark), with who shared it in the bar. "page": the page itself is the
/// note, as in the app, with who shared it under the title. One of them stays; the other is deleted.
export type NoteDesign = "sheet" | "page";
export const NOTE_DESIGN: NoteDesign = "sheet";

function Avatar({ by, size }: { by: Sharer | null | undefined; size: number }) {
  const photo = avatarURL(by?.avatar);
  return photo
    ? <img className={s.avatar} src={photo} alt="" width={size} height={size} referrerPolicy="no-referrer" />
    : <span className={`${s.avatar} ${s.initials}`} style={{ width: size, height: size }} aria-hidden="true">{sharerLabel(by).initials}</span>;
}

/// Who shared the note, at the right of the bar. Long names and emails truncate; the photo stays.
function SharedBy({ by }: { by: Sharer | null | undefined }) {
  const { name, email } = sharerLabel(by);
  return (
    <div className={s.sharer} title={email ? `${name} · ${email}` : name}>
      <Avatar by={by} size={32} />
      <span className={s.sharerText}>
        <span className={s.sharerLine}><span className={s.sharerLabel}>Shared by </span><span className={s.sharerName}>{name}</span></span>
        {email && <span className={s.sharerEmail}>{email}</span>}
      </span>
    </div>
  );
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

export function NotePage({ slug, note, files, design = NOTE_DESIGN }: { slug: string; note: SharedNote; files: Record<string, SharedFile>; design?: NoteDesign }) {
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
  // Copies the whole note into the visitor's own Amber Notes, once the app handles the link.
  const use = APP_TEMPLATES.live && <a className={s.use} href={copyLink(slug)}>Use this note</a>;

  return (
    <Shell className={design === "page" ? s.plain : s.desk}>
      <TopBar href={`/n/${slug}`}>
        {design === "sheet" && <SharedBy by={note.shared_by} />}
        {use}
      </TopBar>
      {design === "sheet" ? (
        <main className={s.deskMain}>
          {parent}
          <div className={s.sheet}>
            <p className={s.date}>Edited {edited(note.updated_at)}</p>
            <h1 className={s.title}>{note.title}</h1>
            <article className="note" dangerouslySetInnerHTML={{ __html: html }} />
            {subnotes}
          </div>
          <GetAmberNotes />
        </main>
      ) : (
        <main className={s.plainMain}>
          {parent}
          <h1 className={s.bigTitle}>{note.title}</h1>
          <div className={s.byline} title={email ? `${name} · ${email}` : name}>
            <Avatar by={note.shared_by} size={36} />
            <p>
              <span className={s.bylineName}><span className={s.sharerLabel}>Shared by </span>{name}</span>
              <span className={s.bylineDate}>Edited {edited(note.updated_at)}</span>
            </p>
          </div>
          <article className="note" dangerouslySetInnerHTML={{ __html: html }} />
          {subnotes}
          <GetAmberNotes />
        </main>
      )}
      <footer className={s.foot}>
        <Link href={`/report/${slug}`}>Report this page</Link>
      </footer>
    </Shell>
  );
}
