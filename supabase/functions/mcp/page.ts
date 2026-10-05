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
  { op: "add_column", table, name, type?, after? }  { op: "rename_column", table, col, to }
  amber.update([op, op, ...]) applies several as ONE change with one Undo (all or nothing): use it for a workout's sets, imported rows, a grocery run. Each op sees the note as the ones before it left it (lines move down after added rows).
Each change lands in the note's markdown as a normal edit the person can see and undo. Changes to the app's own data are quiet (no receipt): use the data for app state.
The page's own data (not the note's text; for state the person wouldn't type, like settings, logs, a schedule): amber.data = { values, collections };
  amber.store.get(key) / amber.store.set(key, value); amber.store.collection(name).list() / query(fn) / get(id) / add(fields) -> { id } / update(id, patch) / remove(id); amber.setData(mergePatch).
  amber.onChange(fn) passes (note, data). Up to 4 MB. Files: amber.files.save({ name, type, base64 }) -> { file: { $file, ... } }; keep the ref in a record and show it with amber.files.url(ref, { width }) as an <img>/<audio>/<video> src (instant, no data: URLs in the data); amber.files.read(ref) -> { dataURL } when you need the bytes.
The device, through the system's own prompts (results go to the page only; write to the note explicitly if wanted): amber.device.reminders.create({ title, due, repeat: "daily" }), calendar.today() -> { events: [{ title, start, end, location, attendees }] },
  notify({ title, body, at | in }) -> { id }, notify.cancel(id), reminders.complete(id) / reminders.delete(id) (only ones an app made), openURL(url), photos.pick({ limit }) / camera.take() -> { files: [{ $file, thumb }] }, contacts.pick() -> { contact: { name, organization, emails, phones, addresses, birthday?, photo? } }, files.pick(), location.once() -> { lat, lon, place },
  maps.open({ lat, lon | query, directions }), maps.snapshot({ lat, lon, km | pins: [{ lat, lon, label }], fit, pin, width, height, dark }) -> { dataURL, region, points: [{ x, y }] } (points: where each pin landed, to draw on top). On-device AI: amber.ai.available(), amber.ai.respond(prompt, { instructions }) -> { text }. Every call returns { ok, ... } or { ok: false, error }.
Settings the person can change without an AI: declare <meta name="amber-settings" content='{"settings": [{ "key": "budget", "label": "Monthly budget", "type": "number", "default": 15000 }]}'> (types: text, number (with "min", "max", "step": a slider when both ends are given), choice with "options" (strings, or { "value": 120, "label": "2 minutes" }), multi (several options, a list), list, color, currency, toggle (true/false), time ("21:30"), date ("2026-10-05")).
  Each may have "help" (a line under it), "section" (settings with the same section are grouped under that heading) and "showIf": "otherKey" or { "key": "otherKey", "equals": value } (shown only then).
  amber.openSettings() opens that sheet; don't build a settings screen or a gear of your own.
  Amber Notes shows them in App Settings; read amber.settings (defaults filled in); onChange runs when they change. Use settings for names, goals, limits, currencies and categories instead of hardcoding them.
Libraries: Amber Notes ships chart (Chart.js 4.4.4 → Chart), d3 (7.9.0 → d3), three (0.160.0 → THREE), tone (14.8.49 → Tone), dayjs (1.11.13), marked (12.0.2), purify (DOMPurify 3.1.6, use it on marked output),
  anime (3.2.2), confetti (canvas-confetti 1.9.3), topojson (topojson-client 3.1.0), world (country shapes, TopoJSON → worldAtlas110m).
  For a real application with several screens and state, use Preact without a build step: preact (10.24.3 → preact), preact-hooks (→ preactHooks), htm (3.1.1 → htm), router (Amber Notes, 1 kB → amberRouter: <Router> with path="/item/:id", <a href="#/add">, route(), back(); kept in memory, the page cannot navigate).
  <meta name="amber-libs" content="preact, preact-hooks, htm, router"> (what a library needs is loaded first), then const html = htm.bind(preact.h); const { useState } = preactHooks; preact.render(html\`<\${App} />\`, document.body). Declare them: <meta name="amber-libs" content="chart, d3">, loaded before your scripts as those globals; or await amber.lib("three").
  Any other npm package: npm:name@1.2.3/path/to/file.min.js#sha384-<base64> in the same meta (a pinned version and an SRI hash, sha256/384/512); Amber Notes downloads it once from cdn.jsdelivr.net, checks the hash, keeps it on the device. Never paste a library into the page.
Where the app is: amber.context = { embedded, width, height }; <html data-amber-context="widget|full">. The web view is the app's real size, with safe areas (env(safe-area-inset-*)); resizing and the keyboard work the standard web way.
Network: the page itself can't reach anything. Declare hosts ("*.archive.org" covers its servers, for services that redirect to numbered hosts) in <meta name="amber-needs" content='{"hosts": ["api.open-meteo.com"], "keys": [{ "name": "OpenWeather", "hosts": ["api.openweathermap.org"], "query": "appid={key}", "help": "How to get one" }]}'>
  and call amber.fetch(url, { method, headers, body, key }) -> { ok, status, body }. The person approves each host once and sees every request; with key, the app adds that API key (the page never sees it). Redirects are followed only to declared, approved hosts.
Look like Amber Notes: the app sets these CSS variables on :root, already switched for light and dark, and gives body its font, text colour and background. Use them instead of your own colours and fonts:
  --amber-bg (the note's background), --amber-surface (cards and grouped rows), --amber-fill (controls, empty cells), --amber-text, --amber-text-secondary, --amber-separator,
  --amber-accent (amber, for marks and filled controls), --amber-accent-text (amber for text), --amber-accent-soft (a soft amber fill), --amber-on-accent (text on --amber-accent),
  --amber-danger, --amber-field and --amber-field-border (inputs), --amber-radius (cards), --amber-radius-small (controls), --amber-font (the system font), --amber-font-rounded, --amber-font-mono, --amber-content-max, --amber-gutter.
Every input, select and textarea is visible as a field in both themes: a solid fill and a 1px border (inputs get background: var(--amber-field); border: 1px solid var(--amber-field-border) by default; don't remove them). Nothing see-through: solid colours only.
Size text in rem: on iPhone the root follows the reader's text size. In a parent note the app can show as a small widget: <html> then has the class amber-widget; use a compact layout.
Fit every width: the page fills the note, from 320 px on a small iPhone to 1,800 px in a full-screen Mac window, and re-lays out live as the window resizes. Put content in a container with max-width: var(--amber-content-max) (1100 px), margin: 0 auto and side padding var(--amber-gutter). Use one column under 600 px, and from 900 px use the room (side-by-side sections, more history, bigger numbers) with @media (min-width: 900px) or the classes amber-narrow / amber-medium / amber-wide the app keeps on <html>. Never a fixed width, never a stretched phone layout. Don't set a background on html or body.`;

/** Libraries Amber Notes ships (Pane/Resources/AppLibraries/libraries.json): name → the global it defines. */
export const BUNDLED_LIBS: Record<string, string> = {
  chart: "Chart", d3: "d3", three: "THREE", tone: "Tone", dayjs: "dayjs", marked: "marked", purify: "DOMPurify",
  anime: "anime", confetti: "confetti", topojson: "topojson", world: "worldAtlas110m",
  preact: "preact", "preact-hooks": "preactHooks", htm: "htm", router: "amberRouter",
};

/** npm:<name>@<x.y.z>[/<file>]#<sha256|sha384|sha512>-<base64>: a pinned package, checked by hash. */
export const NPM_REF = /^npm:((?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*)@(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?)(\/[^#\s]+)?#(sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2}$/;

/** What <meta name="amber-libs"> asks for that can't be served. */
export function libProblems(html: string): string[] {
  const tag = html.match(/<meta[^>]*name=["']amber-libs["'][^>]*>/i)?.[0];
  const content = tag?.match(/content=(['"])([\s\S]*?)\1/)?.[2];
  if (!content) return [];
  const out: string[] = [];
  for (const item of content.split(",").map((x) => x.trim()).filter(Boolean)) {
    if (item.startsWith("npm:")) {
      if (!NPM_REF.test(item)) out.push(`"${item}" needs a pinned version and a hash: npm:name@1.2.3/file.min.js#sha384-… (sha256, sha384 or sha512, base64).`);
    } else if (!(item in BUNDLED_LIBS)) {
      out.push(`No bundled library "${item}". Bundled: ${Object.keys(BUNDLED_LIBS).join(", ")}; anything else as npm:name@version#hash.`);
    }
  }
  return out;
}

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

/** A host the page declared, exactly or under a "*.example.org" pattern (whole labels, not a bare TLD). */
export function hostDeclared(declared: Set<string>, host: string): boolean {
  if (declared.has(host)) return true;
  return [...declared].some((d) => d.startsWith("*.") && d.slice(2).includes(".") && !d.slice(2).includes("*") && host.endsWith(d.slice(1)));
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
    .filter((u) => !NAMESPACES.test(u.replace(/\/$/, "")) && !/^amber-(lib|file):/i.test(u))
    .filter((u) => { try { const x = new URL(u); return !(/^https?:$/.test(x.protocol) && hostDeclared(declared, x.host.toLowerCase())); } catch { return true; } });
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
  out.push(...libProblems(html));
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
