// The file-like tool set (prototype, chosen with AMBER_MCP_TOOLS=files): the account works like a
// folder of files, the way coding agents already work, and the AI sees paths only, never ids
// (paths.ts says how every note, sub-note, file and app gets one). Twelve tools: search, list,
// fetch, create, edit, write, move, delete, history, restore, pin, see_app. search, fetch, list and
// edit behave like a coding agent's Grep, Read, Glob and Edit; edit and write refuse to change what
// this session hasn't read, or what changed since (mcp_reads), and answer with checks: real
// breakage in a note (note_checks.ts), compile, render and test results in an app.

import { appendText, mimeOf, previewOf, searchFilter, searchInMemory, titleOf, wikiLinks } from "./notes.ts";
import { noteChecks } from "./note_checks.ts";
import { cleanPath, type Project } from "./app_project.ts";
import { scaffold } from "./app_scaffold.ts";
import { fileList, projectOf, saveProject, withFile, withFiles } from "./app_files.ts";
import { pageDataOf, storePageData } from "./data_tools.ts";
import { dataShape } from "./data_ops.ts";
import { appHandlers } from "./app_tools.ts";
import type { PageData } from "./page.ts";
import {
  bodyOf, Content, descendants, findFolder, handlers as classic, iso, LOCKED, MAX_READ_CHARS,
  type Note, type NoteRow, quote, refuseLocked, runIn, save, Scan, type Tool, type ToolContext, ToolError, type Tx, type Call, UUID,
  wholeNumber, withHead, checkSize, readCapped,
} from "./tools.ts";
import { DELETED, type Entry, Paths, safeName } from "./paths.ts";
import { toBase64, fromBase64 } from "../_shared/e2ee.ts";
import { AI_FILE_BYTES, extract, fileOut, type FolderFile, fileVersions, isTextFile, moveFile, readFile, restoreFile, restoreFileVersion, trashFile, utiOf, writeFile } from "./folder_files.ts";

type Args = Record<string, unknown>;
const str = (d: string) => ({ type: "string", description: d });
const int = (d: string) => ({ type: "integer", description: d });
const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const change = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;
const add = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const PATH = "A path, as list and search show them: \"Work/Acme.md\", a folder \"Work/\", a sub-note \"Work/Acme/Agenda.md\", a note's file \"Work/Acme/contract.pdf\", a file in a folder \"To read/Paper.pdf\", an app's file \"Work/Habits.app/src/App.tsx\" or its data \"Work/Habits.app/data.json\".";

/** Trying an app (see_app steps) and its tests on save; off only in the experiment's control arm. */
export const tryOn = () => Deno.env.get("AMBER_NO_TRY") !== "1";

export const FILE_TOOLS: Tool[] = ([
  {
    name: "search", title: "Search",
    description: "Finds notes. With query: ranked full-text search (words, \"quoted phrases\", OR, -word), best first, with a snippet. With pattern: like grep, a regular expression (or plain text) matched line by line; output \"files\" (the matching paths), \"content\" (matching lines as path:line: text, with context lines) or \"count\". Names and paths match too. Narrow with path (a folder \"Work/\", a glob \"Work/**/2026*\", a note and its sub-notes, an app \"Work/Habits.app\" to search its code), type, pinned, modified_after/before (YYYY-MM-DD), title_only, sub_notes: false, deleted: true. Pages with limit and offset.",
    inputSchema: {
      type: "object",
      properties: {
        query: str("Words to find, ranked."),
        pattern: str("A regular expression (or plain text) to match line by line, like grep."),
        path: str("Where to look: a folder, a glob, a note, or an app. Default: everywhere."),
        output: { type: "string", enum: ["files", "content", "count"], description: "With pattern. Default files." },
        context: int("With output content: lines shown before and after each match (0-10)."),
        case_sensitive: { type: "boolean", description: "Default false." },
        type: { type: "string", enum: ["note", "app", "file"], description: "Only notes, only app code, or only files (by name)." },
        title_only: { type: "boolean", description: "Match names, not text." },
        pinned: { type: "boolean" },
        modified_after: str("YYYY-MM-DD."),
        modified_before: str("YYYY-MM-DD."),
        sub_notes: { type: "boolean", description: "Include sub-notes. Default true." },
        deleted: { type: "boolean", description: "Include Recently Deleted. Default false." },
        limit: int("Results per page (default 20; lines with output content: 100)."),
        offset: int("Skip this many results (the next page)."),
      },
    },
    annotations: read,
  },
  {
    name: "list", title: "List",
    description: "Lists like a file browser, newest first. No path: the top level. A folder (\"Work/\"), a note's folder (\"Work/Acme/\": its sub-notes and files), an app (\"Work/Habits.app\"), or \"Recently Deleted/\". pattern is a glob over every path below it (\"**/*.md\", \"Work/**\", \"**/*.app\", \"**/*invoice*\"). Pages with limit and offset.",
    inputSchema: { type: "object", properties: { path: str("A folder, a note's folder, an app, or \"Recently Deleted/\"."), pattern: str("A glob, like \"**/*.md\"."), limit: int("Default 100."), offset: int("Skip this many.") } },
    annotations: read,
  },
  {
    name: "fetch", title: "Read",
    description: "Reads a note, an app file, an app's data.json or a file, with line numbers (cat -n). Long text is read in parts: offset is the first line, limit how many (default 2000). A folder reads as its listing. Files: text files (TXT, CSV, JSON, code) as text you can edit; PDFs, Word, Excel and PowerPoint as their text; pictures as images. raw: true returns the file itself (base64, up to 10 MB) to change with your own tools and write back. Read something before you edit or write it.",
    inputSchema: { type: "object", properties: { id: str(PATH), offset: int("First line (1-based)."), limit: int("How many lines."), raw: { type: "boolean", description: "A file's own bytes, as a resource (base64). Up to 10 MB." } }, required: ["id"] },
    annotations: read,
  },
  {
    name: "create", title: "Create",
    description: "Creates a note, a folder or an app. A note: path \"Work/Acme.md\" (its name is its title; folders are made as needed) and content, its markdown. In a note's folder (\"Work/Acme/Agenda.md\") it becomes that note's sub-note. A folder: path \"Work/Clients/\". An app: path is the note that becomes the app (existing, or new like \"Work/Habits.md\"); it starts as a React + TypeScript + Tailwind + shadcn/ui project whose README.md says how apps run here. Notes are markdown: checklists \"- [ ] item\", links to notes [[Title]], and a tracker is a table with a line like <!-- pane-table: Date=date; Mood=scale 1-5; Walk=choice Yes|No --> above it (keep values in range).",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["note", "folder", "app"], description: "Default note." },
        path: str("Where: \"Work/Acme.md\", \"Work/Clients/\", or the app's note."),
        content: str("A note's markdown."),
        pinned: { type: "boolean" },
      },
      required: ["path"],
    },
    annotations: add,
  },
  {
    name: "edit", title: "Edit",
    description: "Replaces old_string with new_string in a note, an app file, an app's data.json or a text file (TXT, CSV, JSON, code), like a coding agent's Edit. Read it first with fetch; copy old_string exactly, without the line numbers. It must match once unless replace_all; an empty new_string deletes it. Answers with checks: what the change broke in a note (a table, a checklist line, a tracker value), or the app's compile, render and test results. Each edit is one change the person can undo.",
    inputSchema: {
      type: "object",
      properties: {
        path: str(PATH),
        old_string: str("The exact text to replace."),
        new_string: str("The text to put there."),
        replace_all: { type: "boolean", description: "Replace every occurrence. Default false." },
      },
      required: ["path", "old_string", "new_string"],
    },
    annotations: change,
  },
  {
    name: "write", title: "Write",
    description: "Writes a whole note, app file, data.json or file: creates it, or replaces it (read it first). Prefer edit for changes; the old version stays in history. A file (\"To read/Summary.txt\", \"To read/Paper.pdf\") takes content for text, or content_base64 with mime_type for anything else (a PDF, a picture, a spreadsheet), up to 10 MB. Answers with the same checks as edit. Notes are markdown: checklists \"- [ ] item\", links to notes [[Title]], and a tracker is a table with a line like <!-- pane-table: Date=date; Mood=scale 1-5; Walk=choice Yes|No --> above it (keep values in range).",
    inputSchema: {
      type: "object",
      properties: {
        path: str(PATH), content: str("The whole text (data.json: JSON)."), content_base64: str("A file's bytes, base64 (up to 10 MB)."), mime_type: str("With content_base64, like \"application/pdf\"."),
        file: { type: "object", description: "A file from the chat (ChatGPT hands these over), instead of content_base64.", properties: { download_url: { type: "string" }, file_id: { type: "string" }, mime_type: { type: "string" }, file_name: { type: "string" } } },
      },
      required: ["path"],
    },
    // ChatGPT passes a file from the chat (one the person attached, or one it made) as a download link.
    _meta: { "openai/fileParams": ["file"] },
    annotations: change,
  },
  {
    name: "move", title: "Move or rename",
    description: "Moves or renames a note, a folder or an app file: a note to a folder (\"Clients/\", made if needed), into a note's folder (\"Work/Acme/\": it becomes a sub-note), or to a new name (\"Work/New title.md\"); a folder to a new path (\"Archive/2025/\"); an app file within its app; a file in a folder to another folder (\"Archive/\") or a new name (\"To read/Old paper.pdf\", same ending).",
    inputSchema: { type: "object", properties: { path: str(PATH), to: str("Where it goes.") }, required: ["path", "to"] },
    annotations: change,
  },
  {
    name: "delete", title: "Delete",
    description: "Deletes a note (to Recently Deleted with its sub-notes, for 30 days), a folder (its notes and files go to Recently Deleted), a file in a folder (to Recently Deleted for 30 days), an app file, or an app (\"Work/Habits.app\": the note stays; the app is kept in history).",
    inputSchema: { type: "object", properties: { path: str(PATH) }, required: ["path"] },
    annotations: change,
  },
  {
    name: "history", title: "History",
    description: "Earlier versions, newest first, with who made each (a device or an AI): of a note's text, an app (code and data), or a file.",
    inputSchema: { type: "object", properties: { path: str(PATH), limit: int("Default 10.") }, required: ["path"] },
    annotations: read,
  },
  {
    name: "restore", title: "Restore",
    description: "Brings back a note or file from Recently Deleted (no version), or an earlier version from history: of a note's text, an app (code and data as they were), or a file.",
    inputSchema: { type: "object", properties: { path: str(PATH), version: int("A version from history.") }, required: ["path"] },
    annotations: change,
  },
  {
    name: "pin", title: "Pin",
    description: "Pins a note to the top of the list, or unpins it.",
    inputSchema: { type: "object", properties: { path: str(PATH), pinned: { type: "boolean" } }, required: ["path", "pinned"] },
    annotations: { ...change, idempotentHint: true },
  },
  {
    name: "see_app", title: "See an app",
    description: "Screenshots of a note's app at iPhone and Mac sizes, light and dark, over a sample with the shape of its data (data: \"real\" only if the person allowed it in Amber Notes), with what each view shows and anything broken." +
      (tryOn() ? " With steps, uses the app like a person instead and answers after each step with what's on screen, console errors, what changed in its data, and screenshots: { tap: \"Add\" } (text, label or CSS selector), { type: \"85\", into: \"Weight\" }, { scroll: \"down\" }, { wait: 500 | \"Saved\" }, { press: \"Enter\" }, { resize: \"phone\" | \"desktop\" }, { dark: true }. Nothing is written back." : ""),
    inputSchema: {
      type: "object",
      properties: {
        path: str("The app (\"Work/Habits.app\") or its note."),
        widths: { type: "array", items: { type: "integer" }, description: "Default [390, 1280]." },
        themes: { type: "array", items: { type: "string", enum: ["light", "dark"] } },
        data: { type: "string", enum: ["sample", "real"] },
        ...(tryOn() ? { steps: { type: "array", items: { type: "object" }, description: "Up to 30 steps, done in order on a throwaway copy." } } : {}),
      },
      required: ["path"],
    },
    annotations: read,
  },
] satisfies Tool[]).map((t) => ({ ...t, annotations: { title: t.title, ...t.annotations }, securitySchemes: [{ type: "oauth2" as const, scopes: [t.annotations.readOnlyHint ? "notes:read" : "notes:write"] }] }));

/** What the server tells every client when this tool set is on: how the files are laid out. The
 *  format rules live where they're needed (the tools' checks and descriptions, an app's README). */
export const FILE_INSTRUCTIONS = `Amber Notes is the person's notes, as files: each note is a markdown file in folders ("Work/Acme.md"; its first line is its title). A note's sub-notes and files are in the folder with its name ("Work/Acme/Agenda.md", "Work/Acme/contract.pdf"); folders also hold files of their own ("To read/Paper.pdf"). A folder ending in .app is the note's app, a small React project with its data in data.json; read its README.md first. Deleted notes are in "Recently Deleted/". Read before you edit; edit and write answer with checks: fix what they report.`;

const SWITCHES = new Set(["title_only", "case_sensitive", "pinned", "sub_notes", "deleted", "replace_all", "raw"]);
export async function runFileTool(name: string, args: Args, ctx: ToolContext): Promise<unknown> {
  // Paths, not ids: "path" is the argument everywhere ("id" from older clients still works).
  // Switches sent as text ("true") count as what they say.
  const a = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, SWITCHES.has(k) && v === "true" ? true : SWITCHES.has(k) && v === "false" ? false : v]));
  if (a.path === undefined && a.id !== undefined && name !== "fetch") a.path = a.id;
  if (name === "fetch" && a.id === undefined && a.path !== undefined) a.id = a.path;
  return await runIn(FILE_TOOLS, fileHandlers, name, a, ctx);
}

// MARK: What this session has read

/** What's stored for an item: a note's or app's id stays (ids aren't the person's words); an app
 *  file's path is tagged. */
const itemKey = async (c: Call, raw: string) => raw.startsWith("file:") ? `file:${raw.slice(5, 41)}:${await c.v.tag(raw)}` : raw;

/** The read-before-edit rule's record, per session (mcp_reads): what was read, at which version. */
const sessionOf = (c: Call) => c.ctx.session ?? "unknown";
async function markRead(tx: Tx, c: Call, raw: string, stamp: string) {
  const item = await itemKey(c, raw);
  await tx`insert into public.mcp_reads (session, item, stamp) values (${sessionOf(c)}, ${item}, ${stamp})
    on conflict (user_id, session, item) do update set stamp = excluded.stamp, read_at = now()`;
  // Old rows go as new ones come in (a day is longer than any session works on one thing).
  if (Math.random() < 0.05) await tx`delete from public.mcp_reads where read_at < now() - interval '1 day'`;
}
async function mustHaveRead(tx: Tx, c: Call, raw: string, stamp: string, path: string) {
  const item = await itemKey(c, raw);
  const [r] = await tx<{ stamp: string }[]>`select stamp from public.mcp_reads where session = ${sessionOf(c)} and item = ${item} and read_at > now() - interval '1 day'`;
  if (!r) throw new ToolError(`Read ${path} with fetch before changing it.`);
  if (r.stamp !== stamp) throw new ToolError(`${path} changed since you read it. Fetch it again, then make the change.`);
}
// A file's name and text are the person's: what's stored is a keyed tag of them (Vault.tag), never them.
const hash = (c: Call, s: string) => c.v.tag(s);
const noteItem = (id: string) => `note:${id}`;
const fileItem = (id: string, path: string) => `file:${id}:${path}`;
const dataItem = (id: string) => `data:${id}`;
/** A file's bytes, read at a content version. */
const blobItem = (id: string) => `blob:${id}`;

// MARK: Paths

type Ref =
  | { kind: "dir"; dir: string }
  | { kind: "note"; note: Note; path: string }
  | { kind: "app"; note: Note; base: string }
  | { kind: "appfile"; note: Note; base: string; file: string }
  | { kind: "data"; note: Note; base: string }
  /** A file a note embeds (note), or one kept in a folder (folder). */
  | { kind: "file"; id: string; path: string; note?: Note; folder?: FolderFile };

const callPaths = new WeakMap<Call, Paths>();
/** The account's paths for this call (built once, then kept until something moves). */
async function pathsOf(tx: Tx, c: Call, fresh = false): Promise<Paths> {
  let p = callPaths.get(c);
  if (!p || fresh) {
    p = await Paths.load(tx, c);
    callPaths.set(c, p);
    if (c.ctx.timing) {
      c.ctx.timing.paths_db = (c.ctx.timing.paths_db ?? 0) + p.timing.dbMs;
      c.ctx.timing.paths_open = (c.ctx.timing.paths_open ?? 0) + p.timing.openMs;
      c.ctx.timing.paths_build = (c.ctx.timing.paths_build ?? 0) + p.timing.buildMs;
      c.ctx.timing.paths_opened = (c.ctx.timing.paths_opened ?? 0) + p.timing.opened;
      c.ctx.timing.notes = p.timing.rows;
    }
  }
  return p;
}

/** A note, whole and locked for this call (the paths only carry titles). */
async function full(tx: Tx, c: Call, id: string, trashed = false): Promise<Note> {
  const rows = await tx<NoteRow[]>`select * from public.notes where id = ${id}::uuid and deleted_at is null for update`;
  if (!rows.length) throw new ToolError("That note was just deleted.");
  const n = await withHead(c.v, rows[0]);
  if (n.trashed_at && !trashed) throw new ToolError(`"${n.title}" is in Recently Deleted. Bring it back with restore first.`);
  return n;
}

const clean = (raw: unknown) => String(raw ?? "").trim().replace(/^\/+/, "").replace(/^\.\//, "");

async function resolve(tx: Tx, c: Call, raw: unknown, opts: { trashed?: boolean } = {}): Promise<Ref> {
  const ref = clean(raw);
  const P = await pathsOf(tx, c);
  if (!ref) return { kind: "dir", dir: "" };
  // Older clients' handles: an id, "<id>.app/…", "pane-file:<id>".
  if (/^pane-file:/i.test(ref)) {
    const id = ref.slice(10).toLowerCase();
    const path = P.filePathOf(id);
    return { kind: "file", id, path: path ?? ref, ...(path ? { folder: P.fileAt(path) } : {}) };
  }
  if (UUID.test(ref.slice(0, 36))) {
    const path = P.pathOf(ref.slice(0, 36));
    if (!path) throw new ToolError("No such note.");
    return await resolve(tx, c, path.replace(/\.md$/, "") + (ref.slice(36) || ".md"), opts);
  }
  const at = ref.search(/\.app(\/|$)/i);
  if (at >= 0) {
    const base = ref.slice(0, at);
    const e = P.at(base + ".md");
    if (e?.kind !== "note") throw new ToolError(`No app at "${base}.app".${P.similar(base + ".md").length ? ` Notes with that name: ${P.similar(base + ".md").join(", ")}.` : ""}`);
    if (!e.app) throw new ToolError(`"${e.path}" has no app. Make one with create { type: "app", path: "${e.path}" }.`);
    const n = e.note;
    const sub = ref.slice(at + 4).replace(/^\/+/, "");
    const app = e.path.replace(/\.md$/, ".app");
    if (!sub) return { kind: "app", note: n, base: app };
    if (sub === "data.json") return { kind: "data", note: n, base: app };
    return { kind: "appfile", note: n, base: app, file: sub };
  }
  if (ref.endsWith("/") || ref.toLowerCase() === "recently deleted") {
    const dir = ref.endsWith("/") ? ref : ref + "/";
    if (P.isDir(dir) || P.noteOfDir(dir)) return { kind: "dir", dir: canonicalDir(P, dir) };
    throw new ToolError(`No folder "${dir}". Use list to see what's there.`);
  }
  const e = P.at(ref) ?? P.at(ref + ".md");
  if (e?.kind === "note") {
    if (e.note.trashed_at && !opts.trashed) throw new ToolError(`"${e.path}" is in Recently Deleted. Bring it back with restore first.`);
    return { kind: "note", note: e.note, path: e.path };
  }
  if (e?.kind === "folder") return { kind: "dir", dir: e.path };
  if (e?.kind === "file") {
    if (e.file.trashed_at && !opts.trashed) throw new ToolError(`"${e.path}" is in Recently Deleted. Bring it back with restore first.`);
    return { kind: "file", id: e.file.id, path: e.path, folder: e.file };
  }
  // A file a note embeds: "Work/Acme/contract.pdf".
  const slash = ref.lastIndexOf("/");
  if (slash > 0 && !/\.md$/i.test(ref)) {
    const owner = P.noteOfDir(ref.slice(0, slash + 1));
    if (owner) {
      const files = await noteFiles(tx, c, P, owner);
      const f = files.find((x) => x.path.toLowerCase() === ref.toLowerCase());
      if (f) return { kind: "file", id: f.id, path: f.path, note: owner };
    }
  }
  // A unique title anywhere ("Groceries", or a stale folder): the note it names.
  const like = P.similar(ref);
  if (like.length === 1) return await resolve(tx, c, like[0], opts);
  if (like.length > 1) throw new ToolError(`Nothing at "${ref}". Notes with that name: ${like.map((p) => `"${p}"`).join(", ")}.`);
  throw new ToolError(`Nothing at "${ref}". Use list or search to find it.`);
}

/** A directory as the paths spell it ("work/" → "Work/"). */
function canonicalDir(P: Paths, dir: string): string {
  if (!dir || dir.toLowerCase() === DELETED.toLowerCase()) return dir ? DELETED : "";
  const e = P.at(dir);
  if (e?.kind === "folder") return e.path;
  const n = P.note(P.noteOfDir(dir)?.id ?? "");
  return n ? n.path.replace(/\.md$/, "/") : dir;
}

// MARK: A note's files and links

type NoteFile = { path: string; id: string; name: string; type: string; bytes: number; added: string | null };

/** The files a note embeds (![name](pane-file:<id>)), named in its folder. */
async function noteFiles(tx: Tx, c: Call, P: Paths, n: Note, body?: string): Promise<NoteFile[]> {
  if (n.locked_body) return [];
  const text = body ?? await bodyOf(c.v, await full(tx, c, n.id, true));
  const ids = [...new Set([...text.matchAll(/pane-file:([0-9a-f-]{36})/gi)].map((m) => m[1].toLowerCase()))];
  if (!ids.length) return [];
  const rows = await tx<{ id: string; meta_ct: string; size: string; created_at: Date }[]>`
    select id, meta_ct, size, created_at from public.attachments where id = any(${ids}::uuid[]) and deleted_at is null`;
  const dir = P.pathOf(n.id)!.replace(/\.md$/, "/");
  const taken = new Set(P.children(dir).map((e) => e.path.slice(dir.length).replace(/\/$/, "").toLowerCase()));
  const out: NoteFile[] = [];
  for (const id of ids) {
    const r = rows.find((x) => x.id === id);
    if (!r) continue;
    const meta = await c.v.openFileMeta(r.id, r.meta_ct).catch(() => null);
    if (!meta) continue;
    const name = safeName(meta.name);
    const dot = name.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    let k = 1, nm = name;
    while (taken.has(nm.toLowerCase())) nm = `${stem} (${++k})${ext}`;
    taken.add(nm.toLowerCase());
    out.push({ path: dir + nm, id: r.id, name: nm, type: mimeOf(meta.type, meta.name), bytes: Number(r.size), added: iso(r.created_at) });
  }
  return out;
}

/** A note's text as the AI sees it: links to sub-notes, notes and files as paths, not ids. */
function present(body: string, P: Paths, files: NoteFile[]): string {
  return body
    .replace(/\]\(pane-note:([0-9a-f-]{36})\)/gi, (m, id) => { const p = P.pathOf(id.toLowerCase()); return p ? `](<${p}>)` : m; })
    .replace(/\]\(pane-file:([0-9a-f-]{36})\)/gi, (m, id) => { const f = files.find((x) => x.id === id.toLowerCase()); return f ? `](<${f.path}>)` : m; });
}
/** The text back as stored: a link to a note's or file's path becomes its id again. */
function unpresent(text: string, P: Paths, files: NoteFile[]): string {
  return text.replace(/\]\(<([^<>\n]+)>\)|\]\(([^()\s<>]+\.[A-Za-z0-9]{1,8})\)/g, (m, a, b) => {
    const target = (a ?? b) as string;
    const f = files.find((x) => x.path.toLowerCase() === target.toLowerCase());
    if (f) return `](pane-file:${f.id})`;
    const e = P.at(target);
    return e?.kind === "note" ? `](pane-note:${e.note.id})` : m;
  });
}

// MARK: Lines

const MAX_LINES = 2000;
/** Lines from offset (1-based), at most limit, cat -n style, within the size one result can carry. */
function numberedLines(text: string, offsetArg: unknown, limitArg: unknown) {
  const lines = text.split("\n");
  const offset = Math.max(1, Number.isFinite(Number(offsetArg)) && offsetArg !== undefined ? Math.floor(Number(offsetArg)) : 1);
  const limit = Math.max(1, Number.isFinite(Number(limitArg)) && limitArg !== undefined ? Math.floor(Number(limitArg)) : MAX_LINES);
  if (offset > lines.length && lines.length) throw new ToolError(`offset ${offset} is past the end: it has ${lines.length} lines.`);
  const out: string[] = [];
  let size = 0, last = offset - 1;
  for (let i = offset - 1; i < Math.min(lines.length, offset - 1 + limit); i++) {
    const row = `${String(i + 1).padStart(6)}\t${lines[i].length > 4000 ? lines[i].slice(0, 4000) + "… (line cut)" : lines[i]}`;
    if (size + row.length > MAX_READ_CHARS && out.length) break;
    out.push(row);
    size += row.length + 1;
    last = i + 1;
  }
  const more = last < lines.length;
  return { text: out.join("\n"), lines: lines.length, ...(more ? { truncated: `Showing lines ${offset}-${last} of ${lines.length}. Continue with offset ${last + 1}.` } : {}) };
}

/** Claude Code's Edit rules, with errors that say what to do. */
function replaceIn(text: string, oldStr: string, newStr: string, all: boolean, path: string): string {
  if (oldStr === "") throw new ToolError("old_string is empty. To write the whole text, use write.");
  if (oldStr === newStr) throw new ToolError("old_string and new_string are the same: nothing to change.");
  const count = text.split(oldStr).length - 1;
  if (count === 0) {
    const hint = /^\s*\d+\t/m.test(oldStr) ? " It starts with a line number: copy the text after the tab, without the number."
      : text.toLowerCase().includes(oldStr.toLowerCase()) ? " The text is there with different capitals."
      : text.replace(/\s+/g, " ").includes(oldStr.replace(/\s+/g, " ")) ? " The text is there with different spaces or line breaks; copy it exactly."
      : "";
    throw new ToolError(`old_string isn't in ${path}.${hint} Fetch it again and copy the exact text.`);
  }
  if (count > 1 && !all) throw new ToolError(`old_string is in ${path} ${count} times. Add more of the surrounding text so it matches once, or pass replace_all: true to change all ${count}.`);
  return all ? text.split(oldStr).join(newStr) : text.replace(oldStr, () => newStr);
}

const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: Deno.env.get("PANE_TIMEZONE") ?? "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** An app's project; refuses a note without one. */
async function appProject(tx: Tx, c: Call, n: Note): Promise<Project> {
  const { project, exists } = await projectOf(tx, c, n.id);
  if (!exists) throw new ToolError(`"${n.title}" has no app. Make one with create { type: "app" }.`);
  return project;
}

/** data.json as the AI sees it: the app's JSON, localStorage parsed. */
const dataText = (d: PageData) => JSON.stringify(d, null, 2);
async function saveData(tx: Tx, c: Call, n: Note, base: string, before: PageData, text: string) {
  let next: PageData;
  try { next = JSON.parse(text); } catch (e) { throw new ToolError(`data.json isn't valid JSON after the change: ${(e as Error).message}. Nothing was saved.`); }
  if (!next || typeof next !== "object" || Array.isArray(next)) throw new ToolError("data.json must be an object: { \"values\": { … }, \"collections\": { … } }.");
  next = { ...next, values: next.values ?? {}, collections: next.collections ?? {} };
  if (JSON.stringify(next) === JSON.stringify(before)) return { path: `${base}/data.json`, unchanged: true };
  await storePageData(tx, c, n.id, next);
  await markRead(tx, c, dataItem(n.id), await hash(c, dataText(await pageDataOf(tx, c, n.id))));
  return { saved: `${base}/data.json`, note: "One change: the open app shows it at once, and the person can undo it." };
}

/** Where a new note goes: a folder (made if needed), or under a note when the place is that note's folder. */
async function placeFor(tx: Tx, c: Call, P: Paths, dir: string): Promise<{ folder: string | null; parent?: Note }> {
  if (!dir) return { folder: null };
  const real = P.at(dir + "/");
  if (real?.kind === "folder") return { folder: real.folder.id };
  const owner = P.noteOfDir(dir + "/");
  if (owner) return { folder: owner.folder_id, parent: owner };
  if (dir.toLowerCase().startsWith(DELETED.toLowerCase().slice(0, -1))) throw new ToolError("Nothing can be made in Recently Deleted.");
  return { folder: (await findFolder(tx, c.v, dir, true)).id };
}

/** Makes a note at a path; its first line is its name. */
async function newNote(tx: Tx, c: Call, path: string, content: string, pinned = false): Promise<{ path: string; id: string; checks: string[] }> {
  const P = await pathsOf(tx, c);
  const parts = path.replace(/\.md$/i, "").split("/").map((s) => s.trim()).filter(Boolean);
  const name = parts.pop();
  if (!name) throw new ToolError("path is where the note goes, like \"Work/Acme.md\".");
  if (P.at(parts.concat(name).join("/") + ".md")) throw new ToolError(`"${parts.concat(name).join("/")}.md" already exists. Read it, then change it with edit or write.`);
  let body = content.replace(/^\s*\n/, "");
  if (!body.trim()) body = `${name}\n`;
  else if (titleOf(body) !== name) body = `${name}\n\n${body}`;
  checkSize(body);
  const where = await placeFor(tx, c, P, parts.join("/"));
  const id = crypto.randomUUID();
  const head = { title: titleOf(body), preview: previewOf(body) };
  await tx`insert into public.notes (id, body_ct, head_ct, folder_id, parent_id, is_pinned)
    values (${id}, ${await c.v.sealBody(id, body)}, ${await c.v.sealHead(id, head)}, ${where.folder}, ${where.parent?.id ?? null}, ${pinned})`;
  if (where.parent) {
    // A sub-note is linked from its parent, as the app makes them.
    const parent = await full(tx, c, where.parent.id);
    refuseLocked(parent);
    const before = await bodyOf(c.v, parent);
    await save(tx, c, parent, before, appendText(before, `[${head.title.replace(/[\[\]]/g, "")}](pane-note:${id})`));
  }
  const fresh = await pathsOf(tx, c, true);
  const [row] = await tx<{ version: string }[]>`select version from public.notes where id = ${id}`;
  await markRead(tx, c, noteItem(id), String(row.version));
  return { path: fresh.pathOf(id)!, id, checks: noteChecks("", body, today()) };
}

const entryOut = (e: Entry, extra: Record<string, unknown> = {}) => e.kind === "folder"
  ? { path: e.path, type: "folder", ...extra }
  : e.kind === "file" ? fileOut(e.path, e.file)
  : { path: e.path, type: e.app ? "note+app" : "note", updated: iso(e.note.updated_at), ...(e.note.is_pinned ? { pinned: true } : {}), ...(e.note.locked_body ? { locked: true } : {}), ...(e.note.trashed_at ? { deleted: iso(e.note.trashed_at) } : {}), ...extra };
const updatedOf = (e: Entry) => e.kind === "note" ? +new Date(e.note.updated_at) : e.kind === "file" ? +new Date(e.file.updated_at) : 0;
const newest = (a: Entry, b: Entry) => (a.kind === "folder" ? 0 : 1) - (b.kind === "folder" ? 0 : 1) || updatedOf(b) - updatedOf(a) || a.path.localeCompare(b.path);

/** A glob ("**\/*.md", "Work/**", "*invoice*") as a regular expression over whole paths. */
export function globRe(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") { re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*"; i += glob[i + 2] === "/" ? 2 : 1; }
    else if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}/?$`, "i");
}

const page = (a: Args, def: number, max: number) => ({ limit: Math.max(1, Math.min(max, Number(a.limit) || def)), offset: Math.max(0, Math.floor(Number(a.offset) || 0)) });
const more = (total: number, offset: number, shown: number) => total > offset + shown ? { more: `${total - offset - shown} more: offset ${offset + shown}.` } : {};

// MARK: Handlers

export const fileHandlers: Record<string, (tx: Tx, a: Args, c: Call) => Promise<unknown>> = {
  async search(tx, a, c) {
    const P = await pathsOf(tx, c);
    const query = typeof a.query === "string" ? a.query.trim() : "";
    const pattern = typeof a.pattern === "string" ? a.pattern : "";
    if (!query && !pattern) throw new ToolError("Give query (words, ranked) or pattern (a regular expression, line by line).");
    const output = pattern ? (a.output === "content" || a.output === "count" ? a.output : "files") : "ranked";
    const pg = page(a, output === "content" ? 100 : 20, output === "content" ? 500 : 200);
    const scope = clean(a.path);
    const inScope = await scopeTest(tx, c, P, scope);
    const after = dateArg(a.modified_after, "modified_after"), before = dateArg(a.modified_before, "modified_before");
    const notes = P.all().filter((e): e is Extract<Entry, { kind: "note" }> => e.kind === "note")
      .filter((e) => (a.deleted === true ? true : !e.note.trashed_at) && inScope(e.path))
      .filter((e) => a.pinned === undefined || !!e.note.is_pinned === (a.pinned === true))
      .filter((e) => !after || +new Date(e.note.updated_at) >= after)
      .filter((e) => !before || +new Date(e.note.updated_at) < before + 86_400_000)
      .filter((e) => a.sub_notes !== false || !e.note.parent_id || !P.pathOf(e.note.parent_id))
      .sort((x, y) => +new Date(y.note.updated_at) - +new Date(x.note.updated_at));
    // Leading inline flags as grep and ripgrep take them ("(?i)deposit"); JavaScript has none.
    const inline = pattern.match(/^\(\?([imsx]+)\)/);
    const source = inline ? pattern.slice(inline[0].length) : pattern;
    const flags = [...new Set(((a.case_sensitive === true ? "" : "i") + (inline?.[1] ?? "").replace("x", "")).split(""))].join("");
    let re: RegExp | null = null;
    if (pattern) { try { re = new RegExp(source, flags); } catch { re = new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags); } }
    const nameHit = (path: string) => re ? re.test(path) : searchFilter(query)({ title: path, body: "", updated_at: new Date() });
    const t0 = performance.now();

    // Files by name, and app code: what type asks for.
    if (a.type === "file") {
      const hits: string[] = [];
      for (const e of notes) for (const f of await noteFiles(tx, c, P, e.note).catch(() => [])) if (nameHit(f.name)) hits.push(f.path);
      // And files kept in folders.
      for (const e of P.all()) if (e.kind === "file" && (a.deleted === true || !e.file.trashed_at) && inScope(e.path) && nameHit(e.path.split("/").pop()!)) hits.push(e.path);
      return { files: hits.slice(pg.offset, pg.offset + pg.limit), ...more(hits.length, pg.offset, Math.min(pg.limit, hits.length - pg.offset)) };
    }
    if (a.type === "app" || /\.app(\/|$)/i.test(scope)) {
      const apps = notes.filter((e) => e.app);
      const lines: string[] = [], files: string[] = [];
      for (const e of apps) {
        const { project, exists } = await projectOf(tx, c, e.note.id);
        if (!exists) continue;
        const base = e.path.replace(/\.md$/, ".app");
        for (const [f, text] of Object.entries(project.files)) {
          const path = base + f;
          if (!inScope(path) && !inScope(e.path)) continue;
          const matched = text.split("\n").flatMap((l, i) => (re ? re.test(l) : l.toLowerCase().includes(query.toLowerCase())) ? [`${path}:${i + 1}: ${l.trim().slice(0, 300)}`] : []);
          if (matched.length || nameHit(path)) { files.push(path); lines.push(...matched); }
        }
      }
      if (output === "content") return { lines: lines.slice(pg.offset, pg.offset + pg.limit), ...more(lines.length, pg.offset, Math.min(pg.limit, lines.length)) };
      if (output === "count") return { matches: lines.length, files: files.length };
      return { files: files.slice(pg.offset, pg.offset + pg.limit), ...more(files.length, pg.offset, Math.min(pg.limit, files.length)) };
    }

    // Notes: open each text (sealed) newest first, within the scan's time.
    const scan = await Scan.start(tx, c);
    const ids = notes.filter((e) => !e.note.locked_body && a.title_only !== true).map((e) => e.note.id);
    const bodies = new Map<string, string>();
    for (let i = 0; i < ids.length && !scan.over; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const rows = await tx<{ id: string; body_ct: string | null }[]>`select id, body_ct from public.notes where id = any(${chunk}::uuid[])`;
      await scan.timed(async () => {
        await Promise.all(rows.map(async (r) => { if (r.body_ct) bodies.set(r.id, await c.v.openBody(r.id, r.body_ct).catch(() => "")); }));
      });
      scan.seen += rows.length;
    }
    const looked = bodies.size;
    const skipped = ids.length - looked;
    const searched = skipped > 0 ? { searched: `the ${looked.toLocaleString("en-US")} most recently edited notes of ${ids.length.toLocaleString("en-US")} (time ran out; narrow with path, type or modified_after)` } : {};
    if (c.ctx.timing) { c.ctx.timing.search_open = performance.now() - t0; c.ctx.timing.search_notes = looked; }

    if (output === "ranked") {
      const docs = notes.map((e) => ({ e, title: e.path.replace(/\.md$/, ""), body: a.title_only === true ? "" : present(bodies.get(e.note.id) ?? "", P, []), updated_at: e.note.updated_at }));
      const { results, broad } = searchInMemory(query, docs, pg.offset + pg.limit + 1);
      const shown = results.slice(pg.offset, pg.offset + pg.limit);
      return {
        results: shown.map((r) => ({ id: r.doc.e.path, title: r.doc.e.note.title, url: `ambernotes://note/${r.doc.e.note.id}`, ...(r.doc.e.app ? { app: r.doc.e.path.replace(/\.md$/, ".app/") } : {}), snippet: r.snippet })),
        ...(results.length > pg.offset + pg.limit ? { more: `More results: offset ${pg.offset + pg.limit}.` } : {}),
        ...(broad ? { no_note_has_every_word: true } : {}), ...searched,
      };
    }
    // grep: names first, then lines.
    const ctxN = Math.max(0, Math.min(10, Number(a.context) || 0));
    const fileHits: string[] = [];
    const lines: string[] = [];
    let count = 0;
    for (const e of notes) {
      const name = re!.test(e.path);
      const text = bodies.get(e.note.id);
      const all = text === undefined ? [] : present(text, P, []).split("\n");
      const at = all.flatMap((l, i) => (re!.test(l) ? [i] : []));
      if (!name && !at.length) continue;
      fileHits.push(e.path);
      count += at.length + (name && !at.length ? 1 : 0);
      if (output === "content") {
        if (name && !at.length) lines.push(`${e.path}: (its name matches)`);
        let last = -1;
        for (const i of at) {
          const from = Math.max(0, i - ctxN, last + 1), to = Math.min(all.length - 1, i + ctxN);
          if (ctxN && last >= 0 && from > last + 1) lines.push("--");
          for (let k = from; k <= to; k++) lines.push(`${e.path}:${k + 1}${k === i ? ":" : "-"} ${all[k].slice(0, 400)}`);
          last = to;
        }
      }
    }
    if (output === "count") return { matches: count, notes: fileHits.length, ...searched };
    if (output === "content") return { lines: lines.slice(pg.offset, pg.offset + pg.limit), ...more(lines.length, pg.offset, Math.min(pg.limit, Math.max(0, lines.length - pg.offset))), ...searched };
    return { files: fileHits.slice(pg.offset, pg.offset + pg.limit), ...more(fileHits.length, pg.offset, Math.min(pg.limit, Math.max(0, fileHits.length - pg.offset))), ...searched };
  },

  async list(tx, a, c) {
    const P = await pathsOf(tx, c);
    const pg = page(a, 100, 1000);
    const r = await resolve(tx, c, a.path, { trashed: true });
    if (r.kind === "app" || r.kind === "appfile" || r.kind === "data") {
      const p = await appProject(tx, c, r.note);
      const files = [...fileList(p).map((f) => ({ path: `${r.base}${f.path}`, lines: f.lines })), { path: `${r.base}/data.json`, what: "the app's data" }];
      const want = typeof a.pattern === "string" && a.pattern ? globRe(`${r.base}/${a.pattern.replace(/^\/+/, "")}`) : null;
      const shown = want ? files.filter((f) => want.test(f.path)) : files;
      return { path: `${r.base}/`, files: shown.slice(pg.offset, pg.offset + pg.limit), ...more(shown.length, pg.offset, Math.min(pg.limit, shown.length)) };
    }
    if (r.kind === "note") return await fileHandlers.list(tx, { ...a, path: r.path.replace(/\.md$/, "/") }, c);
    if (r.kind !== "dir") throw new ToolError(`${clean(a.path)} is a file: read it with fetch.`);
    const dir = r.dir;
    if (typeof a.pattern === "string" && a.pattern.trim()) {
      const re = globRe(dir + a.pattern.trim().replace(/^\/+/, ""));
      const hits = P.all().filter((e) => e.path.toLowerCase().startsWith(dir.toLowerCase()) && (dir.toLowerCase().startsWith(DELETED.toLowerCase()) || !e.path.startsWith(DELETED)))
        .flatMap((e) => [e, ...(e.kind === "note" && e.app ? [{ ...e, path: e.path.replace(/\.md$/, ".app/") } as Entry] : [])])
        .filter((e) => re.test(e.path)).sort(newest);
      return { pattern: a.pattern, ...(dir ? { path: dir } : {}), matches: hits.slice(pg.offset, pg.offset + pg.limit).map((e) => e.path.endsWith(".app/") ? { path: e.path, type: "app" } : entryOut(e)), ...more(hits.length, pg.offset, Math.min(pg.limit, hits.length)) };
    }
    const kids = P.children(dir).sort(newest);
    const owner = P.noteOfDir(dir);
    const files = owner ? await noteFiles(tx, c, P, owner).catch(() => []) : [];
    const entries = [
      ...kids.map((e) => e.kind === "folder" ? entryOut(e, { items: P.children(e.path).length }) : entryOut(e, e.kind === "note" && e.app ? { app: e.path.replace(/\.md$/, ".app/") } : {})),
      ...files.map((f) => ({ path: f.path, type: "file", kind: f.type, bytes: f.bytes })),
    ];
    const deleted = dir === "" ? P.children(DELETED).length : 0;
    return {
      path: dir || "/", ...(owner ? { note: P.pathOf(owner.id) } : {}),
      entries: entries.slice(pg.offset, pg.offset + pg.limit), ...more(entries.length, pg.offset, Math.min(pg.limit, entries.length)),
      ...(dir === "" ? { notes: P.all().filter((e) => e.kind === "note" && !e.note.trashed_at).length, ...(deleted ? { recently_deleted: `${deleted} in "${DELETED}"` } : {}) } : {}),
    };
  },

  async fetch(tx, a, c) {
    const P = await pathsOf(tx, c);
    const r = await resolve(tx, c, a.id, { trashed: true });
    if (r.kind === "file") return await fetchFile(tx, a, c, r);
    if (r.kind === "dir") {
      const listing = await fileHandlers.list(tx, { path: r.dir }, c);
      return { id: r.dir || "/", title: r.dir || "Notes", text: JSON.stringify(listing, null, 2), url: "ambernotes://notes", metadata: { type: "folder" } };
    }
    if (r.kind === "note") {
      const n = await full(tx, c, r.note.id, true);
      if (n.locked_body) return { id: r.path, title: n.title, text: LOCKED, url: `ambernotes://note/${n.id}`, metadata: { path: r.path, locked: true } };
      const body = await bodyOf(c.v, n);
      const files = await noteFiles(tx, c, P, n, body);
      const shown = numberedLines(present(body, P, files), a.offset, a.limit);
      const dir = r.path.replace(/\.md$/, "/");
      const subs = P.children(dir).filter((e) => e.kind === "note").map((e) => e.path);
      await markRead(tx, c, noteItem(n.id), String(n.version));
      return {
        id: r.path, title: n.title, text: shown.text, url: `ambernotes://note/${n.id}`,
        metadata: {
          path: r.path, lines: shown.lines, updated: iso(n.updated_at), ...(n.is_pinned ? { pinned: true } : {}),
          ...(n.trashed_at ? { deleted: "In Recently Deleted: restore brings it back." } : {}),
          ...(subs.length ? { sub_notes: subs } : {}), ...(files.length ? { files: files.map((f) => f.path) } : {}),
          ...(wikiLinks(body).length ? { links: wikiLinks(body) } : {}),
          ...(P.hasApp(n.id) ? { app: r.path.replace(/\.md$/, ".app/") } : {}),
          ...(shown.truncated ? { truncated: shown.truncated } : {}),
        },
      };
    }
    if (r.kind === "data") {
      const d = await pageDataOf(tx, c, r.note.id);
      const text = dataText(d);
      const shown = numberedLines(text, a.offset, a.limit);
      // What the app's own notes say its data means: docs/README.md, else README.md, under "## Data".
      const files = (await projectOf(tx, c, r.note.id)).project.files;
      const readme = [files["/docs/README.md"], files["/README.md"]].map((t) => t?.match(/^##\s*Data\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m)?.[1]?.trim()).find(Boolean);
      await markRead(tx, c, dataItem(r.note.id), await hash(c, text));
      return { id: `${r.base}/data.json`, title: `${r.note.title}: data.json`, text: shown.text, url: `ambernotes://note/${r.note.id}`,
        metadata: { path: `${r.base}/data.json`, lines: shown.lines, shape: { values: dataShape(d.values), collections: dataShape(d.collections) }, ...(readme ? { readme_data: readme } : {}), ...(shown.truncated ? { truncated: shown.truncated } : {}),
          about: "values.localStorage holds what the app keeps in localStorage, parsed; it's saved back as the app expects." } };
    }
    const p = await appProject(tx, c, r.note);
    if (r.kind === "app") {
      const { draft } = await projectOf(tx, c, r.note.id);
      return { id: `${r.base}/`, title: `${r.note.title} (app)`, text: [...fileList(p).map((f) => `${r.base}${f.path}  (${f.lines} lines)`), `${r.base}/data.json`].join("\n"), url: `ambernotes://note/${r.note.id}`,
        metadata: { path: `${r.base}/`, readme: p.files["/README.md"] ?? null, ...(await loadFailure(tx, r.note.id)),
          ...(draft !== null && draft !== undefined ? { held_back: `These files are a version that failed its checks, so the person still has the last one that passed. What failed:\n${draft}` } : {}) } };
    }
    const file = appPath(r.file);
    if (p.files[file] === undefined) throw new ToolError(`No ${r.base}${file}. Its files: list "${r.base}".`);
    const shown = numberedLines(p.files[file], a.offset, a.limit);
    await markRead(tx, c, fileItem(r.note.id, file), await hash(c, p.files[file]));
    return { id: `${r.base}${file}`, title: file.slice(1), text: shown.text, url: `ambernotes://note/${r.note.id}`, metadata: { path: `${r.base}${file}`, lines: shown.lines, ...(shown.truncated ? { truncated: shown.truncated } : {}) } };
  },

  async create(tx, a, c) {
    const type = a.type ?? "note";
    const path = clean(a.path);
    if (!path) throw new ToolError("path is where it goes: a note \"Work/Acme.md\", a folder \"Work/Clients/\", or an app's note.");
    if (type === "folder") {
      const f = await findFolder(tx, c.v, path.replace(/\/+$/, ""), true);
      return { created: (await pathsOf(tx, c, true)).folderPathOf(f.id) };
    }
    if (type === "app") {
      let n: Note;
      try {
        const r = await resolve(tx, c, path.replace(/\.app\/?$/i, ".md"));
        if (r.kind !== "note") throw new ToolError(`${path} isn't a note.`);
        n = r.note;
      } catch (e) {
        if (!/^Nothing at/.test((e as Error).message)) throw e;
        const made = await newNote(tx, c, path.replace(/\.app\/?$/i, "").replace(/\.md$/i, "") + ".md", "");
        n = (await pathsOf(tx, c)).noteAt(made.path)!;
      }
      if ((await pathsOf(tx, c)).hasApp(n.id)) throw new ToolError(`"${(await pathsOf(tx, c)).pathOf(n.id)}" already has an app. Change its files with edit and write.`);
      const proj = await withFiles({ amberApp: 1, files: {}, compiled: {} }, scaffold(n.title));
      const result = await saveProject(tx, c, await full(tx, c, n.id), proj, "a new React project", a) as Record<string, unknown>;
      const base = (await pathsOf(tx, c, true)).pathOf(n.id)!.replace(/\.md$/, ".app");
      // The starter counts as read: its files are what the AI starts from.
      for (const [f, text] of Object.entries(proj.files)) await markRead(tx, c, fileItem(n.id, f), await hash(c, text));
      const { app: _, ...rest } = result;
      return { ...rest, app: `${base}/`, next: `Read ${base}/README.md, then build the app with write and edit (files under ${base}/src/). Its data is ${base}/data.json.` };
    }
    if (type !== "note") throw new ToolError("type is note, folder or app.");
    const content = String(a.content ?? "");
    // A folder as the path: the note's name is its first line.
    const target = /\.md$/i.test(path) ? path : `${path.replace(/\/+$/, "")}/${safeName(titleOf(content))}.md`;
    const made = await newNote(tx, c, target, content, a.pinned === true);
    return { created: made.path, ...(made.checks.length ? { checks: made.checks } : {}) };
  },

  async edit(tx, a, c) {
    const P = await pathsOf(tx, c);
    if (typeof a.old_string !== "string" || typeof a.new_string !== "string") throw new ToolError("edit takes path, old_string and new_string (one change per call).");
    const r = await resolve(tx, c, a.path);
    const all = a.replace_all === true;
    if (r.kind === "note") {
      const n = await full(tx, c, r.note.id);
      refuseLocked(n);
      await mustHaveRead(tx, c, noteItem(n.id), String(n.version), r.path);
      const before = await bodyOf(c.v, n);
      const files = await noteFiles(tx, c, P, n, before);
      const shown = present(before, P, files);
      const body = unpresent(replaceIn(shown, a.old_string, a.new_string, all, r.path), P, files);
      if (body === before) return { path: r.path, unchanged: true };
      await save(tx, c, n, before, body);
      const [row] = await tx<{ version: string }[]>`select version from public.notes where id = ${n.id}`;
      await markRead(tx, c, noteItem(n.id), String(row.version));
      const checks = noteChecks(before, body, today());
      const now = (await pathsOf(tx, c, true)).pathOf(n.id)!;
      return { edited: now, ...(now !== r.path ? { renamed_from: r.path } : {}), checks: checks.length ? checks : "ok" };
    }
    if (r.kind === "data") {
      const before = await pageDataOf(tx, c, r.note.id);
      const text = dataText(before);
      await mustHaveRead(tx, c, dataItem(r.note.id), await hash(c, text), `${r.base}/data.json`);
      return await saveData(tx, c, r.note, r.base, before, replaceIn(text, a.old_string, a.new_string, all, `${r.base}/data.json`));
    }
    if (r.kind === "appfile") {
      const p = await appProject(tx, c, r.note);
      const file = appPath(r.file);
      if (p.files[file] === undefined) throw new ToolError(`No ${r.base}${file}. To make a new file, use write.`);
      await mustHaveRead(tx, c, fileItem(r.note.id, file), await hash(c, p.files[file]), `${r.base}${file}`);
      const text = replaceIn(p.files[file], a.old_string, a.new_string, all, `${r.base}${file}`);
      const out = await saveProject(tx, c, await full(tx, c, r.note.id), await withFile(p, file, text), `${file}`, a) as Record<string, unknown>;
      await markRead(tx, c, fileItem(r.note.id, file), await hash(c, text));
      return appResult(out, `${r.base}${file}`);
    }
    if (r.kind === "file") {
      const { bytes, meta, version } = await readFile(tx, c, r.id, r.path);
      if (!isTextFile(meta.name, meta.type)) throw new ToolError(`${r.path} isn't text: edit changes text files. To change it, fetch it with raw: true, change it with your own tools, and write it back with content_base64.`);
      await mustHaveRead(tx, c, blobItem(r.id), String(version), r.path);
      const before = new TextDecoder().decode(bytes);
      const text = replaceIn(before, a.old_string, a.new_string, all, r.path);
      if (text === before) return { path: r.path, unchanged: true };
      const w = await writeFile(tx, c, { id: r.id, name: meta.name, type: meta.type, bytes: new TextEncoder().encode(text), path: r.path });
      await markRead(tx, c, blobItem(r.id), String(w.version));
      return { edited: r.path, kept: "The version before is in history; restore brings it back." };
    }
    throw new ToolError("edit changes a note, an app file, an app's data.json or a text file.");
  },

  async write(tx, a, c) {
    if (typeof a.content_base64 === "string" || (a.file && typeof a.file === "object") || (typeof a.content === "string" && looksLikeFile(clean(a.path)))) return await writeFileTool(tx, a, c);
    if (typeof a.content !== "string") throw new ToolError("content is the whole new text (content_base64 with mime_type for a file's bytes).");
    const content = a.content;
    let r: Ref;
    try { r = await resolve(tx, c, a.path); } catch (e) {
      // A new note.
      const path = clean(a.path);
      if (/\.md$/i.test(path) && /^Nothing at/.test((e as Error).message)) {
        const made = await newNote(tx, c, path, content);
        return { created: made.path, checks: made.checks.length ? made.checks : "ok" };
      }
      throw e;
    }
    const P = await pathsOf(tx, c);
    if (r.kind === "note") {
      if (!content.trim()) throw new ToolError("content is empty. To remove the note, use delete.");
      checkSize(content);
      const n = await full(tx, c, r.note.id);
      refuseLocked(n);
      await mustHaveRead(tx, c, noteItem(n.id), String(n.version), r.path);
      const before = await bodyOf(c.v, n);
      const body = unpresent(content, P, await noteFiles(tx, c, P, n, before));
      await save(tx, c, n, before, body);
      const [row] = await tx<{ version: string }[]>`select version from public.notes where id = ${n.id}`;
      await markRead(tx, c, noteItem(n.id), String(row.version));
      const checks = noteChecks(before, body, today());
      const now = (await pathsOf(tx, c, true)).pathOf(n.id)!;
      return { written: now, ...(now !== r.path ? { renamed_from: r.path } : {}), checks: checks.length ? checks : "ok" };
    }
    if (r.kind === "data") {
      const before = await pageDataOf(tx, c, r.note.id);
      await mustHaveRead(tx, c, dataItem(r.note.id), await hash(c, dataText(before)), `${r.base}/data.json`);
      return await saveData(tx, c, r.note, r.base, before, content);
    }
    if (r.kind === "appfile") {
      const p = await appProject(tx, c, r.note);
      const file = appPath(r.file);
      if (p.files[file] === content) return { path: `${r.base}${file}`, unchanged: true };
      if (p.files[file] !== undefined) await mustHaveRead(tx, c, fileItem(r.note.id, file), await hash(c, p.files[file]), `${r.base}${file}`);
      const out = await saveProject(tx, c, await full(tx, c, r.note.id), await withFile(p, file, content), `${file} (${p.files[file] === undefined ? "created" : "replaced"})`, a) as Record<string, unknown>;
      await markRead(tx, c, fileItem(r.note.id, file), await hash(c, content));
      return appResult(out, `${r.base}${file}`);
    }
    if (r.kind === "file") return await writeFileTool(tx, a, c);
    throw new ToolError("write writes a note, an app file, an app's data.json or a file.");
  },

  async move(tx, a, c) {
    const P = await pathsOf(tx, c);
    const r = await resolve(tx, c, a.path);
    const to = clean(a.to);
    if (!to) throw new ToolError("to is where it goes.");
    if (r.kind === "note") {
      let n = await full(tx, c, r.note.id);
      const rename = /\.md$/i.test(to);
      const dir = (rename ? to.split("/").slice(0, -1).join("/") : to).replace(/\/+$/, "");
      const here = r.path.split("/").slice(0, -1).join("/");
      if (dir.toLowerCase() !== here.toLowerCase()) {
        if (dir.toLowerCase().startsWith(r.path.replace(/\.md$/, "").toLowerCase())) throw new ToolError("A note can't move into its own folder.");
        const where = await placeFor(tx, c, P, dir);
        // Out of its old parent: the link to it there goes too.
        if (n.parent_id && n.parent_id !== where.parent?.id) {
          const old = await full(tx, c, n.parent_id, true).catch(() => null);
          if (old && !old.locked_body) {
            const ob = await bodyOf(c.v, old);
            const nb = ob.split("\n").filter((l) => !new RegExp(`^\\s*(?:[-*]\\s+)?\\[[^\\]]*\\]\\(pane-note:${n.id}\\)\\s*$`, "i").test(l)).join("\n");
            if (nb !== ob) await save(tx, c, old, ob, nb);
          }
        }
        await tx`update public.notes set folder_id = ${where.folder}, parent_id = ${where.parent?.id ?? null}, updated_at = now() where id = ${n.id}`;
        if (where.parent) {
          const parent = await full(tx, c, where.parent.id);
          refuseLocked(parent);
          const pb = await bodyOf(c.v, parent);
          if (!pb.includes(`pane-note:${n.id}`)) await save(tx, c, parent, pb, appendText(pb, `[${n.title.replace(/[\[\]]/g, "")}](pane-note:${n.id})`));
        }
        // Its sub-notes follow it (they live in its folder).
        const subs = await descendants(tx, n.id);
        if (subs.length) await tx`update public.notes set folder_id = ${where.folder} where id = any(${subs}::uuid[])`;
      }
      if (rename) {
        const title = to.split("/").pop()!.replace(/\.md$/i, "").trim();
        n = await full(tx, c, n.id);
        refuseLocked(n);
        const before = await bodyOf(c.v, n);
        const lines = before.split("\n");
        const k = lines.findIndex((l) => l.trim());
        const m = (lines[k] ?? "").match(/^(\s*#{1,6}\s+)/);
        lines[k < 0 ? 0 : k] = `${m ? m[1] : ""}${title}`;
        await save(tx, c, n, before, lines.join("\n"));
      }
      return { moved: (await pathsOf(tx, c, true)).pathOf(n.id) };
    }
    if (r.kind === "dir") {
      const e = P.at(r.dir);
      if (e?.kind !== "folder") throw new ToolError(`"${r.dir}" is a note's folder: move the note ("${r.dir.replace(/\/$/, ".md")}") instead.`);
      const parts = to.replace(/\/+$/, "").split("/").filter(Boolean);
      const name = parts.pop()!;
      const parent = parts.length ? await findFolder(tx, c.v, parts.join("/"), true) : null;
      const fresh = await pathsOf(tx, c, true);
      if (parent && (parent.id === e.folder.id || fresh.folderPathOf(parent.id).toLowerCase().startsWith(r.dir.toLowerCase()))) throw new ToolError("A folder can't move into itself.");
      await classic.rename_folder(tx, { folder: e.folder.id, new_name: name }, c);
      await tx`update public.folders set parent_id = ${parent?.id ?? null}, updated_at = now() where id = ${e.folder.id}`;
      return { moved: (await pathsOf(tx, c, true)).folderPathOf(e.folder.id) };
    }
    if (r.kind === "appfile") {
      const target = to.includes(".app/") ? to.slice(to.indexOf(".app/") + 4) : to;
      return await moveAppFile(tx, c, r.note, r.base, r.file, target, a);
    }
    if (r.kind === "file" && r.folder) {
      await moveFile(tx, c, r.folder, to);
      return { moved: (await pathsOf(tx, c, true)).filePathOf(r.id) };
    }
    if (r.kind === "file") throw new ToolError("A note's file moves with the note. To show it in another note, edit both notes' text (move its ![name](…) line).");
    throw new ToolError("move takes a note, a folder or an app file.");
  },

  async delete(tx, a, c) {
    const P = await pathsOf(tx, c);
    const r = await resolve(tx, c, a.path);
    if (r.kind === "note") {
      const d = await classic.delete_note(tx, { id: r.note.id }, c) as { sub_notes_moved: number };
      return { deleted: r.path, ...(d.sub_notes_moved ? { with_sub_notes: d.sub_notes_moved } : {}), now_at: (await pathsOf(tx, c, true)).pathOf(r.note.id), restore_with: "restore" };
    }
    if (r.kind === "dir") {
      const e = P.at(r.dir);
      if (e?.kind !== "folder") throw new ToolError(r.dir ? `"${r.dir}" is a note's folder: delete the note ("${r.dir.replace(/\/$/, ".md")}") instead.` : "The top level can't be deleted.");
      const d = await classic.delete_folder(tx, { folder: e.folder.id }, c) as { notes_moved_to_recently_deleted: number };
      return { deleted: r.dir, notes_moved_to: `${DELETED} (${d.notes_moved_to_recently_deleted})` };
    }
    if (r.kind === "appfile") {
      const p = await appProject(tx, c, r.note);
      const file = appPath(r.file);
      if (file === "/index.html") throw new ToolError("/index.html is the page the app opens; it can't be deleted.");
      if (p.files[file] === undefined) throw new ToolError(`No ${r.base}${file}.`);
      const files = { ...p.files }, compiled = { ...p.compiled };
      delete files[file]; delete compiled[file];
      return appResult(await saveProject(tx, c, await full(tx, c, r.note.id), { amberApp: 1, files, compiled }, `deleted ${file}`, a) as Record<string, unknown>, `${r.base}${file}`);
    }
    if (r.kind === "app") {
      await tx`update public.note_pages set page_ct = null, draft_ct = null where note_id = ${r.note.id}`;
      return { deleted: `${r.base}/`, kept: "The note stays; the app is in its history (restore with a version)." };
    }
    if (r.kind === "file" && r.folder) {
      await trashFile(tx, r.folder);
      return { deleted: r.path, now_at: (await pathsOf(tx, c, true)).filePathOf(r.id), restore_with: "restore" };
    }
    if (r.kind === "file") throw new ToolError("To remove a file from a note, edit the note's text (remove its ![name](…) line).");
    throw new ToolError("delete takes a note, a folder, an app file or an app.");
  },

  async history(tx, a, c) {
    const r = await resolve(tx, c, a.path, { trashed: true });
    const limit = Math.max(1, Math.min(50, Number(a.limit) || 10));
    if (r.kind === "note") {
      const h = await classic.note_history(tx, { id: r.note.id, limit }, c) as { revisions: Record<string, unknown>[] };
      return { path: r.path, versions: h.revisions.map(({ revision_id, version: _n, ...rest }: Record<string, unknown>) => ({ version: revision_id, ...rest })) };
    }
    if (r.kind === "app" || r.kind === "appfile" || r.kind === "data") {
      const rows = await tx<{ id: string; client: string | null; made_at: Date; replaced_at: Date; reason: string }[]>`
        select id, client, made_at, replaced_at, reason from public.note_page_versions where note_id = ${r.note.id} order by id desc limit ${limit}`;
      return { path: `${r.base}/`, versions: rows.map((v) => ({ version: Number(v.id), what: v.reason === "data" ? "data" : "code", made_by: v.client, made: iso(v.made_at), replaced: iso(v.replaced_at) })) };
    }
    if (r.kind === "file") return { path: r.path, versions: await fileVersions(tx, c, r.id, limit) };
    throw new ToolError("history takes a note, an app or a file.");
  },

  async restore(tx, a, c) {
    const r = await resolve(tx, c, a.path, { trashed: true });
    if (r.kind === "note") {
      if (a.version === undefined || a.version === null) {
        await classic.restore_note(tx, { id: r.note.id }, c);
        return { restored: (await pathsOf(tx, c, true)).pathOf(r.note.id) };
      }
      if (r.note.trashed_at) throw new ToolError(`"${r.path}" is in Recently Deleted: restore it first (no version).`);
      await classic.restore_revision(tx, { id: r.note.id, revision_id: a.version }, c);
      return { restored: (await pathsOf(tx, c, true)).pathOf(r.note.id), version: a.version, note: "The text before this restore is kept in history too." };
    }
    if (r.kind === "app" || r.kind === "appfile" || r.kind === "data") {
      const want = wholeNumber(a.version, "version");
      const [v] = await tx<{ page_ct: string | null; data_ct: string | null }[]>`select page_ct, data_ct from public.note_page_versions where id = ${want} and note_id = ${r.note.id}`;
      if (!v) throw new ToolError("No such version of this app. Use history.");
      await tx`update public.note_pages set page_ct = coalesce(${v.page_ct}, page_ct), data_ct = coalesce(${v.data_ct}, data_ct), draft_ct = null, draft_problems = null where note_id = ${r.note.id}`;
      return { restored: `${r.base}/`, version: want, note: "What it replaced is kept in history." };
    }
    if (r.kind === "file") {
      if (a.version !== undefined && a.version !== null) {
        await restoreFileVersion(tx, c, r.id, wholeNumber(a.version, "version"), r.path);
        return { restored: r.path, version: a.version, note: "What it replaced is kept in history too." };
      }
      if (!r.folder?.trashed_at) return { path: r.path, already_restored: true };
      await restoreFile(tx, c, r.folder);
      return { restored: (await pathsOf(tx, c, true)).filePathOf(r.id) };
    }
    throw new ToolError("restore takes a note (deleted, or with a version), a deleted file, a file with a version, or an app with a version.");
  },

  async pin(tx, a, c) {
    const r = await resolve(tx, c, a.path);
    if (r.kind !== "note") throw new ToolError("pin takes a note.");
    await classic.pin_note(tx, { id: r.note.id, pinned: a.pinned === true }, c);
    return { path: r.path, pinned: a.pinned === true };
  },

  async see_app(tx, a, c) {
    const r = await resolve(tx, c, a.path);
    if (r.kind !== "note" && r.kind !== "app") throw new ToolError("see_app takes an app (\"Work/Habits.app\") or its note.");
    const failure = await loadFailure(tx, r.note.id);
    const seen = Array.isArray(a.steps) && a.steps.length && tryOn()
      ? await appHandlers.try_app(tx, { id: r.note.id, steps: a.steps, data: a.data, screenshots: "last" }, c)
      : await appHandlers.preview_app(tx, { id: r.note.id, widths: a.widths, themes: a.themes, data: a.data }, c);
    const strip = <T,>(v: T): T => JSON.parse(JSON.stringify(v).replaceAll(r.note.id, "")) as T;
    if (!Object.keys(failure).length) return seen instanceof Content ? seen : strip(seen);
    return seen instanceof Content ? new Content([{ type: "text", text: JSON.stringify(failure) }, ...seen.content], { ...seen.structured, ...failure }) : { ...strip(seen as object), ...failure };
  },
};

/** What a scope (a folder, a note, a glob, an app) lets through. */
async function scopeTest(tx: Tx, c: Call, P: Paths, scope: string): Promise<(path: string) => boolean> {
  if (!scope) return () => true;
  if (/[*?]/.test(scope)) { const re = globRe(scope); return (p) => re.test(p) || re.test(p.replace(/\.md$/, "")); }
  const at = scope.search(/\.app(\/|$)/i);
  if (at >= 0) { const base = scope.slice(0, at).toLowerCase(); return (p) => p.toLowerCase().startsWith(base + ".app") || p.toLowerCase() === base + ".md"; }
  if (/\.md$/i.test(scope)) { const n = (await resolve(tx, c, scope, { trashed: true })) as { path?: string }; const base = (n.path ?? scope).replace(/\.md$/, "").toLowerCase(); return (p) => p.toLowerCase() === base + ".md" || p.toLowerCase().startsWith(base + "/"); }
  const dir = canonicalDir(P, scope.endsWith("/") ? scope : scope + "/").toLowerCase();
  if (!P.isDir(dir) && !P.noteOfDir(dir)) throw new ToolError(`No folder "${scope}". Use list to see what's there.`);
  return (p) => p.toLowerCase().startsWith(dir);
}

function dateArg(v: unknown, name: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const t = Date.parse(String(v));
  if (!Number.isFinite(t)) throw new ToolError(`${name} is a date like 2026-10-01.`);
  return t;
}

const appPath = (f: string) => { try { return cleanPath(f.startsWith("/") ? f : "/" + f); } catch (e) { throw new ToolError((e as Error).message); } };

/** An app save's answer, without the note's id. */
function appResult(out: Record<string, unknown> | Content, path: string): unknown {
  if (out instanceof Content) return out;
  const { app: _, saved: __, ...rest } = out;
  return { saved: path, ...rest };
}

/** The newest time a device couldn't open the live app and went back to an earlier one. */
// MARK: Files

const looksLikeFile = (path: string) => /\.[A-Za-z0-9]{1,10}$/.test(path) && !/\.md$/i.test(path) && !/\.app(\/|$)/i.test(path) && !path.includes(".app/");
const IMAGE_BLOCKS = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** A file a chat client hands over by link (ChatGPT's openai/fileParams): fetched once, over HTTPS
 *  from a public address, at most 10 MB. */
async function chatFile(f: Record<string, unknown>): Promise<Uint8Array> {
  let url: URL;
  try { url = new URL(String(f.download_url ?? "")); } catch { throw new ToolError("file.download_url isn't a link."); }
  if (url.protocol !== "https:" || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[|0\.)/i.test(url.hostname) || !url.hostname.includes(".")) {
    throw new ToolError("file.download_url must be a public https link.");
  }
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) { await res.body?.cancel(); throw new ToolError(`The file couldn't be downloaded from the chat (${res.status}).`); }
  return await readCapped(res, AI_FILE_BYTES).catch(() => { throw new ToolError("The file is over 10 MB. The AI can write files up to 10 MB; larger ones are added in Amber Notes."); });
}

/** A file as the AI reads it: text to edit, extracted text, a picture, or (raw) its bytes. */
async function fetchFile(tx: Tx, a: Args, c: Call, r: Extract<Ref, { kind: "file" }>) {
  const { bytes, meta, version } = await readFile(tx, c, r.id, r.path);
  const kind = mimeOf(meta.type, meta.name);
  const head = { path: r.path, kind, bytes: bytes.length, ...(r.folder?.trashed_at ? { deleted: "In Recently Deleted: restore brings it back." } : {}) };
  await markRead(tx, c, blobItem(r.id), String(version));
  try {
    if (a.raw === true) {
      return new Content([{ type: "text", text: JSON.stringify({ ...head, raw: "The file's bytes are the resource below (base64). Change them with your own tools and write them back with content_base64." }) },
        { type: "resource", resource: { uri: `ambernotes://file/${encodeURIComponent(r.path)}`, mimeType: kind, blob: toBase64(bytes) } }], head);
    }
    if (IMAGE_BLOCKS.has(kind)) return new Content([{ type: "text", text: JSON.stringify(head) }, { type: "image", data: toBase64(bytes), mimeType: kind }], head);
    if (isTextFile(meta.name, meta.type)) {
      const shown = numberedLines(new TextDecoder().decode(bytes), a.offset, a.limit);
      return { id: r.path, title: meta.name, text: shown.text, url: "ambernotes://notes", metadata: { ...head, lines: shown.lines, editable: "edit and write change it like a note.", ...(shown.truncated ? { truncated: shown.truncated } : {}) } };
    }
    const got = await extract(bytes, meta.name, meta.type);
    if ("none" in got) return { id: r.path, title: meta.name, text: got.none, url: "ambernotes://notes", metadata: head };
    const shown = numberedLines(got.text, a.offset, a.limit);
    return { id: r.path, title: meta.name, text: shown.text, url: "ambernotes://notes", metadata: { ...head, ...(got.pages ? { pages: got.pages } : {}), lines: shown.lines, text_of: "the file's text, taken out of it; fetch with raw: true for the file itself.", ...(shown.truncated ? { truncated: shown.truncated } : {}) } };
  } finally {
    bytes.fill(0);
  }
}

/** write for a file: a new file in a folder (or in a note's folder, embedded in that note), or
 *  new bytes for an existing one, read first; the version it replaces stays in history. */
async function writeFileTool(tx: Tx, a: Args, c: Call) {
  const path = clean(a.path);
  let bytes: Uint8Array;
  if (typeof a.content_base64 === "string") {
    try { bytes = fromBase64(a.content_base64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "")); } catch { throw new ToolError("content_base64 isn't base64."); }
  } else if (a.file && typeof a.file === "object") {
    bytes = await chatFile(a.file as Record<string, unknown>);
    if (typeof a.mime_type !== "string" && typeof (a.file as Record<string, unknown>).mime_type === "string") a.mime_type = (a.file as Record<string, unknown>).mime_type;
  } else if (typeof a.content === "string") bytes = new TextEncoder().encode(a.content);
  else throw new ToolError("A file takes content (text) or content_base64 with mime_type.");
  let r: Ref | null = null;
  try { r = await resolve(tx, c, path); } catch (e) { if (!/^Nothing at/.test((e as Error).message)) throw e; }
  if (r && r.kind !== "file") throw new ToolError(`${path} isn't a file.`);
  if (r?.kind === "file") {
    const { meta, version } = await readFile(tx, c, r.id, r.path);
    await mustHaveRead(tx, c, blobItem(r.id), String(version), r.path);
    if (typeof a.content_base64 !== "string" && !isTextFile(meta.name, meta.type)) throw new ToolError(`${r.path} isn't text: write its bytes with content_base64.`);
    const w = await writeFile(tx, c, { id: r.id, name: meta.name, type: meta.type, bytes, path: r.path });
    await markRead(tx, c, blobItem(r.id), String(w.version));
    return { written: r.path, bytes: bytes.length, kept: "The version before is in history; restore brings it back." };
  }
  if (!looksLikeFile(path)) throw new ToolError(`${path}: a file's path ends in its kind, like "To read/Summary.txt" or "To read/Paper.pdf".`);
  const slash = path.lastIndexOf("/");
  const name = safeName(path.slice(slash + 1));
  const P = await pathsOf(tx, c);
  const where = slash > 0 ? await placeFor(tx, c, P, path.slice(0, slash)) : { folder: (await findFolder(tx, c.v, "Notes", true)).id };
  const type = utiOf(name, typeof a.mime_type === "string" ? a.mime_type : undefined);
  const made = await writeFile(tx, c, { folderId: where.parent ? null : where.folder, name, type, bytes, path });
  if (where.parent) {
    // In a note's folder: the note shows it.
    const n = await full(tx, c, where.parent.id);
    refuseLocked(n);
    const before = await bodyOf(c.v, n);
    const image = /^image\//.test(mimeOf(type, name));
    await save(tx, c, n, before, appendText(before, `${image ? "!" : ""}[${name.replace(/[\[\]]/g, "")}](pane-file:${made.id})`));
  }
  const now = await pathsOf(tx, c, true);
  const at = now.filePathOf(made.id) ?? (where.parent ? (await noteFiles(tx, c, now, where.parent)).find((f) => f.id === made.id)?.path : path) ?? path;
  await markRead(tx, c, blobItem(made.id), "0");
  return { created: at, bytes: bytes.length };
}

async function loadFailure(tx: Tx, id: string): Promise<Record<string, unknown>> {
  const [f] = await tx<{ message: string; device: string | null; at: Date }[]>`select message, device, at from public.app_load_failures where note_id = ${id} order by at desc limit 1`;
  return f ? { load_failure: { message: f.message, device: f.device, at: iso(f.at), what_happened: "A device couldn't open the live version and went back to an earlier one, with the current data. Fix the cause and save." } } : {};
}

async function moveAppFile(tx: Tx, c: Call, n: Note, base: string, from: string, to: string, a: Args) {
  const p = await appProject(tx, c, n);
  const src = appPath(from), dst = appPath(to);
  if (src === "/index.html") throw new ToolError("/index.html stays where it is: the app opens it.");
  if (p.files[src] === undefined) throw new ToolError(`No ${base}${src}.`);
  if (p.files[dst] !== undefined) throw new ToolError(`${base}${dst} already exists.`);
  const files = { ...p.files }, compiled = { ...p.compiled };
  const content = files[src];
  delete files[src]; delete compiled[src];
  const out = await saveProject(tx, c, await full(tx, c, n.id), await withFile({ amberApp: 1, files, compiled }, dst, content), `${src} → ${dst}`, a);
  await markRead(tx, c, fileItem(n.id, dst), await hash(c, content));
  return appResult(out as Record<string, unknown>, `${base}${dst}`);
}
