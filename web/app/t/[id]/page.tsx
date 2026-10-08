import type { Metadata } from "next";
import { sharedTemplate } from "@/lib/collab-relay";
import PageFrame from "@/lib/PageFrame";
import { renderNote } from "@/lib/render";
import { EmptyState, Shell, Stage, TopBar } from "@/lib/ui";
import s from "@/lib/note-page.module.css";

// A template someone shared from the app (prototype): https://ambernotes.app/t/<id>. It's a thing a
// person shared, not part of our Templates gallery: the same quiet page as a shared note, outside
// the site's header and navigation, never indexed (robots meta here, X-Robots-Tag from
// next.config.ts), never in the sitemap and never linked from our pages. Read on every visit, so
// Stop Sharing and a takedown remove it at once.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const noindex = { index: false, follow: false };
const REPORT = "hello@ambernotes.app";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await sharedTemplate((await params).id);
  if (!t) return { title: "Not shared · Pinto Notes", robots: noindex };
  return { title: `${t.template.title} · Pinto Notes`, description: t.template.description, robots: noindex };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  const shared = await sharedTemplate(id);
  if (!shared) {
    return (
      <Stage>
        <EmptyState title="This template isn't shared anymore">Whoever shared it stopped sharing it.</EmptyState>
      </Stage>
    );
  }
  const t = shared.template;
  const keys = t.needs?.keys ?? [];
  // A template starts empty: the app shows its empty state, the note its headings and columns.
  const example = t.note;
  const maker = shared.maker ?? "someone";
  const report = `mailto:${REPORT}?subject=${encodeURIComponent(`Report template ${id}`)}&body=${encodeURIComponent(`Template: https://ambernotes.app/t/${id}\n\nWhat's wrong with it:\n`)}`;
  return (
    <Shell className={s.plain}>
      <TopBar href="/" />
      <main className={s.plainMain}>
        <p className={s.sharedLine}><span className={s.sharerLabel}>Shared by </span><b>{maker}</b></p>
        {/* With an app, the app shows the title itself; without one, the note's title leads. */}
        {!t.page && <h1 className={s.bigTitle}>{t.title}</h1>}
        <div className={s.useRow}>
          <a className={s.use} href={`/open/shared-template/${id}`}>Use template</a>
          <span>Adds your own copy to Pinto Notes. <a href="/download">Download</a></span>
        </div>
        {t.page
          ? <PageFrame html={t.page} markdown={example} label={`${t.title}, a preview`} />
          : <article className="note" dangerouslySetInnerHTML={{ __html: renderNote(example.split("\n").slice(1).join("\n"), { files: {}, subNoteHref: () => null }) }} />}
        {keys.length > 0 && (
          <p className={s.needs}>
            Needs {keys.map((k, i) => <span key={k.name}>{i > 0 ? (i === keys.length - 1 ? " and " : ", ") : ""}<b>{article(k.name)}</b></span>)}, which you add yourself.
          </p>
        )}
      </main>
      <footer className={s.foot}>
        <a href={report}>Report this template</a>
      </footer>
    </Shell>
  );
}

/// "a Strava access token": the key named as a thing you'd have.
const article = (name: string) => `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
