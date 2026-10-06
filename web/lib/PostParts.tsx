import CopyButton from "@/app/templates/CopyButton";
import s from "./post-parts.module.css";

/// The parts a how-to post is built from. The short answer comes first, so someone from a search
/// result has it on the first screen; the rest is for the people who read on.

/// The short answer, with chips that jump to the sections that have the detail.
export function Answer({ children, jump = [] }: { children: React.ReactNode; jump?: { href: string; label: string }[] }) {
  return (
    <aside className={s.answer} aria-label="The short answer">
      <p className={s.answerLabel}>The short answer</p>
      {children}
      {jump.length ? (
        <ul className={s.jump}>{jump.map((j) => <li key={j.href}><a href={j.href}>{j.label}</a></li>)}</ul>
      ) : null}
    </aside>
  );
}

/// A menu path as it reads on screen, Settings › Apps › Notes, with an optional keyboard shortcut.
export function Path({ steps, keys }: { steps: string[]; keys?: string }) {
  return (
    <span className={s.path} role="group" aria-label={steps.join(", then ") + (keys ? ` (${keys})` : "")}>
      {steps.map((step, i) => (
        <span key={step} className={s.step} aria-hidden="true"><span>{step}</span>{keys && i === steps.length - 1 ? <kbd>{keys}</kbd> : null}</span>
      ))}
    </span>
  );
}

/// The same thing on each device: a label, then its path.
export function Paths({ rows }: { rows: { on: string; steps: string[]; keys?: string }[] }) {
  return (
    <dl className={s.paths}>
      {rows.map((r) => [<dt key={`${r.on}-t`}>{r.on}</dt>, <dd key={`${r.on}-d`}><Path steps={r.steps} keys={r.keys} /></dd>])}
    </dl>
  );
}

/// Numbered steps, each in its own card.
export function Steps({ children }: { children: React.ReactNode }) {
  return <ol className={s.steps}>{children}</ol>;
}

/// Paper-cut art at the top of a post: decoration only, so it has no alt text. Its box has a fixed
/// shape, so the text under it never moves as it loads. Never a picture of an app's screen.
export function Banner({ src }: { src: string }) {
  return (
    <div className={s.banner}>
      <picture>
        <source type="image/avif" srcSet={`${src}.avif`} />
        <img src={`${src}.webp`} alt="" width={1200} height={480} decoding="async" fetchPriority="high" />
      </picture>
    </div>
  );
}

/// Something to keep: a checklist, a cheat sheet, a prompt or a script, with a Copy button that copies
/// `text` exactly. What shows is `children`, or the text itself in a code block. Copies are counted as
/// blog_copy_clicked (lib/posthog.ts reads data-event).
export function Keep({ title, note, text, code = false, children }: { title: string; note?: React.ReactNode; text: string; code?: boolean; children?: React.ReactNode }) {
  return (
    <div className={s.keep}>
      <div className={s.keepHead}>
        <p className={s.keepTitle}>{title}</p>
        <CopyButton text={text} label="Copy" className={s.copy} event="blog_copy_clicked" />
      </div>
      {children ?? (code ? <pre tabIndex={0}><code>{text}</code></pre> : <pre className={s.plain} tabIndex={0}>{text}</pre>)}
      {note && <p className={s.keepNote}>{note}</p>}
    </div>
  );
}
