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
An app note is just the app: it opens straight into the app, and there is no text side. Its data is JSON in the app's own store (encrypted, synced, versioned; every change you make gets "Changed · Undo"). The note's text is only its title and one summary line the app sets.
In a project, import from "amber":
  useStore(key, initial) / useAppData(key, initial) -> [value, set]   any JSON value
  useCollection(name) -> { items: [{ id, created, updated, ...fields }], add(fields) -> id, update(id, patch), remove(id) }
  useSettings(defaults) -> [settings, update(patch)]                 the app's own settings, drawn by the app
  batch(async () => { ... })                                          several changes as one, with one Undo
  setSummary("3 of 4 habits today")                                   the line under the title in the note list and search
  share({ name: "lift.csv", type: "text/csv", text })                 export a file: the share sheet on iPhone, a Save panel on the Mac
  useImported() -> { tables: { Heading: [rows by column] }, checklists: { Heading: [{ text, checked }] }, text } | null
    what a text note held when it became an app: start from it once (in a batch), then keep everything in the store.
  localStorage works and is kept in the same store (so it syncs); sessionStorage lasts while the app is open; IndexedDB isn't available.
A one-file app has the same through window.amber: amber.data = { values, collections }; amber.store.get/set(key, value), amber.store.collection(name).list() / add(fields) -> { id } / update(id, patch) / remove(id); amber.batch(fn); amber.setSummary(text); amber.onChange(fn) calls fn(note, data) now and after every change.
  Files: amber.files.save({ name, type, base64 }) -> { file: { $file, ... } }; keep the ref in a record and show it with amber.files.url(ref, { width }) as an <img>/<audio>/<video> src. Up to 4 MB of data; photos and recordings as files.
Converting an older note only: amber.note.tables/checklists and amber.update(op) (toggle_checklist, set_cell, append_row, delete_row, move_row, set_text, add_checklist_item, add_column, rename_column; an array is one change), or useTable(heading) / useChecklist(heading) in a project. New apps keep their data in the store, not in the note's text.
The device, through the system's own prompts (results go to the page only; write to the note explicitly if wanted): amber.device.reminders.create({ title, due, repeat: "daily" }), calendar.today() -> { events: [{ title, start, end, location, attendees }] },
  notify({ title, body, at | in }) -> { id }, notify.cancel(id), reminders.complete(id) / reminders.delete(id) (only ones an app made), openURL(url), photos.pick({ limit }) / camera.take() -> { files: [{ $file, thumb }] }, contacts.pick() -> { contact: { name, organization, emails, phones, addresses, birthday?, photo? } }, files.pick(), location.once() -> { lat, lon, place },
  maps.open({ lat, lon | query, directions }), maps.snapshot({ lat, lon, km | pins: [{ lat, lon, label }], fit, pin, width, height, dark }) -> { dataURL, region, points: [{ x, y }] } (points: where each pin landed, to draw on top). On-device AI: amber.ai.available(), amber.ai.respond(prompt, { instructions }) -> { text }. Every call returns { ok, ... } or { ok: false, error }.
Settings: the app draws its own (a settings screen or sheet inside the app, in its own style) and keeps them in amber.data or the store, with defaults in the code. Use settings for names, goals, limits, currencies and categories instead of hardcoding them. There is no native settings form; More › App Info is only for the internet, Previous App and Remove App.
Libraries: Amber Notes ships chart (Chart.js 4.4.4 → Chart), d3 (7.9.0 → d3), three (0.160.0 → THREE), tone (14.8.49 → Tone), dayjs (1.11.13), marked (12.0.2), purify (DOMPurify 3.1.6, use it on marked output),
  anime (3.2.2), confetti (canvas-confetti 1.9.3), topojson (topojson-client 3.1.0), world (country shapes, TopoJSON → worldAtlas110m).
  For a real application with several screens and state, use Preact without a build step: preact (10.24.3 → preact), preact-hooks (→ preactHooks), htm (3.1.1 → htm), router (Amber Notes, 1 kB → amberRouter: <Router> with path="/item/:id", <a href="#/add">, route(), back(); kept in memory, the page cannot navigate).
  <meta name="amber-libs" content="preact, preact-hooks, htm, router"> (what a library needs is loaded first), then const html = htm.bind(preact.h); const { useState } = preactHooks; preact.render(html\`<\${App} />\`, document.body). Declare them: <meta name="amber-libs" content="chart, d3">, loaded before your scripts as those globals; or await amber.lib("three").
  Any other npm package: npm:name@1.2.3/path/to/file.min.js#sha384-<base64> in the same meta (a pinned version and an SRI hash, sha256/384/512); Amber Notes downloads it once from cdn.jsdelivr.net, checks the hash, keeps it on the device. Never paste a library into the page.
Where the app is: amber.context = { embedded, width, height }; <html data-amber-context="widget|full">. The web view is the app's real size, with safe areas (env(safe-area-inset-*), also --amber-safe-*). On iPhone the keyboard shrinks the web view (innerHeight and visualViewport both), so a position: fixed; bottom: 0 bar or sheet sits right above it; --amber-keyboard stays 0. Keep bottom bars and pinned buttons above Amber's own things with padding-bottom: max(var(--amber-safe-bottom), var(--amber-inset-bottom)) (amber.insets.bottom; the amber:insets event when it changes).
An app can also be a project of files (written by the file tools): /index.html, /src/main.jsx, /src/App.jsx, /src/screens/, /src/components/, /src/styles.css (linked from index.html), /src/data.js, README.md. JSX/TSX is compiled when written (automatic runtime, jsxImportSource preact). Modules import bare names (no amber-libs meta, no globals): preact, preact/hooks, amber, amber-router, amber-ui, htm, and the other bundled libraries by npm name as a default export (import Chart from "chart.js").
  "amber": useNote() (the live note), useTable("Log") (by the heading above it, or a column name; never by position) -> { rows: [{ id, ...values by column }], columns, found, add(values), update(id, patch), remove(id), move(id, to) }, useChecklist("Packing") -> { items: [{ id, text, checked }], toggle(id), add(text), remove(id) }, useAppData(key, initial) -> [value, set] (kept in the app's data), useSettings(defaults) -> [settings, update(patch)], batch(async () => { ... }) (one change, one Undo), and device, ai, files, fetch.
  "amber-router": Router, Route (<Route path="/plan/:day" component={PlanDay} />), Link, route(path), back(), useRoute(); links as <a href="#/plan">.
  "amber-ui": Button, Card, List, ListRow, Input, TextArea, Select, Toggle, Slider, Stat, EmptyState, Sheet, Dialog, Tabs, TabBar, Shell, Toast, toast, Icon. Files are served from amber-app:///; fetch("/src/data.json") works for the app's own files. At most 200 files, 512 KB each, 3 MB in all.
Network: the page itself can't reach anything. Declare hosts ("*.archive.org" covers its servers, for services that redirect to numbered hosts) in <meta name="amber-needs" content='{"hosts": ["api.open-meteo.com"], "keys": [{ "name": "OpenWeather", "hosts": ["api.openweathermap.org"], "query": "appid={key}", "help": "How to get one" }]}'>
  and call amber.fetch(url, { method, headers, body, key }) -> { ok, status, body }. The person approves each host once and sees every request; with key, the app adds that API key (the page never sees it). Redirects are followed only to declared, approved hosts.
Look like Amber Notes: every app starts with two stylesheets, loaded before its own: amber-tokens.css (these variables, already switched for light and dark) and amber-base.css (body font, colours and background, visible fields, links, no sideways overflow; its full text is AMBER_BASE_CSS). Both are in cascade layers (amber-tokens, amber-base), so any style you write wins over them whatever its specificity; override freely. <meta name="amber-base" content="none"> drops amber-base.css and keeps the variables. Use the variables instead of your own colours and fonts:
  --amber-bg (the note's background), --amber-surface (cards and grouped rows), --amber-fill (controls, empty cells), --amber-text, --amber-text-secondary, --amber-separator,
  --amber-accent (amber, for marks and filled controls), --amber-accent-text (amber for text), --amber-accent-soft (a soft amber fill), --amber-on-accent (text on --amber-accent),
  --amber-danger, --amber-field and --amber-field-border (inputs), --amber-radius (cards), --amber-radius-small (controls), --amber-font (the system font), --amber-font-rounded, --amber-font-mono, --amber-content-max, --amber-gutter.
Every input, select and textarea is visible as a field in both themes: a solid fill and a 1px border (inputs get background: var(--amber-field); border: 1px solid var(--amber-field-border) by default; don't remove them). Nothing see-through: solid colours only.
Size text in rem: on iPhone the root follows the reader's text size. In a parent note the app can show as a small widget: <html> then has the class amber-widget; use a compact layout.
Fit every width: the page fills the note, from 320 px on a small iPhone to 1,800 px in a full-screen Mac window, and re-lays out live as the window resizes. Put content in a container with max-width: var(--amber-content-max) (1100 px), margin: 0 auto and side padding var(--amber-gutter). Use one column under 600 px, and from 900 px use the room (side-by-side sections, more history, bigger numbers) with @media (min-width: 900px) or the classes amber-narrow / amber-medium / amber-wide the app keeps on <html>. Never a fixed width, never a stretched phone layout. `;

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
  if (!/\bamber\s*\.\s*(note|onChange|data|store|batch)\b|\blocalStorage\b/.test(html)) out.push("The app must keep its data in its store (amber.store, amber.data, localStorage) and render from amber.onChange, not carry a fixed copy of it.");
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
