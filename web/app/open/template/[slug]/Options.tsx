import { AIGlyph } from "@/lib/ai-glyphs";
import { CLAUDE_DIRECTORY_URL } from "@/lib/facts";
import { APP_STORE_LIVE, APP_STORE_URL } from "@/lib/site";
import { COVERS, coverPath, inkOn } from "@/lib/template-covers";
import { noteTitle, promptVariants, type Template } from "@/lib/templates";
import NoteWindow from "../../../templates/NoteWindow";
import PromptCopy from "../../../templates/PromptCopy";
import ts from "../../../templates/templates.module.css";
import s from "../../open.module.css";
import o from "./options.module.css";

/// Three designs of the page after "Use template", under review (?v=a, ?v=b, ?v=c). Each one says
/// the template is open in Amber Notes and leads to the next step: the prompt, pasted into ChatGPT
/// or Claude. Their words follow the page's state (OpenApp): trying, opened, or the app not found.

type Props = { t: Template; href: string };

const ground = (t: Template) => ({ "--ground": COVERS[t.slug].ground }) as React.CSSProperties;

function Heading({ t, className }: { t: Template; className: string }) {
  return (
    <h1 className={className}>
      <span className={s.whenTrying}>Opening Amber Notes</span>
      <span className={s.whenOpened}>{noteTitle(t)} is open in Amber&nbsp;Notes</span>
      <span className={s.whenFallback}>Get Amber Notes to use this template</span>
    </h1>
  );
}

function Lede({ className }: { className: string }) {
  return (
    <p className={className}>
      <span className={s.whenFallback}>{APP_STORE_LIVE ? "It's free for iPhone and Mac." : "It's free for Mac, and the iPhone app is coming soon."} Then choose Use template again.</span>
      <span className={s.whenTrying}>Choose Add to my notes there. Then give your AI the prompt, and it keeps the note for you.</span>
      <span className={s.whenOpened}>Choose Add to my notes there. Then give your AI the prompt, and it keeps the note for you.</span>
    </p>
  );
}

/// The way to get the app, only when it didn't open.
function GetIt({ href }: { href: string }) {
  return (
    <div className={`${o.get} ${s.whenFallback}`}>
      <a className={ts.primary} href="/download/mac"><AppleGlyph /> Get Amber Notes for Mac</a>
      {APP_STORE_LIVE
        ? <a className={ts.secondary} href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">Get it for iPhone</a>
        : <span className={o.soon}>Already have it? <a href={href}>Open Amber Notes</a></span>}
    </div>
  );
}

/// The next step: copy the prompt, then the two AI apps to paste it into.
function Next({ t, title = true }: { t: Template; title?: boolean }) {
  return (
    <div className={o.next}>
      {title && (
        <h2 className={o.nextTitle}>
          <span className={s.whenFallback}>Or have your AI add it</span>
          <span className={s.whenTrying}>Next, give your AI the prompt</span>
          <span className={s.whenOpened}>Next, give your AI the prompt</span>
        </h2>
      )}
      <PromptCopy variants={promptVariants(t)} className={`${ts.primary} ${o.copy}`} />
      <Into />
      <p className={o.fine}>First time? <a href="/blog/connect-chatgpt-to-your-notes">Connect ChatGPT</a> or <a href={CLAUDE_DIRECTORY_URL} rel="noopener">connect Claude</a> to Amber Notes.</p>
    </div>
  );
}

function Into() {
  return (
    <p className={o.into}>
      <span>Then paste it into</span>
      <span className={o.apps}>
        <a className={o.app} href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer"><AIGlyph name="openai" size={17} />ChatGPT<OutGlyph /></a>
        <a className={o.app} href="https://claude.ai/new" target="_blank" rel="noopener noreferrer"><AIGlyph name="claude" size={17} />Claude<OutGlyph /></a>
      </span>
    </p>
  );
}

function Quiet({ t, href }: Props) {
  return (
    <p className={o.quiet}>
      <span className={s.whenOpened}>Didn&apos;t open? <a href={href}>Open Amber Notes</a></span>
      <a href={`/templates/${t.slug}`}>See the {t.title.toLowerCase()} template</a>
    </p>
  );
}

/// A: the template's paper-cut cover beside the words, on the cover's own ground, like a gallery card
/// opened out; the next step on a sheet of its own.
export function OptionA({ t, href }: Props) {
  return (
    <section className={o.a} data-v="a" data-ink={inkOn(COVERS[t.slug].ground)} style={ground(t)}>
      <div className={o.aArt}><img src={coverPath(t.slug)} alt="" width={800} height={800} /></div>
      <div className={o.aBody}>
        <div className={o.aHead}>
          <Heading t={t} className={o.aTitle} />
          <Lede className={o.aLede} />
        </div>
        <GetIt href={href} />
        <div className={o.sheet}><Next t={t} /></div>
        <Quiet t={t} href={href} />
      </div>
    </section>
  );
}

/// B: the words and the next step on the left; on the right the note as it now looks in Amber
/// Notes, on the template's cover, as on the template's page.
export function OptionB({ t, href }: Props) {
  return (
    <div className={o.b} data-v="b">
      <div className={o.bText}>
        <div className={o.bHead}>
          <Heading t={t} className={o.bTitle} />
          <Lede className={ts.lede} />
        </div>
        <GetIt href={href} />
        <Next t={t} />
        <Quiet t={t} href={href} />
      </div>
      <div className={`${ts.heroStage} ${o.bStage}`} style={ground(t)}>
        <img className={ts.heroCover} src={coverPath(t.slug)} alt="" width={800} height={800} />
        <div className={ts.heroWindow}>
          <NoteWindow markdown={t.note} folder={t.folder} date="Today" label={`The ${t.title.toLowerCase()} note in Amber Notes`} />
        </div>
      </div>
    </div>
  );
}

/// C: the three steps from here, side by side: it's open (done), give your AI the prompt, then
/// talk to it, with the template's own first things to say.
export function OptionC({ t, href }: Props) {
  return (
    <div className={o.c} data-v="c">
      <div className={o.cHead}>
        <Heading t={t} className={o.bTitle} />
        <Lede className={ts.lede} />
      </div>
      <ol className={o.cSteps}>
        <li className={o.cStep} data-done="">
          <span className={o.cNum} aria-hidden="true"><span className={s.whenFallback}>1</span><span className={s.whenTrying}><TickGlyph /></span><span className={s.whenOpened}><TickGlyph /></span></span>
          <h2 className={o.cName}>
            <span className={s.whenFallback}>Get Amber Notes</span>
            <span className={s.whenTrying}>Opening in Amber Notes</span>
            <span className={s.whenOpened}>Opened in Amber Notes</span>
          </h2>
          <p className={o.cText}>
            <span className={s.whenFallback}>Then choose Use template again, and Amber Notes adds the {noteTitle(t)} note.</span>
            <span className={s.whenTrying}>Choose Add to my notes there, and the {noteTitle(t)} note is in your notes.</span>
            <span className={s.whenOpened}>Choose Add to my notes there, and the {noteTitle(t)} note is in your notes.</span>
          </p>
          <GetIt href={href} />
          <span className={o.cArt} style={ground(t)}><img src={coverPath(t.slug)} alt="" width={800} height={800} /></span>
        </li>
        <li className={o.cStep}>
          <span className={o.cNum} aria-hidden="true">2</span>
          <h2 className={o.cName}>Give your AI the prompt</h2>
          <p className={o.cText}>Paste it once into a chat with Amber Notes connected. Your AI finds the note and learns how to keep it.</p>
          <Next t={t} title={false} />
        </li>
        <li className={o.cStep}>
          <span className={o.cNum} aria-hidden="true">3</span>
          <h2 className={o.cName}>Then just talk to it</h2>
          <p className={o.cText}>In your own words, whenever something comes up. Every change shows in the note, with Undo.</p>
          <ul className={o.cAsks}>{t.asks.slice(0, 3).map((a) => <li key={a}>{a}</li>)}</ul>
        </li>
      </ol>
      <Quiet t={t} href={href} />
    </div>
  );
}

const TickGlyph = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>;
const OutGlyph = () => <svg className={o.out} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 11 11 5M6 4.5h5.5V10" /></svg>;
const AppleGlyph = () => <svg width="14" height="17" viewBox="0 0 15 18" aria-hidden="true" fill="currentColor"><path d="M12.3 9.6c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.4.8-.7 0-1.8-.8-2.9-.8C3.2 4.6 1.8 5.4 1 6.8c-1.6 2.8-.4 6.9 1.1 9.1.8 1.1 1.7 2.3 2.8 2.3 1.1 0 1.6-.7 2.9-.7 1.4 0 1.7.7 2.9.7 1.2 0 2-1.1 2.7-2.2.9-1.3 1.2-2.5 1.2-2.6 0 0-2.3-.9-2.3-3.8zM10.1 3c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.6.6-1.1 1.6-.9 2.6.9.1 1.9-.5 2.5-1.2z" /></svg>;
