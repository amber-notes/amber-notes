// The file-like tool set (prototype, chosen with AMBER_MCP_TOOLS=files): the account works like a
// folder of files, the way coding agents already work. A note is a markdown file
// ("Work/Acme.md"); an app is a folder of code plus data.json ("Work/Habits.app/src/App.tsx",
// "Work/Habits.app/data.json"); folders end in "/". Every path also takes a note's id
// ("<id>", "<id>.app/data.json"). Twelve tools: search, list, fetch, create, edit, write, move,
// delete, history, restore, pin, see_app. edit and write answer with checks: real breakage in a
// note (note_checks.ts), compile and render errors in an app.

import { applyEdits, fitLines, sliceLines, wikiLinks, type Edit } from "./notes.ts";
import { noteChecks } from "./note_checks.ts";
import { cleanPath, editText, type Project } from "./app_project.ts";
import { scaffold } from "./app_scaffold.ts";
import { fileList, projectOf, saveProject, withFile, withFiles } from "./app_files.ts";
import { pageDataOf, storePageData } from "./data_tools.ts";
import { dataShape } from "./data_ops.ts";
import { appHandlers } from "./app_tools.ts";
import type { PageData } from "./page.ts";
import {
  bodyOf, clampInt, Content, findFolder, folders, type FolderRow, handlers as classic, HEAD_COLUMNS, iso, listedNotes, MAX_READ_CHARS,
  type Note, type NoteRow, notesById, pathOf, quote, refuseLocked, runIn, save, Scan, searchAll, type Tool, type ToolContext, ToolError, type Tx, type Call, UUID,
  wholeNumber, withHead, checkSize,
} from "./tools.ts";

type Args = Record<string, unknown>;
const str = (d: string) => ({ type: "string", description: d });
const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const change = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;
const add = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const PATH = "A path from list or search: a note \"Work/Acme.md\", a folder \"Work/\", an app file \"Work/Habits.app/src/App.tsx\", an app's data \"Work/Habits.app/data.json\", a file \"pane-file:<id>\"; or a note's id (\"<id>.app/data.json\" for its app).";

/** Trying an app (see_app steps) and its tests on save; off only in the experiment's control arm. */
export const tryOn = () => Deno.env.get("AMBER_NO_TRY") !== "1";

export const FILE_TOOLS: Tool[] = ([
  {
    name: "search", title: "Search",
    description: "Search the person's notes by words or phrases (\"quoted phrases\", OR, -word). Returns each note's id, title, path and a snippet; read one with fetch. Locked notes are left out.",
    inputSchema: { type: "object", properties: { query: str("Search query.") }, required: ["query"] },
    annotations: read,
  },
  {
    name: "list", title: "List",
    description: "What's in the notes, like a file listing. No path: the overview (folders with counts, pinned notes, the most recently edited notes, how many are in Recently Deleted). A folder (\"Work/\"): its notes and sub-folders. An app (\"Work/Habits.app\"): its files. \"Recently Deleted/\": deleted notes, which restore brings back.",
    inputSchema: { type: "object", properties: { path: str("A folder, an app, or \"Recently Deleted/\". Default: the overview.") } },
    annotations: read,
  },
  {
    name: "fetch", title: "Read",
    description: "Reads anything by its path or id: a note's markdown (with its path, folder, version, sub-notes, and its app if it has one), an app file, an app's data.json (its JSON data, with what the app keeps in localStorage already parsed, and the data's shape), a file (text, image or PDF), or a folder's listing. For long notes, pass lines like \"40-120\".",
    inputSchema: { type: "object", properties: { id: str(PATH), lines: str("A line range, like \"40-120\".") }, required: ["id"] },
    annotations: read,
  },
  {
    name: "create", title: "Create",
    description: "Creates a note, a folder or an app. A note: content is its markdown (the first line is the title), path its folder (default Notes); pinned to pin it; inside a note's path to make it that note's sub-note (linked from it). A folder: path like \"Work/Clients/\". An app: path is the note that becomes the app (an existing note, or a new one like \"Work/Habits.md\"); it starts as a React + TypeScript + Tailwind + shadcn/ui project whose README.md says how apps run here.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["note", "folder", "app"], description: "Default note." },
        path: str("A note: its folder (default Notes). A folder: its path. An app: the note."),
        content: str("A note's markdown."),
        inside: str("Make the note a sub-note of this note (path or id)."),
        pinned: { type: "boolean" },
      },
    },
    annotations: add,
  },
  {
    name: "edit", title: "Edit",
    description: "Exact search and replace in a note, an app file or an app's data.json, like a coding agent's Edit: each old_text must match once (copy it from fetch, without line numbers) unless replace_all; edits apply in order, all or nothing. Answers with checks: what the change broke in a note (a damaged table, a checklist line that won't tick, a tracker value out of range or not one of its choices), or the app's compile and render errors. data.json stays JSON and is saved as one change the person can undo.",
    inputSchema: {
      type: "object",
      properties: {
        id: str(PATH),
        edits: { type: "array", items: { type: "object", properties: { old_text: str("Exact existing text."), new_text: str("Replacement; empty deletes."), replace_all: { type: "boolean" } }, required: ["old_text", "new_text"] } },
      },
      required: ["id", "edits"],
    },
    annotations: change,
  },
  {
    name: "write", title: "Write",
    description: "Replaces a whole note, app file or data.json with content (a new app file is created). Prefer edit for changes; the old version stays in history. Answers with the same checks as edit.",
    inputSchema: { type: "object", properties: { id: str(PATH), content: str("The whole new text (data.json: JSON).") }, required: ["id", "content"] },
    annotations: change,
  },
  {
    name: "move", title: "Move or rename",
    description: "Moves or renames a note, a folder or an app file. A note to a folder (\"Work/Clients/\", created if needed), or to a new name in place or elsewhere (\"Work/New title.md\"); a folder to a new path or name (\"Archive/2025/\"); an app file within its app.",
    inputSchema: { type: "object", properties: { id: str(PATH), to: str("Where it goes.") }, required: ["id", "to"] },
    annotations: change,
  },
  {
    name: "delete", title: "Delete",
    description: "Deletes a note (to Recently Deleted, with its sub-notes; restore brings it back for 30 days), a folder (its notes go to Recently Deleted), an app file, or a note's app (\"Work/Habits.app\": the note stays; the app is kept in history).",
    inputSchema: { type: "object", properties: { id: str(PATH) }, required: ["id"] },
    annotations: change,
  },
  {
    name: "history", title: "History",
    description: "Earlier versions, newest first, with who made each (the app on a device, or an AI): of a note's text, or of an app (its code and data.json).",
    inputSchema: { type: "object", properties: { id: str(PATH), limit: { type: "integer" } }, required: ["id"] },
    annotations: read,
  },
  {
    name: "restore", title: "Restore",
    description: "Brings back a note from Recently Deleted (no version), or an earlier version from history: of a note's text, or of an app (code and data as they were).",
    inputSchema: { type: "object", properties: { id: str(PATH), version: { type: "integer", description: "A version id from history." } }, required: ["id"] },
    annotations: change,
  },
  {
    name: "pin", title: "Pin",
    description: "Pins a note to the top of the list, or unpins it.",
    inputSchema: { type: "object", properties: { id: str(PATH), pinned: { type: "boolean" } }, required: ["id", "pinned"] },
    annotations: { ...change, idempotentHint: true },
  },
  {
    name: "see_app", title: "See an app",
    description: "Screenshots of a note's app at iPhone and Mac sizes, light and dark, over a sample with the shape of its data (data: \"real\" only if the person allowed it in Amber Notes), with what each view shows and anything broken." +
      (tryOn() ? " With steps, uses the app like a person instead and answers after each step with what's on screen, console errors, what changed in its data, and screenshots: { tap: \"Add\" } (text, label or CSS selector), { type: \"85\", into: \"Weight\" }, { scroll: \"down\" }, { wait: 500 | \"Saved\" }, { press: \"Enter\" }, { resize: \"phone\" | \"desktop\" }, { dark: true }. Nothing is written back." : ""),
    inputSchema: {
      type: "object",
      properties: {
        id: str("The app's note (path or id)."),
        widths: { type: "array", items: { type: "integer" }, description: "Default [390, 1280]." },
        themes: { type: "array", items: { type: "string", enum: ["light", "dark"] } },
        data: { type: "string", enum: ["sample", "real"] },
        ...(tryOn() ? { steps: { type: "array", items: { type: "object" }, description: "Up to 30 steps, done in order on a throwaway copy." } } : {}),
      },
      required: ["id"],
    },
    annotations: read,
  },
] satisfies Tool[]).map((t) => ({ ...t, annotations: { title: t.title, ...t.annotations }, securitySchemes: [{ type: "oauth2" as const, scopes: [t.annotations.readOnlyHint ? "notes:read" : "notes:write"] }] }));

/** What the server tells every client when this tool set is on. */
export const FILE_INSTRUCTIONS = `Amber Notes is the person's notes app. Their notes work like a folder of files: list shows them, fetch reads anything, edit and write change it, create/move/delete/pin/history/restore do the rest, search finds notes by their words. Paths: a note "Work/Acme.md", a folder "Work/", an app "Work/Habits.app/…", a file "pane-file:<id>"; every path also takes a note's id.
Notes are markdown; the first line is the title. Keep what's there as written: checklists "- [ ] item" / "- [x] item", tables (a "<!-- pane-table: Date=date; Mood=scale 1-5; Walk=choice Yes|No -->" line above a table makes it a tracker: keep values in range), links to sub-notes [Title](pane-note:<id>) and files ![name](pane-file:<id>). To tick an item, log a row, or add under a heading, edit the note: copy old_text exactly from fetch. edit and write answer with checks; fix anything they report.
A note can be an app: a React + TypeScript + Tailwind + shadcn/ui project (create type "app"); its README.md says how apps run here, and its docs/ folder is that app's memory: read docs/ first, and keep it current (data shape, decisions and why, known gaps) whenever you change the app. Every feature you add gets a test in tests/ like the starter's (do what the person does, check what they see and what was saved); never weaken, skip or delete a test to make it pass: fix the app instead. Tests run on every save, and a version that fails isn't shown to the person. Its data is data.json: read and edit it like any file to change the person's data without opening the app ("remove these dates"); each edit is one change they can undo. Look at an app with see_app.
Talk about "notes" and "the note's app", never "pages". Link notes with [[Title]], [[Title|text]] or [[Title#Heading]]: the app follows them by title (fetch "Title" opens one; fetch lists a note's links). Locked notes can't be read here.`;

export async function runFileTool(name: string, args: Args, ctx: ToolContext): Promise<unknown> {
  return await runIn(FILE_TOOLS, fileHandlers, name, args, ctx);
}

// MARK: Paths

type Ref =
  | { kind: "root" }
  | { kind: "deleted" }
  | { kind: "folder"; folder: FolderRow }
  | { kind: "note"; note: Note }
  | { kind: "app"; note: Note }
  | { kind: "appfile"; note: Note; path: string }
  | { kind: "data"; note: Note }
  | { kind: "file"; id: string };

const safeName = (t: string) => t.replace(/\//g, "∕").trim() || "Untitled";
/** A note's path: its folder's path and its title (sub-notes under their parent's path). */
async function notePath(tx: Tx, c: Call, n: Note, all: FolderRow[], depth = 0): Promise<string> {
  if (n.parent_id && depth < 8) {
    const [p] = await notesById(tx, c.v, [n.parent_id]);
    if (p && !p.trashed_at) return `${(await notePath(tx, c, p, all, depth + 1)).replace(/\.md$/, "")}/${safeName(n.title)}.md`;
  }
  const f = pathOf(n.folder_id, all);
  return `${f ? f + "/" : ""}${safeName(n.title)}.md`;
}
const urlOf = (id: string) => `ambernotes://note/${id}`;

/** Every note whose title is `title`, heads only. */
async function byTitle(tx: Tx, c: Call, title: string, trashed: boolean): Promise<Note[]> {
  const want = title.toLowerCase();
  const out: Note[] = [];
  const scan = await Scan.start(tx, c);
  await scan.notes(() => trashed ? tx`` : tx`and trashed_at is null`, false, async (r) => {
    const n = await withHead(c.v, r);
    if (safeName(n.title).toLowerCase() === want) out.push(n);
  });
  return out;
}

async function noteById(tx: Tx, c: Call, id: string, trashed: boolean): Promise<Note> {
  const rows = await tx<NoteRow[]>`select * from public.notes where id = ${id}::uuid and deleted_at is null for update`;
  if (!rows.length) throw new ToolError(`No note with id ${id}.`);
  const n = await withHead(c.v, rows[0]);
  if (n.trashed_at && !trashed) throw new ToolError(`"${n.title}" is in Recently Deleted. Bring it back with restore first.`);
  refuseLocked(n);
  return n;
}

/** A note by its path ("Work/Acme.md", "Work/Trip/Packing.md" for a sub-note), without ".md". */
async function noteByPath(tx: Tx, c: Call, path: string, trashed: boolean): Promise<Note> {
  const parts = path.split("/").map((p) => p.trim()).filter(Boolean);
  const title = parts.pop()!;
  const dir = parts.join("/");
  const all = await folders(tx, c.v);
  const hits = await byTitle(tx, c, title, trashed);
  const fit: Note[] = [];
  for (const n of hits) {
    if (!dir) { fit.push(n); continue; }
    if (pathOf(n.folder_id, all).toLowerCase() === dir.toLowerCase() && !n.parent_id) { fit.push(n); continue; }
    if ((await notePath(tx, c, n, all)).toLowerCase() === `${path}.md`.toLowerCase()) fit.push(n);
  }
  const pick = fit.length ? fit : !dir ? [] : hits.length === 1 ? hits : [];
  if (pick.length === 1) {
    const n = await noteById(tx, c, pick[0].id, trashed);
    return n;
  }
  if (pick.length > 1) throw new ToolError(`${pick.length} notes are at "${path}.md": ${(await Promise.all(pick.slice(0, 5).map(async (n) => `${await notePath(tx, c, n, all)} (${n.id})`))).join(", ")}. Use an id.`);
  throw new ToolError(`No note at "${path}.md".${hits.length ? ` Notes titled "${title}": ${(await Promise.all(hits.slice(0, 5).map(async (n) => `${await notePath(tx, c, n, all)} (${n.id})`))).join(", ")}.` : " Use search or list to find it."}`);
}

async function resolve(tx: Tx, c: Call, raw: unknown, opts: { trashed?: boolean } = {}): Promise<Ref> {
  let ref = String(raw ?? "").trim().replace(/^\/+/, "");
  if (!ref) return { kind: "root" };
  if (/^recently deleted\/?$/i.test(ref)) return { kind: "deleted" };
  if (/^pane-file:/i.test(ref)) return { kind: "file", id: ref.slice(10) };
  const app = (n: Note, rest: string): Ref => {
    const sub = rest.replace(/^\/+/, "");
    if (!sub) return { kind: "app", note: n };
    if (sub === "data.json") return { kind: "data", note: n };
    return { kind: "appfile", note: n, path: sub };
  };
  const id = ref.slice(0, 36);
  if (UUID.test(id)) {
    const rest = ref.slice(36);
    const n = await noteById(tx, c, id, opts.trashed ?? false);
    if (!rest || rest === ".md") return { kind: "note", note: n };
    if (rest.startsWith(".app")) return app(n, rest.slice(4));
    throw new ToolError(`"${ref}": after a note id comes nothing, ".md", or ".app/<file>".`);
  }
  const at = ref.search(/\.app(\/|$)/i);
  if (at >= 0) return app(await noteByPath(tx, c, ref.slice(0, at), opts.trashed ?? false), ref.slice(at + 4));
  if (/\.md$/i.test(ref)) return { kind: "note", note: await noteByPath(tx, c, ref.slice(0, -3), opts.trashed ?? false) };
  const folderPath = ref.replace(/\/+$/, "");
  if (ref.endsWith("/")) return { kind: "folder", folder: await findFolder(tx, c.v, folderPath, false) };
  // No ending: a folder by that path, else a note by that path or title.
  try { return { kind: "folder", folder: await findFolder(tx, c.v, folderPath, false) }; } catch { /* not a folder */ }
  return { kind: "note", note: await noteByPath(tx, c, ref, opts.trashed ?? false) };
}

const lineRange = (v: unknown): [number | undefined, number | undefined] => {
  if (v === undefined || v === null || v === "") return [undefined, undefined];
  const m = String(v).match(/^\s*(\d+)?\s*(?:-\s*(\d+)?)?\s*$/);
  if (!m) throw new ToolError(`lines is a range like "40-120" (got ${quote(String(v))}).`);
  return [m[1] ? Number(m[1]) : undefined, m[2] ? Number(m[2]) : m[1] && !String(v).includes("-") ? Number(m[1]) : undefined];
};
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: Deno.env.get("PANE_TIMEZONE") ?? "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function hasApp(tx: Tx, id: string): Promise<boolean> {
  return (await tx`select 1 from public.note_pages where note_id = ${id} and page_ct is not null`).length > 0;
}

/** An app's project; refuses a note without one. */
async function appProject(tx: Tx, c: Call, n: Note): Promise<Project> {
  const { project, exists } = await projectOf(tx, c, n.id);
  if (!exists) throw new ToolError(`"${n.title}" has no app. Make one with create { type: "app", path: <the note> }.`);
  return project;
}

/** data.json as the AI sees it: the app's JSON, localStorage parsed. */
const dataText = (d: PageData) => JSON.stringify(d, null, 2);
async function saveData(tx: Tx, c: Call, n: Note, before: PageData, text: string) {
  let next: PageData;
  try { next = JSON.parse(text); } catch (e) { throw new ToolError(`data.json isn't valid JSON after the change: ${(e as Error).message}. Nothing was saved.`); }
  if (!next || typeof next !== "object" || Array.isArray(next)) throw new ToolError("data.json must be an object: { \"values\": { … }, \"collections\": { … } }.");
  next = { ...next, values: next.values ?? {}, collections: next.collections ?? {} };
  if (JSON.stringify(next) === JSON.stringify(before)) return { app: n.title, data: "unchanged" };
  const { bytes } = await storePageData(tx, c, n.id, next);
  return { app: n.title, saved: "data.json", bytes, note: "Saved as one change: the open app shows it at once, and the person can undo it." };
}

// MARK: Handlers

export const fileHandlers: Record<string, (tx: Tx, a: Args, c: Call) => Promise<unknown>> = {
  async search(tx, a, c) {
    const q = String(a.query ?? "").trim();
    if (!q) return { results: [] };
    const all = await folders(tx, c.v);
    const { results, broad, scan } = await searchAll(tx, c, q, clampInt(a.limit, 10, 30) || 10);
    return {
      results: await Promise.all(results.map(async ({ doc: n, snippet }) => ({ id: n.id, title: n.title, url: urlOf(n.id), path: await notePath(tx, c, n, all), snippet }))),
      ...(broad ? { no_note_has_every_word: true } : {}), ...scan.searched,
    };
  },

  async list(tx, a, c) {
    const r = await resolve(tx, c, a.path);
    const all = await folders(tx, c.v);
    const entry = async (n: Note) => ({ path: await notePath(tx, c, n, all), id: n.id, ...(n.is_pinned ? { pinned: true } : {}), ...(n.locked_body ? { locked: true } : {}), updated: iso(n.updated_at), ...(await hasApp(tx, n.id) ? { app: true } : {}) });
    if (r.kind === "root") {
      const { listed, counts, approximate } = await listedNotes(tx, c);
      const pinned = await Promise.all((await tx<NoteRow[]>`select ${HEAD_COLUMNS(tx)} from public.notes where deleted_at is null and trashed_at is null and is_pinned order by updated_at desc limit 20`).map((x) => withHead(c.v, x)));
      const recent = await notesById(tx, c.v, listed.slice(0, 15).map((n) => n.id));
      const [{ trashed }] = await tx<{ trashed: number }[]>`select count(*)::int as trashed from public.notes where deleted_at is null and trashed_at is not null`;
      return {
        notes: listed.length, folders: all.map((f) => ({ path: pathOf(f.id, all) + "/", notes: counts.get(f.id) ?? 0 })),
        pinned: await Promise.all(pinned.map(entry)), recently_edited: await Promise.all(recent.map(entry)), recently_deleted: trashed, ...(approximate ? { counts_approximate: true } : {}),
      };
    }
    if (r.kind === "deleted") {
      const rows = await tx<NoteRow[]>`select ${HEAD_COLUMNS(tx)} from public.notes where deleted_at is null and trashed_at is not null order by trashed_at desc limit 100`;
      return { path: "Recently Deleted/", notes: await Promise.all((await Promise.all(rows.map((x) => withHead(c.v, x)))).map(async (n) => ({ ...(await entry(n)), deleted: iso(n.trashed_at) }))) };
    }
    if (r.kind === "folder") {
      const rows = await tx<NoteRow[]>`select ${HEAD_COLUMNS(tx)} from public.notes where deleted_at is null and trashed_at is null and folder_id = ${r.folder.id} and parent_id is null order by is_pinned desc, updated_at desc limit 300`;
      return {
        path: pathOf(r.folder.id, all) + "/",
        folders: all.filter((f) => f.parent_id === r.folder.id).map((f) => pathOf(f.id, all) + "/"),
        notes: await Promise.all((await Promise.all(rows.map((x) => withHead(c.v, x)))).map(entry)),
      };
    }
    if (r.kind === "app" || r.kind === "appfile" || r.kind === "data") {
      const p = await appProject(tx, c, r.note);
      const base = (await notePath(tx, c, r.note, all)).replace(/\.md$/, ".app");
      return { path: `${base}/`, files: [...fileList(p).map((f) => ({ ...f, path: `${base}${f.path}` })), { path: `${base}/data.json`, what: "the app's data" }] };
    }
    if (r.kind === "note") {
      const subs = await Promise.all((await tx<NoteRow[]>`select ${HEAD_COLUMNS(tx)} from public.notes where parent_id = ${r.note.id} and deleted_at is null and trashed_at is null`).map((x) => withHead(c.v, x)));
      return { path: await notePath(tx, c, r.note, all), sub_notes: await Promise.all(subs.map(entry)), ...(await hasApp(tx, r.note.id) ? { app: (await notePath(tx, c, r.note, all)).replace(/\.md$/, ".app/") } : {}) };
    }
    throw new ToolError("Files are listed in the overview's notes; read one with fetch.");
  },

  async fetch(tx, a, c) {
    const r = await resolve(tx, c, a.id, { trashed: true });
    const all = await folders(tx, c.v);
    if (r.kind === "file") return await classic.get_file(tx, { id: r.id }, c);
    if (r.kind === "root" || r.kind === "folder" || r.kind === "deleted") {
      const listing = await fileHandlers.list(tx, { path: r.kind === "folder" ? pathOf(r.folder.id, all) + "/" : r.kind === "deleted" ? "Recently Deleted/" : "" }, c);
      return { id: String(a.id ?? ""), title: r.kind === "folder" ? r.folder.name : r.kind === "deleted" ? "Recently Deleted" : "Notes", text: JSON.stringify(listing, null, 2), url: "ambernotes://notes", metadata: { kind: "folder" } };
    }
    if (r.kind === "note") {
      const n = r.note;
      const body = await bodyOf(c.v, n);
      const [start, end] = lineRange(a.lines);
      const shown = fitLines(sliceLines(body, start, end, false), MAX_READ_CHARS);
      const first = start ?? 1;
      const subs = await Promise.all((await tx<NoteRow[]>`select ${HEAD_COLUMNS(tx)} from public.notes where parent_id = ${n.id} and deleted_at is null and trashed_at is null`).map((x) => withHead(c.v, x)));
      const path = await notePath(tx, c, n, all);
      return {
        id: n.id, title: n.title, text: shown.text, url: urlOf(n.id),
        metadata: {
          path, folder: pathOf(n.folder_id, all) + "/", pinned: n.is_pinned, version: Number(n.version), updated: iso(n.updated_at), lines: body.split("\n").length,
          ...(n.trashed_at ? { in_recently_deleted: true } : {}),
          ...(subs.length ? { sub_notes: await Promise.all(subs.map((s) => notePath(tx, c, s, all))) } : {}),
          // [[wiki links]] as written; fetch a target by its title ("Recipes") to open it.
          ...(wikiLinks(body).length ? { links: wikiLinks(body) } : {}),
          ...(await hasApp(tx, n.id) ? { app: path.replace(/\.md$/, ".app/"), app_note: "This note is an app: list its files, or fetch its data.json." } : {}),
          ...(shown.truncated ? { shown: `lines ${first}-${first + shown.lines - 1}`, next: `lines: "${first + shown.lines}-"` } : start || end ? { shown: `lines ${first}-${Math.min(end ?? Infinity, body.split("\n").length)}` } : {}),
        },
      };
    }
    const base = (await notePath(tx, c, r.note, all)).replace(/\.md$/, ".app");
    if (r.kind === "data") {
      const d = await pageDataOf(tx, c, r.note.id);
      const text = dataText(d);
      const shown = fitLines(text, MAX_READ_CHARS);
      // What the app's own notes say its data means: docs/README.md, else README.md, under "## Data".
      const files = (await projectOf(tx, c, r.note.id)).project.files;
      const readme = [files["/docs/README.md"], files["/README.md"]].map((t) => t?.match(/^##\s*Data\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m)?.[1]?.trim()).find(Boolean);
      return { id: `${r.note.id}.app/data.json`, title: `${r.note.title}: data.json`, text: shown.text, url: urlOf(r.note.id),
        metadata: { path: `${base}/data.json`, shape: { values: dataShape(d.values), collections: dataShape(d.collections) }, ...(readme ? { readme_data: readme } : {}), ...(shown.truncated ? { truncated: true } : {}),
          about: "values.localStorage holds what the app keeps in localStorage, parsed; it's saved back as the app expects." } };
    }
    const p = await appProject(tx, c, r.note);
    if (r.kind === "app") {
      const { draft } = await projectOf(tx, c, r.note.id);
      return { id: `${r.note.id}.app`, title: `${r.note.title} (app)`, text: [...fileList(p).map((f) => `${base}${f.path}  (${f.lines} lines)`), `${base}/data.json`].join("\n"), url: urlOf(r.note.id),
        metadata: { path: `${base}/`, readme: p.files["/README.md"] ?? null, ...(await loadFailure(tx, r.note.id)),
          ...(draft !== null && draft !== undefined ? { held_back: `These files are a version that failed its checks, so the person still has the last one that passed. What failed:\n${draft}` } : {}) } };
    }
    const file = cleanPath(r.path);
    if (p.files[file] === undefined) throw new ToolError(`No ${base}${file}. Files: ${Object.keys(p.files).sort().join(", ")}.`);
    const [start, end] = lineRange(a.lines);
    const shown = fitLines(sliceLines(p.files[file], start, end, false), MAX_READ_CHARS);
    return { id: `${r.note.id}.app${file}`, title: file, text: shown.text, url: urlOf(r.note.id), metadata: { path: `${base}${file}`, lines: p.files[file].split("\n").length, ...(shown.truncated ? { truncated: true } : {}) } };
  },

  async create(tx, a, c) {
    const type = a.type ?? "note";
    if (type === "folder") {
      const f = await findFolder(tx, c.v, String(a.path ?? "").replace(/\/+$/, ""), true);
      return { created: pathOf(f.id, await folders(tx, c.v)) + "/" };
    }
    if (type === "app") {
      if (typeof a.path !== "string" || !a.path.trim()) throw new ToolError("path is the note that becomes the app: an existing note or a new one like \"Work/Habits.md\".");
      let n: Note;
      try {
        const r = await resolve(tx, c, a.path);
        if (r.kind !== "note") throw new ToolError(`${a.path} isn't a note.`);
        n = r.note;
      } catch (e) {
        if (!/^No note at/.test((e as Error).message)) throw e;
        const p = String(a.path).replace(/\.md$/i, "").split("/").filter(Boolean);
        const title = p.pop()!;
        const made = await classic.create_note(tx, { body: `${title}\n`, folder: p.join("/") || "Notes" }, c) as { created: { id: string } };
        n = await noteById(tx, c, made.created.id, false);
      }
      if (await hasApp(tx, n.id)) throw new ToolError(`"${n.title}" already has an app. Change its files with edit and write.`);
      const proj = await withFiles({ amberApp: 1, files: {}, compiled: {} }, scaffold(n.title));
      const result = await saveProject(tx, c, n, proj, "a new React project", a) as Record<string, unknown>;
      const base = (await notePath(tx, c, n, await folders(tx, c.v))).replace(/\.md$/, ".app");
      return { ...result, app: `${base}/`, next: `Read ${base}/README.md, then build the app with write and edit (files under ${base}/src/). Its data is ${base}/data.json.` };
    }
    if (type !== "note") throw new ToolError("type is note, folder or app.");
    const content = String(a.content ?? "");
    if (!content.trim()) throw new ToolError("content is the note's markdown; its first line is the title.");
    if (a.inside !== undefined) {
      const r = await resolve(tx, c, a.inside);
      if (r.kind !== "note") throw new ToolError("inside is the note that will hold the sub-note.");
      const made = await classic.create_sub_note(tx, { id: r.note.id, body: content }, c) as { created: { id: string; title: string } };
      const n = await noteById(tx, c, made.created.id, false);
      return { created: await notePath(tx, c, n, await folders(tx, c.v)), id: n.id, linked_from: r.note.title };
    }
    const folder = typeof a.path === "string" && a.path.trim() ? String(a.path).replace(/\/[^/]*\.md$/i, "").replace(/\.md$/i, "").replace(/\/+$/, "") : "Notes";
    const made = await classic.create_note(tx, { body: content, folder: folder || "Notes", pinned: a.pinned === true }, c) as { created: { id: string } };
    const n = await noteById(tx, c, made.created.id, false);
    const checks = noteChecks("", content, today());
    return { created: await notePath(tx, c, n, await folders(tx, c.v)), id: n.id, ...(checks.length ? { checks } : {}) };
  },

  async edit(tx, a, c) {
    if (!Array.isArray(a.edits) || !a.edits.length) throw new ToolError("edits is a list of { old_text, new_text }.");
    const edits = a.edits as Edit[];
    const r = await resolve(tx, c, a.id);
    const apply = (text: string) => { try { return applyEdits(text, edits); } catch (e) { throw new ToolError((e as Error).message.replace("read_note", "fetch").replace("append_to_note", "edit")); } };
    if (r.kind === "note") {
      const before = await bodyOf(c.v, r.note);
      const body = apply(before);
      if (body === before) return { path: a.id, unchanged: true };
      const saved = await save(tx, c, r.note, before, body);
      const checks = noteChecks(before, body, today());
      return { edited: await notePath(tx, c, { ...r.note, title: saved.title }, await folders(tx, c.v)), version: saved.version, checks: checks.length ? checks : "ok" };
    }
    if (r.kind === "data") {
      const before = await pageDataOf(tx, c, r.note.id);
      return await saveData(tx, c, r.note, before, apply(dataText(before)));
    }
    if (r.kind === "appfile") {
      const p = await appProject(tx, c, r.note);
      const file = cleanPath(r.path);
      if (p.files[file] === undefined) throw new ToolError(`No ${file} in the app. To make a new file, use write.`);
      let text = p.files[file];
      for (const e of edits) { try { text = editText(text, e.old_text, e.new_text, e.replace_all === true).text; } catch (err) { throw new ToolError(`${file}: ${(err as Error).message}`); } }
      return await saveProject(tx, c, r.note, await withFile(p, file, text), `${file} (${edits.length} edit${edits.length > 1 ? "s" : ""})`, a);
    }
    throw new ToolError("edit changes a note, an app file or an app's data.json.");
  },

  async write(tx, a, c) {
    if (typeof a.content !== "string") throw new ToolError("content is the whole new text.");
    const content = a.content;
    const r = await resolve(tx, c, a.id);
    if (r.kind === "note") {
      if (!content.trim()) throw new ToolError("content is empty. To remove the note, use delete.");
      checkSize(content);
      const before = await bodyOf(c.v, r.note);
      const saved = await save(tx, c, r.note, before, content);
      const checks = noteChecks(before, content, today());
      return { written: await notePath(tx, c, { ...r.note, title: saved.title }, await folders(tx, c.v)), version: saved.version, checks: checks.length ? checks : "ok" };
    }
    if (r.kind === "data") return await saveData(tx, c, r.note, await pageDataOf(tx, c, r.note.id), content);
    if (r.kind === "appfile") {
      const p = await appProject(tx, c, r.note);
      const file = cleanPath(r.path);
      if (p.files[file] === content) return { path: a.id, unchanged: true };
      return await saveProject(tx, c, r.note, await withFile(p, file, content), `${file} (${p.files[file] === undefined ? "created" : "replaced"})`, a);
    }
    throw new ToolError("write replaces a note, an app file or an app's data.json.");
  },

  async move(tx, a, c) {
    const r = await resolve(tx, c, a.id);
    const to = String(a.to ?? "").trim().replace(/^\/+/, "");
    if (!to) throw new ToolError("to is where it goes.");
    const all = await folders(tx, c.v);
    if (r.kind === "note") {
      let n = r.note;
      const rename = /\.md$/i.test(to);
      const dir = rename ? to.split("/").slice(0, -1).join("/") : to.replace(/\/+$/, "");
      if (dir && dir.toLowerCase() !== pathOf(n.folder_id, all).toLowerCase()) await classic.move_note(tx, { id: n.id, folder: dir }, c);
      if (rename) {
        const title = to.split("/").pop()!.replace(/\.md$/i, "").trim();
        const before = await bodyOf(c.v, n);
        const lines = before.split("\n");
        const k = lines.findIndex((l) => l.trim());
        const m = (lines[k] ?? "").match(/^(\s*#{1,6}\s+)/);
        lines[k < 0 ? 0 : k] = `${m ? m[1] : ""}${title}`;
        n = await noteById(tx, c, n.id, false);
        await save(tx, c, n, before, lines.join("\n"));
      }
      n = await noteById(tx, c, n.id, false);
      return { moved: await notePath(tx, c, n, await folders(tx, c.v)) };
    }
    if (r.kind === "folder") {
      const parts = to.replace(/\/+$/, "").split("/").filter(Boolean);
      const name = parts.pop()!;
      const parent = parts.length ? await findFolder(tx, c.v, parts.join("/"), true) : null;
      if (parent && (parent.id === r.folder.id || pathOf(parent.id, all).startsWith(pathOf(r.folder.id, all) + "/"))) throw new ToolError("A folder can't move into itself.");
      await classic.rename_folder(tx, { folder: r.folder.id, new_name: name }, c);
      await tx`update public.folders set parent_id = ${parent?.id ?? null}, updated_at = now() where id = ${r.folder.id}`;
      return { moved: pathOf(r.folder.id, await folders(tx, c.v)) + "/" };
    }
    if (r.kind === "appfile") {
      const target = to.includes(".app/") ? to.slice(to.indexOf(".app/") + 4) : to;
      return await moveAppFile(tx, c, r.note, r.path, target, a);
    }
    throw new ToolError("move takes a note, a folder or an app file.");
  },

  async delete(tx, a, c) {
    const r = await resolve(tx, c, a.id);
    if (r.kind === "note") return { deleted: (await classic.delete_note(tx, { id: r.note.id }, c)), restore_with: "restore" };
    if (r.kind === "folder") return { deleted: await classic.delete_folder(tx, { folder: r.folder.id }, c), restore_with: "restore each note from Recently Deleted/" };
    if (r.kind === "appfile") {
      const p = await appProject(tx, c, r.note);
      const file = cleanPath(r.path);
      if (file === "/index.html") throw new ToolError("/index.html is the page the app opens; it can't be deleted.");
      if (p.files[file] === undefined) throw new ToolError(`No ${file} in the app.`);
      const files = { ...p.files }, compiled = { ...p.compiled };
      delete files[file]; delete compiled[file];
      return await saveProject(tx, c, r.note, { amberApp: 1, files, compiled }, `deleted ${file}`, a);
    }
    if (r.kind === "app") {
      await tx`update public.note_pages set page_ct = null where note_id = ${r.note.id} and page_ct is not null`;
      return { deleted: `the app of "${r.note.title}"`, kept: "The note stays; the app is in its history (restore with a version)." };
    }
    throw new ToolError("delete takes a note, a folder, an app file or an app.");
  },

  async history(tx, a, c) {
    const r = await resolve(tx, c, a.id, { trashed: true });
    const limit = clampInt(a.limit, 10, 50) || 10;
    if (r.kind === "note") {
      const h = await classic.note_history(tx, { id: r.note.id, limit }, c) as { revisions: Record<string, unknown>[] };
      return { ...h, revisions: h.revisions.map(({ revision_id, version: _n, ...rest }: Record<string, unknown>) => ({ ...rest, version: revision_id })) };
    }
    if (r.kind === "app" || r.kind === "appfile" || r.kind === "data") {
      const rows = await tx<{ id: string; client: string | null; made_at: Date; replaced_at: Date; reason: string }[]>`
        select id, client, made_at, replaced_at, reason from public.note_page_versions where note_id = ${r.note.id} order by id desc limit ${limit}`;
      return { app: r.note.title, versions: rows.map((v) => ({ version: Number(v.id), what: v.reason === "data" ? "data" : "code", made_by: v.client, made: iso(v.made_at), replaced: iso(v.replaced_at) })) };
    }
    throw new ToolError("history takes a note or an app.");
  },

  async restore(tx, a, c) {
    const r = await resolve(tx, c, a.id, { trashed: true });
    if (r.kind === "note") {
      if (a.version === undefined || a.version === null) return { restored: await classic.restore_note(tx, { id: r.note.id }, c) };
      if (r.note.trashed_at) throw new ToolError(`"${r.note.title}" is in Recently Deleted: restore it first (no version).`);
      const done = await classic.restore_revision(tx, { id: r.note.id, revision_id: a.version }, c) as Record<string, unknown>;
      return { ...done, note: "The text before this restore is kept in history too." };
    }
    if (r.kind === "app" || r.kind === "appfile" || r.kind === "data") {
      const want = wholeNumber(a.version, "version");
      const [v] = await tx<{ page_ct: string | null; data_ct: string | null }[]>`select page_ct, data_ct from public.note_page_versions where id = ${want} and note_id = ${r.note.id}`;
      if (!v) throw new ToolError("No such version of this app. Use history.");
      await tx`update public.note_pages set page_ct = coalesce(${v.page_ct}, page_ct), data_ct = coalesce(${v.data_ct}, data_ct) where note_id = ${r.note.id}`;
      return { restored: `the app of "${r.note.title}" as of version ${want}`, note: "What it replaced is kept in history." };
    }
    throw new ToolError("restore takes a note (deleted, or with a version) or an app with a version.");
  },

  async pin(tx, a, c) {
    const r = await resolve(tx, c, a.id);
    if (r.kind !== "note") throw new ToolError("pin takes a note.");
    await classic.pin_note(tx, { id: r.note.id, pinned: a.pinned === true }, c);
    return { path: await notePath(tx, c, r.note, await folders(tx, c.v)), pinned: a.pinned === true };
  },

  async see_app(tx, a, c) {
    const r = await resolve(tx, c, a.id);
    if (r.kind !== "note" && r.kind !== "app") throw new ToolError("see_app takes the app's note.");
    const failure = await loadFailure(tx, r.note.id);
    const seen = Array.isArray(a.steps) && a.steps.length && tryOn()
      ? await appHandlers.try_app(tx, { id: r.note.id, steps: a.steps, data: a.data, screenshots: "last" }, c)
      : await appHandlers.preview_app(tx, { id: r.note.id, widths: a.widths, themes: a.themes, data: a.data }, c);
    if (!Object.keys(failure).length) return seen;
    return seen instanceof Content ? new Content([{ type: "text", text: JSON.stringify(failure) }, ...seen.content], { ...seen.structured, ...failure }) : { ...(seen as object), ...failure };
  },
};

/** The newest time a device couldn't open the live app and went back to an earlier one. */
async function loadFailure(tx: Tx, id: string): Promise<Record<string, unknown>> {
  const [f] = await tx<{ message: string; device: string | null; at: Date }[]>`select message, device, at from public.app_load_failures where note_id = ${id} order by at desc limit 1`;
  return f ? { load_failure: { message: f.message, device: f.device, at: iso(f.at), what_happened: "A device couldn't open the live version and went back to an earlier one, with the current data. Fix the cause and save." } } : {};
}

async function moveAppFile(tx: Tx, c: Call, n: Note, from: string, to: string, a: Args) {
  const p = await appProject(tx, c, n);
  const src = cleanPath(from), dst = cleanPath(to);
  if (src === "/index.html") throw new ToolError("/index.html stays where it is: the app opens it.");
  if (p.files[src] === undefined) throw new ToolError(`No ${src} in the app.`);
  if (p.files[dst] !== undefined) throw new ToolError(`${dst} already exists.`);
  const files = { ...p.files }, compiled = { ...p.compiled };
  const content = files[src];
  delete files[src]; delete compiled[src];
  return await saveProject(tx, c, n, await withFile({ amberApp: 1, files, compiled }, dst, content), `${src} → ${dst}`, a);
}

