"use client";

import { useEffect, useState } from "react";
import type { QA } from "./questions";
import f from "./faq.module.css";

/// One question per row; click to open. Each row has an #anchor, and opening one updates the address.
export default function Faq({ items }: { items: QA[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fromHash = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (!items.some((i) => i.id === id)) return;
      setOpen((o) => new Set(o).add(id));
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [items]);

  const toggle = (id: string) => {
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id); else n.add(id);
      history.replaceState(null, "", n.has(id) ? `#${id}` : location.pathname);
      return n;
    });
  };

  return (
    <div className={f.list}>
      {items.map((it) => {
        const on = open.has(it.id);
        return (
          <div key={it.id} id={it.id} className={f.item} data-open={on || undefined}>
            <h2 className={f.q}>
              <button type="button" aria-expanded={on} aria-controls={`${it.id}-a`} onClick={() => toggle(it.id)}>
                <span>{it.q}</span>
                <svg className={f.chev} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5.5 7 9.5l4-4" /></svg>
              </button>
            </h2>
            <div id={`${it.id}-a`} role="region" aria-labelledby={it.id} className={f.a} inert={!on || undefined}>
              <div>
                {it.a.map((p) => <p key={p}>{p}</p>)}
                {it.more && <p className={f.more}><a href={it.more.href}>{it.more.text}</a></p>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
