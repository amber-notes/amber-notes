import type { Metadata } from "next";
import { APP_TEMPLATES, pageMetadata } from "@/lib/site";
import { JsonLd, breadcrumbs, incredible, maker, organization, templateLibrary } from "@/lib/structured-data";
import { AUDIENCES, CATEGORIES, anchor, forAudience, inCategory, templates } from "@/lib/templates";
import Card from "./Card";
import Library from "./Library";
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

export default function Page() {
  const all = templates();
  return (
    <div className={s.main}>
      <JsonLd graph={[breadcrumbs([{ name: "Templates", path: "/templates" }]), templateLibrary(all), organization, maker, incredible]} />
      <section className={s.hero}>
        <h1 className={`${s.h1} rise`} style={at(0)}>Templates <mark className={s.mark}>your AI</mark> fills in.</h1>
        <p className={`${s.lede} rise`} style={at(1)}>
          In most apps, you fill in a template yourself. In Amber Notes, <b>ChatGPT, Claude or Claude Code fills it in for you</b>: tell it what
          happened, and the row, the checklist or the summary lands in the right note.
        </p>
        <ol className={`${s.steps} rise`} style={at(2)}>
          {APP_TEMPLATES.live ? (
            <>
              <li><b>Add the template</b><span>It becomes an ordinary note in Amber Notes, in the folder you pick.</span></li>
              <li><b>Copy the prompt</b><span>Each template comes with instructions for your AI.</span></li>
            </>
          ) : (
            <>
              <li><b>Pick a template</b><span>A note, the prompt that runs it, and an example of the result.</span></li>
              <li><b>Paste the prompt</b><span>Your AI creates the note in Amber Notes and learns how to fill it in.</span></li>
            </>
          )}
          <li><b>Talk to your AI</b><span>&ldquo;Log today&rdquo;, &ldquo;plan dinners&rdquo;, &ldquo;quiz me&rdquo;. It updates the note.</span></li>
        </ol>
      </section>

      <div className="rise" style={at(3)}>
        <Library
          items={all.map((t) => ({ slug: t.slug, category: t.category, audiences: t.audiences }))}
          cards={all.map((t) => <Card key={t.slug} t={t} />)}
          categories={CATEGORIES.map((c) => ({ name: c, anchor: anchor(c), count: inCategory(c).length }))}
          audiences={AUDIENCES.map((a) => ({ name: a, anchor: anchor(a), count: forAudience(a).length }))}
        />
      </div>

      {APP_TEMPLATES.live && <section className={s.loop} aria-labelledby="loop">
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
