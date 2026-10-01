"use client";

import { useEffect, useState } from "react";
import s from "./templates.module.css";

type Item = { slug: string; category: string; audiences: string[] };
type Filter = { name: string; anchor: string; count: number };

/// The gallery's filters: one category and one audience at a time, kept in the address
/// (?category=work&for=developers) so a filtered view can be linked. Without JavaScript every
/// template simply shows.
export default function Library({ items, cards, categories, audiences }: { items: Item[]; cards: React.ReactNode[]; categories: Filter[]; audiences: Filter[] }) {
  const [category, setCategory] = useState<string | null>(null);
  const [audience, setAudience] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const c = q.get("category"), a = q.get("for");
    setCategory(categories.some((x) => x.anchor === c) ? c : null);
    setAudience(audiences.some((x) => x.anchor === a) ? a : null);
  }, [categories, audiences]);

  const update = (c: string | null, a: string | null) => {
    setCategory(c);
    setAudience(a);
    const q = new URLSearchParams();
    if (c) q.set("category", c);
    if (a) q.set("for", a);
    history.replaceState(null, "", q.size ? `?${q}` : location.pathname);
  };

  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const show = items.map((i) => (!category || slug(i.category) === category) && (!audience || i.audiences.some((a) => slug(a) === audience)));
  const shown = show.filter(Boolean).length;
  const filtered = category !== null || audience !== null;

  return (
    <div className={s.library}>
      <div className={s.filters}>
        <div className={s.filterRow} role="group" aria-label="Category">
          <span className={s.filterLabel} aria-hidden="true">Category</span>
          <button type="button" className={s.chip} aria-pressed={category === null} onClick={() => update(null, audience)}>All</button>
          {categories.map((c) => (
            <button key={c.anchor} type="button" className={s.chip} aria-pressed={category === c.anchor} onClick={() => update(category === c.anchor ? null : c.anchor, audience)}>
              {c.name}<span className={s.count}>{c.count}</span>
            </button>
          ))}
        </div>
        <div className={s.filterRow} role="group" aria-label="Who it's for">
          <span className={s.filterLabel} aria-hidden="true">For</span>
          <button type="button" className={s.chip} aria-pressed={audience === null} onClick={() => update(category, null)}>Everyone</button>
          {audiences.map((a) => (
            <button key={a.anchor} type="button" className={s.chip} aria-pressed={audience === a.anchor} onClick={() => update(category, audience === a.anchor ? null : a.anchor)}>
              {a.name}<span className={s.count}>{a.count}</span>
            </button>
          ))}
        </div>
      </div>
      <p className={s.shown} aria-live="polite">{filtered ? `${shown} of ${items.length} templates` : `${items.length} templates`}</p>
      {shown === 0 && (
        <p className={s.none}>No templates match both filters.<button type="button" onClick={() => update(null, null)}>Show all templates</button></p>
      )}
      <ul className={s.grid}>
        {items.map((i, k) => <li key={i.slug} hidden={!show[k]}>{cards[k]}</li>)}
      </ul>
    </div>
  );
}
