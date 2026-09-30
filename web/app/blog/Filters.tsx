"use client";

import { useEffect, useState } from "react";
import s from "./blog.module.css";

/// The category filters beside the index: each is a link to #<category>, so a post's category
/// link lands here filtered. "All posts" clears it. Without JavaScript every post simply shows.
export default function Filters({ categories }: { categories: { name: string; anchor: string; count: number }[] }) {
  const [on, setOn] = useState<string | null>(null);

  useEffect(() => {
    const read = () => {
      const h = decodeURIComponent(location.hash.slice(1));
      setOn(categories.some((c) => c.anchor === h) ? h : null);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [categories]);

  useEffect(() => {
    const grid = document.getElementById("posts");
    if (!grid) return;
    if (on) grid.dataset.filter = on;
    else delete grid.dataset.filter;
  }, [on]);

  const pick = (anchor: string | null) => (e: React.MouseEvent) => {
    e.preventDefault();
    history.replaceState(null, "", anchor ? `#${anchor}` : location.pathname);
    setOn(anchor);
  };

  return (
    <nav className={s.filters} aria-label="Categories">
      <a href="/blog" aria-current={on === null ? "true" : undefined} onClick={pick(null)}>All posts</a>
      {categories.map((c) => (
        <a key={c.anchor} href={`#${c.anchor}`} aria-current={on === c.anchor ? "true" : undefined} onClick={pick(c.anchor)}>
          {c.name}<span className={s.count}>{c.count}</span>
        </a>
      ))}
    </nav>
  );
}
