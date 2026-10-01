import { anchor, shape, templatePath, type Shape, type Template } from "@/lib/templates";
import s from "./templates.module.css";

/// One template in the gallery or under "More templates": its real note, filled in, in miniature,
/// then what it is and who it's for. The whole card is the link; "Use template" says so at rest.
export default function Card({ t, heading = "h2" }: { t: Template; heading?: "h2" | "h3" }) {
  const H = heading;
  return (
    <a className={s.card} href={templatePath(t.slug)}>
      <div className={s.cardArt} data-cat={anchor(t.category)} aria-hidden="true">
        <Mini title={t.note.split("\n")[0]} rows={shape(t.example)} />
      </div>
      <span className={s.cardText}>
        <span className={s.label}>{t.category}</span>
        <H className={s.cardTitle}>{t.title}</H>
        <span className={s.cardLine}>{t.description}</span>
      </span>
      <span className={s.cardFoot}>
        <span className={s.tags}>{t.audiences.map((a) => <span key={a} className={s.tag}>{a}</span>)}</span>
        <span className={s.use} aria-hidden="true">Use template<ArrowGlyph /></span>
      </span>
    </a>
  );
}

const ArrowGlyph = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>;

/// A small Amber Notes page: the title, then the note's headings, checklists, lists and tables.
export function Mini({ title, rows }: { title: string; rows: Shape[] }) {
  return (
    <div className={s.mini}>
      <p className={s.miniTitle}>{title}</p>
      <div className={s.miniRows}>
        {rows.map((r, i) => {
          switch (r.kind) {
            case "heading": return <p key={i} className={s.miniH}>{r.text}</p>;
            case "text": return <p key={i} className={s.miniText}>{r.text}</p>;
            case "check": return <p key={i} className={s.miniCheck} data-done={r.done || undefined}><i /><span>{r.text}</span></p>;
            case "item": return <p key={i} className={s.miniItem}><i /><span>{r.text}</span></p>;
            case "table": {
              const cols = Math.min(r.columns.length, 4);
              const cell = (v: string, k: number) => <span key={k}>{v === "Yes" ? <i className={s.miniYes} /> : v === "No" ? <i className={s.miniNo} /> : v}</span>;
              return (
                <div key={i} className={s.miniTable} style={{ "--cols": cols } as React.CSSProperties}>
                  <div className={s.miniTr}>{r.columns.slice(0, cols).map((c, k) => <span key={k}>{c}</span>)}</div>
                  {r.rows.map((row, j) => <div key={j} className={s.miniTr}>{row.slice(0, cols).map(cell)}</div>)}
                </div>
              );
            }
          }
        })}
      </div>
    </div>
  );
}
