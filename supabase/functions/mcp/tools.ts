// The note tools. Each runs in a transaction as the token's owner (RLS applies).

import type { Sql, TransactionSql } from "npm:postgres@3.4.5";
import { appendText, applyEdits, coerce, findTables, outline, previewOf, replaceTable, setChecklistItem, sliceLines, titleOf, typeSpec, type Edit, type Table } from "./notes.ts";

export type ToolContext = { sql: Sql; userId: string; client: string; canWrite: boolean };
export class ToolError extends Error {}

type Tx = TransactionSql;
type Args = Record<string, unknown>;
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: false };
};

const str = (d: string) => ({ type: "string", description: d });
const int = (d: string) => ({ type: "integer", description: d });
const bool = (d: string) => ({ type: "boolean", description: d });
const noteRef = {
  id: str("Note id (preferred)."),
  title: str("Note title, if you don't have the id. Must match one note."),
};
const read = { readOnlyHint: true, openWorldHint: false } as const;
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

export const tools: Tool[] = [
  {
    name: "get_overview", title: "Overview of the notes",
    description: "Start here. Folders with counts, pinned notes and the most recently edited notes.",
    inputSchema: { type: "object", properties: {} }, annotations: read,
  },
  {
    name: "search_notes", title: "Search notes",
    description: "Full-text search across titles and bodies. Returns ranked notes with a highlighted snippet («match»).",
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
    annotations: write,
  },
  {
    name: "append_to_note", title: "Add to a note",
    description: "Adds markdown to the end of a note, or to the end (or start) of the section under a heading. Good for logs, lists and journals.",
    inputSchema: { type: "object", properties: { ...noteRef, text: str("Markdown to add."), under_heading: str("Heading text whose section gets the text."), at_start: bool("Add at the start of the note/section instead of the end.") }, required: ["text"] },
    annotations: write,
  },
  {
    name: "replace_note_body", title: "Rewrite a note",
    description: "Replaces the whole note with new markdown. Use only for full rewrites; prefer edit_note. The old version stays in history.",
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
    description: "Moves a note and its sub-notes to Recently Deleted (kept 30 days, restorable with restore_note).",
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
    description: "Deletes a folder and its sub-folders; their notes (and those notes' sub-notes) go to Recently Deleted.",
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
    annotations: write,
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
    description: "Details of a file and a download link valid for 10 minutes, so you can fetch and read it (PDF, spreadsheet, image…).",
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
    annotations: write,
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
    description: "Search the user's notes by words or phrases. Returns note ids, titles and links; read one with fetch.",
    inputSchema: { type: "object", properties: { query: str("Search query.") }, required: ["query"] },
    annotations: read,
  },
  {
    name: "fetch", title: "Fetch",
    description: "Fetch a note by id (from search) as its full markdown, with folder, pinned state and last edit time.",
    inputSchema: { type: "object", properties: { id: str("Note id.") }, required: ["id"] },
    annotations: read,
  },
];

const writeTools = new Set(tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name));

export async function runTool(name: string, args: Args, ctx: ToolContext): Promise<unknown> {
  if (!tools.some((t) => t.name === name)) throw new ToolError(`Unknown tool ${name}.`);
  if (writeTools.has(name) && !ctx.canWrite) throw new ToolError("This access token is read-only.");
  return await ctx.sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true),
                    set_config('request.jwt.claims', ${JSON.stringify({ sub: ctx.userId, role: "authenticated" })}, true),
                    set_config('pane.source', 'mcp', true),
                    set_config('pane.client', ${ctx.client}, true)`;
    return await handlers[name](tx, args, ctx);
  });
}

// MARK: Helpers

type NoteRow = { id: string; body: string; title: string; folder_id: string | null; parent_id: string | null; is_pinned: boolean; created_at: Date; updated_at: Date; trashed_at: Date | null; version: string };
type FolderRow = { id: string; name: string; parent_id: string | null; sort_index: number };

/** Notes the app shows in its list: everything except sub-notes still linked from a live parent. */
function listed(tx: Tx) {
  return tx`and not exists (
    select 1 from public.notes p
    where p.id = notes.parent_id and p.deleted_at is null and p.trashed_at is null
      and strpos(p.body, 'pane-note:' || notes.id::text) > 0)`;
}

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

/** A whole number the model sent, or a clear error naming the argument. */
function wholeNumber(v: unknown, name: string): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n)) throw new ToolError(`${name} must be a whole number (got ${JSON.stringify(v)}).`);
  return n;
}

/** Long text quoted back in an error, cut to something readable. */
const quote = (s: string) => JSON.stringify(s.length > 80 ? s.slice(0, 79) + "…" : s);

const bytes = (s: string) => new TextEncoder().encode(s).length;
const MAX_NOTE_BYTES = 5_000_000;

function checkSize(body: string) {
  if (bytes(body) > MAX_NOTE_BYTES) throw new ToolError(`That note would be ${(bytes(body) / 1e6).toFixed(1)} MB; the limit is 5 MB. Split it into several notes.`);
}

function checkFolderName(name: string) {
  if ([...name].length > 200) throw new ToolError("Folder names can be at most 200 characters.");
}

/** LIKE pattern that treats %, _ and \ in the text literally. */
const likeText = (s: string) => "%" + s.replace(/[\\%_]/g, (c) => "\\" + c) + "%";

async function folders(tx: Tx): Promise<FolderRow[]> {
  return await tx<FolderRow[]>`select id, name, parent_id, sort_index from public.folders where deleted_at is null order by sort_index, name`;
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

async function findFolder(tx: Tx, ref: string, create: boolean): Promise<FolderRow> {
  // Two requests creating the same folder at once would otherwise make two of it.
  if (create) await tx`select pg_advisory_xact_lock(hashtextextended('pane-folders:' || auth.uid()::text, 0))`;
  const all = await folders(tx);
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
      const rows: FolderRow[] = await tx<FolderRow[]>`
        insert into public.folders (id, name, parent_id, sort_index)
        values (${crypto.randomUUID()}, ${part}, ${parentId}, ${Date.now() / 1000})
        returning id, name, parent_id, sort_index`;
      all.push(rows[0]);
      next = rows[0];
    }
    parent = next ?? null;
  }
  return parent!;
}

async function findNote(tx: Tx, args: Args, includeTrashed = false): Promise<NoteRow> {
  const id = typeof args.id === "string" ? args.id : undefined;
  const title = typeof args.title === "string" ? args.title.trim() : undefined;
  if (id) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new ToolError(`${quote(id)} isn't a note id. Ids look like 3f2b…-…; get one from search_notes or list_notes.`);
    const rows = await tx<NoteRow[]>`select * from public.notes where id = ${id}::uuid and deleted_at is null`;
    if (!rows.length) throw new ToolError(`No note with id ${id}.`);
    if (rows[0].trashed_at && !includeTrashed) throw new ToolError(`"${rows[0].title}" is in Recently Deleted. Restore it with restore_note first.`);
    return rows[0];
  }
  if (!title) throw new ToolError("Give the note's id (preferred) or its title.");
  const rows = await tx<NoteRow[]>`select * from public.notes where deleted_at is null and trashed_at is null and lower(title) = lower(${title}) order by updated_at desc limit 5`;
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) throw new ToolError(`${rows.length} notes are titled ${quote(title)}: ${rows.map((r) => r.id).join(", ")}. Use an id.`);
  const near = await tx<{ id: string; title: string }[]>`select id, title from public.notes where deleted_at is null and trashed_at is null and title ilike ${likeText(title)} order by updated_at desc limit 5`;
  throw new ToolError(near.length ? `No note titled ${quote(title)}. Close matches: ${near.map((n) => `${n.title} (${n.id})`).join("; ")}.` : `No note titled ${quote(title)}. Try search_notes.`);
}

function summary(n: NoteRow, all: FolderRow[]) {
  return {
    id: n.id, title: n.title, folder: pathOf(n.folder_id, all), pinned: n.is_pinned, updated: iso(n.updated_at), preview: previewOf(n.body),
    ...(n.parent_id ? { sub_note_of: n.parent_id } : {}),
  };
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const clampInt = (v: unknown, def: number, max: number) => Math.max(0, Math.min(max, Number.isFinite(Number(v)) ? Math.floor(Number(v)) : def));

async function save(tx: Tx, note: NoteRow, body: string, expected?: unknown) {
  checkSize(body);
  const rows = await tx<{ version: string; updated_at: Date }[]>`
    update public.notes set body = ${body}, updated_at = now()
    where id = ${note.id}
      ${expected !== undefined && expected !== null ? tx`and version = ${wholeNumber(expected, "expected_version")}` : tx``}
    returning version, updated_at`;
  if (!rows.length) throw new ToolError(`The note changed since version ${expected}. Read it again and retry.`);
  return { id: note.id, title: titleOf(body), version: Number(rows[0].version), updated: iso(rows[0].updated_at) };
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

// MARK: Handlers

const handlers: Record<string, (tx: Tx, a: Args, ctx: ToolContext) => Promise<unknown>> = {
  async get_overview(tx) {
    const all = await folders(tx);
    const counts = await tx<{ folder_id: string | null; n: number }[]>`
      select folder_id, count(*)::int as n from public.notes where deleted_at is null and trashed_at is null ${listed(tx)} group by folder_id`;
    const pinned = await tx<NoteRow[]>`select * from public.notes where deleted_at is null and trashed_at is null and is_pinned order by updated_at desc limit 20`;
    const recent = await tx<NoteRow[]>`select * from public.notes where deleted_at is null and trashed_at is null ${listed(tx)} order by updated_at desc limit 10`;
    const [{ trashed }] = await tx<{ trashed: number }[]>`select count(*)::int as trashed from public.notes where deleted_at is null and trashed_at is not null`;
    return {
      total_notes: counts.reduce((s, c) => s + c.n, 0),
      folders: all.map((f) => ({ path: pathOf(f.id, all), id: f.id, notes: counts.find((c) => c.folder_id === f.id)?.n ?? 0 })),
      pinned: pinned.map((n) => summary(n, all)),
      recently_edited: recent.map((n) => summary(n, all)),
      recently_deleted: trashed,
    };
  },

  async search_notes(tx, a) {
    const q = String(a.query ?? "").trim();
    if (!q) throw new ToolError("query is empty.");
    const all = await folders(tx);
    const rows = await tx<{ id: string; title: string; folder_id: string | null; is_pinned: boolean; updated_at: Date; snippet: string; rank: number }[]>`
      select s.*, n.is_pinned from public.search_notes(${q}, ${clampInt(a.limit, 10, 50) || 10}) s join public.notes n on n.id = s.id order by s.rank desc`;
    return { query: q, results: rows.map((r) => ({ id: r.id, title: r.title, folder: pathOf(r.folder_id, all), pinned: r.is_pinned, updated: iso(r.updated_at), snippet: r.snippet })) };
  },

  async list_notes(tx, a) {
    const all = await folders(tx);
    const folder = typeof a.folder === "string" && a.folder.trim() ? await findFolder(tx, a.folder, false) : null;
    const trashed = a.recently_deleted === true;
    const limit = clampInt(a.limit, 30, 200) || 30;
    const offset = clampInt(a.offset, 0, 100000);
    const order = a.sort === "title" ? tx`lower(title) asc` : a.sort === "created" ? tx`created_at desc` : tx`is_pinned desc, updated_at desc`;
    const rows = await tx<NoteRow[]>`
      select * from public.notes where deleted_at is null
        and ${trashed ? tx`trashed_at is not null` : tx`trashed_at is null`}
        ${folder ? tx`and folder_id = ${folder.id}` : tx``}
        ${a.pinned_only === true ? tx`and is_pinned` : tx``}
        ${a.include_sub_notes === true || trashed ? tx`` : listed(tx)}
      order by ${order} limit ${limit + 1} offset ${offset}`;
    return {
      folder: folder ? pathOf(folder.id, all) : "All Notes",
      notes: rows.slice(0, limit).map((n) => summary(n, all)),
      next_offset: rows.length > limit ? offset + limit : null,
    };
  },

  async read_note(tx, a) {
    const n = await findNote(tx, a, true);
    const all = await folders(tx);
    const o = outline(n.body);
    const ranged = a.start_line !== undefined || a.end_line !== undefined;
    const start = a.start_line === undefined ? undefined : wholeNumber(a.start_line, "start_line");
    const end = a.end_line === undefined ? undefined : wholeNumber(a.end_line, "end_line");
    if (start !== undefined && start > o.lines) throw new ToolError(`start_line ${start} is past the end: the note has ${o.lines} lines.`);
    if (start !== undefined && end !== undefined && end < start) throw new ToolError("end_line must be at or after start_line.");
    const subs = await tx<{ id: string; title: string }[]>`select id, title from public.notes where parent_id = ${n.id} and deleted_at is null and trashed_at is null`;
    const parentRow = n.parent_id ? (await tx<{ id: string; title: string }[]>`select id, title from public.notes where id = ${n.parent_id}`)[0] : undefined;
    return {
      id: n.id, title: n.title, folder: pathOf(n.folder_id, all), pinned: n.is_pinned,
      created: iso(n.created_at), updated: iso(n.updated_at), version: Number(n.version),
      in_recently_deleted: n.trashed_at !== null,
      parent: parentRow ?? null,
      sub_notes: subs,
      outline: o,
      ...(ranged ? { lines: `${Math.max(1, start ?? 1)}-${Math.min(o.lines, end ?? o.lines)}` } : {}),
      markdown: sliceLines(n.body, start, end, a.line_numbers === true),
    };
  },

  async create_note(tx, a) {
    const body = String(a.body ?? "");
    if (!body.trim()) throw new ToolError("body is empty.");
    checkSize(body);
    const folder = await findFolder(tx, typeof a.folder === "string" && a.folder.trim() ? a.folder : "Notes", true);
    const all = await folders(tx);
    const [n] = await tx<NoteRow[]>`
      insert into public.notes (id, body, folder_id, is_pinned)
      values (${crypto.randomUUID()}, ${body}, ${folder.id}, ${a.pinned === true})
      returning *`;
    return { created: summary(n, all), version: Number(n.version) };
  },

  async edit_note(tx, a) {
    const n = await findNote(tx, a);
    if (!Array.isArray(a.edits) || !a.edits.length) throw new ToolError("edits must be a non-empty list.");
    let body: string;
    try { body = applyEdits(n.body, a.edits as Edit[]); } catch (e) { throw new ToolError((e as Error).message); }
    if (body === n.body) return { id: n.id, unchanged: true };
    return { edited: await save(tx, n, body, a.expected_version), edits_applied: (a.edits as Edit[]).length };
  },

  async append_to_note(tx, a) {
    const n = await findNote(tx, a);
    const text = String(a.text ?? "");
    if (!text.trim()) throw new ToolError("text is empty.");
    let body: string;
    try { body = appendText(n.body, text, typeof a.under_heading === "string" ? a.under_heading : undefined, a.at_start === true); } catch (e) { throw new ToolError((e as Error).message); }
    return { appended: await save(tx, n, body) };
  },

  async replace_note_body(tx, a) {
    const n = await findNote(tx, a);
    const body = String(a.body ?? "");
    if (!body.trim()) throw new ToolError("body is empty. To remove the note use delete_note.");
    return { replaced: await save(tx, n, body, a.expected_version), previous_version_saved: true };
  },

  async set_checklist_item(tx, a) {
    const n = await findNote(tx, a);
    let r: { body: string; matched: string };
    try { r = setChecklistItem(n.body, String(a.item ?? ""), a.checked === true); } catch (e) { throw new ToolError((e as Error).message); }
    if (r.body === n.body) return { id: n.id, item: r.matched, checked: a.checked === true, unchanged: true };
    await save(tx, n, r.body);
    return { id: n.id, item: r.matched, checked: a.checked === true };
  },

  async move_note(tx, a) {
    const n = await findNote(tx, a);
    const f = await findFolder(tx, String(a.folder ?? ""), true);
    await tx`update public.notes set folder_id = ${f.id}, updated_at = now() where id = ${n.id}`;
    const all = await folders(tx);
    return { id: n.id, title: n.title, folder: pathOf(f.id, all) };
  },

  async pin_note(tx, a) {
    const n = await findNote(tx, a);
    await tx`update public.notes set is_pinned = ${a.pinned === true}, updated_at = now() where id = ${n.id}`;
    return { id: n.id, title: n.title, pinned: a.pinned === true };
  },

  async delete_note(tx, a) {
    const n = await findNote(tx, a);
    // Like the app: a note takes its sub-notes with it.
    const subs = await descendants(tx, n.id);
    await tx`update public.notes set trashed_at = now(), is_pinned = false, updated_at = now()
      where id = any(${[n.id, ...subs]}::uuid[]) and trashed_at is null`;
    return { id: n.id, title: n.title, moved_to: "Recently Deleted", sub_notes_moved: subs.length, restore_with: "restore_note" };
  },

  async restore_note(tx, a) {
    const n = await findNote(tx, a, true);
    if (!n.trashed_at) return { id: n.id, title: n.title, already_restored: true };
    const all = await folders(tx);
    const folderOk = n.folder_id && all.some((f) => f.id === n.folder_id);
    const target = folderOk ? n.folder_id : (await findFolder(tx, "Notes", true)).id;
    await tx`update public.notes set trashed_at = null, folder_id = ${target}, updated_at = now() where id = ${n.id}`;
    const subs = await descendants(tx, n.id);
    const back = await tx`update public.notes set trashed_at = null, updated_at = now()
      where id = any(${subs}::uuid[]) and trashed_at is not null returning id`;
    return { id: n.id, title: n.title, restored_to: pathOf(target, await folders(tx)), sub_notes_restored: back.length };
  },

  async list_folders(tx) {
    const all = await folders(tx);
    const counts = await tx<{ folder_id: string; n: number }[]>`
      select folder_id, count(*)::int as n from public.notes where deleted_at is null and trashed_at is null ${listed(tx)} group by folder_id`;
    return { folders: all.map((f) => ({ path: pathOf(f.id, all), id: f.id, notes: counts.find((c) => c.folder_id === f.id)?.n ?? 0 })) };
  },

  async create_folder(tx, a) {
    const f = await findFolder(tx, String(a.path ?? ""), true);
    return { id: f.id, path: pathOf(f.id, await folders(tx)) };
  },

  async rename_folder(tx, a) {
    const f = await findFolder(tx, String(a.folder ?? ""), false);
    const name = String(a.new_name ?? "").trim();
    if (!name || name.includes("/")) throw new ToolError("new_name must be a plain name without '/'.");
    checkFolderName(name);
    await tx`update public.folders set name = ${name}, updated_at = now() where id = ${f.id}`;
    return { id: f.id, path: pathOf(f.id, await folders(tx)) };
  },

  async delete_folder(tx, a) {
    const f = await findFolder(tx, String(a.folder ?? ""), false);
    const all = await folders(tx);
    const ids = [f.id];
    for (let i = 0; i < ids.length; i++) all.filter((c) => c.parent_id === ids[i]).forEach((c) => ids.push(c.id));
    const inFolders = await tx<{ id: string }[]>`select id from public.notes where folder_id = any(${ids}::uuid[]) and trashed_at is null and deleted_at is null`;
    // Sub-notes go with their parents even when they sit in another folder.
    const all_ids = new Set(inFolders.map((r) => r.id));
    for (const r of inFolders) for (const d of await descendants(tx, r.id)) all_ids.add(d);
    const trashed = await tx`update public.notes set trashed_at = now(), is_pinned = false, updated_at = now()
      where id = any(${[...all_ids]}::uuid[]) and trashed_at is null and deleted_at is null returning id`;
    await tx`update public.folders set deleted_at = now(), updated_at = now() where id = any(${ids}::uuid[])`;
    return { deleted_folders: ids.length, notes_moved_to_recently_deleted: trashed.length };
  },

  async note_history(tx, a) {
    const n = await findNote(tx, a, true);
    const rows = await tx<{ id: string; version: string; source: string; client: string | null; created_at: Date; body: string }[]>`
      select id, version, source, client, created_at, body from public.note_revisions where note_id = ${n.id}
      order by id desc limit ${clampInt(a.limit, 10, 50) || 10}`;
    return {
      id: n.id, title: n.title, current_version: Number(n.version),
      revisions: rows.map((r) => ({ revision_id: Number(r.id), version: Number(r.version), replaced_at: iso(r.created_at), replaced_by: r.client ?? r.source, title: titleOf(r.body), preview: previewOf(r.body, 100), characters: r.body.length })),
    };
  },

  async restore_revision(tx, a) {
    const n = await findNote(tx, a, true);
    const rows = await tx<{ body: string }[]>`select body from public.note_revisions where id = ${wholeNumber(a.revision_id, "revision_id")} and note_id = ${n.id}`;
    if (!rows.length) throw new ToolError("No such revision for this note. Use note_history.");
    await tx`select set_config('pane.source', 'restore', true)`;
    return { restored: await save(tx, n, rows[0].body) };
  },

  async create_sub_note(tx, a) {
    const parent = await findNote(tx, a);
    const body = String(a.body ?? "");
    if (!body.trim()) throw new ToolError("body is empty.");
    checkSize(body);
    const [child] = await tx<NoteRow[]>`
      insert into public.notes (id, body, folder_id, parent_id)
      values (${crypto.randomUUID()}, ${body}, ${parent.folder_id}, ${parent.id})
      returning *`;
    const link = `[${titleOf(body).replace(/[\[\]]/g, "")}](pane-note:${child.id})`;
    let updated: string;
    try { updated = appendText(parent.body, link, typeof a.under_heading === "string" ? a.under_heading : undefined); } catch (e) { throw new ToolError((e as Error).message); }
    await save(tx, parent, updated);
    return { created: { id: child.id, title: titleOf(body), parent: { id: parent.id, title: parent.title } } };
  },

  async list_files(tx, a) {
    const q = typeof a.query === "string" ? a.query.trim() : "";
    const rows = await tx<{ id: string; filename: string; content_type: string; size: string; created_at: Date }[]>`
      select id, filename, content_type, size, created_at from public.attachments
      where deleted_at is null ${q ? tx`and filename ilike ${likeText(q)}` : tx``}
      order by created_at desc limit ${clampInt(a.limit, 30, 200) || 30}`;
    const files = [];
    for (const r of rows) {
      const notes = await tx<{ id: string; title: string }[]>`
        select id, title from public.notes where deleted_at is null and body like ${"%pane-file:" + r.id + "%"} limit 5`;
      files.push({ id: r.id, filename: r.filename, type: r.content_type, bytes: Number(r.size), added: iso(r.created_at), in_notes: notes });
    }
    return { files };
  },

  async get_file(tx, a) {
    const id = String(a.id ?? "").replace(/^pane-file:/, "");
    const rows = await tx<{ id: string; filename: string; content_type: string; size: string; storage_path: string }[]>`
      select id, filename, content_type, size, storage_path from public.attachments where id = ${id}::uuid and deleted_at is null`.catch(() => []);
    if (!rows.length) throw new ToolError(`No file with id ${id}. Use list_files.`);
    const f = rows[0];
    // The row was read under RLS, so this path belongs to the caller.
    const base = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const res = await fetch(`${base}/storage/v1/object/sign/files/${f.storage_path.split("/").map(encodeURIComponent).join("/")}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, apikey: key, "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: 600 }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.signedURL) throw new ToolError("The file isn't uploaded yet. Open Amber Notes on the device that added it so it can sync.");
    // Locally the runtime sees an internal hostname; PANE_PUBLIC_URL gives the reachable one.
    const publicBase = Deno.env.get("PANE_PUBLIC_URL") ?? base;
    return { id: f.id, filename: f.filename, type: f.content_type, bytes: Number(f.size), download_url: `${publicBase}/storage/v1${body.signedURL}`, expires_in_seconds: 600 };
  },

  async read_table(tx, a) {
    const n = await findNote(tx, a);
    const t = pickTable(n.body, a.table);
    const rows = t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c.name, r[i]])));
    const last = clampInt(a.last, 0, 10000);
    return {
      note: { id: n.id, title: n.title },
      columns: t.columns.map((c) => ({ name: c.name, type: typeSpec(c.type) })),
      rows: last ? rows.slice(-last) : rows,
      total_rows: rows.length,
    };
  },

  async log_table_row(tx, a) {
    const n = await findNote(tx, a);
    const t = pickTable(n.body, a.table);
    const values = (a.values ?? {}) as Record<string, unknown>;
    const byName = new Map(t.columns.map((c, i) => [c.name.toLowerCase(), i]));
    const unknown = Object.keys(values).filter((k) => !byName.has(k.toLowerCase()));
    if (unknown.length) throw new ToolError(`Unknown column(s): ${unknown.join(", ")}. Columns: ${t.columns.map((c) => c.name).join(", ")}.`);
    // "Today" is the owner's local day (PANE_TIMEZONE, default Europe/Stockholm), not UTC.
    const tz = Deno.env.get("PANE_TIMEZONE") ?? "Europe/Stockholm";
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const dateCol = t.columns.findIndex((c) => c.type.kind === "date");
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
    await save(tx, n, replaceTable(n.body, t));
    return { note: n.title, [updated ? "updated_row" : "added_row"]: Object.fromEntries(t.columns.map((c, i) => [c.name, row[i]])) };
  },

  async delete_table_row(tx, a) {
    const n = await findNote(tx, a);
    const t = pickTable(n.body, a.table);
    const dateCol = t.columns.findIndex((c) => c.type.kind === "date");
    const i = typeof a.date === "string" && dateCol >= 0 ? t.rows.findIndex((r) => r[dateCol] === a.date) : Number.isInteger(a.index) ? Number(a.index) : -1;
    if (i < 0 || i >= t.rows.length) throw new ToolError("No such row. Use read_table to see dates and indexes.");
    const [gone] = t.rows.splice(i, 1);
    await save(tx, n, replaceTable(n.body, t));
    return { deleted_row: Object.fromEntries(t.columns.map((c, k) => [c.name, gone[k]])) };
  },

  async search(tx, a) {
    const rows = await tx<{ id: string; title: string }[]>`select id, title from public.search_notes(${String(a.query ?? "")}, 10)`;
    return { results: rows.map((r) => ({ id: r.id, title: r.title, url: `pane://note/${r.id}` })) };
  },

  async fetch(tx, a) {
    const n = await findNote(tx, { id: a.id }, true);
    const all = await folders(tx);
    return { id: n.id, title: n.title, text: n.body, url: `pane://note/${n.id}`, metadata: { folder: pathOf(n.folder_id, all), pinned: n.is_pinned, updated: iso(n.updated_at) } };
  },
};
