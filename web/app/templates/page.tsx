import type { Metadata } from "next";
import { APP_TEMPLATES, pageMetadata } from "@/lib/site";
import { JsonLd, breadcrumbs, incredible, maker, organization, templateLibrary } from "@/lib/structured-data";
import { CATEGORIES, anchor, inCategory, templates } from "@/lib/templates";
import Card from "./Card";
import Library from "./Library";
import { COVERS, coverPath } from "@/lib/template-covers";
import s from "./templates.module.css";

export const dynamic = "force-static";
export const metadata: Metadata = pageMetadata({
  title: "Note templates for ChatGPT and Claude · Amber Notes",
  shareTitle: "Templates your AI fills in",
  description: "Free note templates that ChatGPT, Claude and Claude Code fill in for you: habit trackers, meeting notes, standups, meal plans and more.",
  path: "/templates",
  image: { url: "/templates/opengraph-image", alt: "Amber Notes templates: note templates that ChatGPT, Claude and Claude Code fill in for you." },
});

const at = (i: number) => ({ "--i": i }) as React.CSSProperties;

/// The covers fanned beside the title.
const FAN = ["habit-tracker", "meeting-notes", "reading-list", "meal-plan"];

export default function Page() {
  const all = templates();
  return (
    <div className={s.main}>
      <JsonLd graph={[breadcrumbs([{ name: "Templates", path: "/templates" }]), templateLibrary(all), organization, maker, incredible]} />
      <div className={s.gallery}>
        <section className={s.hero}>
          {/* Four covers fanned beside the title, a taste of the cards below. */}
          <span className={s.fan} aria-hidden="true">{FAN.map((slug) => <img key={slug} src={coverPath(slug)} alt="" width={800} height={800} />)}</span>
          <h1 className={`${s.h1} rise`} style={at(0)}>Templates <mark className={s.mark}>your AI</mark> fills in.</h1>
          <p className={`${s.lede} rise`} style={at(1)}>
            {APP_TEMPLATES.live
              ? <>Open a template to add the note to Amber Notes and copy its prompt. From then on, <b>ChatGPT, Claude or Claude Code</b> fills it in for you.</>
              : <>Open a template to get the note and its prompt, ready to copy. Paste it once, and <b>ChatGPT, Claude or Claude Code</b> fills the note in for you.</>}
          </p>
        </section>

        <div className="rise" style={at(2)}>
          <Library
            items={all.map((t) => ({ slug: t.slug, category: t.category }))}
            cards={all.map((t) => <Card key={t.slug} t={t} />)}
            categories={CATEGORIES.map((c) => {
              const ts = inCategory(c);
              return { name: c, anchor: anchor(c), count: ts.length, swatch: ts.slice(0, 3).map((t) => COVERS[t.slug].ground) };
            })}
          />
        </div>
      </div>

      {APP_TEMPLATES.live && <section className={`${s.loop} filter-after`} aria-labelledby="loop">
        <div className={s.sectionHead}>
          <h2 id="loop" className={s.h2}>Every shared note is a template too</h2>
          <p className={s.sectionLede}>
            When someone shares a note from Amber Notes, its page has a <b>Use this note</b> button. It copies the note into your own Amber
            Notes, so a friend&apos;s packing list or a colleague&apos;s meeting format becomes yours to fill in.
          </p>
          <p className={s.sectionLede}>New to connecting an AI? <a href="/blog/connect-chatgpt-to-your-notes">Here&apos;s how</a>.</p>
        </div>
        <div className={s.loopArt} aria-hidden="true">
          <div className={s.loopBar}>
            <span><img src="/mark-256.png" alt="" width={18} height={18} />Amber Notes</span>
            <span className={s.loopUse}>Use this note</span>
          </div>
          <p className={s.loopNote}>Packing for Lisbon</p>
          <p className={s.loopLine}>Shared by Maja</p>
        </div>
      </section>}
    </div>
  );
}
