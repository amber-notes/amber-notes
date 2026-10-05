// Note pages (prototype): the optional view an AI writes over a note. The note's markdown stays the
// data; the page is one self-contained HTML document the app renders in a locked web view with no
// network, handing it the note as data. Pure, so it's unit-tested.
//
// The check here is early, readable feedback for the AI. The app's sandbox is what actually keeps a
// page off the network: a page that slips past this check still can't load or send anything.

/** Bigger than any page needs; a note's data never goes in it. */
export const MAX_PAGE_BYTES = 256 * 1024;

/** Before changing a page that exists: keep what the person relies on. */
export const PAGE_REWRITE = `Before changing a note's page, call get_note_page and read_note: keep reading the same tables and column names, keep the ops the page already uses, and keep its layout unless asked to change it. For small changes use edit_note_page instead of sending the whole page again.`;

/** What the page is given and may do. The same words go to the AI in set_note_page's description. */
export const PAGE_CONTRACT = `The page runs in Amber Notes in a sandbox with no network: no fetch, no external scripts, styles, fonts or images. Put all CSS and JS inline; images only as data: URIs or inline SVG.
Read the note from window.amber.note, never hardcode its contents (the note changes; the page must follow):
  amber.note = { title, markdown, today: "yyyy-mm-dd", tables: [{ index, columns: [{ name, type }], rows: [[cell, ...], ...] }], checklists: [{ line, text, checked }] }
  amber.onChange(fn) calls fn(note) right away and again with fresh data after every change, the page's own included. Render from it.
Change the note only through amber.update(op), which returns a Promise of { ok: true } or { ok: false, error }:
  { op: "toggle_checklist", line }            line from amber.note.checklists
  { op: "set_cell", table, row, col, value }  table index, row index (0-based, header excluded), col index or column name; plain one-line text
  { op: "append_row", table, values }         values: { columnName: text } or [text, ...]
  { op: "delete_row", table, row }  { op: "move_row", table, from, to }
  { op: "set_text", heading, text }            replaces the text under that heading (up to the next heading of the same level)
  { op: "add_checklist_item", text, under_heading? }  a new open "- [ ] text" after the last open item of that checklist (keep checklists as checklists)
Each change lands in the note's markdown as a normal edit the person can see and undo.
The page's own data (not the note's text; for state the person wouldn't type, like settings, logs, a schedule): amber.data = { values, collections };
  amber.store.get(key) / amber.store.set(key, value); amber.store.collection(name).list() / query(fn) / get(id) / add(fields) -> { id } / update(id, patch) / remove(id); amber.setData(mergePatch).
  amber.onChange(fn) passes (note, data). Up to 4 MB. Files: amber.files.save({ name, type, base64 }) -> { file: { $file, ... } }, amber.files.read(ref) -> { dataURL }; keep the ref in a record.
The device, through the system's own prompts (results go to the page only; write to the note explicitly if wanted): amber.device.reminders.create({ title, due, repeat: "daily" }), calendar.today() -> { events: [{ title, start, end, location, attendees }] },
  notify({ title, body, at | in }), openURL(url), photos.pick({ limit }) / camera.take() -> { files: [{ $file, thumb }] }, contacts.pick() -> { contact }, files.pick(), location.once() -> { lat, lon, place },
  maps.open({ lat, lon | query, directions }), maps.snapshot({ lat, lon, km, width, height, dark }) -> { dataURL }. On-device AI: amber.ai.available(), amber.ai.respond(prompt, { instructions }) -> { text }. Every call returns { ok, ... } or { ok: false, error }.
Network: the page itself can't reach anything. Declare hosts in <meta name="amber-needs" content='{"hosts": ["api.open-meteo.com"], "keys": [{ "name": "OpenWeather", "hosts": ["api.openweathermap.org"], "query": "appid={key}", "help": "How to get one" }]}'>
  and call amber.fetch(url, { method, headers, body, key }) -> { ok, status, body }. The person approves each host once and sees every request; with key, the app adds that API key (the page never sees it).
Look like Amber Notes: the app sets these CSS variables on :root, already switched for light and dark, and gives body its font, text colour and background. Use them instead of your own colours and fonts:
  --amber-bg (the note's background), --amber-surface (cards and grouped rows), --amber-fill (controls, empty cells), --amber-text, --amber-text-secondary, --amber-separator,
  --amber-accent (amber, for marks and filled controls), --amber-accent-text (amber for text), --amber-accent-soft (a soft amber fill), --amber-on-accent (text on --amber-accent),
  --amber-danger, --amber-radius (cards), --amber-radius-small (controls), --amber-font (the system font), --amber-font-rounded, --amber-font-mono, --amber-content-max, --amber-gutter.
Fit every width: the page fills the note, from 320 px on a small iPhone to 1,800 px in a full-screen Mac window, and re-lays out live as the window resizes. Put content in a container with max-width: var(--amber-content-max) (1100 px), margin: 0 auto and side padding var(--amber-gutter). Use one column under 600 px, and from 900 px use the room (side-by-side sections, more history, bigger numbers) with @media (min-width: 900px) or the classes amber-narrow / amber-medium / amber-wide the app keeps on <html>. Never a fixed width, never a stretched phone layout. Don't set a background on html or body.`;

const NAMESPACES = /^https?:\/\/www\.w3\.org\/(2000\/svg|1999\/xhtml|1999\/xlink|XML\/1998\/namespace)$/;

/** The hosts a page declares in <meta name="amber-needs" content='{"hosts": [...], "keys": [{"hosts": [...]}]}'>. */
export function declaredHosts(html: string): Set<string> {
  const tag = html.match(/<meta[^>]*name=["']amber-needs["'][^>]*>/i)?.[0];
  const content = tag?.match(/content=(['"])([\s\S]*)\1/)?.[2];
  if (!content) return new Set();
  try {
    const n = JSON.parse(content.replace(/&quot;/g, '"'));
    return new Set([...(n.hosts ?? []), ...(n.keys ?? []).flatMap((k: { hosts?: string[] }) => k.hosts ?? [])].map((h: string) => String(h).toLowerCase()));
  } catch {
    return new Set();
  }
}

/** Why a page can't be stored, or null when it can. */
export function pageProblems(html: string): string[] {
  const out: string[] = [];
  const bytes = new TextEncoder().encode(html).length;
  if (bytes > MAX_PAGE_BYTES) out.push(`The page is ${Math.ceil(bytes / 1024)} KB; the limit is ${MAX_PAGE_BYTES / 1024} KB. The note's data comes from window.amber.note, so the page itself stays small.`);
  if (!/<(script|style|body|div|main|html)\b/i.test(html)) out.push("This doesn't look like an HTML page.");

  // Any address with a scheme (https://, ws://, ftp://…), except the SVG and XHTML namespace names
  // and the hosts the page declares for amber.fetch.
  const declared = declaredHosts(html);
  const urls = [...html.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]*/gi)].map((m) => m[0])
    .filter((u) => !NAMESPACES.test(u.replace(/\/$/, "")))
    .filter((u) => { try { const x = new URL(u); return !(/^https?:$/.test(x.protocol) && declared.has(x.host.toLowerCase())); } catch { return true; } });
  if (urls.length) out.push(`External addresses aren't allowed: ${[...new Set(urls)].slice(0, 3).join(", ")}. The page has no network of its own; to call a service, declare its host in <meta name="amber-needs"> and use amber.fetch.`);
  // Protocol-relative addresses and stylesheet imports.
  if (/\b(src|href|action|formaction|poster|data|srcset|background)\s*=\s*["']?\s*\/\//i.test(html) || /url\(\s*["']?\s*\/\//i.test(html)) {
    out.push("Protocol-relative addresses (//host/...) aren't allowed.");
  }
  if (/@import\b/i.test(html)) out.push("@import isn't allowed: put all CSS in a <style> element.");
  const tags = [...new Set([...html.matchAll(/<(base|link|iframe|frame|frameset|object|embed|portal|applet)\b/gi)].map((m) => m[1].toLowerCase()))];
  if (tags.length) out.push(`<${tags.join(">, <")}> isn't allowed: everything must be inline.`);
  if (/<meta\b[^>]*http-equiv\s*=\s*["']?\s*refresh/i.test(html)) out.push("A meta refresh isn't allowed.");
  const apis = [...new Set([...html.matchAll(/(?<!amber\s*\.\s*)\b(fetch|sendBeacon|importScripts)\s*\(|\bnew\s+(XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker|RTCPeerConnection)\b|\bnavigator\.serviceWorker\b|\bwindow\.open\s*\(/g)]
    .map((m) => m[1] ?? m[2] ?? m[0].replace(/\s*\($/, "")))];
  if (apis.length) out.push(`The page can't use the network itself (${apis.join(", ")}). Use amber.fetch for declared hosts, and amber.note / amber.update for the note.`);
  if (!/\bamber\s*\.\s*(note|onChange)\b/.test(html)) out.push("The page must read the note from window.amber.note (or amber.onChange), not carry a copy of its data.");
  return out;
}

// MARK: Page data

/** A page's own data, next to it in the database (note_pages.data_ct), never in the markdown. */
export const MAX_PAGE_DATA_BYTES = 4 * 1024 * 1024;

export type PageData = { values: Record<string, unknown>; collections: Record<string, { id: string; created?: string; updated?: string; [k: string]: unknown }[]> };

/** The data's shape, checked: an object with values and collections of records with ids. */
export function pageDataProblems(data: unknown): string[] {
  const out: string[] = [];
  if (typeof data !== "object" || data === null || Array.isArray(data)) return ["Page data is one JSON object: {\"values\": {...}, \"collections\": {\"name\": [records]}}."];
  const d = data as Record<string, unknown>;
  for (const k of Object.keys(d)) if (k !== "values" && k !== "collections") out.push(`Unknown top-level key "${k}": only "values" and "collections".`);
  if (d.values !== undefined && (typeof d.values !== "object" || d.values === null || Array.isArray(d.values))) out.push("values must be an object.");
  if (d.collections !== undefined) {
    if (typeof d.collections !== "object" || d.collections === null || Array.isArray(d.collections)) out.push("collections must be an object of arrays.");
    else for (const [name, list] of Object.entries(d.collections as Record<string, unknown>)) {
      if (!Array.isArray(list)) { out.push(`Collection "${name}" must be an array of records.`); continue; }
      const ids = new Set<string>();
      list.forEach((r, i) => {
        const id = (r as { id?: unknown })?.id;
        if (typeof r !== "object" || r === null || Array.isArray(r)) out.push(`${name}[${i}] must be an object.`);
        else if (typeof id !== "string" || !id) out.push(`${name}[${i}] needs a string "id".`);
        else if (ids.has(id)) out.push(`${name} has two records with id "${id}".`);
        else ids.add(id);
      });
    }
  }
  const bytes = new TextEncoder().encode(JSON.stringify(data)).length;
  if (bytes > MAX_PAGE_DATA_BYTES) out.push(`The data would be ${(bytes / 1048576).toFixed(1)} MB; the limit is 4 MB. Keep photos, recordings and other files as files ({"$file": id}).`);
  return out;
}

/** What get_note_page shows of the data: all of it when small, else its outline. */
export function pageDataView(json: string | null): Record<string, unknown> {
  if (json === null) return { data: { values: {}, collections: {} } };
  const bytes = new TextEncoder().encode(json).length;
  const d = JSON.parse(json) as PageData;
  if (bytes <= 60_000) return { data: d, data_bytes: bytes };
  return {
    data_bytes: bytes,
    data_outline: { values: Object.keys(d.values ?? {}), collections: Object.fromEntries(Object.entries(d.collections ?? {}).map(([k, v]) => [k, v.length])) },
    data_note: "The data is too big to show here; read it with get_page_data.",
  };
}
