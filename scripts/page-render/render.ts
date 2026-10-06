/// <reference lib="dom" />
// Opens a note's app the way Amber Notes does (the same CSP, theme, window.amber bridge, no network)
// in headless WebKit at the widths and color schemes asked for, and measures it: script errors,
// overflow, contrast, small or faint text, unlabeled controls, an edit from the app, and probes
// over changed notes. Used by the render service (server.ts, behind check_app and preview_app) and
// by the evals. Edits run through page_input.ts, the TypeScript twin of Pane/Model/NotePage.swift.
import { Buffer } from "node:buffer";
import { webkit, type Browser, type Page } from "npm:playwright-core@1.63.0";
import { applyPageOp, importedFrom, noteForPage } from "../../supabase/functions/mcp/page_input.ts";
import { mergePatch } from "../../supabase/functions/mcp/data_ops.ts";
import { findTables } from "../../supabase/functions/mcp/notes.ts";
import { AMBER_BASE_CSS } from "../../supabase/functions/mcp/amber-base.ts";

// Pane/Views/NotePageView.swift: NotePageSandbox.policy and sandboxed(_:).
const POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; " +
  "connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'";

// amber-tokens.css as the iPhone app writes it (Pane/Views/NotePageView.swift, NotePageTheme.tokens),
// then amber-base.css, the file the app ships, unless the page opts out with <meta name="amber-base" content="none">.
const vars = (d: boolean) => [
  ["--amber-bg", d ? "#000000" : "#FFFEFD"], ["--amber-surface", d ? "#1C1B1A" : "#F4F1EE"], ["--amber-fill", d ? "#2C2A28" : "#EBE6E1"],
  ["--amber-text", d ? "#F6EFE7" : "#2A1D10"], ["--amber-text-secondary", d ? "#BCB0A3" : "#74604C"],
  ["--amber-separator", d ? "rgba(255, 250, 245, 0.10)" : "rgba(138, 74, 28, 0.14)"], ["--amber-accent", d ? "#F4AD33" : "#D96A06"],
  ["--amber-accent-text", d ? "#F4AD33" : "#A85700"], ["--amber-accent-soft", d ? "#423014" : "#FFF1DC"], ["--amber-on-accent", d ? "#1F1300" : "#FFFFFF"],
  ["--amber-danger", d ? "#FF6B5E" : "#C62828"],
  ["--amber-field", d ? "#1A1918" : "#FFFFFF"], ["--amber-field-border", d ? "#7A716A" : "#9A8673"],
].map(([k, v]) => `${k}: ${v}`).join("; ");
export const TOKENS = `@layer amber-tokens {\n:root { ${vars(false)}; --amber-radius: 14px; --amber-radius-small: 10px; --amber-content-max: 1100px; --amber-gutter: clamp(16px, 3.5vw, 40px); ` +
  `--amber-root-font: 17px/1.35 -apple-system, system-ui, sans-serif; ` +
  `--amber-font: -apple-system, system-ui, sans-serif; --amber-font-rounded: ui-rounded, -apple-system, system-ui, sans-serif; --amber-font-mono: ui-monospace, Menlo, monospace; ` +
  `--amber-safe-top: env(safe-area-inset-top, 0px); --amber-safe-right: env(safe-area-inset-right, 0px); --amber-safe-bottom: env(safe-area-inset-bottom, 0px); --amber-safe-left: env(safe-area-inset-left, 0px); }\n` +
  `@media (prefers-color-scheme: dark) { :root { ${vars(true)}; } }\n}\n`;
const baseOptOut = (html: string) => /<meta[^>]*name=["']amber-base["'][^>]*content=["']none["']/i.test(html);

// Libraries (<meta name="amber-libs">, see supabase/functions/mcp/libraries.ts). The app serves them
// from its own copies; here the same npm files come from a local cache at a made-up host the CSP
// allows, injected before the page's scripts as the app does, and npm hashes are checked here.
const LIB_HOST = "https://lib.amber.invalid/";
const libCache = new URL("./.libcache/", import.meta.url);

/** The page as the app loads it. */
export function sandboxed(html: string): string {
  return prepare(html).html;
}

function prepare(html: string): { html: string; integrity: Map<string, string> } {
  let rest = html.replace(/^[\s\uFEFF]+/, "");
  if (/^<!doctype/i.test(rest)) rest = rest.slice(rest.indexOf(">") + 1);
  const integrity = new Map<string, string>();
  const tags: string[] = [];
  const tag = rest.match(/<meta[^>]*name=["']amber-libs["'][^>]*>/i)?.[0];
  const content = tag?.match(/content=(['"])([\s\S]*?)\1/)?.[2] ?? "";
  // What a library needs loads first, as in the app (preact before its hooks, htm and the router).
  const rank = (x: string) => ({ preact: 0, "preact-hooks": 1, htm: 1, router: 2 } as Record<string, number>)[x] ?? 3;
  for (const item of content.split(",").map((x) => x.trim()).filter(Boolean).sort((a, b) => rank(a) - rank(b))) {
    const npm = item.match(/^npm:(.+?)#((?:sha256|sha384|sha512)-.+)$/);
    const path = npm ? `npm/${npm[1]}` : item;
    if (npm) integrity.set(path, npm[2]);
    tags.push(`<script src="${LIB_HOST}${encodeURI(path)}"></script>`);
  }
  const policy = POLICY.replace("script-src 'unsafe-inline'", `script-src 'unsafe-inline' ${LIB_HOST}`);
  return {
    html: `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` +
      `<style id="amber-tokens">${TOKENS}</style>` + (baseOptOut(html) ? "" : `<style id="amber-base">${AMBER_BASE_CSS}</style>`) + tags.join("") + rest,
    integrity,
  };
}

// Apps that are projects of files (Pane/Views/NotePageProject.swift): the files at a made-up
// origin standing in for amber-app:///, compiled JavaScript at each source path, and the import map
// of bare names over the ES modules the app ships (Pane/Resources/AppLibraries) at LIB_HOST.
const APP_HOST = "https://app.amber.invalid/";
const APP_LIBS = new URL("../../Pane/Resources/AppLibraries/", import.meta.url);
const ESM: Record<string, string> = { preact: "preact.module.js", "preact-hooks": "preact-hooks.module.js", "preact-jsx-runtime": "preact-jsx-runtime.module.js",
  htm: "htm.module.js", "amber-router": "amber-router.module.js", amber: "amber.module.js" };
type Bundled = { name: string; global: string; package: string };
const bundledLibs = (): Bundled[] => JSON.parse(Deno.readTextFileSync(new URL("libraries.json", APP_LIBS))).libraries;
const kit = (() => { let k: { src: Record<string, string>; compiled: Record<string, string>; css: string } | null = null; return () => (k ??= JSON.parse(Deno.readTextFileSync(new URL("amber-ui.json", APP_LIBS)))); })();
/** amber-lib:/// and amber-app:/// as this harness serves them. */
const hosts = (text: string) => text.replaceAll("amber-lib:///", LIB_HOST).replaceAll("amber-app:///", APP_HOST);

export type AppProject = { files: Record<string, string>; compiled: Record<string, string> };
export function projectOf(stored: string): AppProject | null {
  if (!stored.trimStart().startsWith("{") || !stored.includes('"amberApp"')) return null;
  try { const p = JSON.parse(stored); return p?.amberApp === 1 && p.files ? { files: p.files, compiled: p.compiled ?? {} } : null; } catch { return null; }
}

function importMap(): string {
  const imports: Record<string, string> = {
    preact: `${LIB_HOST}esm/preact.js`, "preact/hooks": `${LIB_HOST}esm/preact-hooks.js`, "preact/jsx-runtime": `${LIB_HOST}esm/preact-jsx-runtime.js`,
    htm: `${LIB_HOST}esm/htm.js`, "amber-router": `${LIB_HOST}esm/amber-router.js`, amber: `${LIB_HOST}esm/amber.js`, "amber-ui": `${LIB_HOST}amber-ui/index.js`,
  };
  for (const l of bundledLibs()) if (!["preact", "preact-hooks", "htm", "router"].includes(l.name)) imports[l.package] = `${LIB_HOST}esm/${l.name}.js`;
  // The React stack the app ships (Pane/Resources/AppLibraries/stack.json), and "@/" for /src/.
  for (const [name, file] of Object.entries(stack().map)) imports[name] = `${LIB_HOST}stack/${file}`;
  imports["@/"] = `${APP_HOST}src/`;
  // run_app_tests only: Vitest and Testing Library as test-harness.js gives them.
  for (const name of ["vitest", "@testing-library/react", "@testing-library/preact", "@testing-library/user-event", "@testing-library/dom"]) imports[name] = `${LIB_HOST}test/harness.js`;
  for (const name of ["@testing-library/jest-dom", "@testing-library/jest-dom/vitest"]) imports[name] = `${LIB_HOST}test/empty.js`;
  return `<script type="importmap">${JSON.stringify({ imports })}</script>`;
}

/** The project's /index.html as the app loads it: CSP, viewport, the two stylesheets and the import map first. */
function prepareProject(p: AppProject): string {
  let rest = (p.files["/index.html"] ?? "").replace(/^[\s\uFEFF]+/, "");
  if (/^<!doctype/i.test(rest)) rest = rest.slice(rest.indexOf(">") + 1);
  const policy = `default-src 'none'; script-src 'unsafe-inline' ${APP_HOST} ${LIB_HOST}; style-src 'unsafe-inline' ${APP_HOST} ${LIB_HOST}; img-src data: ${APP_HOST}; font-src data: ${APP_HOST}; media-src data: ${APP_HOST}; ` +
    `connect-src ${APP_HOST}; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'`;
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` +
    `<style id="amber-tokens">${TOKENS}</style>` + (baseOptOut(rest) ? "" : `<style id="amber-base">${AMBER_BASE_CSS}</style>`) + importMap() + hosts(rest);
}

const MIME: Record<string, string> = { html: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript", jsx: "text/javascript", tsx: "text/javascript", ts: "text/javascript", json: "application/json", svg: "image/svg+xml", md: "text/plain", txt: "text/plain" };
/** A project file as served (NotePageProject.serve): resolved like a bundler (.tsx, .ts, .jsx, .js,
 *  then index.*), "x.css?import" as a module that adds the stylesheet, compiled text first. */
function serveFile(p: AppProject, asked: string, query = ""): { body: string; type: string } | null {
  const path = [asked, ...[".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"].map((e) => asked + e)].find((x) => p.files[x] !== undefined);
  if (!path) return null;
  if (query === "import" && path.endsWith(".css")) return { body: `if (!document.querySelector('link[href="${path}"]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '${path}'; document.head.appendChild(l); }\n`, type: "text/javascript" };
  // What was compiled at save time wins (JSX/TS, linked JS, CSS generated by Tailwind).
  const text = p.compiled[path] ?? (/\.(jsx|tsx|ts)$/.test(path) ? undefined : p.files[path]);
  if (text === undefined) return null;
  return { body: /\.(m?js|jsx|tsx|ts|css|html)$/.test(path) ? hosts(text) : text, type: MIME[path.split(".").pop()!] ?? "text/plain" };
}

const stack = (() => { let v: { map: Record<string, string>; modules: Record<string, string> } | null = null; return () => (v ??= JSON.parse(Deno.readTextFileSync(new URL("stack.json", APP_LIBS)))); })();

/** LIB_HOST paths only projects use: esm/<name>.js, amber-ui/… and vendor/…. */
function moduleFile(path: string): { body: string; type: string } | null {
  if (path === "test/harness.js") return { body: hosts(Deno.readTextFileSync(new URL("./test-harness.js", import.meta.url))), type: "text/javascript" };
  if (path === "test/empty.js") return { body: "export {};\n", type: "text/javascript" };
  if (path.startsWith("stack/")) { const js = stack().modules[path.slice(6)]; return js === undefined ? null : { body: hosts(js), type: "text/javascript" }; }
  if (path.startsWith("esm/")) {
    const name = path.slice(4).replace(/\.js$/, "");
    if (ESM[name]) return { body: hosts(Deno.readTextFileSync(new URL(ESM[name], APP_LIBS))), type: "text/javascript" };
    const lib = bundledLibs().find((l) => l.name === name);
    if (lib) return { body: `import "${LIB_HOST}${lib.name}";\nexport default globalThis["${lib.global}"];\n`, type: "text/javascript" };
    return null;
  }
  if (path.startsWith("amber-ui/")) {
    const rest = path.slice(9), k = kit();
    if (rest === "amber-ui.css") return { body: k.css, type: "text/css" };
    if (rest.startsWith("src/") && k.src[rest.slice(4)]) return { body: k.src[rest.slice(4)], type: "text/plain" };
    const js = k.compiled[rest === "index.js" ? "index.jsx" : rest];
    return js === undefined ? null : { body: hosts(js), type: "text/javascript" };
  }
  return null;
}

/** A library's bytes: a bundled one by name, or a pinned npm file; cached on disk after the first time. */
async function library(path: string): Promise<Uint8Array | null> {
  const { BUNDLED } = await import("../../supabase/functions/mcp/libraries.ts");
  const bundled = BUNDLED.find((b) => b.name === path);
  // The app's own copy first (Pane/Resources/AppLibraries), so a render needs no network.
  const shipped = bundledLibs().find((l) => l.name === path) as (Bundled & { file?: string }) | undefined;
  if (shipped?.file) { const local = await Deno.readFile(new URL(shipped.file, APP_LIBS)).catch(() => null); if (local) return local; }
  if (bundled?.npm.startsWith("local:")) return await Deno.readFile(new URL(`../../${bundled.npm.slice(6)}`, import.meta.url)).catch(() => null);
  const npm = bundled ? bundled.npm : path.startsWith("npm/") ? path.slice(4) : null;
  if (!npm || !/@\d+\.\d+\.\d+/.test(npm)) return null;
  const file = new URL(npm.replace(/[^\w.@-]/g, "_"), libCache);
  let bytes: Uint8Array | null = null;
  try { bytes = await Deno.readFile(file); } catch { /* not cached yet */ }
  if (!bytes) {
    const res = await fetch(`https://cdn.jsdelivr.net/npm/${npm}`);
    if (!res.ok) { await res.body?.cancel(); return null; }
    bytes = new Uint8Array(await res.arrayBuffer());
    await Deno.mkdir(libCache, { recursive: true });
    await Deno.writeFile(file, bytes);
  }
  // A data library (world's TopoJSON) arrives as its global, like the app serves it.
  if (bundled && npm.endsWith(".json")) return new TextEncoder().encode(`window.${bundled.global} = ${new TextDecoder().decode(bytes)};`);
  return bytes;
}

async function sri(bytes: Uint8Array, want: string): Promise<boolean> {
  const [alg, b64] = want.split(/-(.*)/s);
  const name = alg === "sha256" ? "SHA-256" : alg === "sha384" ? "SHA-384" : alg === "sha512" ? "SHA-512" : null;
  if (!name) return false;
  const got = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest(name, new Uint8Array(bytes)))));
  return got === b64;
}

// Pane/Views/NotePageView.swift bootstrap(data:store:), with the app's message handlers replaced by
// the harness's. The device, the on-device model and amber.fetch answer { ok: false } here: the
// evals check pages handle that, not what the device returns.
const bootstrap = (note: unknown, data: unknown) => `(() => {
  const listeners = [];
  const post = (msg) => window.__amberData(msg)
    .then((r) => { if (r && r.data) amber.data = r.data; if (r) delete r.data; return r; })
    .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  // Inside amber.batch(), data changes and note edits are collected and sent as one each (as the app).
  let batching = null;
  const ask = (msg) => (batching && /^(store|collection)\./.test(msg.op)) ? (batching.data.push(msg), Promise.resolve({ ok: true })) : post(msg);
  const unavailable = (what) => () => Promise.resolve({ ok: false, error: what + " isn't available here." });
  // Silent: every live audio context's destination is a gain of 0 in front of the real one (Tone.js
  // and any wrapper reach it through the same getter), and media elements start muted.
  {
    const proto = (window.BaseAudioContext || window.AudioContext || window.webkitAudioContext || function () {}).prototype;
    const real = Object.getOwnPropertyDescriptor(proto, "destination");
    if (real && real.get) Object.defineProperty(proto, "destination", { configurable: true, get() {
      if (window.OfflineAudioContext && this instanceof window.OfflineAudioContext) return real.get.call(this);
      if (!this.__muted) { const g = proto.createGain.call(this); g.gain.value = 0; g.connect(real.get.call(this)); Object.defineProperty(this, "__muted", { value: g }); }
      return this.__muted;
    } });
  }
  addEventListener("play", (e) => { if (e.target instanceof HTMLMediaElement) e.target.muted = true; }, true);
  // Frames the page asks for, so a check can tell whether it animates (a game that plays).
  window.__frames = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (fn) => { window.__frames++; return raf(fn); };
  const amber = {
    note: ${JSON.stringify(note)},
    update(op) {
      if (batching) { batching.notes.push(...(Array.isArray(op) ? op : [op])); return Promise.resolve({ ok: true }); }
      return window.__amberUpdate(op).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
    },
    setSummary(text) { return post({ op: "note.summary", text: String(text == null ? "" : text) }); },
    onChange(fn) { listeners.push(fn); try { fn(amber.note, amber.data); } catch (e) { console.error(e); } return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    insets: { top: 0, bottom: 0 },
    data: ${JSON.stringify(data)},
    setData(patch) { return ask({ op: "store.patch", patch }); },
    store: {
      get: (key) => Promise.resolve(amber.data.values[key]),
      set: (key, value) => ask({ op: "store.set", key, value: value === undefined ? null : value }),
      collection(name) {
        const list = () => (amber.data.collections[name] || []).slice();
        return {
          list: () => Promise.resolve(list()), query: (fn) => Promise.resolve(list().filter(fn)), get: (id) => Promise.resolve(list().find((r) => r.id === id)),
          add: (fields) => ask({ op: "collection.add", name, fields }), update: (id, patch) => ask({ op: "collection.update", name, id, patch }),
          remove: (id) => ask({ op: "collection.remove", name, id }),
        };
      },
      subscribe(fn) { amber.onChange((note, data) => fn(data)); },
    },
    files: { save: unavailable("Files"), read: unavailable("Files"), url: () => "data:image/gif;base64,R0lGODlhAQABAAAAACw=" },
    device: {
      reminders: { create: unavailable("Reminders") }, calendar: { today: unavailable("Calendar") }, notify: unavailable("Notifications"),
      openURL: unavailable("Opening links"), photos: { pick: unavailable("Photos") }, camera: { take: unavailable("The camera") },
      contacts: { pick: unavailable("Contacts") }, files: { pick: unavailable("Files") }, location: { once: unavailable("Location") },
      maps: { open: unavailable("Maps"), snapshot: unavailable("Maps") }, weather: { current: unavailable("Weather") },
    },
    ai: { available: () => Promise.resolve({ ok: true, available: false }), respond: unavailable("The on-device model") },
    lib: (name) => new Promise((ok, fail) => {
      const g = ${JSON.stringify(Object.fromEntries([["chart","Chart"],["d3","d3"],["three","THREE"],["tone","Tone"],["dayjs","dayjs"],["marked","marked"],["purify","DOMPurify"],["anime","anime"],["confetti","confetti"],["topojson","topojson"],["world","worldAtlas110m"],["preact","preact"],["preact-hooks","preactHooks"],["htm","htm"],["router","amberRouter"]]))}[name];
      if (!g) return fail(new Error("No bundled library " + name));
      if (window[g]) return ok(window[g]);
      const s = document.createElement("script"); s.src = "${LIB_HOST}" + name; s.onload = () => ok(window[g]); s.onerror = () => fail(new Error("Couldn't load " + name)); document.head.append(s);
    }),
    context: { embedded: !!window.__amberWidget, width: innerWidth, height: innerHeight },
    fetch: (url) => { window.__amberFetched && window.__amberFetched(String(url)); return Promise.resolve({ ok: false, error: "The person hasn't allowed this host yet." }); },
  };
  amber.batch = async (fn) => {
    if (batching) return fn();
    batching = { notes: [], data: [] };
    let b;
    try { await fn(); } finally { b = batching; batching = null; }
    const results = [];
    if (b.data.length) results.push(await post(b.data.length === 1 ? b.data[0] : { op: "batch", ops: b.data }));
    if (b.notes.length) results.push(await amber.update(b.notes.length === 1 ? b.notes[0] : b.notes));
    return results.find((r) => r && r.ok === false) || { ok: true };
  };
  // localStorage is the app's own data (values.localStorage), sessionStorage lasts while the app is
  // open, IndexedDB isn't there: as Pane/Views/NotePageView.swift.
  const storage = (persist) => {
    let map = Object.assign({}, persist ? ((amber.data.values || {}).localStorage || {}) : {});
    let timer = null;
    const flush = () => { timer = null; post({ op: "store.set", key: "localStorage", value: map }); };
    const changed = () => { if (!persist) return; clearTimeout(timer); timer = setTimeout(flush, 250); };
    if (persist) listeners.push((note, data) => { if (!timer && data && data.values) map = Object.assign({}, data.values.localStorage || {}); });
    const api = {
      getItem: (k) => Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null,
      setItem: (k, v) => { map[String(k)] = String(v); changed(); },
      removeItem: (k) => { delete map[String(k)]; changed(); },
      clear: () => { map = {}; changed(); },
      key: (i) => Object.keys(map)[i] ?? null,
      get length() { return Object.keys(map).length; },
    };
    return new Proxy(api, {
      get: (t, k) => k in t ? t[k] : api.getItem(k),
      set: (t, k, v) => { api.setItem(k, v); return true; },
      deleteProperty: (t, k) => { api.removeItem(k); return true; },
      has: (t, k) => k in t || Object.prototype.hasOwnProperty.call(map, k),
      ownKeys: () => Object.keys(map),
      getOwnPropertyDescriptor: (t, k) => Object.prototype.hasOwnProperty.call(map, k) ? { value: map[k], enumerable: true, configurable: true, writable: true } : undefined,
    });
  };
  for (const [name, value] of [["localStorage", storage(true)], ["sessionStorage", storage(false)], ["indexedDB", undefined]]) {
    try { Object.defineProperty(window, name, { value, configurable: true, writable: false }); } catch (e) {}
  }
  Object.defineProperty(amber, "_receive", { value(note, data) {
    amber.note = note; if (data) amber.data = data;
    for (const fn of listeners) { try { fn(note, amber.data); } catch (e) { console.error(e); } }
  } });
  window.amber = amber;
  const sized = () => { if (!document.documentElement) return addEventListener("DOMContentLoaded", sized, { once: true }); const w = window.innerWidth, c = document.documentElement.classList;
    c.toggle("amber-narrow", w < 600); c.toggle("amber-medium", w >= 600 && w < 900); c.toggle("amber-wide", w >= 900); };
  sized(); addEventListener("resize", sized);
  { const w = () => { if (!document.documentElement) return addEventListener("DOMContentLoaded", w, { once: true }); document.documentElement.dataset.amberContext = window.__amberWidget ? "widget" : "full"; if (window.__amberWidget) document.documentElement.classList.add("amber-widget"); }; w(); }
})();`;

type DataDoc = { values: Record<string, unknown>; collections: Record<string, unknown> };
/** Every list of records in an app's data, with a way to put a changed list back: collections,
 *  arrays in values (one level down too), and arrays kept in localStorage as JSON strings. */
function dataLists(doc: DataDoc): { items: Record<string, unknown>[]; with: (items: unknown[]) => DataDoc; withIn: (d: DataDoc, items: unknown[]) => DataDoc }[] {
  const out: { items: Record<string, unknown>[]; with: (items: unknown[]) => DataDoc; withIn: (d: DataDoc, items: unknown[]) => DataDoc }[] = [];
  const records = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === "object" && !Array.isArray(x)) ? v as Record<string, unknown>[] : null;
  const add = (items: Record<string, unknown>[] | null, put: (d: DataDoc, items: unknown[]) => DataDoc) => { if (items) out.push({ items, withIn: put, with: (xs) => put(doc, xs) }); };
  const clone = (d: DataDoc): DataDoc => JSON.parse(JSON.stringify(d));
  for (const [k, v] of Object.entries(doc.collections ?? {})) add(records(v), (d, xs) => { const c = clone(d); c.collections[k] = xs; return c; });
  for (const [k, v] of Object.entries(doc.values ?? {})) {
    if (k === "imported") continue;
    add(records(v), (d, xs) => { const c = clone(d); c.values[k] = xs; return c; });
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        let parsed: unknown = v2;
        const asString = typeof v2 === "string";
        if (asString) { try { parsed = JSON.parse(v2 as string); } catch { continue; } }
        add(records(parsed), (d, xs) => { const c = clone(d); (c.values[k] as Record<string, unknown>)[k2] = asString ? JSON.stringify(xs) : xs; return c; });
      }
    }
  }
  return out;
}

/** The app's data ops (Pane/Model/NotePageData.swift apply). */
function applyDataOp(doc: { values: Record<string, unknown>; collections: Record<string, Record<string, unknown>[]> }, m: Record<string, unknown>) {
  const d = JSON.parse(JSON.stringify(doc)) as typeof doc;
  const now = new Date().toISOString();
  const list = (n: unknown) => (d.collections[String(n)] ??= []);
  let id: string | undefined;
  switch (m.op) {
    case "store.set": if (m.value === null) delete d.values[String(m.key)]; else d.values[String(m.key)] = m.value; break;
    case "store.patch": { const p = mergePatch(d, m.patch) as typeof doc; d.values = p.values ?? {}; d.collections = p.collections ?? {}; break; }
    case "collection.add": {
      const f = { ...(m.fields as Record<string, unknown>) }, l = list(m.name);
      id = typeof f.id === "string" && !l.some((r) => r.id === f.id) ? f.id : crypto.randomUUID();
      l.push({ ...f, id, created: f.created ?? now, updated: now }); break;
    }
    case "collection.update": {
      const l = list(m.name), k = l.findIndex((r) => r.id === m.id);
      if (k < 0) throw new Error(`No record ${m.id} in ${m.name}.`);
      l[k] = { ...(mergePatch(l[k], m.patch) as Record<string, unknown>), id: m.id, updated: now }; break;
    }
    case "collection.remove": {
      const l = list(m.name), k = l.findIndex((r) => r.id === m.id);
      if (k < 0) throw new Error(`No record ${m.id} in ${m.name}.`);
      l.splice(k, 1); break;
    }
    case "batch": {
      let cur = d;
      for (const op of (m.ops as Record<string, unknown>[]) ?? []) cur = applyDataOp(cur, op).d;
      d.values = cur.values; d.collections = cur.collections; break;
    }
    case "note.summary": if (typeof m.text !== "string" || m.text.length > 300) throw new Error("setSummary takes a line of text, at most 300 characters."); break;
    default: throw new Error(`Unknown op ${m.op}.`);
  }
  if (new TextEncoder().encode(JSON.stringify(d)).length > 4 * 1048576) throw new Error("This app's data would be over 4 MB.");
  return { d, id };
}

export type View = {
  name: string; width: number; scheme: "light" | "dark";
  errors: string[]; overflowPx: number; textLength: number; shown: number; sampled: number;
  bg: string; fg: string; contrast: number; bgLuminance: number;
  unnamedControls: string[]; smallTargets: number; screenshot?: string;
  smallText: string[]; smallTextCount: number; faintText: string[]; faintCount: number; headings: string[]; excerpt: string; png?: string;
  titleCount: number; ghostFields: string[]; sections: number; nav: boolean; junk: string[]; under44: string[]; under44Count: number; clipped: string[]; clippedCount: number; usedWidth: number; canvases: number; svgShapes: number; gridCols: number; frames: number;
  look: { accentHue: number | null; nonAmberVivid: number; tintedBg: boolean };
};
export type Render = {
  views: View[]; blocked: string[]; updates: { op: unknown; ok: boolean; error?: string }[]; setData: number;
  interaction: { tried: string; ok: boolean | null; error?: string; framesPerSecond?: number };
  probes: Partial<Record<"follows" | "escapes" | "empty" | "large", { pass: boolean; detail?: string }>>;
  markdownAfter: string; dataAfter: unknown;
  /** try_app: what each step did. */
  trial?: TrialStep[];
  /** The save gate's smoke check. */
  smoke?: { ok: boolean; problems: string[]; taps: number };
  /** run_app_tests: each test's result. */
  tests?: { name: string; ok: boolean; error?: string; ms: number; file?: string }[];
  testErrors?: string[];
};

/** One thing to do in the app, like a person would (try_app). */
/** Any step may be marked optional (the walkthroughs): a miss doesn't fail it. */
export type Step = (
  | { tap: string } | { type: string; into: string } | { scroll: "down" | "up" | string } | { wait: number | string }
  | { press: string } | { resize: "phone" | "desktop" } | { dark: boolean } | { expect: string }
) & { optional?: boolean };
export type TrialStep = {
  step: Step; ok: boolean; error?: string; png?: string; errors: string[];
  /** Headings, buttons, links, fields and text the person can see now (short). */
  screen: string[];
  /** What changed in the app's data: paths added, changed or removed. */
  data: string[];
};

/** The changes between two JSON values, as short lines ("+ collections.log[5]", "~ values.goal: 3 → 4"). */
function jsonDiff(a: unknown, b: unknown, path = "", out: string[] = []): string[] {
  if (out.length > 30) return out;
  const short = (v: unknown) => { const t = JSON.stringify(v) ?? "undefined"; return t.length > 80 ? t.slice(0, 77) + "…" : t; };
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  const obj = (v: unknown) => v !== null && typeof v === "object";
  if (!obj(a) || !obj(b) || Array.isArray(a) !== Array.isArray(b)) { out.push(a === undefined ? `+ ${path}: ${short(b)}` : b === undefined ? `- ${path}` : `~ ${path}: ${short(a)} → ${short(b)}`); return out; }
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  for (const k of keys) jsonDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], Array.isArray(a) ? `${path}[${k}]` : path ? `${path}.${k}` : k, out);
  return out;
}

/** try_app: one page, steps done like a person would, and after each a screenshot, the errors, what
 *  the screen shows and what changed in the data. Data changes stay in this throwaway copy. */
async function trial(open: (w: number, s: "light" | "dark") => Promise<{ page: Page; errors: string[] }>, store: () => unknown, opts: RenderOptions): Promise<Render> {
  const first = opts.views?.[0] ?? { width: 390, scheme: "light" as const };
  let { page, errors } = await open(first.width, first.scheme);
  const out: TrialStep[] = [];
  const screen = () => page.evaluate(() => {
    const seen = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && s.visibility !== "hidden" && s.display !== "none"; };
    const name = (el: Element) => (el.getAttribute("aria-label") || (el as HTMLElement).innerText || (el as HTMLInputElement).placeholder || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const lines: string[] = [];
    for (const el of document.querySelectorAll("h1, h2, h3, [role=heading], button, a[href], [role=button], [role=tab], [role=switch], [role=checkbox], input, select, textarea, [role=dialog]")) {
      if (!seen(el)) continue;
      const tag = el.tagName.toLowerCase(), role = el.getAttribute("role");
      const kind = role ?? (/^h\d$/.test(tag) ? "heading" : tag === "a" ? "link" : tag === "input" ? `input ${(el as HTMLInputElement).type}` : tag);
      const extra = (el as HTMLInputElement).value !== undefined && /input|select|textarea/.test(tag) ? ` = "${String((el as HTMLInputElement).value).slice(0, 40)}"` : el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-checked") === "true" || el.getAttribute("data-state") === "checked" ? " (on)" : "";
      lines.push(`${kind}: ${name(el)}${extra}`);
      if (lines.length >= 40) break;
    }
    const text = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
    return [...lines, `text: ${text.slice(0, 400)}${text.length > 400 ? "…" : ""}`];
  }).catch((e) => [`(the page didn't answer: ${String(e).slice(0, 100)})`]);
  // The element a person means: a selector, else a label, a role's name, or visible text.
  // "/add|new/i" is a pattern (the evals' walkthroughs use them).
  const pattern = (what: string): string | RegExp => { const m = what.match(/^\/(.+)\/([a-z]*)$/); return m ? new RegExp(m[1], m[2]) : what; };
  const target = async (what: string, field = false) => {
    if (/^[#.\[]|^[a-z]+[#.\[]/.test(what)) return page.locator(what).first();
    const w = pattern(what);
    // An open dialog or sheet is what a person is looking at: look there first.
    const dialog = page.locator("[role=dialog]:visible, dialog[open]").last();
    const scope = (await dialog.count().catch(() => 0)) ? dialog : page;
    const order = field
      ? [scope.getByLabel(w, { exact: false }).and(scope.locator("input, textarea, select, [contenteditable=true], [role=textbox], [role=combobox], [role=spinbutton]")), scope.getByPlaceholder(w), scope.getByRole("textbox", { name: w }), scope.getByRole("spinbutton", { name: w }), scope.getByRole("combobox", { name: w })]
      : [scope.getByRole("button", { name: w }), scope.getByRole("link", { name: w }), scope.getByRole("tab", { name: w }), scope.getByRole("menuitem", { name: w }), scope.getByRole("option", { name: w }), scope.getByRole("checkbox", { name: w }), scope.getByRole("switch", { name: w }), scope.getByLabel(w, { exact: false }), scope.getByText(w, { exact: false })];
    // Visible and not covered by something else (a sheet over the page): what a tap would reach. If
    // nothing passes that (an animation still running), the first visible one.
    let fallback: ReturnType<typeof page.locator> | null = null;
    for (const l of order) {
      const n = await l.count().catch(() => 0);
      for (let i = 0; i < Math.min(n, 8); i++) {
        if (!(await l.nth(i).isVisible().catch(() => false))) continue;
        if (field || await l.nth(i).click({ trial: true, timeout: 1200 }).then(() => true, () => false)) return l.nth(i);
        fallback ??= l.nth(i);
      }
    }
    if (fallback) return fallback;
    throw new Error(`Nothing visible matches "${what}".`);
  };
  for (const step of (opts.steps ?? []).slice(0, 30)) {
    const before = JSON.parse(JSON.stringify(store()));
    const errs = errors.length;
    let ok = true, error: string | undefined;
    try {
      if ("tap" in step) await (await target(step.tap)).click({ timeout: 3000 });
      else if ("expect" in step) { const w = pattern(step.expect); const hits = page.getByText(w); const n = Math.min(await hits.count().catch(() => 0), 12); let seen = false; for (let i = 0; i < n && !seen; i++) seen = await hits.nth(i).isVisible().catch(() => false); if (!seen && !(await page.locator("input:visible, textarea:visible").evaluateAll((els, [src, flags]) => els.some((e) => new RegExp(src, flags).test((e as HTMLInputElement).value)), typeof w === "string" ? [w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"] : [w.source, w.flags]).catch(() => false))) throw new Error(`"${step.expect}" isn't on screen.`); }
      else if ("type" in step) { const el = step.into ? await target(step.into, true) : page.locator("input:visible, textarea:visible").first(); await el.click({ timeout: 3000 }); await el.fill(String(step.type), { timeout: 3000 }).catch(async () => { await page.keyboard.type(String(step.type)); }); }
      else if ("scroll" in step) await page.mouse.wheel(0, step.scroll === "up" ? -600 : 600);
      else if ("wait" in step) typeof step.wait === "number" ? await page.waitForTimeout(Math.min(step.wait, 5000)) : await page.getByText(step.wait).first().waitFor({ timeout: 5000 });
      else if ("press" in step) await page.keyboard.press(step.press);
      else if ("resize" in step) await page.setViewportSize(step.resize === "desktop" ? { width: 1280, height: 900 } : { width: 390, height: 844 });
      else if ("dark" in step) await page.emulateMedia({ colorScheme: step.dark ? "dark" : "light" });
      else throw new Error(`Unknown step ${JSON.stringify(step)}.`);
      await page.waitForTimeout(250);
    } catch (e) {
      // An optional step (the evals': "open the list, if there is one") may find nothing.
      if (!(step as { optional?: boolean }).optional) { ok = false; error = String((e as Error).message ?? e).split("\n")[0].slice(0, 200); }
    }
    const png = await page.screenshot({ type: "png", scale: "css" }).then((b) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join(""))).catch(() => undefined);
    out.push({ step, ok, ...(error ? { error } : {}), png, errors: errors.slice(errs), screen: await screen(), data: jsonDiff(before, store()) });
  }
  await page.context().close();
  return { views: [], blocked: [], updates: [], setData: 0, interaction: { tried: "none", ok: null }, probes: {}, markdownAfter: "", dataAfter: store(), trial: out };
}

/** The page run_app_tests opens instead of the app: imports each test file, then runs them. */
export function testRunnerProject(stored: string): string | null {
  const p = projectOf(stored);
  if (!p) return null;
  const files = Object.keys(p.files).filter((f) => /^\/tests?\/.*\.test\.(tsx|ts|jsx|js)$/.test(f) || /\/__tests__\/.*\.(tsx|ts|jsx|js)$/.test(f)).sort();
  if (!files.length) return null;
  const html = `<!doctype html><html lang="en"><body><script type="module">
const results = [], errors = [];
const { run } = await import("vitest");
for (const f of ${JSON.stringify(files)}) {
  const before = results.length;
  try { await import(f); } catch (e) { errors.push(f + ": " + String(e && e.message || e).slice(0, 400)); continue; }
  for (const r of await run(() => window.__amberReset())) results.push({ ...r, file: f });
}
window.__testResults = { results, errors };
</script></body></html>`;
  return JSON.stringify({ amberApp: 1, files: { ...p.files, "/index.html": html }, compiled: p.compiled });
}

async function runTests(open: (w: number, s: "light" | "dark") => Promise<{ page: Page; errors: string[] }>): Promise<Render> {
  const { page, errors } = await open(390, "light");
  const got = await page.waitForFunction(() => (window as any).__testResults, null, { timeout: 30000 }).then((h) => h.jsonValue() as Promise<{ results: Render["tests"]; errors: string[] }>).catch(() => ({ results: [], errors: ["The tests didn't finish in 30 s."] }));
  await page.context().close();
  return { views: [], blocked: [], updates: [], setData: 0, interaction: { tried: "none", ok: null }, probes: {}, markdownAfter: "", dataAfter: null,
    tests: got.results ?? [], testErrors: [...(got.errors ?? []), ...errors.filter((e) => !/^Failed to load resource/.test(e)).slice(0, 5)] };
}

let browser: Browser | null = null;
export async function closeBrowser() { await browser?.close(); browser = null; }

function lum(rgb: string): number {
  const m = rgb.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  const [r, g, b] = m.slice(0, 3).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrastOf = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** Values from the note that a page showing its data would show: the last rows' non-empty cells. */
function samples(markdown: string): string[] {
  const out: string[] = [];
  for (const t of findTables(markdown)) {
    for (const r of [...t.rows.slice(0, 2), ...t.rows.slice(-3)]) for (const c of r) if (c && c.length >= 2 && c.length <= 40 && !/^[\s✓✔xX·-]+$/.test(c) && !/^\d{4}-\d{2}-\d{2}$/.test(c)) out.push(c);
  }
  return [...new Set(out)].slice(0, 12);
}

export type RenderOptions = {
  shots?: string; today: string; interact?: boolean;
  /** Which widths and color schemes (default 390 light and dark, 320 light, 1280 light and dark: iPhone and Mac, no tablet). */
  views?: { width: number; scheme: "light" | "dark"; widget?: boolean }[];
  /** Keep a PNG of each view in the result (for preview_app). */
  capture?: boolean;
  /** Skip the robustness probes (for a quick check). */
  probes?: boolean;
  /** Also render as a widget in a parent note: a 340 x 260 strip with html.amber-widget. */
  widget?: boolean;
  /** try_app: open the app once (the first view) and do these steps, screenshot after each. */
  steps?: Step[];
  /** run_app_tests: run the project's tests/*.test.* files instead of opening the app. */
  tests?: boolean;
  /** The save gate's smoke check: open at 390 and 1280 and tap each visible tab and button once. */
  smoke?: boolean;
};

/** Renders, starting WebKit again (once) if it went away under load. */
export async function renderPage(html: string, markdown: string, data: unknown, opts: RenderOptions): Promise<Render> {
  try {
    return await renderOnce(html, markdown, data, opts);
  } catch (e) {
    if (!/closed|crash|disconnect/i.test(String(e))) throw e;
    await browser?.close().catch(() => {});
    browser = null;
    return await renderOnce(html, markdown, data, opts);
  }
}

async function renderOnce(html: string, markdown: string, data: unknown, opts: RenderOptions): Promise<Render> {
  if (browser && !browser.isConnected()) browser = null;
  browser ??= await webkit.launch();
  // As the app: a note's first app gets what the note held in values.imported, once.
  const empty = (x: unknown) => {
    const d = { values: {}, collections: {}, ...(x as object ?? {}) } as { values: Record<string, unknown>; collections: Record<string, unknown> };
    return d.values.imported === undefined ? { ...d, values: { ...d.values, imported: importedFrom(markdown) } } : d;
  };
  let md = markdown, store: unknown = empty(data);
  const updates: Render["updates"] = [];
  const blocked: string[] = [];
  let setData = 0;
  const dataErrors: string[] = [];
  const views: View[] = [];
  let interaction: Render["interaction"] = { tried: "none", ok: null };
  const want = samples(markdown);

  const open = async (width: number, scheme: "light" | "dark", widget = false): Promise<{ page: Page; errors: string[] }> => {
    const ctx = await browser!.newContext({ viewport: { width, height: widget ? 260 : width < 600 ? 844 : 900 }, colorScheme: scheme, deviceScaleFactor: width < 600 ? 2 : 1, serviceWorkers: "block" });
    const page = await ctx.newPage();
    // A window the page opens is another page in this context: closed at once (the routes below
    // cover the whole context, so even its first request is refused).
    ctx.on("page", (p) => { blocked.push("window.open"); p.close().catch(() => {}); });
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e.message).slice(0, 300)}`));
    // The document is served at one made-up address, so init scripts run on it like the app's
    // user script; every other request is recorded and refused.
    const project = projectOf(html);
    const home = project ? `${APP_HOST}index.html` : "https://page.amber.invalid/";
    const prepared = project ? { html: prepareProject(project), integrity: new Map<string, string>() } : prepare(html);
    await ctx.route("**/*", (r) => {
      const u = r.request().url();
      if (u === home) return r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: prepared.html });
      if (project && u.startsWith(APP_HOST)) {
        const f = serveFile(project, "/" + decodeURIComponent(new URL(u).pathname.slice(1)), new URL(u).search.slice(1));
        if (!f) { errors.push(`missing file: ${new URL(u).pathname}`); return r.fulfill({ status: 404, body: "" }); }
        return r.fulfill({ status: 200, contentType: `${f.type}; charset=utf-8`, headers: { "access-control-allow-origin": "*" }, body: f.body });
      }
      const mod = u.startsWith(LIB_HOST) ? moduleFile(decodeURIComponent(u.slice(LIB_HOST.length))) : null;
      if (mod) return r.fulfill({ status: 200, contentType: `${mod.type}; charset=utf-8`, headers: { "access-control-allow-origin": "*" }, body: mod.body });
      if (u.startsWith(LIB_HOST)) {
        const path = decodeURIComponent(u.slice(LIB_HOST.length));
        return library(path).then(async (bytes) => {
          const want = prepared.integrity.get(path);
          if (!bytes || (path.startsWith("npm/") && (!want || !(await sri(bytes, want))))) { blocked.push(`library ${path}${bytes ? " (hash missing or wrong)" : " (unknown)"}`); return r.abort(); }
          return r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", headers: { "access-control-allow-origin": "*" }, body: Buffer.from(bytes) });
        });
      }
      if (u.startsWith("data:")) return r.continue();
      blocked.push(u);
      return r.abort();
    });
    await page.exposeFunction("__amberUpdate", async (op: unknown) => {
      try {
        md = applyPageOp(md, op);
        updates.push({ op, ok: true });
        await page.evaluate(([n, d]) => (window as any).amber._receive(n, d), [noteForPage(md, opts.today), store]);
        return { ok: true };
      } catch (e) {
        updates.push({ op, ok: false, error: (e as Error).message });
        return { ok: false, error: (e as Error).message };
      }
    });
    await page.exposeFunction("__amberData", async (msg: Record<string, unknown>) => {
      try {
        const { d, id } = applyDataOp(store as Parameters<typeof applyDataOp>[0], msg);
        store = d; setData++;
        await page.evaluate(([n, x]) => (window as any).amber._receive(n, x), [noteForPage(md, opts.today), store]);
        return { ok: true, ...(id ? { id } : {}), data: store };
      } catch (e) {
        dataErrors.push((e as Error).message);
        return { ok: false, error: (e as Error).message };
      }
    });
    // run_app_tests: every test starts from the same data.
    await page.exposeFunction("__amberReset", async () => {
      md = markdown; store = empty(data);
      await page.evaluate(([n, d]) => (window as any).amber._receive(n, d), [noteForPage(md, opts.today), store]);
    });
    if (widget) await page.addInitScript("window.__amberWidget = true;");
    await page.addInitScript(bootstrap(noteForPage(md, opts.today), store));
    await page.goto(home, { waitUntil: "load", timeout: 15000 }).catch((e) => errors.push(`load: ${(e as Error).message.slice(0, 200)}`));
    await page.waitForTimeout(400);
    return { page, errors };
  };

  if (opts.steps?.length) { md = markdown; store = empty(data); return await trial(open, () => store, opts); }
  if (opts.tests) { md = markdown; store = empty(data); return await runTests(open); }
  if (opts.smoke) {
    const problems: string[] = [];
    let taps = 0;
    for (const width of [390, 1280]) {
      md = markdown; store = empty(data);
      const { page, errors: raw } = await open(width, "light");
      // Console noise that isn't the app's (a refused load is reported as blocked instead).
      const errs = () => raw.filter((e) => !/^Failed to load resource/.test(e));
      const at = (what: string) => `${width} px${what ? `, after tapping "${what}"` : ""}`;
      const text = await page.evaluate(() => (document.body?.innerText ?? "").trim().length).catch(() => 0);
      if (text < 10) problems.push(`${at("")}: the app shows nothing (a blank screen).`);
      problems.push(...[...new Set(errs())].slice(0, 2).map((e) => `${at("")}: ${e}`));
      // Each visible tab and button once (on this throwaway copy), closing whatever it opened.
      const names: string[] = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll("button, [role=tab], [role=button], a[href^='#']")) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height || (el as HTMLButtonElement).disabled) continue;
          const name = (el.getAttribute("aria-label") || (el as HTMLElement).innerText || "").replace(/\s+/g, " ").trim().slice(0, 60);
          if (name && !out.includes(name)) out.push(name);
        }
        return out.slice(0, 20);
      }).catch(() => []);
      for (const name of names) {
        const before = errs().length, dataBefore = dataErrors.length;
        const el = page.getByRole("button", { name, exact: true }).or(page.getByRole("tab", { name, exact: true })).or(page.getByRole("link", { name, exact: true })).first();
        if (!(await el.isVisible().catch(() => false))) continue;
        await el.click({ timeout: 2000 }).catch(() => {});
        taps++;
        await page.waitForTimeout(150);
        if (errs().length > before) problems.push(...[...new Set(errs().slice(before))].slice(0, 2).map((e) => `${at(name)}: ${e}`));
        if (dataErrors.length > dataBefore) problems.push(`${at(name)}: saving its data failed: ${dataErrors[dataErrors.length - 1]}`);
        if (!(await page.evaluate(() => (document.body?.innerText ?? "").trim().length).catch(() => 0))) { problems.push(`${at(name)}: the screen went blank.`); break; }
        await page.keyboard.press("Escape").catch(() => {});
      }
      await page.context().close();
    }
    return { views: [], blocked: [...new Set(blocked)], updates, setData, interaction: { tried: "none", ok: null }, probes: {}, markdownAfter: markdown, dataAfter: store, smoke: { ok: problems.length === 0, problems: [...new Set(problems)].slice(0, 8), taps } };
  }

  const wanted: { width: number; scheme: "light" | "dark"; widget?: boolean }[] = opts.views ?? ([[390, "light"], [390, "dark"], [320, "light"], [1280, "light"], [1280, "dark"]] as const).map(([width, scheme]) => ({ width, scheme }));
  if (opts.widget && !wanted.some((v) => v.widget)) wanted.push({ width: 340, scheme: "light", widget: true });
  for (const { width, scheme, widget } of wanted) {
    md = markdown; store = empty(data);
    const { page, errors } = await open(width, scheme, widget);
    const m = await page.evaluate((want: string[]) => {
      const de = document.documentElement;
      const text = document.body?.innerText ?? "";
      const flat = text.replace(/\s+/g, " ").toLowerCase();
      const bodyStyle = getComputedStyle(document.body);
      let bg = bodyStyle.backgroundColor;
      if (/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) bg = getComputedStyle(de).backgroundColor;
      if (/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) bg = "rgb(255, 255, 255)";
      const name = (el: Element) => {
        const a = el.getAttribute("aria-label") || "";
        const lb = el.getAttribute("aria-labelledby");
        const byId = lb ? lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ") : "";
        const labels = (el as HTMLInputElement).labels ? [...(el as HTMLInputElement).labels!].map((l) => l.textContent ?? "").join(" ") : "";
        const own = el.tagName === "BUTTON" || el.getAttribute("role") === "button" ? (el.textContent ?? "") : "";
        const title = el.getAttribute("title") || "";
        return (a + byId + labels + own + title).trim();
      };
      const visible = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const controls = [...document.querySelectorAll("input:not([type=hidden]), select, textarea, button, [role=button], [role=checkbox]")].filter(visible);
      const unnamed = controls.filter((el) => !name(el)).map((el) => el.outerHTML.slice(0, 120));
      const small = controls.filter((el) => { const r = el.getBoundingClientRect(); return r.height < 28 || r.width < 28; }).length;
      // A control's tap area: its own box, or its label's when the label wraps it.
      const tapBox = (el: Element) => { const r = el.getBoundingClientRect(); const l = (el as HTMLInputElement).labels?.[0]; if (!l) return r; const b = l.getBoundingClientRect(); return b.width * b.height > r.width * r.height ? b : r; };
      // Fields that don't look like fields: each needs a border and a solid fill of its own.
      const ghostFields = [...document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=hidden]):not([type=submit]):not([type=button]), select, textarea")].filter(visible).filter((el) => {
        const st = getComputedStyle(el);
        const border = ["Top", "Right", "Bottom", "Left"].some((k) => parseFloat((st as any)[`border${k}Width`]) >= 1 && !/rgba\([^)]*, 0\)$|transparent/.test((st as any)[`border${k}Color`]));
        const v = (st.backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
        const fill = v.length >= 3 && (v[3] === undefined || v[3] > 0.5) && st.backgroundColor !== getComputedStyle(el.parentElement ?? document.body).backgroundColor;
        return !border || !fill;
      }).map((el) => (el.getAttribute("name") ?? el.id ?? el.tagName).slice(0, 30));
      const under44 = controls.filter((el) => { const r = tapBox(el); return r.height < 40 || r.width < 40; }).map((el) => (el.textContent?.trim() || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30));
      // How much of the window's width the content uses.
      let left = Infinity, right = -Infinity;
      for (const el of document.querySelectorAll("body *")) {
        if (!visible(el)) continue;
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) || ["CANVAS", "SVG", "IMG", "INPUT", "BUTTON", "SELECT", "TEXTAREA"].includes(el.tagName.toUpperCase());
        if (!own) continue;
        const r = el.getBoundingClientRect();
        left = Math.min(left, r.left); right = Math.max(right, r.right);
      }
      const used = right > left ? (right - left) / window.innerWidth : 0;
      // The look: colors by the area they cover (backgrounds) and by text, to tell an app with its
      // own palette from one in the default amber and beige.
      const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
      const hsl = ([r, g, b]: number[]) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn; if (!d) return [0, 0, l]; const s2 = d / (1 - Math.abs(2 * l - 1)); const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [(h * 60 + 360) % 360, s2, l]; };
      const area = new Map<string, number>();
      for (const el of document.querySelectorAll("body *")) {
        if (!visible(el)) continue;
        const st = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const bgc = st.backgroundColor;
        const v = rgb(bgc);
        if (v.length >= 3 && (v[3] === undefined || v[3] > 0.3)) area.set(bgc, (area.get(bgc) ?? 0) + r.width * r.height);
        if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) area.set(st.color, (area.get(st.color) ?? 0) + r.width * r.height * 0.05);
      }
      // Drawn colors too: SVG fills and strokes, and a sample of each canvas's pixels.
      for (const el of document.querySelectorAll("svg path, svg rect, svg circle, svg line, svg polyline, svg polygon, svg ellipse")) {
        if (!visible(el)) continue;
        const st = getComputedStyle(el), r = el.getBoundingClientRect(), a2 = Math.max(4, r.width * r.height * 0.3);
        for (const c of [st.fill, st.stroke]) if (/^rgb/.test(c)) area.set(c, (area.get(c) ?? 0) + a2);
      }
      for (const cv of document.querySelectorAll("canvas")) {
        if (!visible(cv)) continue;
        try {
          const g = (cv as HTMLCanvasElement).getContext("2d");
          if (!g) continue;
          const { width: w, height: h } = cv as HTMLCanvasElement;
          const r = cv.getBoundingClientRect();
          for (let k = 0; k < 300; k++) {
            const px = g.getImageData(Math.floor(((k * 37) % 100) / 100 * w), Math.floor(((k * 61) % 100) / 100 * h), 1, 1).data;
            if (px[3] < 128) continue;
            const c = `rgb(${px[0]}, ${px[1]}, ${px[2]})`;
            area.set(c, (area.get(c) ?? 0) + (r.width * r.height) / 300);
          }
        } catch { /* a WebGL canvas: not readable this way */ }
      }
      const total = [...area.values()].reduce((x, y) => x + y, 0) || 1;
      const colors = [...area].map(([c, a]) => { const [h, s2, l] = hsl(rgb(c)); return { c, share: a / total, h, s: s2, l }; }).sort((x, y) => y.share - x.share);
      const vivid = colors.filter((x) => x.s > 0.3 && x.l > 0.12 && x.l < 0.9);
      const amberish = (x: { h: number }) => x.h >= 15 && x.h <= 45;
      const look = { accentHue: vivid[0] ? Math.round(vivid[0].h) : null, nonAmberVivid: vivid.filter((x) => !amberish(x)).reduce((t, x) => t + x.share, 0), tintedBg: colors.filter((x) => x.share > 0.1 && x.s > 0.12 && !amberish(x)).length > 0 };
      // What kind of layout: canvas, drawn SVG, multi-column grids, or a stack of rows.
      const canvases = [...document.querySelectorAll("canvas")].filter(visible).length + [...document.querySelectorAll("img, svg")].filter((el) => { const r = el.getBoundingClientRect(); return visible(el) && r.width >= 120 && r.height >= 120; }).length;
      const svgShapes = [...document.querySelectorAll("svg path, svg rect, svg circle, svg line, svg polyline, svg polygon, svg ellipse")].filter(visible).length;
      const gridCols = Math.max(0, ...[...document.querySelectorAll("body *")].filter(visible).map((el) => { const s = getComputedStyle(el); return s.display.includes("grid") ? s.gridTemplateColumns.split(" ").filter(Boolean).length : 0; }));
      // Text that is small or faint against what's behind it.
      // Any CSS color (rgb, oklab, color-mix: what Tailwind 4 writes) as sRGB and alpha, read back from a canvas.
      const pen = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
      const rgbaOf = (c: string): number[] => { pen.clearRect(0, 0, 1, 1); pen.fillStyle = "#000"; pen.fillStyle = c; pen.fillRect(0, 0, 1, 1); const [r, g, b, a] = pen.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255]; };
      const lumOf = (c: string) => { const m = /^rgba?\(/.test(c) ? c.match(/[\d.]+/g)!.map(Number) : rgbaOf(c); const [r, g, b] = m.slice(0, 3).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      // What's behind an element: its own and its ancestors' backgrounds, translucent ones laid over the first solid one.
      const behind = (el: Element | null): string => {
        const layers: number[][] = [];
        for (let e = el; e; e = e.parentElement) {
          const v = rgbaOf(getComputedStyle(e).backgroundColor);
          if (v[3] === 0) continue;
          layers.push(v);
          if (v[3] >= 0.99) break;
        }
        if (!layers.length || layers[layers.length - 1][3] < 0.99) layers.push(rgbaOf(bg));
        let [r, g, b] = layers.pop()!;
        for (const [r2, g2, b2, a] of layers.reverse()) { r = r2 * a + r * (1 - a); g = g2 * a + g * (1 - a); b = b2 * a + b * (1 - a); }
        return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
      };
      const texts = [...document.querySelectorAll("body *")].filter((el) => visible(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()));
      // Text cut off by its box (no ellipsis meant).
      const clipped = texts.filter((el) => { const s = getComputedStyle(el); return el.clientWidth > 2 && s.clip !== "rect(0px, 0px, 0px, 0px)" && !(s.position === "absolute" && el.clientWidth <= 2) && el.scrollWidth > el.clientWidth + 2 && s.overflowX !== "visible" && s.textOverflow !== "ellipsis" && s.overflowX !== "auto" && s.overflowX !== "scroll"; }).map((el) => (el.textContent ?? "").trim().slice(0, 40));
      const smallText = texts.filter((el) => parseFloat(getComputedStyle(el).fontSize) < 12).map((el) => (el.textContent ?? "").trim().slice(0, 40));
      const faint = texts.filter((el) => { const s = getComputedStyle(el); if (parseFloat(s.opacity) < 0.3) return false; const a = lumOf(s.color), b = lumOf(behind(el)); const [x, y] = [a, b].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) < 4.5; }).map((el) => (el.textContent ?? "").trim().slice(0, 40));
      return {
        // Values a script showed by mistake: an unawaited promise, an object, undefined, NaN.
        // Elements whose own text is exactly the note's title (headings or not).
        titleCount: (() => { const t = String((window as any).amber?.note?.title ?? "").trim().toLowerCase(); if (!t) return 0; return [...document.querySelectorAll("body *")].filter((el) => visible(el) && [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim().toLowerCase() === t).length; })(),
        ghostFields, sections: (() => {
          // Independent sections on the first screen: visible blocks that each carry a heading or
          // their own card, counted at the top level of the app's layout.
          const heads = [...document.querySelectorAll("h2, h3, section, [role=region], fieldset, form")].filter(visible).filter((el) => !el.closest("[role=tabpanel][hidden], dialog:not([open])"));
          const tops = new Set(heads.map((el) => { let e: Element = el; while (e.parentElement && e.parentElement !== document.body && e.parentElement.children.length === 1) e = e.parentElement; return e; }));
          // Repeated blocks of one kind (a row per instrument, a card per habit) are one section.
          const kinds = new Set([...tops].map((e) => `${e.tagName}.${(e as HTMLElement).className}|${e.parentElement === null ? "" : (e.parentElement as HTMLElement).className}`));
          return Math.min(kinds.size, [...document.querySelectorAll("h2, h3")].filter(visible).length + [...document.querySelectorAll("form, section")].filter(visible).length);
        })(),
        nav: [...document.querySelectorAll("[role=tablist], nav, [role=tab]")].filter(visible).length > 0,

        junk: [...new Set((text.match(/\[object (Promise|Object)\]|\bundefined\b|\bNaN\b|Invalid Date/g) ?? []))],
        under44: under44.slice(0, 5), under44Count: under44.length, clipped: clipped.slice(0, 5), clippedCount: clipped.length, used,
        canvases, svgShapes, gridCols, frames: (window as any).__frames as number, look,
        smallText: smallText.slice(0, 5), smallTextCount: smallText.length, faint: faint.slice(0, 5), faintCount: faint.length,
        headings: [...document.querySelectorAll("h1, h2, h3, [role=heading]")].filter(visible).map((h) => (h.textContent ?? "").trim().slice(0, 80)).slice(0, 12),
        excerpt: text.replace(/\s+/g, " ").trim().slice(0, 500),
        // amber-base.css clips sideways overflow (html, body { overflow-x: clip }), so scrollWidth no longer
        // shows it: measure how far anything that starts on screen reaches past the right edge, unless an
        // inner scroller or clip holds it (a row of chips that scrolls is fine).
        overflow: Math.max(0, de.scrollWidth - window.innerWidth, Math.round([...document.body.querySelectorAll("*")].reduce((m, el) => {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height || r.left >= window.innerWidth - 1 || r.right <= m) return m;
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") return m;
          return r.right;
        }, 0) - window.innerWidth)), textLength: text.trim().length,
        shown: want.filter((w) => flat.includes(w.toLowerCase().replace(/\s+/g, " ")) || (/^[\d\s.,\u00a0]+$/.test(w) && flat.replace(/[\s,\u00a0\u202f]/g, "").includes(w.replace(/[\s,\u00a0]/g, "")))).length,
        bg, fg: bodyStyle.color, unnamed, small,
      };
    }, want).catch((e) => ({ overflow: 0, textLength: 0, shown: 0, bg: "rgb(255,255,255)", fg: "rgb(0,0,0)", unnamed: [] as string[], small: 0, smallText: [] as string[], smallTextCount: 0, faint: [] as string[], faintCount: 0, headings: [] as string[], excerpt: "", titleCount: 0, ghostFields: [] as string[], sections: 0, nav: false, junk: [] as string[], under44: [] as string[], under44Count: 0, clipped: [] as string[], clippedCount: 0, used: 0, canvases: 0, svgShapes: 0, gridCols: 0, frames: 0, look: { accentHue: null as number | null, nonAmberVivid: 0, tintedBg: false }, err: String(e) }));
    let shot: string | undefined;
    if (opts.shots && (width < 600 || scheme === "light")) {
      shot = `${opts.shots}-${width}-${scheme}.png`;
      await page.screenshot({ path: shot, fullPage: width < 600 }).catch(() => (shot = undefined));
    }
    let png: string | undefined;
    if (opts.capture) {
      const full = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 900);
      const buf = await page.screenshot({ clip: { x: 0, y: 0, width, height: Math.min(full, width < 600 ? 1700 : 1100) } }).catch(() => null);
      if (buf) png = btoa(Array.from(buf, (b) => String.fromCharCode(b)).join(""));
    }
    views.push({ name: `${widget ? "widget" : width}-${scheme}`, width, scheme, errors, overflowPx: m.overflow, textLength: m.textLength, shown: m.shown, sampled: want.length,
      bg: m.bg, fg: m.fg, contrast: contrastOf(m.bg, m.fg), bgLuminance: lum(m.bg), unnamedControls: m.unnamed, smallTargets: m.small, screenshot: shot,
      smallText: m.smallText, smallTextCount: m.smallTextCount, faintText: m.faint, faintCount: m.faintCount, headings: m.headings, excerpt: m.excerpt,
      titleCount: m.titleCount, ghostFields: m.ghostFields, sections: m.sections, nav: m.nav, junk: m.junk, under44: m.under44, under44Count: m.under44Count, clipped: m.clipped, clippedCount: m.clippedCount, usedWidth: m.used, canvases: m.canvases, svgShapes: m.svgShapes, gridCols: m.gridCols, frames: m.frames, look: m.look, ...(png ? { png } : {}) });

    await page.context().close();
  }

  // Can the page edit the note? On the phone: fill in and submit the first form, else press
  // checkbox-like controls and then buttons, one at a time, until an edit lands.
  md = markdown; store = empty(data);
  const viewUpdates = updates.length;
  if (opts.interact) {
    const { page, errors } = await open(375, "light");
    const errs = errors.length;
    const before = updates.length + setData;
    for (let k = 0; k < 8 && updates.length + setData === before; k++) {
      const tried = await page.evaluate((k: number) => {
        const form = document.querySelector("form");
        if (k === 0 && form) {
          for (const el of form.querySelectorAll("input, textarea")) {
            const i = el as HTMLInputElement;
            if (["hidden", "submit", "button", "checkbox", "radio"].includes(i.type) || i.value) continue;
            const hint = (i.name + " " + i.placeholder + " " + (i.labels?.[0]?.textContent ?? "") + " " + (i.getAttribute("aria-label") ?? "")).toLowerCase();
            i.value = i.type === "email" ? "test@example.com" : i.type === "url" ? "" : i.type === "number" || /amount|kr|price|cost|km|min|value|sum|rating|goal/.test(hint) || i.inputMode === "decimal" || i.inputMode === "numeric" ? "3" : i.type === "date" ? (window as any).amber.note.today : "Test entry";
            i.dispatchEvent(new Event("input", { bubbles: true }));
          }
          const b = form.querySelector("button:not([type=button]), input[type=submit]") as HTMLElement | null;
          if (b) b.click(); else form.requestSubmit();
          return "form";
        }
        const pool = [...document.querySelectorAll("input[type=checkbox], [role=checkbox], [aria-pressed], [data-line], button:not(form button)")]
          .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !(el as HTMLButtonElement).disabled; });
        const el = pool[k - (form ? 1 : 0)] as HTMLElement | undefined;
        if (!el) return "none";
        el.click();
        return "control";
      }, k).catch(() => "error");
      if (tried === "none" || tried === "error") { if (k === 0) interaction = { tried: tried, ok: tried === "none" ? null : false }; break; }
      interaction = { tried, ok: null };
      await page.waitForTimeout(300);
    }
    // Does it move after that (a game or toy that plays)? Frames asked for over the next second.
    const f0 = await page.evaluate(() => (window as any).__frames as number).catch(() => 0);
    await page.waitForTimeout(1000);
    interaction.framesPerSecond = (await page.evaluate(() => (window as any).__frames as number).catch(() => 0)) - f0;
    if (interaction.tried === "form" || interaction.tried === "control") {
      const fresh = updates.slice(viewUpdates);
      const landed = updates.length + setData > before;
      interaction.ok = landed && fresh.every((u) => u.ok) && errors.length === errs;
      if (!interaction.ok) interaction.error = fresh.find((u) => !u.ok)?.error ?? (errors.length > errs ? errors[errors.length - 1] : "no control sent an edit");
    }
    await page.context().close();
  }
  if (viewUpdates) interaction.error = `${viewUpdates} edit(s) were sent just by opening the page`;

  // Robustness: the same app over changed data. A new record with markup in it (does the app follow
  // its data, and escape it?), everything removed, and 400 records. Apps keep their data as JSON in
  // their store (a collection, a list in values, or a list kept in localStorage as a string); older
  // apps read the note's tables, and are probed through the note instead.
  const probes: Render["probes"] = {};
  if (opts.probes === false) return { views, blocked: [...new Set(blocked)], updates, setData, interaction, probes, markdownAfter: markdown, dataAfter: data };
  const PROBE = 'Zq <b>probe</b> & "x"';
  const measure = async (body: string, d: unknown = data) => {
    md = body; store = empty(d);
    const t0 = performance.now();
    const { page, errors } = await open(390, "light");
    const ms = performance.now() - t0;
    const r = await page.evaluate((probe: string) => ({ text: document.body?.innerText ?? "", injected: [...document.querySelectorAll("b")].some((b) => b.textContent === "probe" && (b.parentElement?.textContent ?? "").includes("Zq")) }), PROBE).catch(() => ({ text: "", injected: false }));
    await page.context().close();
    return { errors, ms, ...r };
  };
  const follow = (r: Awaited<ReturnType<typeof measure>>, what: string) => {
    probes.follows = { pass: r.text.includes(PROBE) && r.errors.length === 0, detail: r.errors[0] ?? (r.injected ? "markup from its data ran as HTML" : r.text.includes("Zq") ? "shown, but not as written" : `a new ${what} doesn't show`) };
    probes.escapes = { pass: !r.injected && r.errors.length === 0, detail: r.injected ? "markup from its data ran as HTML" : r.errors[0] };
  };
  const lists = dataLists(empty(data));
  const main = lists.sort((a, b) => b.items.length - a.items.length)[0];
  if (main && main.items.length) {
    const last = main.items[main.items.length - 1];
    const key = Object.keys(last).find((k) => typeof last[k] === "string" && !/^(id|created|updated|date|day|time|at)$/i.test(k) && !/^\d{4}-\d{2}-\d{2}/.test(last[k] as string) && !/^[\d\s.,:-]+$/.test(last[k] as string));
    if (key) {
      const probe = { ...last, [key]: PROBE, ...(typeof last.id === "string" ? { id: "probe-1" } : {}) };
      follow(await measure(markdown, main.with([...main.items, probe])), "record in the app's data");
    }
    const r = await measure(markdown, lists.reduce((d, l) => l.withIn(d, []), empty(data)));
    probes.empty = { pass: r.errors.length === 0 && r.text.trim().length > 0, detail: r.errors[0] ?? "blank app" };
    const many: Record<string, unknown>[] = [];
    for (let k = 0; many.length < 400; k++) { const x = main.items[k % main.items.length]; many.push(typeof x.id === "string" ? { ...x, id: `${x.id}-${k}` } : x); }
    const big = await measure(markdown, main.with(many));
    probes.large = { pass: big.errors.length === 0 && big.ms < 3000, detail: big.errors[0] ?? `${Math.round(big.ms)} ms to load 400 records` };
    return { views, blocked: [...new Set(blocked)], updates, setData, interaction, probes, markdownAfter: markdown, dataAfter: data };
  }
  const tables = findTables(markdown);
  const mainTable = tables.slice().sort((a, b) => b.rows.length - a.rows.length)[0];
  const lines = markdown.split("\n");
  const rowAt = (t: typeof mainTable) => { const out: number[] = []; for (let k = t.start; k <= t.end; k++) if (/^\s*\|/.test(lines[k]) && !/^[\s|:-]+$/.test(lines[k])) out.push(k); return out.slice(1); };
  const textCol = mainTable ? mainTable.columns.findIndex((c, k) => c.type.kind === "text" && !/date|day/i.test(c.name) && mainTable.rows.some((r) => r[k] && !/^[\d\s.,✓✔xX·-]+$/.test(r[k]))) : -1;
  if (mainTable && textCol >= 0 && mainTable.rows.length) {
    const cells = [...mainTable.rows[mainTable.rows.length - 1]];
    cells[textCol] = PROBE;
    const at = rowAt(mainTable);
    const l2 = [...lines];
    l2.splice(at[at.length - 1] + 1, 0, "| " + cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ") + " |");
    follow(await measure(l2.join("\n")), "row in the note");
  }
  if (tables.length) {
    const drop = new Set(tables.flatMap((t) => rowAt(t)));
    const r = await measure(lines.filter((l, k) => !drop.has(k) && !/^\s*[-*+]\s+\[[ xX]\]/.test(l)).join("\n"));
    probes.empty = { pass: r.errors.length === 0 && r.text.trim().length > 0, detail: r.errors[0] ?? "blank page" };
  }
  if (mainTable && mainTable.rows.length) {
    const at = rowAt(mainTable);
    const extra: string[] = [];
    for (let k = 0; extra.length + mainTable.rows.length < 400; k++) extra.push(lines[at[k % at.length]]);
    const l2 = [...lines];
    l2.splice(at[at.length - 1] + 1, 0, ...extra);
    const r = await measure(l2.join("\n"));
    probes.large = { pass: r.errors.length === 0 && r.ms < 3000, detail: r.errors[0] ?? `${Math.round(r.ms)} ms to load 400 rows` };
  }
  return { views, blocked: [...new Set(blocked)], updates, setData, interaction, probes, markdownAfter: markdown, dataAfter: data };
}
