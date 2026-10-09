"use client";

import { useState } from "react";
import CopyButton from "@/app/templates/CopyButton";
import s from "./post-parts.module.css";

/// A few templates to copy, one shown at a time: pick one, see it the way Notes shows it once pasted
/// (a title, headings, Notes' round checkboxes), and copy it as Markdown. Every template stays in the
/// page's HTML, the ones not picked hidden, so search engines and AI answers can read them all.
/// Picking one counts as blog_helper_used, and copying as blog_copy_clicked.
export type Template = { title: string; text: string };

export function TemplatePicker({ templates, legend }: { templates: Template[]; legend: string }) {
  const [picked, setPicked] = useState(0);
  return (
    <div className={s.chooser}>
      <fieldset>
        <legend>{legend}</legend>
        <div className={s.choices}>
          {templates.map((t, i) => (
            <button key={t.title} type="button" aria-pressed={picked === i} data-event="blog_helper_used" onClick={() => setPicked(i)}>{t.title}</button>
          ))}
        </div>
      </fieldset>
      {templates.map((t, i) => (
        <div key={t.title} className={s.verdict} hidden={picked !== i}>
          <Preview text={t.text} copy={<CopyButton text={t.text} label="Copy" className={s.copy} event="blog_copy_clicked" />} />
        </div>
      ))}
    </div>
  );
}

/// The Markdown drawn the way Notes shows it after Paste as Markdown.
type Block = { kind: "title" | "heading" | "line"; text: string } | { kind: "tick" | "dash"; items: string[] };

export function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  for (const line of text.split("\n")) {
    const tick = /^- \[ \] (.+)$/.exec(line)?.[1];
    const dash = tick === undefined ? /^- (.+)$/.exec(line)?.[1] : undefined;
    const item = tick ?? dash;
    if (item !== undefined) {
      const kind = tick !== undefined ? "tick" : "dash";
      const last = blocks.at(-1);
      if (last && last.kind === kind && "items" in last) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (line.startsWith("# ")) blocks.push({ kind: "title", text: line.slice(2) });
    else if (line.startsWith("## ")) blocks.push({ kind: "heading", text: line.slice(3) });
    else if (line.trim()) blocks.push({ kind: "line", text: line });
  }
  return blocks;
}

const CLASS = { title: s.tplTitle, heading: s.tplHeading, line: s.tplLine };

/// The note's title shares a row with the Copy button.
function Preview({ text, copy }: { text: string; copy: React.ReactNode }) {
  const [first, ...rest] = blocksOf(text);
  const title = first?.kind === "title" ? first.text : null;
  return (
    <div className={s.tpl}>
      <div className={s.keepHead}>{title && <p className={s.tplTitle}>{title}</p>}{copy}</div>
      {(title ? rest : [first, ...rest]).map((b, i) => "items" in b
        ? <ul key={i} className={b.kind === "tick" ? s.ticks : s.dashes}>{b.items.map((it) => <li key={it}>{it}</li>)}</ul>
        : <p key={i} className={CLASS[b.kind]}>{b.text}</p>)}
    </div>
  );
}
