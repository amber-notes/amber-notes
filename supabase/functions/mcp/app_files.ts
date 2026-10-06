// A note's app as a small codebase, edited the way a coding agent edits a repository: list, read
// with line numbers, write, exact-string edit, delete and move files. Every write compiles what
// needs compiling (the device never compiles), checks the project and, when a renderer is set up,
// opens it, and says what to fix. See app_project.ts for the format and checks, app_scaffold.ts for
// the project a new app starts from.

import { hostDeclared, declaredHosts } from "./page.ts";
import { sampleData, sampleNote } from "./app_sample.ts";
import { render, renderedFindings, testSummary } from "./app_check.ts";
import {
  brokenImports, cleanPath, compileMany, editText, isReact, isTest, linkProject, needsCompile, numbered, parseStored, type Project, projectProblems, serialize, sourceProblems, styleWarnings,
} from "./app_project.ts";
import { scaffold } from "./app_scaffold.ts";
import { bodyOf, Content, findNote, type Note, ToolError, type Call, type Tx } from "./tools.ts";

type Args = Record<string, unknown>;
const str = (d: string) => ({ type: "string", description: d });
const noteRef = { id: str("Note id (preferred)."), title: str("Note title, if you don't have the id. Must match one note.") };
const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
// Every write can replace what is there (a file, or the whole app with replace), so all are destructive.
const write = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;
const look = { type: "boolean", description: "Also return a small screenshot of the app at 390 px (for clients that show images)." };
const AFTER = "Every write compiles .jsx/.tsx/.ts, checks the whole project and opens it in a browser when it can, and returns what to fix (compile_error, problems, warnings, check).";

export const fileTools = [
  {
    name: "create_app", title: "Start a note's app",
    description: "Gives a note an app as a normal Vite + React + TypeScript + Tailwind + shadcn/ui project: package.json, tsconfig.json, index.html, src/main.tsx, src/App.tsx, src/index.css (Tailwind, shadcn's variables set from Amber's colours), src/lib/utils.ts (cn), src/lib/amber.ts (the app's data), src/components/ui/ (shadcn components) and README.md. " +
      "Then build the app with write_app_file and edit_app_file. A note that already has an app is left alone unless replace is true (the old app stays in its versions).",
    inputSchema: { type: "object", properties: { ...noteRef, replace: { type: "boolean", description: "Replace the note's current app with a fresh project." } } },
    annotations: write,
  },
  {
    name: "list_app_files", title: "List a note's app files",
    description: "The files of a note's app (path, size, lines) and its README. A one-file app is the project { /index.html }. Read the README first: it says what the app is and where its data lives.",
    inputSchema: { type: "object", properties: { ...noteRef } },
    annotations: read,
  },
  {
    name: "read_app_file", title: "Read a file of a note's app",
    description: "One file of a note's app with line numbers (like cat -n), from offset (1-based) for limit lines (default 2000). Read a file before you edit it, and copy old_string from here without the line numbers.",
    inputSchema: { type: "object", properties: { ...noteRef, path: str("The file, e.g. /src/App.jsx."), offset: { type: "integer" }, limit: { type: "integer" } }, required: ["path"] },
    annotations: read,
  },
  {
    name: "write_app_file", title: "Write a file of a note's app",
    description: "Creates or replaces one file of a note's app with content. Paths start at the project root: /src/screens/Today.jsx, /src/components/SetRow.jsx, /src/styles.css, /README.md. For a change to an existing file, prefer edit_app_file. " + AFTER,
    inputSchema: { type: "object", properties: { ...noteRef, path: str("The file to write."), content: str("The whole file."), look }, required: ["path", "content"] },
    annotations: write,
  },
  {
    name: "edit_app_file", title: "Edit a file of a note's app",
    description: "Replaces old_string with new_string in one file, exactly (spaces and line breaks included). old_string must appear once, unless replace_all is true; include a few lines around the change to make it unique. " + AFTER,
    inputSchema: {
      type: "object",
      properties: { ...noteRef, path: str("The file to edit."), old_string: str("The exact text to replace."), new_string: str("What replaces it."), replace_all: { type: "boolean" }, look },
      required: ["path", "old_string", "new_string"],
    },
    annotations: write,
  },
  {
    name: "delete_app_file", title: "Delete a file of a note's app",
    description: "Removes one file from a note's app (never /index.html). The app before is kept in its versions. " + AFTER,
    inputSchema: { type: "object", properties: { ...noteRef, path: str("The file to delete.") }, required: ["path"] },
    annotations: write,
  },
  {
    name: "move_app_file", title: "Move or rename a file of a note's app",
    description: "Moves or renames one file. Imports that point at it aren't changed: fix them with edit_app_file (the result lists the ones that broke). " + AFTER,
    inputSchema: { type: "object", properties: { ...noteRef, from: str("The file now."), to: str("Its new path.") }, required: ["from", "to"] },
    annotations: write,
  },
];

/** The app the AI is working on: its draft when the last save was held back, else the live one. */
export async function projectOf(tx: Tx, c: Call, id: string): Promise<{ project: Project; exists: boolean; draft?: string | null }> {
  const [row] = await tx<{ page_ct: string | null; draft_ct: string | null; draft_problems: string | null }[]>`select page_ct, draft_ct, draft_problems from public.note_pages where note_id = ${id} for update`;
  const box = row?.draft_ct ?? row?.page_ct;
  if (!box) return { project: parseStored(null), exists: false };
  try { return { project: parseStored(await c.v.openPage(id, box)), exists: true, draft: row?.draft_ct ? row.draft_problems ?? "" : null }; } catch { throw new ToolError("This note's app can't be opened with this connection's key."); }
}

/** The app's own data (for a sample with its shape), or empty. */
async function dataOf(tx: Tx, c: Call, id: string): Promise<unknown> {
  const [row] = await tx<{ data_ct: string | null }[]>`select data_ct from public.note_pages where note_id = ${id}`;
  if (!row?.data_ct) return { values: {}, collections: {} };
  try { return JSON.parse(await c.v.openPageData(id, row.data_ct)); } catch { return { values: {}, collections: {} }; }
}

const lines = (t: string) => t.split("\n").length;
export const fileList = (p: Project) => Object.keys(p.files).sort().map((path) => ({ path, bytes: new TextEncoder().encode(p.files[path]).length, lines: lines(p.files[path]) }));

/** Checks, stores and reports a project after one change. Refuses what the app couldn't run. */
/**
 * Checks a project and saves it. It goes live (devices run it) only when it passes the gate: its own
 * tests and a smoke check (opens at phone and desktop sizes, each visible tab and button tapped
 * once, on a throwaway copy of the data: no crash, no console errors, no blank screen, the data
 * store working). A version that fails is kept as the app's draft, which the AI keeps working on;
 * the last one that passed keeps running for the person (20261007160800_app_drafts.sql).
 */
export async function saveProject(tx: Tx, c: Call, n: Note, unlinked: Project, changed: string, a: Args) {
  const linked = await linkProject(unlinked);
  if (linked.error) throw new ToolError(`Not saved: the CSS doesn't compile.\n${linked.error}`);
  const p = linked.project;
  const stored = serialize(p);
  const declared = declaredHosts(p.files["/index.html"] ?? "");
  const problems = [...projectProblems(p), ...sourceProblems(p, (h) => hostDeclared(declared, h))];
  if (problems.length) throw new ToolError(`Not saved:\n- ${problems.join("\n- ")}`);
  const broken = brokenImports(p);
  const warnings = styleWarnings(p);
  const body = await bodyOf(c.v, n);
  const t = new Date().toISOString().slice(0, 10);
  const sample = { html: stored, markdown: sampleNote(body, t), data: sampleData(await dataOf(tx, c, n.id), t), today: t };
  const r = await render({ ...sample, views: [{ width: 390, scheme: "light" }, { width: 1280, scheme: "light" }], capture: a.look === true, interact: false, probes: false });
  const found = typeof r === "string" ? null : renderedFindings(r);
  const gateOn = Deno.env.get("AMBER_NO_TRY") !== "1";
  // The app's own tests, and the smoke check, on every save.
  const tested = gateOn && Object.keys(p.files).some(isTest) && typeof r !== "string" ? await render({ ...sample, tests: true }) : null;
  const tests = tested && typeof tested !== "string" ? testSummary(tested) : null;
  const smoked = gateOn && typeof r !== "string" ? await render({ ...sample, smoke: true }) : null;
  const smoke = smoked && typeof smoked !== "string" ? smoked.smoke : null;
  const scriptErrors = (found?.errors ?? []).filter((e) => /script error|blank|tried to load/.test(e));
  const failures = [...broken, ...scriptErrors, ...(smoke?.problems ?? []), ...(tests?.failures.map((f) => `test failed: ${f}`) ?? [])];
  const live = failures.length === 0;
  const sealed = await c.v.sealPage(n.id, stored);
  if (live) {
    // The file tools write often: within ten minutes, the same writer's earlier app isn't kept as
    // another version (20261007160600_app_file_writes_coalesce.sql), so Previous App means "before".
    await tx`select set_config('pane.coalesce', 'on', true)`;
    await tx`insert into public.note_pages (note_id, page_ct) values (${n.id}, ${sealed})
      on conflict (note_id) do update set page_ct = excluded.page_ct, draft_ct = null, draft_problems = null`;
    await tx`select set_config('pane.coalesce', 'off', true)`;
  } else {
    // What failed, by name only (test and check names, never note content or data): the device
    // shows it in App Info while the draft is held back.
    const why = [
      ...broken.map((b) => `import: ${b.split(" imports ")[0]}`),
      ...scriptErrors.map((e) => `opens: ${e.split(":")[0]}`),
      ...(smoke?.problems ?? []).map((m) => `smoke check at ${m.split(" px")[0]} px: ${/blank/.test(m) ? "blank screen" : /saving its data/.test(m) ? "saving data failed" : /pageerror|Error/.test(m) ? "script error" : "console error"}${/after tapping/.test(m) ? " after tapping a control" : ""}`),
      ...(tested && typeof tested !== "string" ? [...(tested.tests ?? []).filter((x) => !x.ok).map((x) => `test: ${x.file ?? ""} › ${x.name}`), ...((tested.testErrors ?? []).map((e) => `test file: ${e.split(":")[0]}`))] : []),
    ].filter((x, k, all) => all.indexOf(x) === k).join("\n").slice(0, 3900);
    await tx`insert into public.note_pages (note_id, draft_ct, draft_problems) values (${n.id}, ${sealed}, ${why})
      on conflict (note_id) do update set draft_ct = excluded.draft_ct, draft_problems = excluded.draft_problems`;
  }
  const [{ has_live }] = await tx<{ has_live: boolean }[]>`select page_ct is not null as has_live from public.note_pages where note_id = ${n.id}`;
  const errors = [...broken, ...(found?.errors ?? []), ...(smoke?.problems ?? []), ...(tests?.failures.map((f) => `test failed: ${f}`) ?? [])];
  const notes = [...warnings, ...(found?.notes ?? [])].slice(0, 10);
  const result = {
    app: { id: n.id, title: n.title }, [changed.startsWith("deleted") ? "deleted" : "saved"]: changed.replace(/^deleted /, ""), files: Object.keys(p.files).length,
    live: live ? "Live: the person's devices run this version." : has_live
      ? "Held back: this version failed the checks below, so the person keeps the last version that passed. Fix them and save again; it goes live when it passes."
      : "Held back: this version failed the checks below, so the app won't open for the person until a version passes.",
    ...(errors.length ? { errors } : found ? { opens: "Opens cleanly at 390 and 1280 px (over a sample of its data)." } : {}),
    ...(found === null ? { browser: r } : {}),
    ...(tests ? { tests: `${tests.passed} passed, ${tests.failed} failed` } : {}),
    ...(smoke ? { smoke: smoke.ok ? `ok (${smoke.taps} taps)` : `failed (${smoke.taps} taps)` } : {}),
    ...(notes.length ? { notes } : {}),
  };
  const shot = typeof r !== "string" && a.look === true ? r.views.find((v) => v.png)?.png : undefined;
  return shot ? new Content([{ type: "text", text: JSON.stringify(result, null, 2) }, { type: "image", data: shot, mimeType: "image/png" }], result) : result;
}

/** A project with one file set: compiled if it needs it. A syntax error refuses the write. */
export function withFile(p: Project, path: string, content: string): Promise<Project> {
  return withFiles(p, { [path]: content });
}

/** A project with these files set, compiled in one build. A syntax error refuses the write. */
export async function withFiles(p: Project, files: Record<string, string>): Promise<Project> {
  const next: Project = { amberApp: 1, files: { ...p.files, ...files }, compiled: { ...p.compiled } };
  const react = isReact(next);
  const items = Object.entries(files).filter(([path]) => needsCompile(path, react)).map(([path, source]) => ({ path, source }));
  let built;
  try { built = await compileMany(items, react ? "react" : "preact"); } catch (e) { throw new ToolError(`Not saved: ${(e as Error).message}`); }
  for (const { path } of items) {
    const out = built[path] ?? { error: `${path}: not compiled` };
    if ("error" in out) throw new ToolError(`Not saved: ${path} doesn't compile.\n${out.error}`);
    next.compiled[path] = out.code;
  }
  return next;
}

const text = (v: unknown, k: string) => { if (typeof v !== "string") throw new ToolError(`${k} must be text.`); return v; };
const pathArg = (v: unknown) => { try { return cleanPath(v); } catch (e) { throw new ToolError((e as Error).message); } };

export const fileHandlers: Record<string, (tx: Tx, a: Args, c: Call) => Promise<unknown>> = {
  async create_app(tx, a, c) {
    const n = await findNote(tx, c, a);
    const { exists } = await projectOf(tx, c, n.id);
    if (exists && a.replace !== true) throw new ToolError(`"${n.title}" already has an app. Read it with list_app_files, or pass replace: true to start over (the current app stays in its versions).`);
    const p = await withFiles({ amberApp: 1, files: {}, compiled: {} }, scaffold(n.title));
    const r = await saveProject(tx, c, n, p, "a new project", a) as Record<string, unknown>;
    return { ...r, files: fileList(p), next: "Read /README.md, then make Home do the app's main job: edit src/screens/Home.jsx, add screens and components, and keep README.md current." };
  },

  async list_app_files(tx, a, c) {
    const n = await findNote(tx, c, a, true);
    const { project: p, exists } = await projectOf(tx, c, n.id);
    if (!exists) return { app: { id: n.id, title: n.title }, has_app: false, next: "Start one with create_app." };
    return { app: { id: n.id, title: n.title }, files: fileList(p), ...(p.files["/README.md"] ? { readme: p.files["/README.md"] } : {}), one_file: Object.keys(p.files).length === 1 };
  },

  async read_app_file(tx, a, c) {
    const n = await findNote(tx, c, a, true);
    const { project: p } = await projectOf(tx, c, n.id);
    const path = pathArg(a.path);
    if (p.files[path] === undefined) throw new ToolError(`No ${path}. Files: ${Object.keys(p.files).sort().join(", ") || "none (create_app starts a project)"}.`);
    const offset = Number.isInteger(a.offset) ? Number(a.offset) : 1, limit = Number.isInteger(a.limit) ? Math.max(1, Number(a.limit)) : 2000;
    const r = numbered(p.files[path], offset, limit);
    return { path, lines: r.lines, shown: `${r.shown[0]}-${r.shown[1]}`, content: r.text };
  },

  async write_app_file(tx, a, c) {
    const n = await findNote(tx, c, a);
    const path = pathArg(a.path), content = text(a.content, "content");
    let { project: p, exists } = await projectOf(tx, c, n.id);
    // The first file written to a note without an app starts from the project scaffold.
    if (!exists && path !== "/index.html") for (const [f, t] of Object.entries(scaffold(n.title))) p = await withFile(p, f, t);
    const was = p.files[path];
    if (was === content) return { app: { id: n.id, title: n.title }, saved: `${path} (unchanged)` };
    p = await withFile(p, path, content);
    return await saveProject(tx, c, n, p, `${path} (${was === undefined ? "created" : "replaced"}${!exists && path !== "/index.html" ? ", on a new project scaffold" : ""})`, a);
  },

  async edit_app_file(tx, a, c) {
    const n = await findNote(tx, c, a);
    const path = pathArg(a.path);
    const { project: p } = await projectOf(tx, c, n.id);
    if (p.files[path] === undefined) throw new ToolError(`No ${path}. Files: ${Object.keys(p.files).sort().join(", ") || "none"}. To make a new file, use write_app_file.`);
    let r: { text: string; count: number };
    try { r = editText(p.files[path], text(a.old_string, "old_string"), text(a.new_string, "new_string"), a.replace_all === true); } catch (e) { throw new ToolError((e as Error).message); }
    return await saveProject(tx, c, n, await withFile(p, path, r.text), `${path} (${r.count} change${r.count > 1 ? "s" : ""})`, a);
  },

  async delete_app_file(tx, a, c) {
    const n = await findNote(tx, c, a);
    const path = pathArg(a.path);
    if (path === "/index.html") throw new ToolError("/index.html is the page the app opens; it can't be deleted. To remove the whole app, use set_note_page with an empty html.");
    const { project: p } = await projectOf(tx, c, n.id);
    if (p.files[path] === undefined) throw new ToolError(`No ${path}.`);
    const files = { ...p.files }, compiled = { ...p.compiled };
    delete files[path]; delete compiled[path];
    return await saveProject(tx, c, n, { amberApp: 1, files, compiled }, `deleted ${path}`, a);
  },

  async move_app_file(tx, a, c) {
    const n = await findNote(tx, c, a);
    const from = pathArg(a.from), to = pathArg(a.to);
    if (from === "/index.html") throw new ToolError("/index.html stays where it is: the app opens it.");
    const { project: p } = await projectOf(tx, c, n.id);
    if (p.files[from] === undefined) throw new ToolError(`No ${from}.`);
    if (p.files[to] !== undefined) throw new ToolError(`${to} already exists. Delete it first, or pick another name.`);
    const files = { ...p.files }, compiled = { ...p.compiled };
    const content = files[from];
    delete files[from]; delete compiled[from];
    return await saveProject(tx, c, n, await withFile({ amberApp: 1, files, compiled }, to, content), `${from} → ${to}`, a);
  },
};
