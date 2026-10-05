// Note pages (prototype): the tools that put data in and out of a note without touching its page,
// and the page's own data and guide. The checks and edits are pure (data_ops.ts); this file
// opens the note, applies them and saves, like the note tools in tools.ts.
//
// Safety: every change is checked whole before any of it lands, adds and edits touch only their
// own lines, and anything that would drop a value (a column with values, several rows at once)
// has to be asked for by name.

import { addChecklistItems, addRows, atPath, changeStore, DataError, fileRefs, newFiles, placeFiles, queryRecords, recordsFromCsv, deleteRows, hasTable, newTable, parseDelimited, editColumns, pastedRows, updateChecklistItems, updateRows, type ChecklistChange, type ColumnChange, type RowInput } from "./data_ops.ts";
import { findTables, mimeOf, typeSpec } from "./notes.ts";
import { PAGE_GUIDE } from "./page_guide.ts";
import { noteForPage } from "./page_input.ts";
import { appHandlers, appTools } from "./app_tools.ts";
import { pageDataProblems, type PageData } from "./page.ts";
import { PAGE_TEMPLATES } from "./page_templates.gen.ts";
import { bodyOf, findNote, save, ToolError, type Call, type Tx } from "./tools.ts";

type Args = Record<string, unknown>;

const str = (d: string) => ({ type: "string", description: d });
const bool = (d: string) => ({ type: "boolean", description: d });
const noteRef = { id: str("Note id (preferred)."), title: str("Note title, if you don't have the id. Must match one note.") };
const tableRef = { description: "Which table: its index (0 = first table in the note), the heading above it, or one of its column names. Omit when the note has one table.", anyOf: [{ type: "integer" }, { type: "string" }] };
const cellValue = { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] };
const rowObject = { type: "object", description: "Column name → value. Column names are matched case-insensitively.", additionalProperties: cellValue };
const whereObject = {
  type: "object",
  description: "Which rows: column name → the value that row has (case-insensitive), e.g. { \"Name\": \"Sarah Lee\" }, or a test: { \"Date\": { \"from\": \"2026-09-01\", \"to\": \"2026-09-30\" } }, { \"Item\": { \"contains\": \"coffee\" } }, { \"Date\": { \"starts_with\": \"2026-09\" } }, { \"Notes\": { \"empty\": true } }. from/to are inclusive and compare numbers as numbers. Several columns must all match. { \"row\": 3 } picks the 4th row.",
  additionalProperties: { anyOf: [...cellValue.anyOf, { type: "object", properties: { equals: cellValue, contains: { type: "string" }, starts_with: { type: "string" }, from: cellValue, to: cellValue, empty: { type: "boolean" } } }] },
};

const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const add = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const change = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

export const dataTools = [
  {
    name: "add_table_rows", title: "Add rows to a table",
    description: "Adds one or many rows to a table in a note: give rows (objects by column name) or csv (pasted CSV, TSV, semicolon-separated or a markdown table, first line the header). " +
      "Use it for bulk imports too: up to 5000 rows in one call, all or nothing. A note without the table: set create_table (and column_types). Values are checked against typed columns (number, date yyyy-mm-dd, scale, choice) and every row is checked before any is added; an error names the row and column. " +
      "Only new lines are inserted: existing rows and the rest of the note stay exactly as they were. In a dated tracker kept in date order, rows go in date order. A page over the note shows the new rows by itself. To add a column first, use edit_table_columns.",
    inputSchema: {
      type: "object",
      properties: {
        ...noteRef, table: tableRef,
        rows: { type: "array", description: "Rows to add, each { \"Column\": value }.", items: rowObject },
        csv: str("Pasted rows with a header line instead of rows. Quoted fields (\"a, b\") work."),
        column_map: { type: "object", description: "For csv: pasted header → table column, when they differ, e.g. { \"Amount (kr)\": \"Amount\" }.", additionalProperties: { type: "string" } },
        ignore_extra_columns: bool("For csv: skip pasted columns the table doesn't have instead of refusing."),
        create_table: bool("If the note has no such table, make one: its columns are the csv header (after column_map) or the rows' keys, in order. Put it under under_heading, else at the end of the note."),
        column_types: { type: "object", description: "For create_table: column name → text, number, date, scale 1-5 or choice A|B|C. Omitted columns are text.", additionalProperties: { type: "string" } },
        under_heading: str("For create_table: put the new table at the end of this heading's section."),
      },
    },
    annotations: add,
  },
  {
    name: "update_table_rows", title: "Change rows in a table",
    description: "Sets column values on the rows that match `where`, e.g. where { \"Name\": \"Sarah Lee\" } set { \"Stage\": \"Won\" }. Refuses when several rows match unless all is true. Only the matched rows' lines change. Values are checked against the column types.",
    inputSchema: {
      type: "object",
      properties: { ...noteRef, table: tableRef, where: whereObject, set: { ...rowObject, description: "Column name → new value." }, all: bool("Change every matching row, not just one.") },
      required: ["where", "set"],
    },
    annotations: { ...change, idempotentHint: true },
  },
  {
    name: "delete_table_rows", title: "Delete rows from a table",
    description: "Removes the rows that match `where`. Refuses when several rows match unless all is true. The deleted rows are returned and stay in the note's history (restore_revision).",
    inputSchema: { type: "object", properties: { ...noteRef, table: tableRef, where: whereObject, all: bool("Delete every matching row.") }, required: ["where"] },
    annotations: change,
  },
  {
    name: "edit_table_columns", title: "Change a table's columns",
    description: "Adds, renames, retypes or removes columns of a table in one step, keeping every row's values under the right column. Changes: { add, type?, after?, value? } | { rename, to } | { set_type, type } | { remove }. " +
      "Types: text, number, date, scale 1-5, choice A|B|C. set_type refuses if existing values don't fit, naming them. remove refuses to drop filled values unless drop_values is true; ask the person before dropping data. If a page reads a renamed column, update the page too (edit_note_page).",
    inputSchema: {
      type: "object",
      properties: {
        ...noteRef, table: tableRef,
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              add: str("New column name."), type: str("Column type for add or set_type."), after: str("For add: put it after this column (default: last)."), value: { ...cellValue, description: "For add: value for every existing row (default empty)." },
              rename: str("Column to rename."), to: str("Its new name."),
              set_type: str("Column to retype."),
              remove: str("Column to remove."),
            },
          },
        },
        drop_values: bool("Allow remove to drop a column that has values. Only after the person agreed."),
      },
      required: ["changes"],
    },
    annotations: change,
  },
  {
    name: "add_checklist_items", title: "Add checklist items",
    description: "Adds open '- [ ] item' lines to a note's checklist: the one under under_heading, else the note's first checklist; a note without one gets a new checklist at the end. New items go after the last open item, above ticked ones.",
    inputSchema: { type: "object", properties: { ...noteRef, items: { type: "array", items: { type: "string" }, description: "Item texts." }, under_heading: str("Heading whose checklist gets the items.") }, required: ["items"] },
    annotations: add,
  },
  {
    name: "update_checklist_items", title: "Change checklist items",
    description: "Ticks, unticks, renames or removes checklist items matched by their text (exact, or a unique part). Several changes in one call, all or nothing.",
    inputSchema: {
      type: "object",
      properties: {
        ...noteRef,
        changes: { type: "array", items: { type: "object", properties: { item: str("The item's text or a unique part of it."), checked: bool("Tick (true) or untick (false)."), text: str("New text."), remove: bool("Delete the item.") }, required: ["item"] } },
      },
      required: ["changes"],
    },
    annotations: change,
  },
  {
    name: "get_page_data", title: "Read a note's app data",
    description: "Reads the data a note's app keeps for itself, next to the note and never in its text: { values: { … }, collections: { name: [records with id, created, updated, …] } }. " +
      "With collection, returns that collection's records, filtered by where (field → value, or a test like { \"date\": { \"from\": \"2026-09-01\" } }, { \"name\": { \"contains\": \"ann\" } }; dotted fields reach nested values), limit/offset paged, optionally only some fields. path reads one part, like \"values.goal\". Files in records are { \"$file\": id }; open one with get_file.",
    inputSchema: {
      type: "object",
      properties: {
        ...noteRef,
        collection: str("A collection's name: return its records."),
        where: { type: "object", description: "For collection: field → value or test (equals, contains, starts_with, from, to, empty)." },
        limit: { type: "integer", description: "For collection: records per call, default 50, max 500." },
        offset: { type: "integer", description: "For collection: skip this many (paging)." },
        fields: { type: "array", items: { type: "string" }, description: "For collection: only these fields (and id)." },
        path: str("Dotted path to one part, e.g. \"values.goal\"."),
      },
    },
    annotations: read,
  },
  {
    name: "update_page_data", title: "Change a note's app data",
    description: "Changes the data a note's app keeps (any JSON, in values and in named collections of records) in one all-or-nothing call; the note's text is never touched and the app shows the change at once: " +
      "values (JSON merge patch; null removes a key), add ({ collection: [records] }; each gets an id and created/updated stamps), update ({ collection: [{ id, …fields }] }, merged), remove ({ collection: [ids] }), " +
      "import ({ collection, csv }: pasted CSV/TSV as records, numbers as numbers, \"a.b\" headers as nested fields, up to 20000), and replace (the whole { values, collections }, only when asked to start over). " +
      "Attach a file to a record by putting { \"$new_file\": { name, type, text | base64 } } in a field (it's saved encrypted and becomes { \"$file\": id }), or { \"$file\": id } for a file from list_files. Up to 4 MB of JSON; earlier data stays in the app's versions.",
    inputSchema: {
      type: "object",
      properties: {
        ...noteRef,
        values: { type: "object", description: "Merge patch into values, e.g. { \"goal\": 5, \"program\": { \"week1\": [ … ] } }." },
        add: { type: "object", description: "Collection name → records to add, e.g. { \"workouts\": [{ \"kind\": \"Run\", \"km\": 5.2 }] }.", additionalProperties: { type: "array", items: { type: "object" } } },
        update: { type: "object", description: "Collection name → [{ id, …fields to change }].", additionalProperties: { type: "array", items: { type: "object" } } },
        remove: { type: "object", description: "Collection name → ids to remove.", additionalProperties: { type: "array", items: { type: "string" } } },
        import: { type: "object", description: "{ collection, csv, column_map? }: add pasted rows as records.", properties: { collection: { type: "string" }, csv: { type: "string" }, column_map: { type: "object", additionalProperties: { type: "string" } } } },
        replace: { type: "object", description: "The complete new { values, collections }. Only when the person wants to start over." },
      },
    },
    annotations: change,
  },
  {
    name: "get_page_guide", title: "How to build note pages",
    description: "The guide to building and editing note pages: the window.amber API, the data model, design and accessibility rules, the workflow and a starter page, plus a list of tested templates. Call once before making, redesigning or fixing a page. With template, returns that template's HTML.",
    inputSchema: { type: "object", properties: { template: { type: "string", enum: PAGE_TEMPLATES.map((t) => t.name), description: "A template's name." } } },
    annotations: read,
  },
  ...appTools,
];

async function pageDataOf(tx: Tx, c: Call, id: string): Promise<PageData> {
  const [row] = await tx<{ data_ct: string | null }[]>`select data_ct from public.note_pages where note_id = ${id} for update`;
  if (!row?.data_ct) return { values: {}, collections: {} };
  let d: Partial<PageData>;
  try { d = JSON.parse(await c.v.openPageData(id, row.data_ct)); } catch { throw new ToolError("This page's data can't be opened with this connection's key."); }
  return { values: d.values ?? {}, collections: d.collections ?? {} };
}

async function storePageData(tx: Tx, c: Call, id: string, data: unknown) {
  const problems = pageDataProblems(data);
  if (problems.length) throw new ToolError(`The data wasn't saved:\n- ${problems.join("\n- ")}`);
  const json = JSON.stringify(data);
  await tx`insert into public.note_pages (note_id, data_ct) values (${id}, ${await c.v.sealPageData(id, json)})
    on conflict (note_id) do update set data_ct = excluded.data_ct`;
  return { bytes: new TextEncoder().encode(json).length };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A file an AI adds for an app's record: sealed like the app's own uploads, kept in Storage. */
async function saveFile(tx: Tx, c: Call, f: { name: string; type: string; text?: string; base64?: string }) {
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = f.text !== undefined ? new TextEncoder().encode(f.text) : Uint8Array.from(atob(f.base64!.replace(/\s/g, "")), (ch) => ch.charCodeAt(0)); } catch { throw new ToolError(`$new_file "${f.name}": base64 doesn't decode.`); }
  if (bytes.length > 8 * 1024 * 1024) throw new ToolError(`$new_file "${f.name}" is over 8 MB.`);
  const type = f.type || mimeOf("", f.name);
  const id = crypto.randomUUID();
  const path = `${c.ctx.userId}/${id}`;
  await tx`insert into public.attachments (id, meta_ct, size, storage_path) values (${id}, ${await c.v.sealFileMeta(id, { name: f.name, type, size: bytes.length })}, ${bytes.length}, ${path})`;
  const sealed = await c.v.sealFileBytes(id, bytes);
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/storage/v1/object/files/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST", headers: { authorization: `Bearer ${key}`, apikey: key, "content-type": "application/octet-stream", "x-upsert": "false" }, body: sealed,
  });
  if (!res.ok) { await res.body?.cancel(); throw new ToolError(`"${f.name}" couldn't be saved (storage said ${res.status}). Nothing was changed; try again.`); }
  await res.body?.cancel();
  return { $file: id, name: f.name, type, size: bytes.length };
}

const outline = (d: PageData) => ({ values: Object.keys(d.values), collections: Object.fromEntries(Object.entries(d.collections).map(([k, v]) => [k, v.length])) });

/** Runs a pure edit; its DataError becomes a ToolError the model sees. */
function attempt<T>(fn: () => T): T {
  try { return fn(); } catch (e) { if (e instanceof DataError || e instanceof Error) throw new ToolError(e.message); throw e; }
}

const localToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: Deno.env.get("PANE_TIMEZONE") ?? "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function tableSummary(body: string, index: number) {
  const t = findTables(body)[index];
  return { index, columns: t.columns.map((c) => ({ name: c.name, type: typeSpec(c.type) })), total_rows: t.rows.length };
}

export const dataHandlers: Record<string, (tx: Tx, a: Args, c: Call) => Promise<unknown>> = {
  ...appHandlers,
  async add_table_rows(tx, a, c) {
    const n = await findNote(tx, c, a);
    const before = await bodyOf(c.v, n);
    const hasRows = Array.isArray(a.rows) && a.rows.length > 0, hasCsv = typeof a.csv === "string" && a.csv.trim() !== "";
    if (hasRows === hasCsv) throw new ToolError("Give either rows (a list of { \"Column\": value }) or csv (pasted text with a header line), not both or neither.");
    const map = (a.column_map ?? {}) as Record<string, string>;
    let body = before, ref = a.table, created = false;
    if (a.create_table === true && !attempt(() => hasTable(before, a.table))) {
      // The new table's columns: the pasted header (mapped) or the rows' keys, in order.
      const names = hasCsv
        ? attempt(() => parseDelimited(a.csv as string)).header.map((h) => Object.entries(map).find(([k]) => k.trim().toLowerCase() === h.trim().toLowerCase())?.[1] ?? h)
        : [...new Set((a.rows as RowInput[]).flatMap((r) => (Array.isArray(r) ? [] : Object.keys(r))))];
      body = attempt(() => newTable(before, names, (a.column_types ?? {}) as Record<string, string>, typeof a.under_heading === "string" && a.under_heading.trim() ? a.under_heading : undefined));
      const all = findTables(body);
      ref = all.map((t, i) => ({ t, i })).filter(({ t }) => !t.rows.length && t.columns.map((c) => c.name).join("|") === names.map((x) => x.trim()).join("|")).pop()!.i;
      created = true;
    }
    const rows = hasRows ? a.rows as RowInput[] : attempt(() => pastedRows(body, ref, a.csv as string, map, a.ignore_extra_columns === true));
    const r = attempt(() => addRows(body, ref, rows, localToday()));
    const saved = await save(tx, c, n, before, r.body);
    return { note: { id: n.id, title: n.title, version: saved.version }, ...(created ? { created_table: true } : {}), added_rows: r.added, table: tableSummary(r.body, r.table) };
  },

  async update_table_rows(tx, a, c) {
    const n = await findNote(tx, c, a);
    const before = await bodyOf(c.v, n);
    const r = attempt(() => updateRows(before, a.table, a.where as Record<string, unknown>, a.set as Record<string, unknown>, localToday(), { all: a.all === true }));
    await save(tx, c, n, before, r.body);
    return { note: { id: n.id, title: n.title }, table: r.table, updated_rows: r.updated, rows: r.rows };
  },

  async delete_table_rows(tx, a, c) {
    const n = await findNote(tx, c, a);
    const before = await bodyOf(c.v, n);
    const r = attempt(() => deleteRows(before, a.table, a.where as Record<string, unknown>, { all: a.all === true }));
    await save(tx, c, n, before, r.body);
    return { note: { id: n.id, title: n.title }, table: r.table, deleted_rows: r.deleted, rows: r.rows, undo: "note_history / restore_revision" };
  },

  async edit_table_columns(tx, a, c) {
    const n = await findNote(tx, c, a);
    const before = await bodyOf(c.v, n);
    const r = attempt(() => editColumns(before, a.table, a.changes as ColumnChange[], localToday(), a.drop_values === true));
    await save(tx, c, n, before, r.body);
    const [page] = await tx`select 1 from public.note_pages where note_id = ${n.id} and page_ct is not null`;
    const renamed = (a.changes as ColumnChange[]).some((ch) => "rename" in ch || "remove" in ch);
    return { note: { id: n.id, title: n.title }, table: r.table, changes: r.changes, columns: r.columns,
      ...(page && renamed ? { page: "This note has a page. If it reads a renamed or removed column by name, update it with edit_note_page." } : {}) };
  },

  async add_checklist_items(tx, a, c) {
    const n = await findNote(tx, c, a);
    const before = await bodyOf(c.v, n);
    const r = attempt(() => addChecklistItems(before, a.items as string[], typeof a.under_heading === "string" && a.under_heading.trim() ? a.under_heading : undefined));
    await save(tx, c, n, before, r.body);
    return { note: { id: n.id, title: n.title }, added: r.added };
  },

  async update_checklist_items(tx, a, c) {
    const n = await findNote(tx, c, a);
    const before = await bodyOf(c.v, n);
    const r = attempt(() => updateChecklistItems(before, a.changes as ChecklistChange[]));
    await save(tx, c, n, before, r.body);
    return { note: { id: n.id, title: n.title }, changed: r.changed };
  },

  async get_page_data(tx, a, c) {
    const n = await findNote(tx, c, a, true);
    const data = await pageDataOf(tx, c, n.id);
    const note = { id: n.id, title: n.title };
    if (typeof a.collection === "string" && a.collection.trim()) {
      const limit = Math.max(1, Math.min(500, Number.isInteger(a.limit) ? Number(a.limit) : 50));
      const offset = Math.max(0, Number.isInteger(a.offset) ? Number(a.offset) : 0);
      return { note, ...attempt(() => queryRecords(data, a.collection as string, (a.where ?? {}) as Record<string, unknown>, limit, offset, Array.isArray(a.fields) ? a.fields.map(String) : undefined)) };
    }
    if (typeof a.path === "string" && a.path.trim()) return { note, path: a.path, value: atPath(data, a.path) ?? null };
    const json = JSON.stringify(data);
    if (json.length <= 60_000) return { note, data };
    return { note, outline: outline(data), bytes: json.length, more: "Too big to show whole: read a collection with collection (and where/limit), or a part with path." };
  },

  async update_page_data(tx, a, c) {
    const n = await findNote(tx, c, a);
    const known = ["values", "add", "update", "remove", "import", "replace"];
    if (!known.some((k) => a[k] !== undefined)) throw new ToolError(`Say what to change: ${known.join(", ")}.`);
    let store: PageData;
    let added: Record<string, string[]> = {};
    let changes = 0;
    if (a.replace !== undefined) {
      if (known.filter((k) => k !== "replace").some((k) => a[k] !== undefined)) throw new ToolError("replace sets everything: send it alone.");
      const r = a.replace as Partial<PageData>;
      store = typeof r === "object" && r !== null && !Array.isArray(r) ? { values: r.values ?? {}, collections: r.collections ?? {}, ...r } as PageData : r as PageData;
      changes = 1;
    } else {
      const change: Record<string, unknown> = Object.fromEntries(["values", "add", "update", "remove"].filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
      if (a.import !== undefined) {
        const im = a.import as { collection?: unknown; csv?: unknown; column_map?: Record<string, string> };
        if (typeof im?.collection !== "string" || !im.collection.trim() || typeof im.csv !== "string") throw new ToolError("import is { collection, csv }.");
        const records = attempt(() => recordsFromCsv(im.csv as string, im.column_map ?? {}));
        const addTo = { ...((change.add ?? {}) as Record<string, unknown[]>) };
        addTo[im.collection] = [...(addTo[im.collection] ?? []), ...records];
        change.add = addTo;
      }
      const before = await pageDataOf(tx, c, n.id);
      const r = attempt(() => changeStore(before, change, new Date().toISOString()));
      store = r.store; added = r.added; changes = r.changed;
    }
    // Files: new ones are saved (sealed) first; every reference must be the person's file.
    const fresh = attempt(() => newFiles(store));
    if (fresh.length > 20) throw new ToolError(`${fresh.length} new files in one call; save at most 20 at a time.`);
    const saved: Record<string, unknown>[] = [];
    for (const f of fresh) saved.push(await saveFile(tx, c, f));
    if (saved.length) store = placeFiles(store, saved) as PageData;
    const refs = [...new Set(fileRefs(store))];
    if (refs.length) {
      const bad = refs.filter((r) => !UUID_RE.test(r));
      const found = bad.length ? [] : await tx<{ id: string }[]>`select id from public.attachments where id = any(${refs}::uuid[]) and deleted_at is null`;
      const missing = bad.length ? bad : refs.filter((r) => !found.some((x) => x.id === r));
      if (missing.length) throw new ToolError(`No file with id ${missing.slice(0, 3).join(", ")}. Use list_files for existing files, or { "$new_file": { name, type, text | base64 } } to add one.`);
    }
    const { bytes } = await storePageData(tx, c, n.id, store);
    const small = bytes <= 20_000;
    return { note: { id: n.id, title: n.title }, changes, ...(Object.keys(added).length ? { added_ids: Object.fromEntries(Object.entries(added).map(([k, v]) => [k, v.length > 50 ? { count: v.length, first: v.slice(0, 5) } : v])) } : {}),
      ...(saved.length ? { files_saved: saved } : {}), ...(small ? { data: store } : { outline: outline(store) }), bytes };
  },

  // deno-lint-ignore require-await
  async get_page_guide(_tx, a) {
    if (typeof a.template === "string" && a.template) {
      const t = PAGE_TEMPLATES.find((x) => x.name === a.template);
      if (!t) throw new ToolError(`No template "${a.template}". Templates: ${PAGE_TEMPLATES.map((x) => x.name).join(", ")}.`);
      return { template: t.name, description: t.description, expects: t.expects, html: t.html };
    }
    return { guide: PAGE_GUIDE };
  },
};

/** What get_note_page adds: the shape of what the page is handed as amber.note (first rows only). */
export function pageExtras(body: string) {
  const note = noteForPage(body, localToday());
  const SAMPLE = 3;
  return {
    page_input: {
      title: note.title, today: note.today, markdown: `(${body.length} characters: the note as read_note shows it)`,
      tables: note.tables.map((t) => ({ ...t, rows: t.rows.slice(0, SAMPLE), ...(t.rows.length > SAMPLE ? { more_rows: t.rows.length - SAMPLE } : {}) })),
      checklists: note.checklists.slice(0, 10), ...(note.checklists.length > 10 ? { more_checklist_items: note.checklists.length - 10 } : {}),
    },
  };
}
