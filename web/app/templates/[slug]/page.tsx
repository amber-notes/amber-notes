import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AIGlyph } from "@/lib/ai-glyphs";
import { APP_TEMPLATES, pageMetadata } from "@/lib/site";
import { JsonLd, breadcrumbs, maker, organization, templateHowTo, templateWork } from "@/lib/structured-data";
import { COVERS, coverPath } from "@/lib/template-covers";
import { anchor, changedCount, instructions, noteTitle, searchTitle, template, templates, useLink, type Template } from "@/lib/templates";
import Card from "../Card";
import CopyButton from "../CopyButton";
import Instructions from "../Instructions";
import PromptCopy from "../PromptCopy";
import NoteWindow from "../NoteWindow";
import s from "../templates.module.css";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return templates().map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = template((await params).slug);
  if (!t) return {};
  return pageMetadata({ title: searchTitle(t), shareTitle: `${t.title}: a template your AI fills in`, description: t.description, path: `/templates/${t.slug}`, image: { url: `/templates/${t.slug}/opengraph-image`, alt: `The ${t.title.toLowerCase()} template for Amber Notes` } });
}

/// The steps, for the page and its HowTo data. Until the app opens template links, the AI makes the note.
const steps = (t: Template) => APP_TEMPLATES.live
  ? [
      { name: "Add the template to Amber Notes", text: `Choose Use this template. Amber Notes opens and adds the "${noteTitle(t)}" note to the folder you pick.` },
      { name: "Connect your AI", text: "Connect ChatGPT, Claude or Claude Code to Amber Notes once, and choose Read and Edit so it can fill in the note." },
      { name: "Give your AI the prompt", text: "Copy the prompt for your AI and paste it into a chat. Then tell it what happened, in your own words." },
    ]
  : [
      { name: "Connect your AI", text: "Connect ChatGPT, Claude or Claude Code to Amber Notes once, and choose Read and Edit so it can write the note." },
      { name: "Paste the prompt", text: `Copy the prompt for your AI and paste it into a chat. It creates the "${noteTitle(t)}" note in your ${t.folder} folder, if you don't have it yet.` },
      { name: "Talk to your AI", text: "Tell it what happened, in your own words. It fills in the note, and you see every change in Amber Notes." },
    ];

const at = (i: number) => ({ "--i": i }) as React.CSSProperties;

/// The prompts worth telling apart: AIs that get the same words share one entry ("ChatGPT or Claude").
function variants(t: Template) {
  const byPrompt = new Map<string, string[]>();
  for (const i of instructions(t)) byPrompt.set(i.prompt, [...(byPrompt.get(i.prompt) ?? []), i.name]);
  return [...byPrompt].map(([prompt, names]) => ({ name: names.join(" or ").replace(/ or (?=.* or )/g, ", "), prompt }));
}

/// The note's own first line under its title: what the note is for, in its own words.
const intro = (t: Template) => t.note.split("\n").slice(1).find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("<!--"))?.trim() ?? "";

export default async function Page({ params }: Props) {
  const t = template((await params).slug);
  if (!t) notFound();
  const related = t.related.map((r) => template(r)).filter((r): r is Template => Boolean(r));
  const changed = changedCount(t);
  // The example bar names the AI the template is mostly used with.
  const by = t.prompt.claudeCode && t.audiences.includes("Developers") ? "Claude Code" : "ChatGPT";
  const vs = variants(t);
  return (
    <div className={s.main}>
      <JsonLd graph={[
        breadcrumbs([{ name: "Templates", path: "/templates" }, { name: t.title, path: `/templates/${t.slug}` }]),
        templateWork(t), templateHowTo(t, steps(t)), organization, maker,
      ]} />
      <div>
        <ol className={s.crumbs} aria-label="Breadcrumb">
          <li><a href="/templates">Templates</a></li>
          <li><a href={`/templates?category=${anchor(t.category)}`}>{t.category}</a></li>
        </ol>
        <div className={s.top}>
          <header className={s.intro}>
            <h1 className={`${s.title} rise`} style={at(0)}>{t.title}</h1>
            <p className={`${s.lede} rise`} style={at(1)}>{t.description}</p>
            <p className={`${s.for} rise`} style={at(1)}>{t.audience}</p>
            <div className={`${s.ctas} rise`} style={at(2)}>
              {APP_TEMPLATES.live && <a className={s.primary} href={useLink(t.slug)}><PlusGlyph /> Use this template</a>}
              <PromptCopy variants={vs} className={APP_TEMPLATES.live ? s.quiet : s.primary}>
                <CopyButton text={t.note} label="Copy the markdown" className={s.quiet} />
              </PromptCopy>
            </div>
            <p className={`${s.fine} rise`} style={at(3)}>Free. No Amber Notes yet? <a href="/download">Download it for Mac</a>.</p>
          </header>
          <div className={`${s.heroExample} rise-soft`} style={at(2)}>
            {/* The filled note leads; the template's cover sits behind it as its stage, as on its card. */}
            <div className={s.heroStage} style={{ "--ground": COVERS[t.slug].ground } as React.CSSProperties}>
              <img className={s.heroCover} src={coverPath(t.slug)} alt="" width={800} height={800} />
              <p className={s.changes} aria-hidden="true">{by} changed <span>{changed} {changed === 1 ? "line" : "lines"}</span><i>Undo</i></p>
              <div className={s.heroWindow}>
                <NoteWindow markdown={t.example} before={t.note} folder={t.folder} date="30 September 2026" label={`The ${t.title.toLowerCase()} template filled in by an AI`} />
              </div>
            </div>
            <p className={s.caption}>
              The note after a few days of talking to your AI. Tinted lines are what it added, the way Amber Notes shows an AI&apos;s changes, with
              Undo and the earlier version kept in the note&apos;s history.
            </p>
          </div>
        </div>
      </div>

      <Instructions title={noteTitle(t)} folder={t.folder} intro={intro(t)} variants={vs} asks={t.asks} />

      <section className={s.section} aria-labelledby="result">
        <div className={s.sectionHead}>
          <h2 id="result" className={s.h2}>The note you start with</h2>
          <p className={s.sectionLede}>
            This is what the prompt creates in Amber Notes: an ordinary note with the headings{t.note.includes("|") ? " and the table" : ""} ready.
            Your AI fills it in from there, and you can still edit every line yourself.
          </p>
        </div>
        <div className={s.result}>
          <NoteWindow markdown={t.note} folder={t.folder} date="Today" label={`The ${t.title.toLowerCase()} template as a note in Amber Notes`} />
        </div>
      </section>

      <section className={s.section} aria-labelledby="how">
        <div className={s.sectionHead}>
          <h2 id="how" className={s.h2}>How to set it up</h2>
        </div>
        <ol className={s.steps}>
          {steps(t).map((st, i) => <li key={st.name} id={`step-${i + 1}`}><b>{st.name}</b><span>{st.text}</span></li>)}
        </ol>
        <ul className={s.connect}>
          <li><a href="/blog/connect-chatgpt-to-your-notes"><b><AIGlyph name="openai" size={18} />ChatGPT</b><span>Plus, Pro, Business, Enterprise or Edu, on the web. A few minutes in Developer mode.</span><em>Connect ChatGPT</em></a></li>
          <li><a href="/blog/mcp-server"><b><AIGlyph name="claude" size={18} />Claude</b><span>Every plan, including free. Add Amber Notes as a custom connector, then Allow.</span><em>Connect Claude</em></a></li>
          <li><a href="/blog/notes-in-claude-code-and-codex"><b><AIGlyph name="claude" size={18} />Claude Code</b><span>One command in your terminal, or the button in Amber Notes on a Mac.</span><em>Connect Claude Code</em></a></li>
        </ul>
      </section>

      {related.length > 0 && (
        <section className={s.section} aria-labelledby="more">
          <h2 id="more" className={s.h2}>More templates</h2>
          <ul className={s.grid}>{related.map((r) => <li key={r.slug}><Card t={r} heading="h3" /></li>)}</ul>
        </section>
      )}
    </div>
  );
}

const PlusGlyph = () => <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>;
