"use client";

import { useEffect, useState } from "react";

/// Design review only: `?v=a|b|c` swaps the page for one of the options being compared. Without it
/// (and on the server) the page shows `children`, the design visitors see today.
export default function Pick({ options, children }: { options: Record<string, React.ReactNode>; children: React.ReactNode }) {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("v");
    if (asked && Object.hasOwn(options, asked)) setV(asked);
  }, [options]);
  return <>{v ? options[v] : children}</>;
}
