// A note's app as a small web project (the stored format agreed with the app side): what's stored, path rules, file edits the way a coding agent makes
// them, the compile step (the device never compiles) and import checks. Pure; the tools are in
// app_files.ts.
import * as esbuild from "npm:esbuild-wasm@0.24.0";

export type Project = { amberApp: 1; files: Record<string, string>; compiled: Record<string, string> };

export const MAX_FILES = 200;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_PROJECT_BYTES = 3 * 1024 * 1024;

/** The stack's bare names: React on preact/compat, shadcn v4's radix-ui and the rest. Radix's own
 *  @radix-ui/react-* packages are in the map only because radix-ui is built from them. */
export const STACK_NAMES = [
  "react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime",
  "preact/compat", "preact/compat/client", "preact/compat/jsx-runtime",
  "radix-ui", "class-variance-authority", "clsx", "tailwind-merge", "lucide-react", "recharts", "date-fns", "zod", "framer-motion", "motion", "sonner", "react-day-picker",
];

/** Bare names the app's import map resolves (the host owns the map; the page never writes one). */
export const BARE_IMPORTS = [
  "preact", "preact/hooks", "preact/jsx-runtime", "htm", "amber", "amber-ui", "amber-router",
  "chart.js", "d3", "three", "tone", "dayjs", "marked", "dompurify", "animejs", "canvas-confetti", "topojson-client", "world-atlas",
  // The React stack (Pane/Resources/AppLibraries/stack.json; app_project.test.ts keeps this in step).
  ...STACK_NAMES,
];

const COMPILED = /\.(jsx|tsx|ts)$/;
const bytes = (s: string) => new TextEncoder().encode(s).length;

/** What page_ct holds, opened: a project, or plain HTML (a one-file project). */
export function parseStored(text: string | null): Project {
  if (!text) return { amberApp: 1, files: {}, compiled: {} };
  if (text.trimStart().startsWith("{")) {
    try {
      const p = JSON.parse(text);
      if (p?.amberApp === 1 && p.files && typeof p.files === "object") return { amberApp: 1, files: p.files, compiled: p.compiled ?? {} };
    } catch { /* HTML that starts with a brace is still HTML */ }
  }
  return { amberApp: 1, files: { "/index.html": text }, compiled: {} };
}

/** What's sealed into page_ct: a lone /index.html stays plain HTML, so one-file apps are unchanged. */
export function serialize(p: Project): string {
  const names = Object.keys(p.files);
  if (names.length === 1 && names[0] === "/index.html" && !Object.keys(p.compiled).length) return p.files["/index.html"];
  const sorted = (o: Record<string, string>) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  return JSON.stringify({ amberApp: 1, files: sorted(p.files), compiled: sorted(p.compiled) });
}

/** A path as the tools accept it: "/src/App.jsx"; "src/App.jsx" gets its slash. */
export function cleanPath(raw: unknown): string {
  let p = String(raw ?? "").trim();
  if (!p) throw new Error("path is empty.");
  if (!p.startsWith("/")) p = "/" + p;
  if (!/^\/[A-Za-z0-9._\-/]+$/.test(p)) throw new Error(`"${p}": paths use letters, digits, ".", "_", "-" and "/" only.`);
  if (p.split("/").some((s) => s === ".." || s === ".") || p.includes("//") || p.endsWith("/")) throw new Error(`"${p}" isn't a file path (no "..", "." or empty parts).`);
  return p;
}

/** Problems with the whole project before it's saved. */
export function projectProblems(p: Project): string[] {
  const out: string[] = [];
  const names = Object.keys(p.files);
  if (!p.files["/index.html"]) out.push("The project needs /index.html: it's the page the app opens.");
  if (names.length > MAX_FILES) out.push(`${names.length} files; at most ${MAX_FILES}.`);
  for (const n of names) if (bytes(p.files[n]) > MAX_FILE_BYTES) out.push(`${n} is ${Math.round(bytes(p.files[n]) / 1024)} KB; a file can be at most ${MAX_FILE_BYTES / 1024} KB.`);
  const total = bytes(serialize(p));
  if (total > MAX_PROJECT_BYTES) out.push(`The project is ${(total / 1048576).toFixed(1)} MB with its compiled files; at most ${MAX_PROJECT_BYTES / 1048576} MB.`);
  if (/<script[^>]*type=["']importmap["']/i.test(p.files["/index.html"] ?? "")) out.push("Don't write an import map: the app provides one with preact, amber, amber-ui and the bundled libraries.");
  return out;
}

/** Claude Code's Edit: old must appear exactly once (or every time, with all). */
export function editText(text: string, oldStr: string, newStr: string, all = false): { text: string; count: number } {
  if (!oldStr) throw new Error("old_string is empty: to write a whole file, use write_app_file.");
  if (oldStr === newStr) throw new Error("old_string and new_string are the same.");
  const count = text.split(oldStr).length - 1;
  if (!count) throw new Error("old_string wasn't found. Read the file again (read_app_file) and copy the exact text, spaces and line breaks included.");
  if (count > 1 && !all) throw new Error(`old_string appears ${count} times. Include more surrounding text so it's unique, or pass replace_all: true.`);
  return { text: all ? text.split(oldStr).join(newStr) : text.replace(oldStr, () => newStr), count: all ? count : 1 };
}

/** A file with line numbers, like cat -n, from line offset (1-based) for limit lines. */
export function numbered(text: string, offset = 1, limit = 2000): { text: string; lines: number; shown: [number, number] } {
  const lines = text.split("\n");
  const from = Math.max(1, offset), to = Math.min(lines.length, from + limit - 1);
  return { text: lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(6)}\t${l}`).join("\n"), lines: lines.length, shown: [from, to] };
}

let ready: Promise<void> | null = null;
/** The agreed transform: esbuild, JSX automatic (React's runtime, which the app maps to
 *  preact/compat, or Preact's for older projects), ESM, es2020, imports as written. */
export async function compile(path: string, source: string, jsxImportSource: "react" | "preact" = "preact"): Promise<{ code: string } | { error: string }> {
  ready ??= esbuild.initialize({ worker: false });
  await ready;
  const loader = path.endsWith(".tsx") ? "tsx" : path.endsWith(".ts") ? "ts" : /\.m?js$/.test(path) ? "js" : "jsx";
  try {
    const r = await esbuild.transform(source, { loader, jsx: "automatic", jsxImportSource, format: "esm", target: "es2020", sourcemap: false, sourcefile: path });
    return { code: r.code };
  } catch (e) {
    // deno-lint-ignore no-explicit-any
    const errs = (e as any).errors as { text: string; location?: { line: number; column: number; lineText: string } }[] | undefined;
    return { error: errs?.length ? errs.slice(0, 5).map((x) => `${path}:${x.location?.line ?? "?"}:${(x.location?.column ?? 0) + 1}: ${x.text}${x.location?.lineText ? `\n    ${x.location.lineText.trim()}` : ""}`).join("\n") : String(e) };
  }
}
export const needsCompile = (path: string, react = false) => COMPILED.test(path) || (react && /\.m?js$/.test(path));

/** A React project (React's names, which the app maps to preact/compat) rather than a Preact one. */
export const isReact = (p: Project) => /"react"/.test(p.files["/package.json"] ?? "") || Object.entries(p.files).some(([f, t]) => /\.(jsx|tsx)$/.test(f) && /from\s*["']react["']/.test(t));

const EXTS = [".tsx", ".ts", ".jsx", ".js", ".mjs"];
/** Where an import points in the project, the way Vite resolves it: "@/x" is /src/x, and a path
 *  without an extension finds x.tsx, x.ts, x.jsx, x.js or x/index.*. null: a bare name (the import
 *  map's) or nothing there. */
export function resolveImport(p: Project, from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = "/src/" + spec.slice(2);
  else if (spec.startsWith(".") || spec.startsWith("/")) base = resolveFrom(from, spec);
  else return null;
  if (p.files[base] !== undefined) return base;
  for (const e of EXTS) if (p.files[base + e] !== undefined) return base + e;
  for (const e of EXTS) if (p.files[`${base}/index${e}`] !== undefined) return `${base}/index${e}`;
  return null;
}


/**
 * Links a project after a change, as a bundler would but file by file: every compiled module's
 * imports point at the exact file they mean ("@/lib/utils" → "/src/lib/utils.ts"), a CSS import
 * becomes "/src/x.css?import" (the app serves that as a module that adds the stylesheet), and each stylesheet that imports Tailwind is generated from the classes
 * the project's files use. The device serves the result as it is.
 */
export async function linkProject(p: Project): Promise<{ project: Project; ms: { tailwind: number }; error?: string }> {
  const compiled: Record<string, string> = {};
  for (const [path, code] of Object.entries(p.compiled)) {
    if (path.endsWith(".css")) continue;
    let out = code.replace(/(^|[;\n])\s*import\s*["']([^"']+\.css)["'];?/g, (m, lead, spec) => {
      const to = resolveImport(p, path, spec);
      return to ? `${lead}import "${to}?import";` : m;
    });
    out = out.replace(/(\bfrom\s*|\bimport\s*\(\s*|(?:^|[;\n])\s*import\s*)(["'])([^"']+)\2/g, (m, lead, q, spec) => {
      const to = resolveImport(p, path, spec);
      return to && to !== spec ? `${lead}${q}${to}${q}` : m;
    });
    compiled[path] = out;
  }
  const t0 = performance.now();
  const sources = Object.entries(p.files).filter(([f]) => !f.endsWith(".css") && !f.endsWith(".md")).map(([, t]) => t).join("\n");
  for (const [path, css] of Object.entries(p.files)) {
    if (!path.endsWith(".css") || !/@import\s+["']tailwindcss["']/.test(css)) continue;
    try { compiled[path] = await tailwind(css, sources); } catch (e) { return { project: p, ms: { tailwind: 0 }, error: `${path}: ${(e as Error).message}` }; }
  }
  return { project: { amberApp: 1, files: p.files, compiled }, ms: { tailwind: Math.round(performance.now() - t0) } };
}

/** Tailwind v4 from the classes in the project's sources (no scanner: every token is a candidate,
 *  and Tailwind keeps the ones that are classes). */
async function tailwind(css: string, sources: string): Promise<string> {
  const [{ compile: twCompile }, { STYLESHEETS }] = await Promise.all([import("npm:tailwindcss@4.1.14"), import("./tailwind.gen.ts")]);
  const c = await twCompile(css, {
    base: "/",
    loadStylesheet: (id: string) => {
      if (STYLESHEETS[id] !== undefined) return Promise.resolve({ base: "/", content: STYLESHEETS[id], path: id });
      throw new Error(`@import "${id}": only "tailwindcss" and "tw-animate-css" can be imported in CSS here.`);
    },
    loadModule: () => { throw new Error("Tailwind plugins (@plugin) aren't available here."); },
  });
  return c.build([...new Set(sources.split(/[^A-Za-z0-9_\-:\[\]\/.#%()!@&*=,'+]+/).filter((x) => x && x.length < 200))]);
}

/** Static import specifiers in a module (import … from "x", import "x", import("x"), export … from "x"). */
export function importsOf(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/(?:^|[;\n}])\s*(?:import|export)\s*(?:[\w*{}\s,$]+?\s*from\s*)?["']([^"']+)["']/g)) out.add(m[1]);
  for (const m of code.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) out.add(m[1]);
  return [...out];
}

/** Where a relative or absolute specifier points, from the importing file. */
export function resolveFrom(from: string, spec: string): string {
  const parts = spec.startsWith("/") ? [] : from.split("/").slice(1, -1);
  for (const s of spec.split("/")) {
    if (!s || s === ".") continue;
    if (s === "..") parts.pop(); else parts.push(s);
  }
  return "/" + parts.join("/");
}

/** Imports and links that point at nothing: a missing file, an unknown bare name, a URL. */
export function brokenImports(p: Project): string[] {
  const out: string[] = [];
  for (const [path, text] of Object.entries(p.files)) {
    if (/\.(m?js|jsx|tsx?)$/.test(path)) {
      for (const spec of importsOf(text)) {
        if (/^https?:|^\/\//.test(spec)) out.push(`${path} imports ${spec}: the app has no network. Use a bundled library or a file in the project.`);
        else if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@/")) { if (!resolveImport(p, path, spec)) out.push(`${path} imports ${spec}, but there's no such file.`); }
        else if (!BARE_IMPORTS.includes(spec) && !spec.startsWith("@radix-ui/")) out.push(`${path} imports "${spec}", which isn't available (${BARE_IMPORTS.join(", ")}). Use one of those, pin an npm file with resolve_package, or add the code as a file.`);
      }
    }
    if (path.endsWith(".html")) {
      for (const m of text.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)) {
        const ref = m[1];
        if (/^(https?:)?\/\//.test(ref)) out.push(`${path} loads ${ref}: the app has no network.`);
        else if (!/^(amber-lib|data):/.test(ref) && !p.files[resolveFrom(path, ref)]) out.push(`${path} loads ${ref}, but ${resolveFrom(path, ref)} doesn't exist.`);
      }
    }
  }
  return out;
}

const NAMESPACES = /^https?:\/\/www\.w3\.org\/(2000\/svg|1999\/xhtml|1999\/xlink|XML\/1998\/namespace)$/;
const isCode = (path: string) => /\.(m?js|jsx|tsx?)$/.test(path);

/** What would make the app refuse to run or reach the network, across every file. */
export function sourceProblems(p: Project, declared: (host: string) => boolean): string[] {
  const out: string[] = [];
  for (const [path, text] of Object.entries(p.files)) {
    if (path.endsWith(".md")) continue;
    const urls = [...text.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>)]*/gi)].map((m) => m[0])
      .filter((u) => !NAMESPACES.test(u.replace(/\/$/, "")) && !/^amber-(lib|file|app):/i.test(u))
      .filter((u) => { try { const x = new URL(u); return !(/^https?:$/.test(x.protocol) && declared(x.host.toLowerCase())); } catch { return true; } });
    if (urls.length) out.push(`${path}: external addresses aren't allowed (${[...new Set(urls)].slice(0, 3).join(", ")}). The app has no network; declare a host in amber-needs (in /index.html) and use fetch from "amber".`);
    if (path.endsWith(".html")) {
      const tags = [...new Set([...text.matchAll(/<(base|iframe|frame|frameset|object|embed|portal|applet)\b/gi)].map((m) => m[1].toLowerCase()))];
      if (tags.length) out.push(`${path}: <${tags.join(">, <")}> isn't allowed.`);
    }
    if (isCode(path) || path.endsWith(".html")) {
      // fetch of the app's own files ("/src/data.json", "./x.json") is fine; anything else isn't.
      const apis = [...new Set([...text.matchAll(/\bnew\s+(XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker|RTCPeerConnection)\b|\bnavigator\.(sendBeacon|serviceWorker)\b|\bimportScripts\s*\(|\bwindow\.open\s*\(/g)].map((m) => m[1] ?? m[0].replace(/\s*\($/, ""))), ...(/(?<![\w.])fetch\s*\(\s*(?!["'`]\.?\/)/.test(text) && !/import\s*\{[^}]*\bfetch\b[^}]*\}\s*from\s*["']amber["']/.test(text) ? ["fetch"] : [])];
      if (apis.length) out.push(`${path}: the app can't use the network itself (${apis.join(", ")}). Use fetch from "amber" for hosts declared in amber-needs; plain fetch("/src/x.json") reads the app's own files.`);
    }
  }
  return out;
}

/** The style a project should be written in: hooks from "amber", tables by name. */
export function styleWarnings(p: Project): string[] {
  const out: string[] = [];
  const code = Object.entries(p.files).filter(([path]) => isCode(path));
  const globals = code.filter(([, t]) => /\bwindow\b[^;\n]{0,20}\.amber\b|(?<![\w.])amber\s*\.\s*(note|update|onChange|setData|store|data)\b/.test(t)).map(([path]) => path);
  if (globals.length) out.push(`${globals.slice(0, 3).join(", ")} use window.amber directly. In a project, import what you need from "@/lib/amber" (useStore, useCollection, useSettings, batch, fetch, device…).`);
  // The app's data is JSON in its own store; the note's text is only read once, to convert an old note.
  const noteData = code.filter(([, t]) => /\buse(Table|Checklist)\s*\(|\.tables\s*\[|\bop\s*:\s*["'](append_row|set_cell|toggle_checklist|add_checklist_item|delete_row)/.test(t)).map(([path]) => path);
  if (noteData.length) out.push(`${noteData.slice(0, 3).join(", ")} keep data in the note's tables or checklists. An app's data is JSON in its own store: useStore / useCollection / useSettings from "amber" (or localStorage, which syncs). useImported() gives what an older note held, to start from once.`);
  const radix = code.filter(([, t]) => /from\s*["']@radix-ui\/react-/.test(t)).map(([path]) => path);
  if (radix.length) out.push(`${radix.slice(0, 3).join(", ")} import @radix-ui/react-* directly. The app ships Radix as the radix-ui package (what shadcn v4 uses): import { Dialog as DialogPrimitive } from "radix-ui".`);
  if (!p.files["/README.md"]) out.push("Add /README.md: what the app is for, its screens and files, and where its data lives (the note's tables by heading, the app's own data). Keep it current; the next AI reads it first.");
  if (!/<html[^>]*\blang\s*=/i.test(p.files["/index.html"] ?? "")) out.push('Add lang="en" (or the note\'s language) to <html> in /index.html.');
  if (code.some(([, t]) => /\b(indexedDB|document\.cookie)\b/.test(t))) out.push("IndexedDB and cookies aren't available. Use the store (useStore, useCollection) or localStorage, which is kept and synced.");
  if (code.some(([, t]) => /(?<![\w.])(alert|confirm|prompt)\s*\(/.test(t))) out.push("alert/confirm/prompt don't show. Use a Sheet or Dialog from amber-ui, or an inline message.");
  const css = Object.entries(p.files).filter(([path]) => path.endsWith(".css")).map(([, t]) => t).join("\n");
  const important = (css.match(/!\s*important/gi) ?? []).length;
  if (important) out.push(`!important appears ${important} time${important > 1 ? "s" : ""}: it isn't needed. amber-base.css and amber-ui sit in cascade layers, so any rule the app writes already wins.`);
  return out;
}
