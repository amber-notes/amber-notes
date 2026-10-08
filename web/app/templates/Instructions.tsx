import s from "./templates.module.css";

type Variant = { name: string; prompt: string };

/// What pasting the prompt does, in plain words, and what to say after. The full prompt stays on
/// the page, folded away, for anyone who wants to read exactly what their AI is told.
export default function Instructions({ title, folder, intro, variants, asks }: { title: string; folder: string; intro: string; variants: Variant[]; asks: string[] }) {
  return (
    <section className={s.prompt} aria-labelledby="prompt">
      <div className={s.promptHead}>
        <h2 id="prompt" className={s.h2}>What the prompt does</h2>
        <p className={s.sectionLede}>
          Your AI creates a note called <b>&ldquo;{title}&rdquo;</b> in your {folder} folder, or finds the one you already have, and learns how to
          keep it. {intro}
        </p>
        <p className={s.promptWhere}>Paste it once into a chat in ChatGPT or Claude with Amber Notes turned on, or into Claude Code.</p>
      </div>
      <div className={s.asks}>
        <p className={s.asksLabel}>Then just talk to it</p>
        <ul>{asks.map((a) => <li key={a}>{a}</li>)}</ul>
      </div>
      <details className={s.full}>
        <summary className={s.fullToggle}>Show the full prompt<Chevron /></summary>
        <div className={s.fullBody}>
          {variants.map((v) => (
            <div key={v.name} className={s.fullVariant}>
              {variants.length > 1 && <p className={s.fullFor}>For {v.name}</p>}
              <p className={s.promptText}>{highlight(v.prompt.slice(0, v.prompt.indexOf("```")).trimEnd())}</p>
              <pre className={s.promptMd} aria-label="The note's markdown, part of the prompt">{v.prompt.slice(v.prompt.indexOf("```"))}</pre>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

const Chevron = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>;

/// Tool names in the prompt stand out, so it's clear which Amber Notes tool does what.
function highlight(text: string) {
  return text.split(/(\b[a-z]+(?:_[a-z]+)+\b)/g).map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));
}
