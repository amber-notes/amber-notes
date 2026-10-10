// Note pages (prototype): advice on a page that was accepted. pageProblems (page.ts) refuses what
// can't work; these are what makes a page break later or feel wrong, said so the AI can fix it in
// the same turn. Heuristics over the HTML text, so they can be wrong: each says what it saw.

import { findTables } from "./notes.ts";

export function pageWarnings(html: string, body?: string): string[] {
  const out: string[] = [];
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  const js = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n");

  const themed = /var\(--amber-/.test(html);
  if (!themed && !/prefers-color-scheme\s*:\s*dark/i.test(html)) out.push("The app uses neither the --amber-* variables nor colors of its own with a dark variant (@media (prefers-color-scheme: dark)): it won't follow dark mode.");
  else {
    // Fixed colors in a themed page break dark mode unless they have a dark variant.
    const fixed = [...css.matchAll(/(?:^|[;{\s])(color|background(?:-color)?)\s*:\s*(#[0-9a-f]{3,8}\b|white|black|rgb\([^)]*\))/gi)].map((m) => `${m[1]}: ${m[2]}`);
    if (fixed.length && !/prefers-color-scheme\s*:\s*dark/i.test(html)) out.push(`Fixed colors without a dark variant (${fixed.slice(0, 3).join(", ")}): use --amber-* variables, or add @media (prefers-color-scheme: dark).`);
  }
  if (/(^|[\s,}])(html|body)\s*[,{][^}]*background/i.test(css)) out.push("Don't set a background on html or body: the app gives body the note's background (--amber-bg).");
  if (/name=["']amber-settings["']|\bamber\s*\.\s*(settings|openSettings)\b/.test(html)) out.push("amber-settings, amber.settings and amber.openSettings() were removed: draw the settings inside the app (a gear, a Settings tab or a section at the end) and keep them in values.settings.");
  const important = (css.match(/!\s*important/gi) ?? []).length + [...html.matchAll(/\sstyle\s*=\s*(["'])([^"']*)\1/gi)].filter((m) => /!\s*important/i.test(m[2])).length;
  if (important) out.push(`!important appears ${important} time${important > 1 ? "s" : ""}: it isn't needed. amber-base.css sits in a cascade layer, so any rule the app writes already wins over it; restyle what you want, or opt out with <meta name="amber-base" content="none">.`);
  const wide = [...css.matchAll(/(?:^|[;{\s])(width|min-width)\s*:\s*(\d{3,})px/gi)].filter((m) => Number(m[2]) > 380);
  if (wide.length) out.push(`Fixed widths over 380 px (${wide.slice(0, 3).map((m) => `${m[1]}: ${m[2]}px`).join(", ")}) overflow a 390 px phone. Use max-width or percentages.`);
  if (/\b(indexedDB|document\.cookie)\b/.test(js)) out.push("IndexedDB and cookies aren't available in the sandbox. Keep data in amber.store (or localStorage, which Pinto Notes keeps and syncs).");
  if (/\b(alert|confirm|prompt)\s*\(/.test(js)) out.push("alert/confirm/prompt don't show in the sandbox. Show messages inline.");
  if (/\bsetInterval\s*\(/.test(js) && !/onChange/.test(js)) out.push("Polling with setInterval: use amber.onChange, which fires on every change.");
  if (/innerHTML/.test(js) && !/&amp;|&lt;|replace\([^)]*[<&]/.test(js) && !/textContent/.test(js)) out.push("Values from the note go into innerHTML without escaping. Escape < & \" ' (see the guide's esc helper) or use textContent; notes contain those characters.");
  const inputs = [...html.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)].filter((m) => !/type\s*=\s*["']?(hidden|submit|button)/i.test(m[2]));
  const labelled = (attrs: string) => /aria-label(ledby)?\s*=/i.test(attrs) || (/\bid\s*=\s*["']?([\w-]+)/i.test(attrs) && new RegExp(`for\\s*=\\s*["']?${attrs.match(/\bid\s*=\s*["']?([\w-]+)/i)![1]}\\b`).test(html));
  if (inputs.length && !/<label\b/i.test(html) && inputs.some((m) => !labelled(m[2]))) out.push("Inputs without labels: wrap each in a <label> or give it aria-label, so VoiceOver can name it.");
  if (/<button\b[^>]*>\s*(<svg[\s\S]*?<\/svg>)?\s*<\/button>/i.test(html) && !/<button\b[^>]*aria-label/i.test(html)) out.push("Icon-only buttons need aria-label.");
  if (!/<html[^>]*\blang\s*=/i.test(html)) out.push('Add lang="en" (or the note\'s language) to <html>.');
  if (/\b(document\.write)\s*\(/.test(js)) out.push("document.write breaks re-rendering: render into an element from amber.onChange.");
  if (!/onChange/.test(js) && /amber\.note/.test(js)) out.push("The app reads amber.note once but never subscribes: use amber.onChange(render) so it follows edits, sync and Undo.");
  if (/\bamber\.(update|setData)\b/.test(js) && !/\.ok\b/.test(js)) out.push("amber.update / amber.setData results aren't checked: show r.error when r.ok is false.");

  // Rows copied into the page instead of read from amber.note.
  if (body) {
    const cells = new Set(findTables(body).flatMap((t) => t.rows.flatMap((r) => r)).filter((c) => c.length >= 4 && !/^\d+([.,]\d+)?$/.test(c) && !/^\d{4}-\d{2}-\d{2}$/.test(c)));
    const copied = [...cells].filter((c) => html.includes(c));
    if (copied.length >= 3) out.push(`The app contains the note's own values (${copied.slice(0, 3).map((c) => `"${c}"`).join(", ")}…). Read them from amber.note instead; the app must follow the note when it changes.`);
  }
  return out;
}
