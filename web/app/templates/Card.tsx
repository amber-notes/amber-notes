import { COVERS, coverPath, inkOn } from "@/lib/template-covers";
import { slice, templatePath, type SliceRow, type Template } from "@/lib/templates";
import s from "./templates.module.css";

/// One template in the gallery or under "More templates": its cover fills the card, the title sits
/// once on the cover's calm lower third, and under it a slice of the real note, filled in, with
/// "Use template". The whole card is the link.
export default function Card({ t, heading = "h2" }: { t: Template; heading?: "h2" | "h3" }) {
  const H = heading;
  const cover = COVERS[t.slug];
  return (
    <a className={s.card} href={templatePath(t.slug)} data-ink={inkOn(cover.ground)} style={{ "--ground": cover.ground } as React.CSSProperties}>
      <span className={s.cover}><img src={coverPath(t.slug)} alt={cover.alt} width={800} height={800} loading="lazy" decoding="async" /></span>
      <span className={s.cardText}>
        <H className={s.cardTitle}>{t.title}</H>
        <span className={s.cardLine}>{t.tagline}</span>
      </span>
      <span className={s.slice} aria-hidden="true">
        <span className={s.sliceNote}>{slice(t).map((r, i) => <Row key={i} r={r} />)}</span>
        <span className={s.cardFoot}><span className={s.use}>Use template<ArrowGlyph /></span></span>
      </span>
    </a>
  );
}

const ArrowGlyph = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>;

/// A row of the slice the way Amber Notes draws it: Yes/No columns and done items as amber ticks,
/// sub-notes as chips, the newest line tinted the way the app tints what an AI just added.
function Row({ r }: { r: SliceRow }) {
  switch (r.kind) {
    case "heading": return <span className={s.sliceH}>{r.text}</span>;
    case "label": return <span className={s.sliceSub}>{r.text}</span>;
    case "table": {
      const cols = Math.min(r.columns.length, 4);
      const cell = (v: string, k: number) => <span key={k}>{v === "Yes" ? <i className={s.sliceYes} /> : v === "No" ? <i className={s.sliceNo} /> : v}</span>;
      return (
        <span className={s.sliceTable} style={{ "--cols": cols } as React.CSSProperties}>
          <span className={s.sliceTr}>{r.columns.slice(0, cols).map((c, k) => <span key={k}>{c}</span>)}</span>
          {r.rows.map((row, j) => <span key={j} className={s.sliceTr} data-fresh={j === r.fresh || undefined}>{row.slice(0, cols).map(cell)}</span>)}
        </span>
      );
    }
    case "check": return <span className={s.sliceLine} data-fresh={r.fresh}><i className={r.done ? s.sliceYes : s.sliceNo} /><span data-done={r.done || undefined}>{r.text}</span></span>;
    case "subnote": return <span className={s.sliceLine} data-fresh={r.fresh}><i className={s.sliceChip} /><span>{r.text}</span></span>;
    case "quote": return <span className={`${s.sliceLine} ${s.sliceQuote}`} data-fresh={r.fresh}><span>{r.text}</span></span>;
    case "item": return <span className={s.sliceLine} data-fresh={r.fresh}><i className={s.sliceDot} /><span>{r.label && <b>{r.label} </b>}{r.text}</span></span>;
    case "text": return <span className={s.sliceLine} data-fresh={r.fresh}><span>{r.label && <b>{r.label} </b>}{r.text}</span></span>;
  }
}
