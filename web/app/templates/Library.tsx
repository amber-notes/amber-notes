"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { FILTER_GRID, filterTransition } from "@/lib/filter-transition";
import s from "./templates.module.css";

type Item = { slug: string; category: string };
type Filter = { name: string; anchor: string; count: number; swatch?: string[] };

/// The gallery's one filter: a category at a time, kept in the address (?category=work) so a
/// filtered view can be linked. Without JavaScript every template simply shows.
export default function Library({ items, cards, categories }: { items: Item[]; cards: React.ReactNode[]; categories: Filter[] }) {
  const [category, setCategory] = useState<string | null>(null);

  useEffect(() => {
    const c = new URLSearchParams(location.search).get("category");
    setCategory(categories.some((x) => x.anchor === c) ? c : null);
  }, [categories]);

  // The site's filter motion (lib/filter-transition.ts), as on the blog's chips.
  const update = (c: string | null, chip: Element) => {
    // Clicking the picked chip again shows them all, so the pick goes to All.
    const picked = c === null ? chip.closest("[role=group]")?.querySelector("button") ?? chip : chip;
    void filterTransition(() => flushSync(() => setCategory(c)), picked);
    history.replaceState(null, "", c ? `?category=${c}` : location.pathname);
  };

  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const show = items.map((i) => !category || slug(i.category) === category);
  const shown = show.filter(Boolean).length;

  return (
    <div className={s.library}>
      <div className={s.filters}>
        <div className={s.filterRow} role="group" aria-label="Category">
          <button type="button" className={s.chip} aria-pressed={category === null} onClick={(e) => update(null, e.currentTarget)}>All</button>
          {categories.map((c) => (
            <button key={c.anchor} type="button" className={s.chip} aria-pressed={category === c.anchor} onClick={(e) => update(category === c.anchor ? null : c.anchor, e.currentTarget)}
>
              {c.swatch && <span className={s.swatch} aria-hidden="true">{c.swatch.map((g) => <i key={g} style={{ background: g }} />)}</span>}
              <span className={s.text}>{c.name}<span className={s.count}>{c.count}</span></span>
            </button>
          ))}
        </div>
        <p className={s.shown} aria-live="polite">{category ? `${shown} of ${items.length} templates` : `${items.length} templates`}</p>
      </div>
      <ul className={`${s.grid} ${FILTER_GRID}`}>
        {items.map((i, k) => <li key={i.slug} hidden={!show[k]}>{cards[k]}</li>)}
      </ul>
    </div>
  );
}
