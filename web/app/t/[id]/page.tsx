import type { Metadata } from "next";
import { sharedTemplate } from "@/lib/collab-relay";
import PageFrame from "@/lib/PageFrame";
import { EmptyState, Stage } from "@/lib/ui";
import CopyButton from "../../templates/CopyButton";
import NoteWindow from "../../templates/NoteWindow";
import s from "../../templates/templates.module.css";
import own from "./t.module.css";

// A template someone shared from the app (prototype): https://ambernotes.app/t/<id>. Built like the
// gallery's template pages, from what the maker chose to publish: the note's skeleton, its app (the
// page, live and read-only on the user-content origin), sample data if they included it, and the
// keys the app asks for, by name. Read on every visit, so Stop Sharing takes it down at once.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await sharedTemplate((await params).id);
  if (!t) return { title: "Template not found · Amber Notes", robots: { index: false, follow: false } };
  const by = t.maker ? ` by ${t.maker}` : "";
  return { title: `${t.template.title}, a template${by} · Amber Notes`, description: t.template.description, robots: { index: false, follow: false } };
}

const at = (i: number) => ({ "--i": i }) as React.CSSProperties;

export default async function Page({ params }: Props) {
  const { id } = await params;
  const shared = await sharedTemplate(id);
  if (!shared) {
    return (
      <Stage inSite>
        <EmptyState title="This template isn't shared anymore" actions={<a className={s.primary} href="/templates">Browse templates</a>}>
          Its maker stopped sharing it. The gallery has others you can use.
        </EmptyState>
      </Stage>
    );
  }
  const t = shared.template;
  const keys = t.needs?.keys ?? [];
  const hosts = [...new Set([...(t.needs?.hosts ?? []), ...keys.flatMap((k) => (k.host ? [k.host] : []))])];
  const preview = t.sample ?? t.note;
  return (
    <div className={s.main}>
      <div>
        <ol className={s.crumbs} aria-label="Breadcrumb">
          <li><a href="/templates">Templates</a></li>
          <li>Shared by people</li>
        </ol>
        <div className={s.top}>
          <header className={s.intro}>
            <h1 className={`${s.title} rise`} style={at(0)}>{t.title}</h1>
            {t.description && <p className={`${s.lede} rise`} style={at(1)}>{t.description}</p>}
            <p className={`${s.for} rise`} style={at(1)}>{shared.maker ? <>A template by {shared.maker}, made in Amber Notes.</> : <>Made in Amber Notes.</>}</p>
            <div className={`${s.ctas} rise`} style={at(2)}>
              <a className={s.primary} href={`/open/shared-template/${id}`}><PlusGlyph /> Use template</a>
              <CopyButton text={t.note} label="Copy the markdown" className={s.quiet} />
            </div>
            <p className={`${s.fine} rise`} style={at(3)}>
              Free. Use template opens Amber Notes and adds a fresh copy: your own note, with {t.sample ? "the sample rows, which you can clear" : "empty tables"}.
              {t.page ? " Its app starts with no internet access until you allow it." : ""} No Amber Notes yet? <a href="/download">Download it</a>.
            </p>
          </header>
          <div id="preview" className={`${s.heroExample} rise-soft`} style={at(2)}>
            {t.page
              ? <PageFrame html={t.page} markdown={preview} label={`A live preview of the ${t.title} app`} caption={false} />
              : <NoteWindow markdown={preview} folder="Notes" date="Today" label={`The ${t.title} template`} />}
            <p className={s.caption}>
              {t.page ? "The app inside this template, running on sample data. It's live: try it. It runs on its own site with no internet access, and nothing you change here is saved." : "The note this template adds."}
            </p>
          </div>
        </div>
      </div>

      <section className={s.section} aria-labelledby="needs">
        <div className={s.sectionHead}>
          <h2 id="needs" className={s.h2}>What it needs</h2>
          <p className={s.sectionLede}>
            {keys.length === 0 && hosts.length === 0
              ? "Nothing. It works with the note alone and never goes online."
              : "When you use it, the app asks before any of these. You add your own keys; the template never carries anyone's."}
          </p>
        </div>
        {(keys.length > 0 || hosts.length > 0) && (
          <ul className={own.needs}>
            {keys.map((k) => <li key={k.name}><b>{k.name}</b><span>{k.host ? `A key you add, sent only to ${k.host}.` : "A key you add."}</span></li>)}
            {hosts.filter((h) => !keys.some((k) => k.host === h)).map((h) => <li key={h}><b>{h}</b><span>A site it may reach, once you allow it.</span></li>)}
          </ul>
        )}
      </section>

      <section className={s.section} aria-labelledby="note">
        <div className={s.sectionHead}>
          <h2 id="note" className={s.h2}>{t.sample ? "The note, with sample data" : "The note you start with"}</h2>
          <p className={s.sectionLede}>
            The app reads and writes this note{t.layout?.length ? `: ${t.layout.map((l) => l.columns.join(", ")).join("; ")}` : ""}. It&apos;s ordinary markdown, so your AI can fill it in too.
          </p>
        </div>
        <div className={s.result}>
          <NoteWindow markdown={preview} folder="Notes" date="Today" label={`The ${t.title} note`} />
        </div>
      </section>

      <p className={s.fine} style={{ marginTop: -48 }}>
        Anyone with this link can see and use this template. The maker&apos;s own notes and data aren&apos;t in it.
      </p>
    </div>
  );
}

const PlusGlyph = () => <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>;
