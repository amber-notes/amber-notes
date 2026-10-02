/// Three drafts of the phone header, to compare on a real phone: A shows the links in one row, B puts
/// them in a menu, C keeps Templates in the header and puts the rest in the menu. Preview deployments and local development only (next.config.ts sets the flag);
/// production always shows A and never reads the address. Goes away when one is picked.
export const HEADER_DRAFTS = process.env.NEXT_PUBLIC_HEADER_DRAFTS === "1";

export type HeaderVariant = "a" | "b" | "c";

/// ?header=a|b|c picks the draft and the tab remembers it, so links inside the site keep it.
export function headerVariant(search: string, remembered: string | null): HeaderVariant {
  const asked = new URLSearchParams(search).get("header");
  if (asked === "a" || asked === "b" || asked === "c") return asked;
  return remembered === "b" || remembered === "c" ? remembered : "a";
}

/// The same rule, run in <head> before first paint so the header never flashes the other draft.
export const headerDraftScript = `(function(){try{var m=/[?&]header=([abc])(?:&|$)/.exec(location.search),v=m?m[1]:sessionStorage.getItem("header");if(m)sessionStorage.setItem("header",v);if(v==="b"||v==="c")document.documentElement.dataset.header=v;}catch(e){}})();`;
