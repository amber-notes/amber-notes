// The note tools. Each runs in a transaction as the token's owner (RLS applies).
//
// Everything a note holds is sealed on the person's devices (end-to-end encryption, see
// _shared/e2ee.ts). The request's vault opens what a tool needs and seals what it writes; the
// database only ever sees boxes. So what used to need the text in SQL (search, sorting by title,
// which sub-notes a list hides, which notes embed a file) happens here, in memory, as a scan with
// a time budget per account.

import type { PendingQuery, Row, Sql, TransactionSql } from "npm:postgres@3.4.5";
import { toBase64, type Head, type Vault } from "../_shared/e2ee.ts";
import { errorKind, log } from "../_shared/log.ts";
import { appendText, applyEdits, coerce, findTables, fitLines, isTextType, mimeOf, outline, previewOf, replaceTable, searchFilter, searchInMemory, setChecklistItem, sliceLines, titleOf, typeSpec, type Edit, type Table } from "./notes.ts";

export type ToolContext = { sql: Sql; userId: string; client: string; canWrite: boolean; vault: Vault };
export class ToolError extends Error {}

/** A result that is MCP content blocks (a file's text, an image, a PDF), sent as they are. */
export class Content {
  constructor(readonly content: Record<string, unknown>[], readonly structured?: Record<string, unknown>) {}
}

type Tx = TransactionSql;
type Args = Record<string, unknown>;
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint?: boolean; openWorldHint: false };
  // ChatGPT reads this per tool: which OAuth scope the call needs.
  securitySchemes?: { type: "oauth2"; scopes: string[] }[];
};

const str = (d: string) => ({ type: "string", description: d });
const int = (d: string) => ({ type: "integer", description: d });
const bool = (d: string) => ({ type: "boolean", description: d });
const noteRef = {
  id: str("Note id (preferred)."),
  title: str("Note title, if you don't have the id. Must match one note."),
};
// The directories check these (Claude's and ChatGPT's): every hint is stated. A tool that can
// overwrite or remove what's there is destructive, even though history can undo it.
const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

export const tools: Tool[] = ([
  {
    name: "get_overview", title: "Overview of the notes",
    description: "An overview of the person's Amber Notes: folders with counts, pinned notes and the most recently edited notes.",
    inputSchema: { type: "object", properties: {} }, annotations: read,
  },
  {
    name: "search_notes", title: "Search notes",
    description: "Full-text search across titles and bodies. Returns ranked notes with a highlighted snippet («match»). Locked notes are left out.",
    inputSchema: { type: "object", properties: { query: str("Words or a phrase. Supports \"quoted phrases\", OR and -exclusions."), limit: int("Max results, default 10.") }, required: ["query"] },
    annotations: read,
  },
  {
    name: "list_notes", title: "List notes",
    description: "List notes, newest first, optionally in one folder. Use for browsing; use search_notes to find something.",
    inputSchema: {
      type: "object",
      properties: {
        folder: str("Folder name or path like \"Work/Q4 planning\". Omit for all notes."),
        pinned_only: bool("Only pinned notes."),
        recently_deleted: bool("List notes in Recently Deleted instead."),
        include_sub_notes: bool("Also list sub-notes (notes that live inside another note). Default false, like the app's list."),
        sort: { type: "string", enum: ["updated", "created", "title"], description: "Default updated." },
        limit: int("Default 30, max 200."),
        offset: int("For paging."),
      },
    },
    annotations: read,
  },
  {
    name: "read_note", title: "Read a note",
    description: "Returns a note's markdown with its folder, dates, version and outline. For long notes, read a line range; set line_numbers to see where headings are.",
    inputSchema: { type: "object", properties: { ...noteRef, start_line: int("First line, 1-based."), end_line: int("Last line, inclusive."), line_numbers: bool("Prefix each line with its number.") } },
    annotations: read,
  },
  {
    name: "create_note", title: "Create a note",
    description: "Creates a note from markdown. The first line becomes the title (write it as plain text or '# Title').",
    inputSchema: { type: "object", properties: { body: str("Markdown. First line is the title."), folder: str("Folder name or path. Created if it doesn't exist. Default: Notes."), pinned: bool("Pin it.") }, required: ["body"] },
    annotations: write,
  },
  {
    name: "edit_note", title: "Edit a note",
    description: "Precise edits: each old_text must match the note exactly once (copy it from read_note) and is replaced by new_text. Edits apply in order. Fails without changing anything if one doesn't match.",
    inputSchema: {
      type: "object",
      properties: {
        ...noteRef,
        edits: { type: "array", items: { type: "object", properties: { old_text: str("Exact existing text."), new_text: str("Replacement; empty string deletes."), replace_all: bool("Replace every occurrence.") }, required: ["old_text", "new_text"] } },
        expected_version: int("Version from read_note; the edit fails if the note changed since."),
      },
      required: ["edits"],
    },
    annotations: { ...write, destructiveHint: true },
  },
  {
    name: "append_to_note", title: "Add to a note",
    description: "Adds markdown to the end of a note, or to the end (or start) of the section under a heading. Good for logs, lists and journals.",
    inputSchema: { type: "object", properties: { ...noteRef, text: str("Markdown to add."), under_heading: str("Heading text whose section gets the text."), at_start: bool("Add at the start of the note/section instead of the end.") }, required: ["text"] },
    annotations: write,
  },
  {
    name: "replace_note_body", title: "Rewrite a note",
    description: "Replaces the whole note with new markdown. Use only for full rewrites; prefer edit_note. The person sees the change in Amber Notes with Undo, and the old version stays in history.",
    inputSchema: { type: "object", properties: { ...noteRef, body: str("The complete new markdown."), expected_version: int("Version from read_note, to avoid overwriting newer changes.") }, required: ["body"] },
    annotations: { ...write, destructiveHint: true },
  },
  {
    name: "set_checklist_item", title: "Tick a checklist item",
    description: "Checks or unchecks a '- [ ] item' line, matched by its text.",
    inputSchema: { type: "object", properties: { ...noteRef, item: str("The item's text (or a unique part of it)."), checked: bool("true to check, false to uncheck.") }, required: ["item", "checked"] },
    annotations: { ...write, idempotentHint: true },
  },
  {
    name: "move_note", title: "Move a note",
    description: "Moves a note to another folder, creating the folder if it doesn't exist. Use a path like \"Work/Clients\" to nest.",
    inputSchema: { type: "object", properties: { ...noteRef, folder: str("Folder name or path.") }, required: ["folder"] },
    annotations: { ...write, idempotentHint: true },
  },
  {
    name: "pin_note", title: "Pin or unpin",
    description: "Pins a note to the top of the list, or unpins it. Pinned state shows as `pinned` in every note listing.",
    inputSchema: { type: "object", properties: { ...noteRef, pinned: bool("true to pin.") }, required: ["pinned"] },
    annotations: { ...write, idempotentHint: true },
  },
  {
    name: "delete_note", title: "Delete a note",
    description: "Moves a note and its sub-notes to Recently Deleted. This can be undone: restore_note brings it back within 30 days.",
    inputSchema: { type: "object", properties: { ...noteRef } },
    annotations: { ...write, destructiveHint: true },
  },
  {
    name: "restore_note", title: "Restore a deleted note",
    description: "Brings a note (and its sub-notes) back from Recently Deleted.",
    inputSchema: { type: "object", properties: { id: str("Note id.") }, required: ["id"] },
    annotations: { ...write, idempotentHint: true },
  },
  {
    name: "list_folders", title: "List folders",
    description: "All folders as paths like \"Work/Q4 planning\", with how many notes each shows in the app.",
    inputSchema: { type: "object", properties: {} }, annotations: read,
  },
  {
    name: "create_folder", title: "Create a folder",
    description: "Creates a folder; use a path like \"Work/Clients\" to nest it.",
    inputSchema: { type: "object", properties: { path: str("Folder path.") }, required: ["path"] },
    annotations: { ...write, idempotentHint: true },
  },
  {
    name: "rename_folder", title: "Rename a folder",
    description: "Renames a folder in place. Its notes and sub-folders stay inside it.",
    inputSchema: { type: "object", properties: { folder: str("Current name or path."), new_name: str("New name.") }, required: ["folder", "new_name"] },
    annotations: write,
  },
  {
    name: "delete_folder", title: "Delete a folder",
    description: "Deletes a folder and its sub-folders. Their notes (and those notes' sub-notes) go to Recently Deleted, and each can be brought back with restore_note within 30 days; the folders themselves are not restored.",
    inputSchema: { type: "object", properties: { folder: str("Name or path.") }, required: ["folder"] },
    annotations: { ...write, destructiveHint: true },
  },
  {
    name: "note_history", title: "Note history",
    description: "Earlier versions of a note, newest first, with who changed it (app or an AI client).",
    inputSchema: { type: "object", properties: { ...noteRef, limit: int("Default 10.") } },
    annotations: read,
  },
  {
    name: "restore_revision", title: "Restore an earlier version",
    description: "Puts an earlier version (from note_history) back as the note's body. The current body is kept in history too.",
    inputSchema: { type: "object", properties: { ...noteRef, revision_id: int("Revision id from note_history.") }, required: ["revision_id"] },
    annotations: { ...write, destructiveHint: true },
  },
  {
    name: "create_sub_note", title: "Create a sub-note",
    description: "Creates a note that lives inside another note: it's linked from the parent (a [Title](pane-note:id) line added at the end, or under a heading) and doesn't show in the main list.",
    inputSchema: { type: "object", properties: { ...noteRef, body: str("Markdown for the sub-note. First line is its title."), under_heading: str("Put the link under this heading in the parent.") }, required: ["body"] },
    annotations: write,
  },
  {
    name: "list_files", title: "List files",
    description: "Files kept in Amber Notes (PDFs, spreadsheets, images…), newest first, with the notes that embed them.",
    inputSchema: { type: "object", properties: { query: str("Filter by filename."), limit: int("Default 30.") } },
    annotations: read,
  },
  {
    name: "get_file", title: "Get a file",
    description: "A file's details and its contents: text files (CSV, JSON, markdown…) as text, images as an image, PDFs and other files as an attached resource. Files over 8 MB can only be opened in Amber Notes.",
    inputSchema: { type: "object", properties: { id: str("File id from list_files or a pane-file: link in a note.") }, required: ["id"] },
    annotations: read,
  },
  {
    name: "read_table", title: "Read a table",
    description: "Reads a table in a note: its columns (with types and allowed values for trackers) and its rows as objects. Use before logging so you use the right column names and values.",
    inputSchema: { type: "object", properties: { ...noteRef, table: int("Which table in the note, counting every table from 0. Default: the first tracker, else the first table."), last: int("Only the last N rows.") } },
    annotations: read,
  },
  {
    name: "log_table_row", title: "Log a row",
    description: "Adds a row to a table. In a tracker with a date column it updates that date's row if there is one (the date defaults to today). Values are checked against each column's type: scales must be in range, choices one of the options, Yes/No also takes true/false.",
    inputSchema: {
      type: "object",
      properties: {
        ...noteRef,
        table: int("Which table in the note, counting every table from 0. Default: the first tracker, else the first table."),
        values: { type: "object", description: "Column name → value. Omitted columns stay as they are (or empty for a new row).", additionalProperties: true },
      },
      required: ["values"],
    },
    annotations: { ...write, destructiveHint: true },
  },
  {
    name: "delete_table_row", title: "Delete a row",
    description: "Removes the row for a date (trackers) or at a 0-based row index from a table.",
    inputSchema: { type: "object", properties: { ...noteRef, table: int("Which table, counting from 0. Default: the first tracker, else the first table."), date: str("yyyy-mm-dd."), index: int("0-based row index.") } },
    annotations: { ...write, destructiveHint: true },
  },
  // ChatGPT's connector conventions.
  {
    name: "search", title: "Search",
    description: "Search the person's Amber Notes by words or phrases. Returns note ids and titles; read one with fetch. Locked notes are left out.",
    inputSchema: { type: "object", properties: { query: str("Search query.") }, required: ["query"] },
    annotations: read,
  },
  {
    name: "fetch", title: "Fetch",
    description: "Fetch an Amber Notes note by id (from search) as its full markdown, with folder, pinned state and last edit time.",
    inputSchema: { type: "object", properties: { id: str("Note id.") }, required: ["id"] },
    annotations: read,
  },
] satisfies Tool[]).map((t) => ({ ...t, securitySchemes: [{ type: "oauth2" as const, scopes: [t.annotations.readOnlyHint ? "notes:read" : "notes:write"] }] }));

const writeTools = new Set(tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name));

/** One tool call: the vault, and how much scan time it spent (charged when it ends). */
type Call = { v: Vault; ctx: ToolContext; scanMs: number };

export async function runTool(name: string, args: Args, ctx: ToolContext): Promise<unknown> {
  if (!tools.some((t) => t.name === name)) throw new ToolError(`Unknown tool ${name}.`);
  if (writeTools.has(name) && !ctx.canWrite) throw new ToolError("This access token is read-only.");
  const claims = JSON.stringify({ sub: ctx.userId, role: "authenticated" });
  // Every call costs one from the account's MCP bucket (600, then 5 a second). Taken in its
  // own transaction so a call that fails still counts: failures are no free way to hammer.
  await ctx.sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    await tx`select public.pane_take('mcp')`;
  }).catch((e) => { throw new ToolError((e as Error).message); });
  const call: Call = { v: ctx.vault, ctx, scanMs: 0 };
  try {
    return await ctx.sql.begin(async (tx) => {
      await tx`select set_config('role', 'authenticated', true),
                      set_config('request.jwt.claims', ${claims}, true),
                      set_config('pane.source', 'mcp', true),
                      set_config('pane.agent', 'mcp', true),
                      set_config('pane.client', ${ctx.client}, true)`;
      return await handlers[name](tx, args, call);
    });
  } finally {
    // Scan time is charged on its own too, so a call that fails after scanning still pays.
    if (call.scanMs > 0) {
      await ctx.sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${claims}, true)`;
        await tx`select public.pane_scan_budget(${call.scanMs}::double precision)`;
      }).catch((e) => log("scan_charge_failed", { tool: name, ...errorKind(e) }));
    }
  }
}

// MARK: Rows and what they hold

type NoteRow = {
  id: string; body_ct?: string | null; head_ct: string; locked_body: string | null; folder_id: string | null; parent_id: string | null;
  is_pinned: boolean; created_at: Date; updated_at: Date; trashed_at: Date | null; version: string;
};
/** A note with its head (title and preview) opened. */
type Note = NoteRow & { title: string; preview?: string };
type FolderRow = { id: string; name: string; parent_id: string | null; sort_index: number };

/** Everything but the body, for lists: bodies can be megabytes. */
const HEAD_COLUMNS = (tx: Tx) => tx`id, head_ct, locked_body, folder_id, parent_id, is_pinned, created_at, updated_at, trashed_at, version`;

const UNREADABLE = "(this note can't be opened here)";

/** A note's title and preview. One that won't open (written with another key) still lists. */
async function withHead(v: Vault, n: NoteRow): Promise<Note> {
  let h: Head;
  try { h = await v.openHead(n.id, n.head_ct); } catch { h = { title: UNREADABLE }; }
  return { ...n, title: h.title, ...(h.preview !== undefined ? { preview: h.preview } : {}) };
}

async function bodyOf(v: Vault, n: { id: string; body_ct?: string | null }): Promise<string> {
  if (!n.body_ct) throw new ToolError(LOCKED);
  try {
    return await v.openBody(n.id, n.body_ct);
  } catch {
    throw new ToolError("This note can't be opened with this connection's key. Connect again from Amber Notes (Settings › Connect an AI).");
  }
}

/** Sub-notes the app doesn't list: those a live parent's text links (pane-note:<id>). */
class Parents {
  private bodies = new Map<string, string | null>();
  /** Some parents weren't opened because the scan ran out of time. */
  incomplete = false;
  constructor(private tx: Tx, private v: Vault, private scan?: Scan) {}

  async hidden(rows: { id: string; parent_id: string | null }[]): Promise<Set<string>> {
    const want = [...new Set(rows.flatMap((r) => (r.parent_id && !this.bodies.has(r.parent_id) ? [r.parent_id] : [])))];
    for (let i = 0; i < want.length; i += 50) {
      if (this.scan?.over) { this.incomplete = true; break; }
      const chunk = want.slice(i, i + 50);
      const found = await this.tx<{ id: string; body_ct: string }[]>`
        select id, body_ct from public.notes
        where id = any(${chunk}::uuid[]) and deleted_at is null and trashed_at is null and body_ct is not null`;
      for (const id of chunk) this.bodies.set(id, null);
      const open = async () => {
        for (const p of found) this.bodies.set(p.id, await this.v.openBody(p.id, p.body_ct).catch(() => null));
      };
      if (this.scan) await this.scan.timed(open); else await open();
    }
    return new Set(rows.filter((r) => r.parent_id && this.bodies.get(r.parent_id)?.includes(`pane-note:${r.id}`)).map((r) => r.id));
  }
}

// MARK: Scans

export const scanLimits = { capMs: 1500, headPage: 500, bodyPage: 50 };
const BUSY = "Another search of your notes is still running. Try again in a moment.";
const SPENT = "Your AI has searched a lot in the last minute. Try again shortly.";

/**
 * A look through every note: one per account at a time, within the account's scan budget
 * (pane_scan_budget), and at most 1.5 seconds. Notes are looked at newest first; when time runs
 * out the scan stops and says how far it got.
 */
class Scan {
  private started = 0;
  private cap = 0;
  private worked = false;
  seen = 0;
  total = 0;
  stopped = false;
  private constructor(private tx: Tx, private call: Call) {}

  static async start(tx: Tx, call: Call): Promise<Scan> {
    const s = new Scan(tx, call);
    await tx`set local lock_timeout = '8s'`;
    try {
      await tx`select pg_advisory_xact_lock(hashtextextended('pane-scan:' || auth.uid()::text, 0))`;
    } catch (e) {
      if ((e as { code?: string }).code === "55P03") throw new ToolError(BUSY);
      throw e;
    }
    await tx`set local lock_timeout = default`;
    const [{ remaining }] = await tx<{ remaining: number }[]>`select public.pane_scan_budget(0::double precision) as remaining`;
    if (!(Number(remaining) > 0)) throw new ToolError(SPENT);
    s.cap = Math.min(scanLimits.capMs, Number(remaining));
    s.started = performance.now();
    return s;
  }

  /** Time is up (something is always looked at first). */
  get over(): boolean {
    return this.worked && performance.now() - this.started >= this.cap;
  }

  /** Runs decrypting and matching work, counting its time against the budget. */
  async timed<T>(fn: () => Promise<T>): Promise<T> {
    const t = performance.now();
    try {
      return await fn();
    } finally {
      this.call.scanMs += performance.now() - t;
      this.worked = true;
    }
  }

  /** Every live note matching `where` (a fresh fragment per query), newest first, in pages, until
   *  time runs out. */
  async notes(where: () => PendingQuery<Row[]>, bodies: boolean, visit: (n: NoteRow) => Promise<void>): Promise<void> {
    const page = bodies ? scanLimits.bodyPage : scanLimits.headPage;
    for (let offset = 0; !this.stopped; offset += page) {
      const rows = await this.tx<NoteRow[]>`
        select ${bodies ? this.tx`*` : HEAD_COLUMNS(this.tx)} from public.notes where deleted_at is null ${where()}
        order by updated_at desc, id desc limit ${page} offset ${offset}`;
      for (const r of rows) {
        if (this.over) { this.stopped = true; break; }
        await this.timed(() => visit(r));
        this.seen++;
      }
      if (rows.length < page) break;
    }
    if (this.stopped) {
      const [{ n }] = await this.tx<{ n: number }[]>`select count(*)::int as n from public.notes where deleted_at is null ${where()}`;
      this.total = n;
    }
  }

  /** How far a scan that stopped got, e.g. "the 1,800 most recently edited notes of 4,100". */
  get searched(): { searched: string } | Record<string, never> {
    if (!this.stopped) return {};
    const f = (n: number) => n.toLocaleString("en-US");
    return { searched: this.seen === 1 ? `the most recently edited note of ${f(this.total)}` : `the ${f(this.seen)} most recently edited notes of ${f(this.total)}` };
  }
}

/** Live notes in the main list, per folder, and all of them newest first. Sub-notes a live parent
 *  links are left out, as in the app. */
async function listedNotes(tx: Tx, call: Call) {
  const scan = await Scan.start(tx, call);
  const live = await tx<{ id: string; folder_id: string | null; parent_id: string | null }[]>`
    select id, folder_id, parent_id from public.notes where deleted_at is null and trashed_at is null order by updated_at desc, id desc`;
  const parents = new Parents(tx, call.v, scan);
  const hidden = await parents.hidden(live);
  const listed = live.filter((n) => !hidden.has(n.id));
  const counts = new Map<string | null, number>();
  for (const n of listed) counts.set(n.folder_id, (counts.get(n.folder_id) ?? 0) + 1);
  return { listed, counts, approximate: parents.incomplete };
}

// MARK: Helpers

/** A note's sub-notes, their sub-notes, and so on. */
async function descendants(tx: Tx, id: string): Promise<string[]> {
  const rows = await tx<{ id: string }[]>`
    with recursive d as (
      select id from public.notes where parent_id = ${id} and deleted_at is null
      union
      select n.id from public.notes n join d on n.parent_id = d.id where n.deleted_at is null
    ) select id from d`;
  return rows.map((r) => r.id);
}

/** A locked note's text is sealed with the user's notes password; here only its title opens. */
export const LOCKED = "This note is locked. Its text is encrypted on the user's devices: it can't be read, searched or changed here. The user can open it in Amber Notes.";

function refuseLocked(n: Note) {
  if (n.locked_body !== null && n.locked_body !== undefined) throw new ToolError(`"${n.title}": ${LOCKED}`);
}

/** A whole number the model sent, or a clear error naming the argument. */
function wholeNumber(v: unknown, name: string): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n)) throw new ToolError(`${name} must be a whole number (got ${JSON.stringify(v)}).`);
  return n;
}

/** Long text quoted back in an error, cut to something readable. */
const quote = (s: string) => JSON.stringify(s.length > 80 ? s.slice(0, 79) + "…" : s);

const bytes = (s: string) => new TextEncoder().encode(s).length;
// About 15k tokens: well inside what Claude and ChatGPT take from one tool call. Longer notes are read in parts.
export const MAX_READ_CHARS = 60_000;
const MAX_NOTE_BYTES = 5_000_000;
// What get_file sends inline: the file itself goes into the model's context.
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

function checkSize(body: string) {
  if (bytes(body) > MAX_NOTE_BYTES) throw new ToolError(`That note would be ${(bytes(body) / 1e6).toFixed(1)} MB; the limit is 5 MB. Split it into several notes.`);
}

function checkFolderName(name: string) {
  if ([...name].length > 200) throw new ToolError("Folder names can be at most 200 characters.");
}

async function folders(tx: Tx, v: Vault): Promise<FolderRow[]> {
  const rows = await tx<{ id: string; name_ct: string; parent_id: string | null; sort_index: number }[]>`
    select id, name_ct, parent_id, sort_index from public.folders where deleted_at is null`;
  const out = await Promise.all(rows.map(async (r) => ({
    id: r.id, parent_id: r.parent_id, sort_index: Number(r.sort_index),
    name: await v.openFolder(r.id, r.name_ct).catch(() => "(can't be opened here)"),
  })));
  return out.sort((a, b) => a.sort_index - b.sort_index || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function pathOf(id: string | null, all: FolderRow[]): string {
  const parts: string[] = [];
  let cur = all.find((f) => f.id === id);
  let guard = 0;
  while (cur && guard++ < 32) {
    parts.unshift(cur.name);
    cur = all.find((f) => f.id === cur!.parent_id);
  }
  return parts.join("/");
}

async function findFolder(tx: Tx, v: Vault, ref: string, create: boolean): Promise<FolderRow> {
  // Two requests creating the same folder at once would otherwise make two of it.
  if (create) await tx`select pg_advisory_xact_lock(hashtextextended('pane-folders:' || auth.uid()::text, 0))`;
  const all = await folders(tx, v);
  const byId = all.find((f) => f.id === ref);
  if (byId) return byId;
  const parts = ref.split("/").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) throw new ToolError("Folder name is empty.");
  // A single name may be nested anywhere; a path must match from the top.
  if (parts.length === 1) {
    const hits = all.filter((f) => f.name.toLowerCase() === parts[0].toLowerCase());
    if (hits.length === 1) return hits[0];
    // Same name at the top level (e.g. two "Notes" after a merge): take the first.
    const top = hits.filter((f) => f.parent_id === null);
    if (top.length >= 1) return top[0];
    if (hits.length > 1) throw new ToolError(`"${ref}" matches several folders: ${hits.map((h) => pathOf(h.id, all)).join(", ")}. Use the full path.`);
  }
  let parent = null as FolderRow | null;
  for (const part of parts) {
    const parentId: string | null = parent?.id ?? null;
    let next: FolderRow | undefined = all.find((f) => f.parent_id === parentId && f.name.toLowerCase() === part.toLowerCase());
    if (!next) {
      if (!create) throw new ToolError(`No folder "${ref}". Folders: ${all.map((f) => pathOf(f.id, all)).join(", ") || "none"}.`);
      checkFolderName(part);
      const id = crypto.randomUUID();
      const [row] = await tx<{ id: string; parent_id: string | null; sort_index: number }[]>`
        insert into public.folders (id, name_ct, parent_id, sort_index)
        values (${id}, ${await v.sealFolder(id, part)}, ${parentId}, ${Date.now() / 1000})
        returning id, parent_id, sort_index`;
      next = { ...row, sort_index: Number(row.sort_index), name: part };
      all.push(next);
    }
    parent = next ?? null;
  }
  return parent!;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findNote(tx: Tx, c: Call, args: Args, includeTrashed = false): Promise<Note> {
  const id = typeof args.id === "string" ? args.id : undefined;
  const title = typeof args.title === "string" ? args.title.trim() : undefined;
  if (id) {
    if (!UUID.test(id)) throw new ToolError(`${quote(id)} isn't a note id. Ids look like 3f2b…-…; get one from search_notes or list_notes.`);
    // Locked for this call: nobody can lock (or change) it between this check and the write.
    const rows = await tx<NoteRow[]>`select * from public.notes where id = ${id}::uuid and deleted_at is null for update`;
    if (!rows.length) throw new ToolError(`No note with id ${id}.`);
    const n = await withHead(c.v, rows[0]);
    if (n.trashed_at && !includeTrashed) throw new ToolError(`"${n.title}" is in Recently Deleted. Restore it with restore_note first.`);
    refuseLocked(n);
    return n;
  }
  if (!title) throw new ToolError("Give the note's id (preferred) or its title.");
  // Titles are sealed: every note's head is opened and compared here.
  const want = title.toLowerCase();
  const hits: Note[] = [], near: Note[] = [];
  const scan = await Scan.start(tx, c);
  await scan.notes(() => tx`and trashed_at is null`, false, async (r) => {
    const n = await withHead(c.v, r);
    const t = n.title.toLowerCase();
    if (t === want) hits.push(n);
    else if (near.length < 5 && t.includes(want)) near.push(n);
  });
  if (hits.length === 1) {
    const [row] = await tx<NoteRow[]>`select * from public.notes where id = ${hits[0].id}::uuid and deleted_at is null and trashed_at is null for update`;
    if (row) {
      const n = await withHead(c.v, row);
      refuseLocked(n);
      return n;
    }
  }
  if (hits.length > 1) throw new ToolError(`${hits.length} notes are titled ${quote(title)}: ${hits.slice(0, 5).map((r) => r.id).join(", ")}. Use an id.`);
  const partly = scan.stopped ? ` (Looked through ${scan.searched.searched}.)` : "";
  throw new ToolError(near.length
    ? `No note titled ${quote(title)}. Close matches: ${near.map((n) => `${n.title} (${n.id})`).join("; ")}.${partly}`
    : `No note titled ${quote(title)}. Try search_notes.${partly}`);
}

function summary(n: Note, all: FolderRow[]) {
  return {
    id: n.id, title: n.title, folder: pathOf(n.folder_id, all), pinned: n.is_pinned, updated: iso(n.updated_at),
    ...(n.locked_body ? { locked: true } : { preview: n.preview ?? "" }),
    ...(n.parent_id ? { sub_note_of: n.parent_id } : {}),
  };
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const clampInt = (v: unknown, def: number, max: number) => Math.max(0, Math.min(max, Number.isFinite(Number(v)) ? Math.floor(Number(v)) : def));

/** Heads of notes by id, in the order given. */
async function notesById(tx: Tx, v: Vault, ids: string[]): Promise<Note[]> {
  if (!ids.length) return [];
  const rows = await tx<NoteRow[]>`select ${HEAD_COLUMNS(tx)} from public.notes where id = any(${ids}::uuid[])`;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return await Promise.all(ids.flatMap((id) => (byId.has(id) ? [withHead(v, byId.get(id)!)] : [])));
}

/**
 * Writes a note's new text, sealed. Text that didn't change isn't written: a new box is a change
 * to the database, which would make a version. A shared note's public copy is rewritten in the
 * same transaction.
 */
async function save(tx: Tx, c: Call, note: Note, before: string, body: string, expected?: unknown) {
  checkSize(body);
  const want = expected !== undefined && expected !== null ? wholeNumber(expected, "expected_version") : undefined;
  if (body === before) {
    if (want !== undefined && want !== Number(note.version)) throw new ToolError(`The note changed since version ${expected}. Read it again and retry.`);
    return { id: note.id, title: note.title, version: Number(note.version), updated: iso(note.updated_at) };
  }
  const head = { title: titleOf(body), preview: previewOf(body) };
  const sameHead = head.title === note.title && head.preview === note.preview;
  const rows = await tx<{ version: string; updated_at: Date }[]>`
    update public.notes set body_ct = ${await c.v.sealBody(note.id, body)},
      head_ct = ${sameHead ? note.head_ct : await c.v.sealHead(note.id, head)}, updated_at = now()
    where id = ${note.id}
      ${want !== undefined ? tx`and version = ${want}` : tx``}
    returning version, updated_at`;
  if (!rows.length) throw new ToolError(`The note changed since version ${expected}. Read it again and retry.`);
  return { id: note.id, title: head.title, version: Number(rows[0].version), updated: iso(rows[0].updated_at) };
}


// A sealed file's bytes beyond its content: "AMB2F", the key id, the nonce and the tag.
const SEALED_FILE_OVERHEAD = 5 + 16 + 12 + 16;

/** A response's body, refused (and the rest cancelled) as soon as it's longer than `cap`. */
export async function readCapped(res: Response, cap: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(res.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > cap) {
    await res.body?.cancel();
    throw new RangeError("too big");
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      await reader.cancel();
      throw new RangeError("too big");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** `which` counts every table in the note from 0, like the app; by default the first tracker (typed table), else the first table. */
function pickTable(body: string, which: unknown): Table {
  const all = findTables(body);
  if (!all.length) throw new ToolError("This note has no table.");
  if (which === undefined || which === null) return all.find((t) => t.typed) ?? all[0];
  const i = wholeNumber(which, "table");
  if (i < 0 || i >= all.length) throw new ToolError(`table ${i} doesn't exist: this note has ${all.length} table${all.length === 1 ? "" : "s"} (0-${all.length - 1}).`);
  return all[i];
}

type Found = Note & { body: string };

/** Search every open note (not locked, not deleted) for `q`, in memory. */
async function searchAll(tx: Tx, c: Call, q: string, limit: number) {
  const keep = searchFilter(q);
  const docs: Found[] = [];
  const scan = await Scan.start(tx, c);
  await scan.notes(() => tx`and trashed_at is null and locked_body is null`, true, async (r) => {
    if (!r.body_ct) return;
    const body = await c.v.openBody(r.id, r.body_ct).catch(() => null);
    if (body === null) return;
    const { body_ct: _, ...rest } = r;
    const n = await withHead(c.v, rest);
    const d = { ...n, body };
    if (keep(d)) docs.push(d);
  });
  const found = await scan.timed(() => Promise.resolve(searchInMemory(q, docs, limit)));
  return { ...found, scan };
}

// MARK: Handlers

const handlers: Record<string, (tx: Tx, a: Args, c: Call) => Promise<unknown>> = {
  async get_overview(tx, _a, c) {
    const all = await folders(tx, c.v);
    const { listed, counts, approximate } = await listedNotes(tx, c);
    const pinnedRows = await tx<NoteRow[]>`select ${HEAD_COLUMNS(tx)} from public.notes where deleted_at is null and trashed_at is null and is_pinned order by updated_at desc limit 20`;
    const pinned = await Promise.all(pinnedRows.map((r) => withHead(c.v, r)));
    const recent = await notesById(tx, c.v, listed.slice(0, 10).map((n) => n.id));
    const [{ trashed }] = await tx<{ trashed: number }[]>`select count(*)::int as trashed from public.notes where deleted_at is null and trashed_at is not null`;
    return {
      total_notes: listed.length,
      folders: all.map((f) => ({ path: pathOf(f.id, all), id: f.id, notes: counts.get(f.id) ?? 0 })),
      pinned: pinned.map((n) => summary(n, all)),
      recently_edited: recent.map((n) => summary(n, all)),
      recently_deleted: trashed,
      ...(approximate ? { counts_approximate: true } : {}),
    };
  },

  async search_notes(tx, a, c) {
    const q = String(a.query ?? "").trim();
    if (!q) throw new ToolError("query is empty.");
    const all = await folders(tx, c.v);
    const { results, broad, scan } = await searchAll(tx, c, q, clampInt(a.limit, 10, 50) || 10);
    // Nothing has every word: say so, and show notes with any of them.
    return {
      query: q, ...(broad ? { no_note_has_every_word: true, searched_for_any_of: broad } : {}),
      ...scan.searched,
      results: results.map(({ doc: n, snippet }) => ({ id: n.id, title: n.title, folder: pathOf(n.folder_id, all), pinned: n.is_pinned, updated: iso(n.updated_at), snippet })),
    };
  },

  async list_notes(tx, a, c) {
    const all = await folders(tx, c.v);
    const folder = typeof a.folder === "string" && a.folder.trim() ? await findFolder(tx, c.v, a.folder, false) : null;
    const trashed = a.recently_deleted === true;
    const limit = clampInt(a.limit, 30, 200) || 30;
    const offset = clampInt(a.offset, 0, 100000);
    const where = () => tx`and ${trashed ? tx`trashed_at is not null` : tx`trashed_at is null`}
      ${folder ? tx`and folder_id = ${folder.id}` : tx``}
      ${a.pinned_only === true ? tx`and is_pinned` : tx``}`;
    const hideSubs = a.include_sub_notes !== true && !trashed;
    let page: Note[];
    let extra = {};
    if (a.sort === "title") {
      // Titles are sealed, so sorting by them means opening every head.
      const scan = await Scan.start(tx, c);
      const got: Note[] = [];
      await scan.notes(where, false, async (r) => { got.push(await withHead(c.v, r)); });
      const hidden = hideSubs ? await new Parents(tx, c.v, scan).hidden(got) : new Set<string>();
      const key = (n: Note) => n.title.toLowerCase();
      page = got.filter((n) => !hidden.has(n.id)).sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0)).slice(offset, offset + limit + 1);
      extra = scan.searched;
    } else {
      const order = () => (a.sort === "created" ? tx`created_at desc, id desc` : tx`is_pinned desc, updated_at desc, id desc`);
      const rows: NoteRow[] = [];
      if (!hideSubs) {
        rows.push(...await tx<NoteRow[]>`select ${HEAD_COLUMNS(tx)} from public.notes where deleted_at is null ${where()} order by ${order()} limit ${limit + 1} offset ${offset}`);
      } else {
        // Which sub-notes are hidden depends on their parents' text: filter here, page by page.
        const parents = new Parents(tx, c.v);
        const batch = Math.max(100, limit + 1);
        let skipped = 0;
        for (let at = 0; rows.length < limit + 1; at += batch) {
          const got = await tx<NoteRow[]>`select ${HEAD_COLUMNS(tx)} from public.notes where deleted_at is null ${where()} order by ${order()} limit ${batch} offset ${at}`;
          const hidden = await parents.hidden(got);
          for (const r of got) {
            if (hidden.has(r.id)) continue;
            if (skipped < offset) { skipped++; continue; }
            rows.push(r);
            if (rows.length === limit + 1) break;
          }
          if (got.length < batch) break;
        }
      }
      page = await Promise.all(rows.map((r) => withHead(c.v, r)));
    }
    return {
      folder: folder ? pathOf(folder.id, all) : "All Notes",
      notes: page.slice(0, limit).map((n) => summary(n, all)),
      next_offset: page.length > limit ? offset + limit : null,
      ...extra,
    };
  },

  async read_note(tx, a, c) {
    const n = await findNote(tx, c, a, true);
    const body = await bodyOf(c.v, n);
    const all = await folders(tx, c.v);
    const o = outline(body);
    const ranged = a.start_line !== undefined || a.end_line !== undefined;
    const start = a.start_line === undefined ? undefined : wholeNumber(a.start_line, "start_line");
    const end = a.end_line === undefined ? undefined : wholeNumber(a.end_line, "end_line");
    if (start !== undefined && start > o.lines) throw new ToolError(`start_line ${start} is past the end: the note has ${o.lines} lines.`);
    if (start !== undefined && end !== undefined && end < start) throw new ToolError("end_line must be at or after start_line.");
    const subRows = await tx<NoteRow[]>`select ${HEAD_COLUMNS(tx)} from public.notes where parent_id = ${n.id} and deleted_at is null and trashed_at is null`;
    const subs = (await Promise.all(subRows.map((r) => withHead(c.v, r)))).map((s) => ({ id: s.id, title: s.title }));
    const parentRow = n.parent_id ? (await notesById(tx, c.v, [n.parent_id]))[0] : undefined;
    const first = Math.max(1, start ?? 1);
    const shown = fitLines(sliceLines(body, start, end, a.line_numbers === true), MAX_READ_CHARS);
    return {
      id: n.id, title: n.title, folder: pathOf(n.folder_id, all), pinned: n.is_pinned,
      created: iso(n.created_at), updated: iso(n.updated_at), version: Number(n.version),
      in_recently_deleted: n.trashed_at !== null,
      parent: parentRow ? { id: parentRow.id, title: parentRow.title } : null,
      sub_notes: subs,
      outline: o,
      ...(shown.truncated
        ? { lines: `${first}-${first + shown.lines - 1}`, truncated: true, next_start_line: first + shown.lines }
        : ranged ? { lines: `${first}-${Math.min(o.lines, end ?? o.lines)}` } : {}),
      markdown: shown.text,
    };
  },

  async create_note(tx, a, c) {
    const body = String(a.body ?? "");
    if (!body.trim()) throw new ToolError("body is empty.");
    checkSize(body);
    const folder = await findFolder(tx, c.v, typeof a.folder === "string" && a.folder.trim() ? a.folder : "Notes", true);
    const all = await folders(tx, c.v);
    const id = crypto.randomUUID();
    const head = { title: titleOf(body), preview: previewOf(body) };
    const [n] = await tx<NoteRow[]>`
      insert into public.notes (id, body_ct, head_ct, folder_id, is_pinned)
      values (${id}, ${await c.v.sealBody(id, body)}, ${await c.v.sealHead(id, head)}, ${folder.id}, ${a.pinned === true})
      returning ${HEAD_COLUMNS(tx)}`;
    return { created: summary({ ...n, ...head }, all), version: Number(n.version) };
  },

  async edit_note(tx, a, c) {
    const n = await findNote(tx, c, a);
    if (!Array.isArray(a.edits) || !a.edits.length) throw new ToolError("edits must be a non-empty list.");
    const before = await bodyOf(c.v, n);
    let body: string;
    try { body = applyEdits(before, a.edits as Edit[]); } catch (e) { throw new ToolError((e as Error).message); }
    if (body === before) return { id: n.id, unchanged: true };
    return { edited: await save(tx, c, n, before, body, a.expected_version), edits_applied: (a.edits as Edit[]).length };
  },

  async append_to_note(tx, a, c) {
    const n = await findNote(tx, c, a);
    const text = String(a.text ?? "");
    if (!text.trim()) throw new ToolError("text is empty.");
    const before = await bodyOf(c.v, n);
    let body: string;
    try { body = appendText(before, text, typeof a.under_heading === "string" ? a.under_heading : undefined, a.at_start === true); } catch (e) { throw new ToolError((e as Error).message); }
    return { appended: await save(tx, c, n, before, body) };
  },

  async replace_note_body(tx, a, c) {
    const n = await findNote(tx, c, a);
    const body = String(a.body ?? "");
    if (!body.trim()) throw new ToolError("body is empty. To remove the note use delete_note.");
    return { replaced: await save(tx, c, n, await bodyOf(c.v, n), body, a.expected_version), previous_version_saved: true };
  },

  async set_checklist_item(tx, a, c) {
    const n = await findNote(tx, c, a);
    const before = await bodyOf(c.v, n);
    let r: { body: string; matched: string };
    try { r = setChecklistItem(before, String(a.item ?? ""), a.checked === true); } catch (e) { throw new ToolError((e as Error).message); }
    if (r.body === before) return { id: n.id, item: r.matched, checked: a.checked === true, unchanged: true };
    await save(tx, c, n, before, r.body);
    return { id: n.id, item: r.matched, checked: a.checked === true };
  },

  async move_note(tx, a, c) {
    const n = await findNote(tx, c, a);
    const f = await findFolder(tx, c.v, String(a.folder ?? ""), true);
    await tx`update public.notes set folder_id = ${f.id}, updated_at = now() where id = ${n.id}`;
    const all = await folders(tx, c.v);
    return { id: n.id, title: n.title, folder: pathOf(f.id, all) };
  },

  async pin_note(tx, a, c) {
    const n = await findNote(tx, c, a);
    await tx`update public.notes set is_pinned = ${a.pinned === true}, updated_at = now() where id = ${n.id}`;
    return { id: n.id, title: n.title, pinned: a.pinned === true };
  },

  async delete_note(tx, a, c) {
    const n = await findNote(tx, c, a);
    // Like the app: a note takes its sub-notes with it.
    const subs = await descendants(tx, n.id);
    await tx`update public.notes set trashed_at = now(), is_pinned = false, updated_at = now()
      where id = any(${[n.id, ...subs]}::uuid[]) and trashed_at is null`;
    return { id: n.id, title: n.title, moved_to: "Recently Deleted", sub_notes_moved: subs.length, restore_with: "restore_note" };
  },

  async restore_note(tx, a, c) {
    const n = await findNote(tx, c, a, true);
    if (!n.trashed_at) return { id: n.id, title: n.title, already_restored: true };
    const all = await folders(tx, c.v);
    const folderOk = n.folder_id && all.some((f) => f.id === n.folder_id);
    const target = folderOk ? n.folder_id : (await findFolder(tx, c.v, "Notes", true)).id;
    await tx`update public.notes set trashed_at = null, folder_id = ${target}, updated_at = now() where id = ${n.id}`;
    const subs = await descendants(tx, n.id);
    const back = await tx`update public.notes set trashed_at = null, updated_at = now()
      where id = any(${subs}::uuid[]) and trashed_at is not null returning id`;
    return { id: n.id, title: n.title, restored_to: pathOf(target, await folders(tx, c.v)), sub_notes_restored: back.length };
  },

  async list_folders(tx, _a, c) {
    const all = await folders(tx, c.v);
    const { counts, approximate } = await listedNotes(tx, c);
    return {
      folders: all.map((f) => ({ path: pathOf(f.id, all), id: f.id, notes: counts.get(f.id) ?? 0 })),
      ...(approximate ? { counts_approximate: true } : {}),
    };
  },

  async create_folder(tx, a, c) {
    const f = await findFolder(tx, c.v, String(a.path ?? ""), true);
    return { id: f.id, path: pathOf(f.id, await folders(tx, c.v)) };
  },

  async rename_folder(tx, a, c) {
    const f = await findFolder(tx, c.v, String(a.folder ?? ""), false);
    const name = String(a.new_name ?? "").trim();
    if (!name || name.includes("/")) throw new ToolError("new_name must be a plain name without '/'.");
    checkFolderName(name);
    if (name !== f.name) await tx`update public.folders set name_ct = ${await c.v.sealFolder(f.id, name)}, updated_at = now() where id = ${f.id}`;
    return { id: f.id, path: pathOf(f.id, await folders(tx, c.v)) };
  },

  async delete_folder(tx, a, c) {
    const f = await findFolder(tx, c.v, String(a.folder ?? ""), false);
    const all = await folders(tx, c.v);
    const ids = [f.id];
    for (let i = 0; i < ids.length; i++) all.filter((x) => x.parent_id === ids[i]).forEach((x) => ids.push(x.id));
    const inFolders = await tx<{ id: string }[]>`select id from public.notes where folder_id = any(${ids}::uuid[]) and trashed_at is null and deleted_at is null`;
    // Sub-notes go with their parents even when they sit in another folder.
    const all_ids = new Set(inFolders.map((r) => r.id));
    for (const r of inFolders) for (const d of await descendants(tx, r.id)) all_ids.add(d);
    const trashed = await tx`update public.notes set trashed_at = now(), is_pinned = false, updated_at = now()
      where id = any(${[...all_ids]}::uuid[]) and trashed_at is null and deleted_at is null returning id`;
    await tx`update public.folders set deleted_at = now(), updated_at = now() where id = any(${ids}::uuid[])`;
    return { deleted_folders: ids.length, notes_moved_to_recently_deleted: trashed.length };
  },

  async note_history(tx, a, c) {
    const n = await findNote(tx, c, a, true);
    const rows = await tx<{ id: string; version: string; source: string; client: string | null; created_at: Date; body_ct: string | null; head_ct: string | null; locked_body: string | null }[]>`
      select id, version, source, client, created_at, body_ct, head_ct, locked_body from public.note_revisions where note_id = ${n.id}
      order by id desc limit ${clampInt(a.limit, 10, 50) || 10}`;
    const revisions = [];
    for (const r of rows) {
      const title = r.head_ct ? (await withHead(c.v, { ...n, head_ct: r.head_ct })).title : "New Note";
      const base = { revision_id: Number(r.id), version: Number(r.version), replaced_at: iso(r.created_at), replaced_by: r.client ?? r.source, title };
      if (r.locked_body !== null || !r.body_ct) { revisions.push({ ...base, locked: true }); continue; }
      const body = await c.v.openBody(n.id, r.body_ct).catch(() => null);
      revisions.push(body === null ? { ...base, unreadable: true } : { ...base, preview: previewOf(body, 100), characters: body.length });
    }
    return { id: n.id, title: n.title, current_version: Number(n.version), revisions };
  },

  async restore_revision(tx, a, c) {
    const n = await findNote(tx, c, a, true);
    const rows = await tx<{ body_ct: string | null; head_ct: string | null; locked_body: string | null }[]>`
      select body_ct, head_ct, locked_body from public.note_revisions where id = ${wholeNumber(a.revision_id, "revision_id")} and note_id = ${n.id}`;
    if (!rows.length) throw new ToolError("No such revision for this note. Use note_history.");
    const r = rows[0];
    if (r.locked_body !== null || !r.body_ct || !r.head_ct) throw new ToolError("That version was saved while the note was locked, so its text is encrypted. The user can restore it in Amber Notes.");
    // Opened to check it opens; the version's boxes go back as they are.
    await bodyOf(c.v, { id: n.id, body_ct: r.body_ct });
    const { title } = await withHead(c.v, { ...n, head_ct: r.head_ct });
    await tx`select set_config('pane.source', 'restore', true)`;
    const [done] = await tx<{ version: string; updated_at: Date }[]>`
      update public.notes set body_ct = ${r.body_ct}, head_ct = ${r.head_ct}, updated_at = now() where id = ${n.id}
      returning version, updated_at`;
    return { restored: { id: n.id, title, version: Number(done.version), updated: iso(done.updated_at) } };
  },

  async create_sub_note(tx, a, c) {
    const parent = await findNote(tx, c, a);
    const body = String(a.body ?? "");
    if (!body.trim()) throw new ToolError("body is empty.");
    checkSize(body);
    const before = await bodyOf(c.v, parent);
    const id = crypto.randomUUID();
    const head = { title: titleOf(body), preview: previewOf(body) };
    const link = `[${head.title.replace(/[\[\]]/g, "")}](pane-note:${id})`;
    let updated: string;
    try { updated = appendText(before, link, typeof a.under_heading === "string" ? a.under_heading : undefined); } catch (e) { throw new ToolError((e as Error).message); }
    await tx`
      insert into public.notes (id, body_ct, head_ct, folder_id, parent_id)
      values (${id}, ${await c.v.sealBody(id, body)}, ${await c.v.sealHead(id, head)}, ${parent.folder_id}, ${parent.id})`;
    await save(tx, c, parent, before, updated);
    return { created: { id, title: head.title, parent: { id: parent.id, title: parent.title } } };
  },

  async list_files(tx, a, c) {
    const q = typeof a.query === "string" ? a.query.trim().toLowerCase() : "";
    const limit = clampInt(a.limit, 30, 200) || 30;
    const scan = await Scan.start(tx, c);
    const rows = await tx<{ id: string; meta_ct: string; size: string; created_at: Date }[]>`
      select id, meta_ct, size, created_at from public.attachments where deleted_at is null order by created_at desc`;
    const files: { id: string; filename: string; type: string; bytes: number; added: string | null; in_notes: { id: string; title: string }[] }[] = [];
    await scan.timed(async () => {
      for (const r of rows) {
        const meta = await c.v.openFileMeta(r.id, r.meta_ct).catch(() => null);
        if (!meta || (q && !meta.name.toLowerCase().includes(q))) continue;
        files.push({ id: r.id, filename: meta.name, type: mimeOf(meta.type, meta.name), bytes: Number(r.size), added: iso(r.created_at), in_notes: [] });
        if (files.length >= limit) break;
      }
    });
    if (files.length) {
      // Which notes embed each file: their text is sealed too, so it's opened and looked through.
      await scan.notes(() => tx``, true, async (r) => {
        if (!r.body_ct) return;
        const body = await c.v.openBody(r.id, r.body_ct).catch(() => "");
        if (!body.includes("pane-file:")) return;
        for (const f of files) {
          if (f.in_notes.length < 5 && body.includes(`pane-file:${f.id}`)) f.in_notes.push({ id: r.id, title: (await withHead(c.v, r)).title });
        }
      });
    }
    return { files, ...scan.searched };
  },

  async get_file(tx, a, c) {
    const id = String(a.id ?? "").replace(/^pane-file:/, "");
    if (!UUID.test(id)) throw new ToolError(`No file with id ${id}. Use list_files.`);
    const rows = await tx<{ id: string; meta_ct: string; size: string; storage_path: string }[]>`
      select id, meta_ct, size, storage_path from public.attachments where id = ${id}::uuid and deleted_at is null`;
    if (!rows.length) throw new ToolError(`No file with id ${id}. Use list_files.`);
    const f = rows[0];
    const meta = await c.v.openFileMeta(f.id, f.meta_ct).catch(() => { throw new ToolError("This file can't be opened here. The user can open it in Amber Notes."); });
    const tooBig = () => new ToolError(`"${meta.name}" is ${(Math.max(Number(f.size), meta.size ?? 0) / 1048576).toFixed(1)} MB. Files over 8 MB can't be sent here; the user can open it in Amber Notes.`);
    if (Math.max(Number(f.size), meta.size ?? 0) > MAX_FILE_BYTES) throw tooBig();
    // The row was read under RLS, so this path belongs to the caller. The service key goes in a
    // header, never in an address; the object is sealed and only this request's vault opens it.
    const base = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const res = await fetch(`${base}/storage/v1/object/files/${f.storage_path.split("/").map(encodeURIComponent).join("/")}`, {
      headers: { authorization: `Bearer ${key}`, apikey: key },
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new ToolError("The file isn't uploaded yet. Open Amber Notes on the device that added it so it can sync.");
    }
    // The stored size was checked above; the object itself is held to the same cap (plus the box's
    // header and tag), by its length and by counting what's read, so a bigger one is never read whole.
    const sealed = await readCapped(res, MAX_FILE_BYTES + SEALED_FILE_OVERHEAD).catch(() => { throw tooBig(); });
    let plain: Uint8Array<ArrayBuffer>;
    try { plain = await c.v.openFile(f.id, sealed); } catch { throw new ToolError("This file can't be opened here. The user can open it in Amber Notes."); }
    const type = mimeOf(meta.type, meta.name);
    const details: Record<string, unknown> = { id: f.id, filename: meta.name, type, bytes: plain.length };
    let block: Record<string, unknown>;
    if (isTextType(type)) {
      const text = new TextDecoder().decode(plain);
      const cut = text.length > MAX_READ_CHARS;
      if (cut) Object.assign(details, { truncated: true, shown_characters: MAX_READ_CHARS, total_characters: text.length });
      block = { type: "text", text: cut ? text.slice(0, MAX_READ_CHARS) : text };
    } else if (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(type)) {
      block = { type: "image", data: toBase64(plain), mimeType: type };
    } else {
      block = { type: "resource", resource: { uri: `pane-file:${f.id}`, mimeType: type, blob: toBase64(plain) } };
    }
    plain.fill(0);
    return new Content([{ type: "text", text: JSON.stringify(details, null, 2) }, block], details);
  },

  async read_table(tx, a, c) {
    const n = await findNote(tx, c, a);
    const t = pickTable(await bodyOf(c.v, n), a.table);
    const rows = t.rows.map((r) => Object.fromEntries(t.columns.map((col, i) => [col.name, r[i]])));
    const last = clampInt(a.last, 0, 10000);
    return {
      note: { id: n.id, title: n.title },
      columns: t.columns.map((col) => ({ name: col.name, type: typeSpec(col.type) })),
      rows: last ? rows.slice(-last) : rows,
      total_rows: rows.length,
    };
  },

  async log_table_row(tx, a, c) {
    const n = await findNote(tx, c, a);
    const before = await bodyOf(c.v, n);
    const t = pickTable(before, a.table);
    const values = (a.values ?? {}) as Record<string, unknown>;
    const byName = new Map(t.columns.map((col, i) => [col.name.toLowerCase(), i]));
    const unknown = Object.keys(values).filter((k) => !byName.has(k.toLowerCase()));
    if (unknown.length) throw new ToolError(`Unknown column(s): ${unknown.join(", ")}. Columns: ${t.columns.map((col) => col.name).join(", ")}.`);
    // "Today" is the owner's local day (PANE_TIMEZONE, default Europe/Stockholm), not UTC.
    const tz = Deno.env.get("PANE_TIMEZONE") ?? "Europe/Stockholm";
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const dateCol = t.columns.findIndex((col) => col.type.kind === "date");
    let row: string[] = t.columns.map(() => "");
    let updated = false;
    try {
      const incoming = new Map<number, string>();
      for (const [k, v] of Object.entries(values)) {
        const i = byName.get(k.toLowerCase())!;
        incoming.set(i, coerce(v, t.columns[i], today));
      }
      if (dateCol >= 0 && !incoming.get(dateCol)) incoming.set(dateCol, today);
      const existing = dateCol >= 0 ? t.rows.findIndex((r) => r[dateCol] === incoming.get(dateCol)) : -1;
      if (existing >= 0) { row = [...t.rows[existing]]; updated = true; }
      for (const [i, v] of incoming) row[i] = v;
      if (existing >= 0) t.rows[existing] = row; else t.rows.push(row);
      if (dateCol >= 0) t.rows.sort((x, y) => x[dateCol].localeCompare(y[dateCol]));
    } catch (e) { throw new ToolError((e as Error).message); }
    await save(tx, c, n, before, replaceTable(before, t));
    return { note: n.title, [updated ? "updated_row" : "added_row"]: Object.fromEntries(t.columns.map((col, i) => [col.name, row[i]])) };
  },

  async delete_table_row(tx, a, c) {
    const n = await findNote(tx, c, a);
    const before = await bodyOf(c.v, n);
    const t = pickTable(before, a.table);
    const dateCol = t.columns.findIndex((col) => col.type.kind === "date");
    const i = typeof a.date === "string" && dateCol >= 0 ? t.rows.findIndex((r) => r[dateCol] === a.date) : Number.isInteger(a.index) ? Number(a.index) : -1;
    if (i < 0 || i >= t.rows.length) throw new ToolError("No such row. Use read_table to see dates and indexes.");
    const [gone] = t.rows.splice(i, 1);
    await save(tx, c, n, before, replaceTable(before, t));
    return { deleted_row: Object.fromEntries(t.columns.map((col, k) => [col.name, gone[k]])) };
  },

  async search(tx, a, c) {
    const q = String(a.query ?? "").trim();
    if (!q) return { results: [] };
    const { results, scan } = await searchAll(tx, c, q, 10);
    return { results: results.map(({ doc: n }) => ({ id: n.id, title: n.title })), ...scan.searched };
  },

  async fetch(tx, a, c) {
    const n = await findNote(tx, c, { id: a.id }, true);
    const body = await bodyOf(c.v, n);
    const all = await folders(tx, c.v);
    const shown = fitLines(body, MAX_READ_CHARS);
    return {
      id: n.id, title: n.title, text: shown.text,
      metadata: {
        folder: pathOf(n.folder_id, all), pinned: n.is_pinned, updated: iso(n.updated_at),
        ...(shown.truncated ? { truncated: true, next_start_line: shown.lines + 1, rest: "read_note with start_line" } : {}),
      },
    };
  },
};
