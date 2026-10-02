"use client";

import { useEffect, useState } from "react";

const GITHUB = "https://github.com/amber-notes/amber-notes";

/// The live star count from /stars.json, or null when it can't be had (offline, GitHub down, a bad answer).
export async function fetchStars(): Promise<number | null> {
  try {
    const r = await fetch("/stars.json");
    if (!r.ok) return null;
    const { stars } = (await r.json()) as { stars?: unknown };
    return typeof stars === "number" && Number.isInteger(stars) && stars >= 0 ? stars : null;
  } catch {
    return null;
  }
}

/// The star count the page was built with, then the live one once it's fetched.
export function useStars(built: number | null): number | null {
  const [stars, setStars] = useState(built);
  useEffect(() => {
    let live = true;
    fetchStars().then((n) => { if (live && n !== null) setStars(n); });
    return () => { live = false; };
  }, []);
  return stars;
}

/// The header's GitHub link. The page renders with the star count it was built with, then swaps in
/// the live one after load; when that fails, the built number stays.
export default function GitHubLink({ stars: built }: { stars: number | null }) {
  const stars = useStars(built);
  return (
    <a className="site-gh" href={GITHUB} target="_blank" rel="noopener noreferrer" aria-label={stars !== null ? `GitHub, ${stars} stars` : "GitHub"}>
      <GitHubGlyph />{stars !== null && <span className="site-stars">★ {stars.toLocaleString("en")}</span>}
    </a>
  );
}

export function GitHubGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
