"use client";

import { useEffect, useState } from "react";

/// How many blog lists are on screen: one while a list is shown, and still one while the next list
/// renders, since the page it replaces stays until the new one is in.
let shown = 0;

/// A blog list's frame. Arriving from another list (a chip, a page number, back or forward), the
/// title, chips and posts don't play their entrance again: blog.module.css turns "rise" off under
/// data-still. The first list of a visit, and one reached from any other page, rises as before.
export default function BlogList({ className, children }: { className: string; children: React.ReactNode }) {
  const [still] = useState(() => shown > 0);
  useEffect(() => {
    shown++;
    return () => { shown--; };
  }, []);
  return <section className={className} data-still={still || undefined}>{children}</section>;
}
