"use client";

import { useEffect, useState } from "react";
import styles from "./legal.module.css";

export type Section = { id: string; title: string };
type Other = { href: string; label: string };

/// A long page's contents. On wide screens it's a list in the left margin that stays in view and
/// marks the section being read; on narrower ones it's one row above the text that opens the list.
/// Without JavaScript both still work as plain links; only the mark is missing.
export function LegalToc({ sections, other, place }: { sections: Section[]; other?: Other; place: "rail" | "fold" }) {
  const current = useCurrentSection(sections, place === "rail");
  const list = (
    <ol>
      {sections.map((s) => (
        <li key={s.id}><a href={`#${s.id}`} aria-current={current === s.id ? "location" : undefined}>{s.title}</a></li>
      ))}
    </ol>
  );
  if (place === "fold") {
    return (
      <details className={styles.fold}>
        <summary>
          <span>On this page</span>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5.5 7 9.5l4-4" /></svg>
        </summary>
        <nav className={styles.toc} aria-label="On this page">
          {list}
          {other && <p className={styles.tocOther}><a href={other.href}>{other.label} →</a></p>}
        </nav>
      </details>
    );
  }
  return (
    <nav className={styles.toc} aria-label="On this page">
      <p className={styles.tocLabel}>On this page</p>
      {list}
      {other && <p className={styles.tocOther}><a href={other.href}>{other.label} →</a></p>}
    </nav>
  );
}

/// The section whose heading was the last to pass the top of the window.
function useCurrentSection(sections: Section[], on: boolean): string | null {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    if (!on) return;
    const heads = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el);
    if (!heads.length) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      let id: string | null = null;
      for (const h of heads) {
        if (h.getBoundingClientRect().top <= 120) id = h.id;
        else break;
      }
      setCurrent(id);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [sections, on]);
  return current;
}
