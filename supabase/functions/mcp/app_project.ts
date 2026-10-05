// A note's app as a small web project (the stored format agreed with the app side): what's stored, path rules, file edits the way a coding agent makes
// them, the compile step (the device never compiles) and import checks. Pure; the tools are in
// app_files.ts.
import * as esbuild from "npm:esbuild-wasm@0.24.0";

export type Project = { amberApp: 1; files: Record<string, string>; compiled: Record<string, string> };

export const MAX_FILES = 200;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_PROJECT_BYTES = 3 * 1024 * 1024;

/** Bare names the app's import map resolves (the host owns the map; the page never writes one). */
export const BARE_IMPORTS = [
  "preact", "preact/hooks", "preact/jsx-runtime", "htm", "amber", "amber-ui", "amber-router",
  "chart.js", "d3", "three", "tone", "dayjs", "marked", "dompurify", "animejs", "canvas-confetti", "topojson-client",
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
/** The agreed transform: esbuild, JSX automatic with preact, ESM, es2020, imports as written. */
export async function compile(path: string, source: string): Promise<{ code: string } | { error: string }> {
  ready ??= esbuild.initialize({ worker: false });
  await ready;
  const loader = path.endsWith(".tsx") ? "tsx" : path.endsWith(".ts") ? "ts" : "jsx";
  try {
    const r = await esbuild.transform(source, { loader, jsx: "automatic", jsxImportSource: "preact", format: "esm", target: "es2020", sourcemap: false, sourcefile: path });
    return { code: r.code };
  } catch (e) {
    // deno-lint-ignore no-explicit-any
    const errs = (e as any).errors as { text: string; location?: { line: number; column: number; lineText: string } }[] | undefined;
    return { error: errs?.length ? errs.slice(0, 5).map((x) => `${path}:${x.location?.line ?? "?"}:${(x.location?.column ?? 0) + 1}: ${x.text}${x.location?.lineText ? `\n    ${x.location.lineText.trim()}` : ""}`).join("\n") : String(e) };
  }
}
export const needsCompile = (path: string) => COMPILED.test(path);

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
        else if (spec.startsWith(".") || spec.startsWith("/")) { if (!p.files[resolveFrom(path, spec)]) out.push(`${path} imports ${spec}, but ${resolveFrom(path, spec)} doesn't exist.`); }
        else if (!BARE_IMPORTS.includes(spec)) out.push(`${path} imports "${spec}", which isn't a bundled name (${BARE_IMPORTS.join(", ")}). Use one of those, or add the code as a file.`);
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
