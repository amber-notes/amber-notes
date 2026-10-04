// Note pages (prototype): the optional view an AI writes over a note. The note's markdown stays the
// data; the page is one self-contained HTML document the app renders in a locked web view with no
// network, handing it the note as data. Pure, so it's unit-tested.
//
// The check here is early, readable feedback for the AI. The app's sandbox is what actually keeps a
// page off the network: a page that slips past this check still can't load or send anything.

/** Bigger than any page needs; a note's data never goes in it. */
export const MAX_PAGE_BYTES = 256 * 1024;

/** What the page is given and may do. The same words go to the AI in set_note_page's description. */
export const PAGE_CONTRACT = `The page runs in Amber Notes in a sandbox with no network: no fetch, no external scripts, styles, fonts or images. Put all CSS and JS inline; images only as data: URIs or inline SVG.
Read the note from window.amber.note, never hardcode its contents (the note changes; the page must follow):
  amber.note = { title, markdown, today: "yyyy-mm-dd", tables: [{ index, columns: [{ name, type }], rows: [[cell, ...], ...] }], checklists: [{ line, text, checked }] }
  amber.onChange(fn) calls fn(note) right away and again with fresh data after every change, the page's own included. Render from it.
Change the note only through amber.update(op), which returns a Promise of { ok: true } or { ok: false, error }:
  { op: "toggle_checklist", line }            line from amber.note.checklists
  { op: "set_cell", table, row, col, value }  table index, row index (0-based, header excluded), col index or column name; plain one-line text
  { op: "append_row", table, values }         values: { columnName: text } or [text, ...]
Each change lands in the note's markdown as a normal edit the person can see and undo. Support light and dark (prefers-color-scheme) and small screens.`;

const NAMESPACES = /^https?:\/\/www\.w3\.org\/(2000\/svg|1999\/xhtml|1999\/xlink|XML\/1998\/namespace)$/;

/** Why a page can't be stored, or null when it can. */
export function pageProblems(html: string): string[] {
  const out: string[] = [];
  const bytes = new TextEncoder().encode(html).length;
  if (bytes > MAX_PAGE_BYTES) out.push(`The page is ${Math.ceil(bytes / 1024)} KB; the limit is ${MAX_PAGE_BYTES / 1024} KB. The note's data comes from window.amber.note, so the page itself stays small.`);
  if (!/<(script|style|body|div|main|html)\b/i.test(html)) out.push("This doesn't look like an HTML page.");

  // Any address with a scheme (https://, ws://, ftp://…), except the SVG and XHTML namespace names.
  const urls = [...html.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]*/gi)].map((m) => m[0]).filter((u) => !NAMESPACES.test(u.replace(/\/$/, "")));
  if (urls.length) out.push(`External addresses aren't allowed (the page has no network): ${[...new Set(urls)].slice(0, 3).join(", ")}.`);
  // Protocol-relative addresses and stylesheet imports.
  if (/\b(src|href|action|formaction|poster|data|srcset|background)\s*=\s*["']?\s*\/\//i.test(html) || /url\(\s*["']?\s*\/\//i.test(html)) {
    out.push("Protocol-relative addresses (//host/...) aren't allowed.");
  }
  if (/@import\b/i.test(html)) out.push("@import isn't allowed: put all CSS in a <style> element.");
  const tags = [...new Set([...html.matchAll(/<(base|link|iframe|frame|frameset|object|embed|portal|applet)\b/gi)].map((m) => m[1].toLowerCase()))];
  if (tags.length) out.push(`<${tags.join(">, <")}> isn't allowed: everything must be inline.`);
  if (/<meta\b[^>]*http-equiv\s*=\s*["']?\s*refresh/i.test(html)) out.push("A meta refresh isn't allowed.");
  const apis = [...new Set([...html.matchAll(/\b(fetch|sendBeacon|importScripts)\s*\(|\bnew\s+(XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker|RTCPeerConnection)\b|\bnavigator\.serviceWorker\b|\bwindow\.open\s*\(/g)]
    .map((m) => m[1] ?? m[2] ?? m[0].replace(/\s*\($/, "")))];
  if (apis.length) out.push(`The page can't use the network (${apis.join(", ")}). Read the note from window.amber.note and change it with amber.update.`);
  if (!/\bamber\s*\.\s*(note|onChange)\b/.test(html)) out.push("The page must read the note from window.amber.note (or amber.onChange), not carry a copy of its data.");
  return out;
}
