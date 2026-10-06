/// Three footer effects under review, picked with ?footer=a|b|c (app/site.css has the effects).
/// The choice holds for the tab so it follows the reviewer between pages; ?footer=off clears it.
/// Without a choice the footer is exactly as it was.
export type FooterFx = "a" | "b" | "c";

export const FOOTER_FX_KEY = "amber.footer-fx";

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

const isFx = (v: string | null): v is FooterFx => v === "a" || v === "b" || v === "c";

export function footerFx(search: string, store: Store | null): FooterFx | null {
  const asked = new URLSearchParams(search).get("footer");
  try {
    if (isFx(asked)) store?.setItem(FOOTER_FX_KEY, asked);
    else if (asked !== null) store?.removeItem(FOOTER_FX_KEY);
    const kept = store?.getItem(FOOTER_FX_KEY) ?? null;
    return isFx(kept) ? kept : null;
  } catch {
    return isFx(asked) ? asked : null; // storage blocked: the address alone decides
  }
}
