"use client";

import { useEffect, useRef, useState } from "react";

/// Marks its child figure with data-in once it has been seen, so CSS can play an entrance once.
export default function InView({ className, label, children }: { className: string; label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <figure ref={ref} className={className} aria-label={label} data-in={seen || undefined}>{children}</figure>;
}
