// Pure helpers for the data tools (data_tools.ts): rows and columns of a note's tables, checklist
// items and a page's JSON data. No I/O, so they are unit-tested (data_ops.test.ts).
//
// Two rules hold everywhere here:
// - Only the lines a change is about are touched. Adding rows inserts lines; updating a row
//   rewrites that row's line; every other line of the note stays byte for byte.
// - Every change is checked whole before any of it applies: one bad row in 200 refuses all 200,
//   with a message that names the row, the column and the fix.

import { coerce, findTables, sortChecklist, stripMarkup, tableCells, typeSpec, type ColType, type Table } from "./notes.ts";

export class DataError extends Error {}

// MARK: Finding a table

/** How a table is named in errors and listings: its index, the heading above it and its columns. */
export function describeTables(body: string): { index: number; heading: string | null; columns: string[]; rows: number }[] {
  const lines = body.split("\n");
  return findTables(body).map((t, index) => ({ index, heading: headingAbove(lines, t.start), columns: t.columns.map((c) => c.name), rows: t.rows.length }));
}

function headingAbove(lines: string[], at: number): string | null {
  for (let i = at - 1; i >= 0; i--) {
    const m = lines[i].match(/^#{1,6}\s+(.*)$/);
    if (m) return stripMarkup(m[1]) || null;
    // Another table in between: the heading belongs to that one too, which is fine.
  }
  return null;
}

const norm = (s: string) => stripMarkup(s).toLowerCase().replace(/\s+/g, " ").trim();

/**
 * A table by its index (0 = the first table in the note), by the heading above it, or by one of
 * its column names. Omitted: the note's only table, else the first typed one (a tracker).
 */
export function resolveTable(body: string, ref: unknown): { table: Table; index: number } {
  const all = findTables(body);
  if (!all.length) throw new DataError("This note has no table yet. Call add_table_rows again with create_table: true (and column_types if some columns are dates or numbers) to make one from your columns.");
  const list = () => describeTables(body).map((t) => `${t.index}${t.heading ? ` ("${t.heading}")` : ""}: ${t.columns.join(", ")}`).join("; ");
  if (ref === undefined || ref === null || ref === "") {
    if (all.length === 1) return { table: all[0], index: 0 };
    const typed = all.findIndex((t) => t.typed);
    if (typed >= 0) return { table: all[typed], index: typed };
    return { table: all[0], index: 0 };
  }
  const asNumber = typeof ref === "number" ? ref : typeof ref === "string" && /^\d+$/.test(ref.trim()) ? Number(ref) : NaN;
  if (Number.isInteger(asNumber)) {
    if (asNumber < 0 || asNumber >= all.length) throw new DataError(`table ${asNumber} doesn't exist. Tables in this note: ${list()}.`);
    return { table: all[asNumber], index: asNumber };
  }
  if (typeof ref !== "string") throw new DataError(`table must be a number or a name. Tables in this note: ${list()}.`);
  const want = norm(ref);
  const described = describeTables(body);
  const byHeading = described.filter((t) => t.heading && norm(t.heading) === want);
  if (byHeading.length === 1) return { table: all[byHeading[0].index], index: byHeading[0].index };
  const byColumn = described.filter((t) => t.columns.some((c) => norm(c) === want));
  if (byColumn.length === 1) return { table: all[byColumn[0].index], index: byColumn[0].index };
  throw new DataError(`No single table matches "${ref}". Tables in this note: ${list()}. Pass the index.`);
}

/** Whether `ref` names a table this note has (no ref: whether it has any). */
export function hasTable(body: string, ref: unknown): boolean {
  if (!findTables(body).length) return false;
  if (ref === undefined || ref === null || ref === "") return true;
  try { resolveTable(body, ref); return true; } catch { return false; }
}

function columnIndex(t: Table, name: string): number {
  const want = norm(name);
  const i = t.columns.findIndex((c) => norm(c.name) === want);
  if (i < 0) throw new DataError(`No column "${name}". Columns: ${t.columns.map((c) => c.name).join(", ")}.`);
  return i;
}

// MARK: Rows

const cellText = (v: string) => (v === "" ? " " : v.replace(/\|/g, "\\|").replace(/\r?\n/g, " "));
export const rowLine = (cells: string[]) => "| " + cells.map(cellText).join(" | ") + " |";

/** Line numbers (0-based) of a table's data rows, in order. */
function rowLines(body: string, t: Table): number[] {
  const lines = body.split("\n");
  const header = t.typed ? t.start + 1 : t.start;
  const out: number[] = [];
  for (let k = header + 2; k <= t.end; k++) if (!/^[\s|:-]+$/.test(lines[k])) out.push(k);
  return out;
}

/** A value for a column, checked against its type; errors name the row and column. */
function cell(v: unknown, col: { name: string; type: ColType }, today: string, where: string): string {
  if (v !== null && typeof v === "object") throw new DataError(`${where}: ${col.name} must be text, a number or true/false, not ${Array.isArray(v) ? "a list" : "an object"}.`);
  let s: string;
  try { s = coerce(v, col, today); } catch (e) { throw new DataError(`${where}: ${(e as Error).message}`); }
  if (s.length > 2000) throw new DataError(`${where}: ${col.name} is ${s.length} characters; a cell holds at most 2000.`);
  return s.replace(/\r?\n/g, " ");
}

export type RowInput = Record<string, unknown> | unknown[];

/** Cells for one incoming row: an object by column name (case-insensitive) or a list in column order. */
function cellsOf(t: Table, input: RowInput, today: string, where: string, base?: string[]): string[] {
  const out = base ? [...base] : t.columns.map(() => "");
  if (Array.isArray(input)) {
    if (input.length > t.columns.length) throw new DataError(`${where}: ${input.length} values, but the table has ${t.columns.length} columns (${t.columns.map((c) => c.name).join(", ")}).`);
    input.forEach((v, i) => { out[i] = cell(v, t.columns[i], today, where); });
    return out;
  }
  if (typeof input !== "object" || input === null) throw new DataError(`${where}: a row is an object of column name to value, or a list of values in column order.`);
  const unknown = Object.keys(input).filter((k) => !t.columns.some((c) => norm(c.name) === norm(k)));
  if (unknown.length) throw new DataError(`${where}: unknown column${unknown.length > 1 ? "s" : ""} ${unknown.map((u) => `"${u}"`).join(", ")}. Columns: ${t.columns.map((c) => c.name).join(", ")}. To add a column use edit_table_columns.`);
  for (const [k, v] of Object.entries(input)) {
    const i = columnIndex(t, k);
    out[i] = cell(v, t.columns[i], today, where);
  }
  return out;
}

/** Adds rows at the end of a table (or in date order for a tracker with a date column). */
/**
 * A new, empty table at the end of the note (or of a heading's section), for add_table_rows'
 * create_table. Column types are optional: { "Date": "date", "Km": "number" }.
 */
export function newTable(body: string, columns: string[], types: Record<string, string> = {}, heading?: string): string {
  const names = columns.map((c) => String(c ?? "").trim());
  if (!names.length || names.some((c) => !c || c.includes("|"))) throw new DataError("A new table needs column names (no empty ones, no \"|\").");
  if (new Set(names.map(norm)).size !== names.length) throw new DataError(`Column names repeat: ${names.join(", ")}.`);
  const unknown = Object.keys(types).filter((k) => !names.some((c) => norm(c) === norm(k)));
  if (unknown.length) throw new DataError(`column_types names columns that aren't in the new table: ${unknown.join(", ")}.`);
  const cols = names.map((name) => ({ name, type: parseColType(Object.entries(types).find(([k]) => norm(k) === norm(name))?.[1] ?? "text") }));
  const typed = cols.some((c) => c.type.kind !== "text");
  const block = [
    ...(typed ? ["<!-- pane-table: " + cols.map((c) => `${c.name}=${typeSpec(c.type)}`).join("; ") + " -->"] : []),
    rowLine(names), "|" + names.map(() => " --- ").join("|") + "|",
  ];
  const lines = body.replace(/\s+$/, "").split("\n");
  if (heading) {
    const { at, end } = findHeading(lines, heading);
    let k = end;
    while (k > at + 1 && lines[k - 1].trim() === "") k--;
    lines.splice(k, 0, "", ...block);
    return lines.join("\n") + "\n";
  }
  return [...lines, "", ...block].join("\n") + "\n";
}

export function addRows(body: string, ref: unknown, rows: RowInput[], today: string): { body: string; added: number; table: number; columns: string[] } {
  if (!Array.isArray(rows) || !rows.length) throw new DataError("rows is empty: give at least one row.");
  if (rows.length > 5000) throw new DataError(`${rows.length} rows at once is too many; send at most 5000 per call.`);
  const { table: t, index } = resolveTable(body, ref);
  const fresh = rows.map((r, i) => cellsOf(t, r, today, `Row ${i + 1}`));
  const lines = body.split("\n");
  const at = rowLines(body, t);
  const dateCol = t.columns.findIndex((c) => c.type.kind === "date");
  // In a dated tracker kept in date order, new rows go where their date belongs; otherwise at the end.
  const existing = at.map((k) => tableCells(lines[k]));
  const sorted = dateCol >= 0 && existing.every((r, i) => i === 0 || (existing[i - 1][dateCol] ?? "") <= (r[dateCol] ?? ""));
  if (!sorted || dateCol < 0) {
    lines.splice(t.end + 1, 0, ...fresh.map(rowLine));
  } else {
    // Insert from the last so earlier positions stay valid.
    const placed = fresh.map((cells, n) => ({ cells, n })).sort((a, b) => (a.cells[dateCol] < b.cells[dateCol] ? -1 : a.cells[dateCol] > b.cells[dateCol] ? 1 : a.n - b.n));
    const inserts: { line: number; text: string }[] = [];
    for (const p of placed) {
      const after = existing.findIndex((r) => (r[dateCol] ?? "") > p.cells[dateCol]);
      inserts.push({ line: after < 0 ? t.end + 1 : at[after], text: rowLine(p.cells) });
    }
    // Same insertion line keeps the given order: group, then splice from the bottom.
    const groups = new Map<number, string[]>();
    for (const x of inserts) groups.set(x.line, [...(groups.get(x.line) ?? []), x.text]);
    for (const line of [...groups.keys()].sort((a, b) => b - a)) lines.splice(line, 0, ...groups.get(line)!);
  }
  return { body: lines.join("\n"), added: fresh.length, table: index, columns: t.columns.map((c) => c.name) };
}

export type Where = Record<string, unknown>;

/** Data rows of a table that match every column=value in `where` (case-insensitive, trimmed); `{ row: n }` picks by 0-based index. */
function matching(body: string, t: Table, where: Where): number[] {
  if (typeof where !== "object" || where === null || Array.isArray(where) || !Object.keys(where).length) {
    throw new DataError(`where must name at least one column and its value, like { "${t.columns[0]?.name ?? "Name"}": "…" }, or { "row": 3 } for the 4th row.`);
  }
  if ("row" in where && !t.columns.some((c) => norm(c.name) === "row")) {
    const n = Number(where.row);
    if (!Number.isInteger(n) || n < 0 || n >= t.rows.length) throw new DataError(`row ${where.row} doesn't exist: the table has ${t.rows.length} rows (0-${t.rows.length - 1}).`);
    return [n];
  }
  const conds = Object.entries(where).map(([k, v]) => { const c = columnIndex(t, k); return [c, condition(t.columns[c].name, v)] as const; });
  return t.rows.flatMap((r, i) => (conds.every(([c, test]) => test(r[c] ?? "")) ? [i] : []));
}

const OPS = ["equals", "contains", "starts_with", "from", "to", "empty"];

/**
 * A test for one cell: a plain value matches it exactly (case and spacing aside); an object
 * combines { equals, contains, starts_with, from, to (inclusive; numbers compare as numbers,
 * dates and text as text), empty }.
 */
export function condition(col: string, v: unknown): (cell: string) => boolean {
  if (v === null || typeof v !== "object" || Array.isArray(v)) { const want = norm(String(v ?? "")); return (cell) => norm(cell) === want; }
  const o = v as Record<string, unknown>;
  const bad = Object.keys(o).filter((k) => !OPS.includes(k));
  if (bad.length || !Object.keys(o).length) throw new DataError(`where.${col}: use a value, or an object of ${OPS.join(", ")} (got ${Object.keys(o).join(", ") || "nothing"}).`);
  const n = (x: string) => { const m = parseFloat(x.replace(/[\s\u00a0]/g, "").replace(",", ".")); return /^-?[\d\s\u00a0]+([.,]\d+)?$/.test(x.trim()) ? m : NaN; };
  const cmp = (a: string, b: string) => { const x = n(a), y = n(b); return Number.isFinite(x) && Number.isFinite(y) ? x - y : norm(a) < norm(b) ? -1 : norm(a) > norm(b) ? 1 : 0; };
  return (cell) => {
    const c = norm(cell);
    if (o.equals !== undefined && c !== norm(String(o.equals))) return false;
    if (o.contains !== undefined && !c.includes(norm(String(o.contains)))) return false;
    if (o.starts_with !== undefined && !c.startsWith(norm(String(o.starts_with)))) return false;
    if (o.empty !== undefined && (c === "") !== (o.empty === true)) return false;
    if (o.from !== undefined && (c === "" || cmp(cell, String(o.from)) < 0)) return false;
    if (o.to !== undefined && (c === "" || cmp(cell, String(o.to)) > 0)) return false;
    return true;
  };
}

const preview = (t: Table, cells: string[]) => Object.fromEntries(t.columns.map((c, i) => [c.name, cells[i] ?? ""]));

/** Sets columns on the rows `where` matches. `expect` guards against matching more rows than meant. */
export function updateRows(body: string, ref: unknown, where: Where, set: Record<string, unknown>, today: string, opts: { all?: boolean } = {}) {
  const { table: t, index } = resolveTable(body, ref);
  if (typeof set !== "object" || set === null || Array.isArray(set) || !Object.keys(set).length) throw new DataError("set must name at least one column and its new value.");
  const hits = matching(body, t, where);
  if (!hits.length) throw new DataError(`No row matches ${JSON.stringify(where)}. Use read_table to see the rows.`);
  if (hits.length > 1 && !opts.all) throw new DataError(`${hits.length} rows match ${JSON.stringify(where)}. Add another column to where, or set all: true to change every one of them.`);
  const lines = body.split("\n");
  const at = rowLines(body, t);
  const changed = hits.map((i) => {
    const cells = cellsOf(t, set, today, `Row ${i}`, t.rows[i]);
    lines[at[i]] = rowLine(cells);
    return preview(t, cells);
  });
  return { body: lines.join("\n"), table: index, updated: changed.length, rows: changed.slice(0, 20) };
}

/** Removes the rows `where` matches. */
export function deleteRows(body: string, ref: unknown, where: Where, opts: { all?: boolean } = {}) {
  const { table: t, index } = resolveTable(body, ref);
  const hits = matching(body, t, where);
  if (!hits.length) throw new DataError(`No row matches ${JSON.stringify(where)}. Use read_table to see the rows.`);
  if (hits.length > 1 && !opts.all) throw new DataError(`${hits.length} rows match ${JSON.stringify(where)}. Add another column to where, or set all: true to delete every one of them.`);
  const lines = body.split("\n");
  const at = rowLines(body, t);
  const gone = hits.map((i) => preview(t, t.rows[i]));
  for (const i of [...hits].sort((a, b) => b - a)) lines.splice(at[i], 1);
  return { body: lines.join("\n"), table: index, deleted: gone.length, rows: gone.slice(0, 20) };
}

// MARK: Columns

export type ColumnChange =
  | { add: string; type?: string; after?: string; value?: unknown }
  | { rename: string; to: string }
  | { set_type: string; type: string }
  | { remove: string };

const TYPE_HELP = "text, number, date, scale 1-5 (any range), or choice A|B|C";

function parseColType(s: unknown): ColType {
  const t = String(s ?? "text").trim();
  const l = t.toLowerCase();
  if (l === "text" || l === "number" || l === "date") return { kind: l };
  const sc = t.match(/^scale\s*(\d+)\s*-\s*(\d+)$/i);
  if (sc && +sc[1] < +sc[2]) return { kind: "scale", min: +sc[1], max: +sc[2] };
  if (/^choice\b/i.test(t)) {
    const options = t.slice(6).split("|").map((o) => o.trim()).filter(Boolean);
    if (options.length >= 2) return { kind: "choice", options };
  }
  throw new DataError(`Unknown column type "${t}". Types: ${TYPE_HELP}.`);
}

/**
 * Adds, renames, retypes or removes columns. Every row keeps its values under the same column
 * (a rename moves nothing). Removing a column drops its values, so it needs `allowDrop`.
 */
export function editColumns(body: string, ref: unknown, changes: ColumnChange[], today: string, allowDrop: boolean) {
  if (!Array.isArray(changes) || !changes.length) throw new DataError("changes is empty.");
  const { table: t, index } = resolveTable(body, ref);
  const cols = t.columns.map((c) => ({ ...c }));
  let rows = t.rows.map((r) => [...r]);
  const did: string[] = [];
  changes.forEach((ch, n) => {
    const where = `Change ${n + 1}`;
    const find = (name: string) => {
      const i = cols.findIndex((c) => norm(c.name) === norm(name));
      if (i < 0) throw new DataError(`${where}: no column "${name}". Columns: ${cols.map((c) => c.name).join(", ")}.`);
      return i;
    };
    const checkName = (name: string) => {
      const s = String(name ?? "").trim();
      if (!s || s.includes("|") || /[\r\n]/.test(s)) throw new DataError(`${where}: a column name is one line of text without "|".`);
      if (cols.some((c) => norm(c.name) === norm(s))) throw new DataError(`${where}: there's already a column "${s}".`);
      return s;
    };
    if ("add" in ch) {
      const name = checkName(ch.add);
      const type = parseColType(ch.type);
      const at = ch.after ? find(ch.after) + 1 : cols.length;
      const col = { name, type };
      const fill = ch.value === undefined ? "" : cell(ch.value, col, today, where);
      cols.splice(at, 0, col);
      rows = rows.map((r) => { const x = [...r]; x.splice(at, 0, fill); return x; });
      did.push(`added ${name}`);
    } else if ("rename" in ch) {
      const i = find(ch.rename);
      const old = cols[i].name;
      cols[i].name = checkName(ch.to);
      did.push(`renamed ${old} to ${cols[i].name}`);
    } else if ("set_type" in ch) {
      const i = find(ch.set_type);
      const type = parseColType(ch.type);
      const col = { name: cols[i].name, type };
      const bad = rows.flatMap((r, k) => { try { coerce(r[i], col, today); return []; } catch { return [`row ${k} ("${r[i]}")`]; } });
      if (bad.length) throw new DataError(`${where}: ${bad.length} value${bad.length > 1 ? "s" : ""} in ${col.name} don't fit ${typeSpec(type)}: ${bad.slice(0, 5).join(", ")}. Fix them with update_table_rows first, or pick another type.`);
      // Values that fit stay exactly as written ("172.50" stays "172.50"); only the type changes.
      cols[i].type = type;
      did.push(`${col.name} is now ${typeSpec(type)}`);
    } else if ("remove" in ch) {
      const i = find(ch.remove);
      const filled = rows.filter((r) => (r[i] ?? "").trim() !== "").length;
      if (filled && !allowDrop) throw new DataError(`${where}: removing ${cols[i].name} would drop ${filled} filled value${filled > 1 ? "s" : ""}. Ask the person first, then call again with drop_values: true.`);
      did.push(`removed ${cols[i].name}${filled ? ` (${filled} values dropped)` : ""}`);
      cols.splice(i, 1);
      rows = rows.map((r) => r.filter((_, k) => k !== i));
    } else {
      throw new DataError(`${where}: each change is one of { add, type?, after?, value? }, { rename, to }, { set_type, type } or { remove }.`);
    }
  });
  if (!cols.length) throw new DataError("A table needs at least one column.");
  // The whole table is rewritten here: its header changes shape. Other lines stay as they were.
  const lines = body.split("\n");
  const typed = t.typed || cols.some((c) => c.type.kind !== "text");
  const out = [
    ...(typed ? ["<!-- pane-table: " + cols.map((c) => `${c.name}=${typeSpec(c.type)}`).join("; ") + " -->"] : []),
    rowLine(cols.map((c) => c.name)),
    "|" + cols.map(() => " --- ").join("|") + "|",
    ...rows.map(rowLine),
  ];
  lines.splice(t.start, t.end - t.start + 1, ...out);
  return { body: lines.join("\n"), table: index, changes: did, columns: cols.map((c) => ({ name: c.name, type: typeSpec(c.type) })) };
}

// MARK: Pasted data

/**
 * Rows from pasted CSV, TSV, semicolon-separated text or a markdown table. The first line is the
 * header; quoted fields ("a, b") and doubled quotes work as in spreadsheets.
 */
export function parseDelimited(text: string): { header: string[]; rows: string[][]; delimiter: string } {
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!src.trim()) throw new DataError("The pasted data is empty.");
  const first = src.split("\n").find((l) => l.trim()) ?? "";
  if (first.trim().startsWith("|")) {
    const lines = src.split("\n").filter((l) => l.trim().startsWith("|") && !/^[\s|:-]+$/.test(l));
    const [header, ...rows] = lines.map(tableCells);
    return { header, rows, delimiter: "|" };
  }
  const counts = ["\t", ";", ","].map((d) => ({ d, n: quotedSplit(first, d).length }));
  const delimiter = counts.find((c) => c.n > 1)?.d ?? ",";
  const records: string[][] = [];
  let row: string[] = [], field = "", quoted = false, i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (ch === '"') { quoted = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"' && field.trim() === "") { quoted = true; field = ""; i++; continue; }
    if (ch === delimiter) { row.push(field.trim()); field = ""; i++; continue; }
    if (ch === "\n") { row.push(field.trim()); records.push(row); row = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  if (quoted) throw new DataError("The pasted data has a quote (\") that's never closed.");
  row.push(field.trim());
  records.push(row);
  const nonEmpty = records.filter((r) => r.some((c) => c !== ""));
  const [header, ...rows] = nonEmpty;
  return { header, rows, delimiter };
}

function quotedSplit(line: string, d: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === d && !q) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Pasted rows as objects for addRows. Header names must match the table's columns (case and
 * spacing don't matter); `map` renames pasted headers to columns, and unmapped extra pasted
 * columns are refused unless `ignoreExtra`.
 */
export function pastedRows(body: string, ref: unknown, text: string, map: Record<string, string> = {}, ignoreExtra = false): RowInput[] {
  const { table: t } = resolveTable(body, ref);
  const { header, rows } = parseDelimited(text);
  const target = header.map((h) => {
    const mapped = Object.entries(map).find(([from]) => norm(from) === norm(h))?.[1];
    const name = mapped ?? h;
    const col = t.columns.find((c) => norm(c.name) === norm(name));
    return col ? col.name : null;
  });
  const extra = header.filter((_, i) => target[i] === null);
  if (extra.length && !ignoreExtra) {
    throw new DataError(`The pasted header has column${extra.length > 1 ? "s" : ""} the table doesn't: ${extra.map((e) => `"${e}"`).join(", ")}. Table columns: ${t.columns.map((c) => c.name).join(", ")}. Map them with column_map ({ "pasted": "Column" }), add them with edit_table_columns first, or set ignore_extra_columns: true.`);
  }
  if (!target.some((x) => x)) throw new DataError(`None of the pasted columns (${header.join(", ")}) match the table's (${t.columns.map((c) => c.name).join(", ")}). Is the first line a header?`);
  return rows.map((r, n) => {
    if (r.length > header.length && r.slice(header.length).some((c) => c)) throw new DataError(`Pasted row ${n + 1} has ${r.length} fields but the header has ${header.length}. Check for an unquoted delimiter in a value.`);
    return Object.fromEntries(header.flatMap((_, i) => (target[i] ? [[target[i]!, r[i] ?? ""]] : [])));
  });
}

// MARK: Checklists

const ITEM = /^(\s*)([-*+])(\s+)\[([ xX])\](\s+)(.*)$/;

export function checklistItems(body: string): { line: number; text: string; checked: boolean }[] {
  return body.split("\n").flatMap((l, i) => {
    const m = l.match(ITEM);
    return m ? [{ line: i + 1, text: m[6], checked: m[4] !== " " }] : [];
  });
}

function findHeading(lines: string[], heading: string): { at: number; end: number } {
  const want = norm(heading);
  const h = lines.findIndex((l) => /^#{1,6}\s/.test(l) && norm(l.replace(/^#{1,6}\s+/, "")) === want);
  if (h < 0) {
    const all = lines.filter((l) => /^#{1,6}\s/.test(l)).map((l) => l.replace(/^#{1,6}\s+/, ""));
    throw new DataError(`No heading "${heading}". Headings: ${all.length ? all.join(", ") : "none"}. Leave under_heading out to add to the note's first checklist, or create the heading first.`);
  }
  const level = lines[h].match(/^#+/)![0].length;
  let end = lines.length;
  for (let i = h + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s/);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return { at: h, end };
}

/**
 * Adds open items to a checklist: the one under `heading`, else the note's first checklist; a note
 * with none gets a new one at the end. Items go after the list's last open item, so they sit
 * above ticked ones, as in the app.
 */
export function addChecklistItems(body: string, items: string[], heading?: string): { body: string; added: string[] } {
  if (!Array.isArray(items) || !items.length) throw new DataError("items is empty.");
  const clean = items.map((s, i) => {
    const t = String(s ?? "").replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, "").replace(/\s+/g, " ").trim();
    if (!t) throw new DataError(`Item ${i + 1} is empty.`);
    return t;
  });
  const lines = body.split("\n");
  let lo = 0, hi = lines.length;
  if (heading) ({ at: lo, end: hi } = findHeading(lines, heading));
  let first = -1;
  for (let i = lo; i < hi; i++) if (ITEM.test(lines[i])) { first = i; break; }
  if (first < 0) {
    const addition = clean.map((t) => `- [ ] ${t}`);
    if (heading) {
      let at = hi;
      while (at > lo + 1 && lines[at - 1].trim() === "") at--;
      lines.splice(at, 0, ...addition);
    } else {
      while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
      lines.push("", ...addition, "");
    }
    return { body: lines.join("\n"), added: clean };
  }
  const indent = lines[first].match(ITEM)![1];
  const marker = lines[first].match(ITEM)![2];
  let last = first, lastOpen = -1;
  for (let i = first; i < hi; i++) {
    const m = lines[i].match(ITEM);
    if (m && m[1] === indent) { last = i; if (m[4] === " ") lastOpen = i; continue; }
    if (m || (lines[i].trim() && lines[i].match(/^(\s*)/)![1].length > indent.length)) continue; // nested
    break;
  }
  const at = (lastOpen >= 0 ? lastOpen : first - 1) + 1;
  // A nested list under the last open item stays with it.
  let pos = at;
  while (pos <= last && pos < hi && lines[pos].match(/^(\s*)/)![1].length > indent.length && lines[pos].trim()) pos++;
  lines.splice(pos, 0, ...clean.map((t) => `${indent}${marker} [ ] ${t}`));
  return { body: lines.join("\n"), added: clean };
}

export type ChecklistChange = { item: string; checked?: boolean; text?: string; remove?: boolean };

/** Ticks, unticks, renames or removes items matched by their text (exact first, then a unique part). */
export function updateChecklistItems(body: string, changes: ChecklistChange[]): { body: string; changed: { item: string; did: string }[] } {
  if (!Array.isArray(changes) || !changes.length) throw new DataError("changes is empty.");
  const lines = body.split("\n");
  const changed: { item: string; did: string }[] = [];
  for (const [n, ch] of changes.entries()) {
    const where = `Change ${n + 1}`;
    const items = lines.map((l, i) => ({ i, m: l.match(ITEM) })).filter((x) => x.m);
    if (!items.length) throw new DataError("This note has no checklist items.");
    const want = norm(String(ch?.item ?? ""));
    if (!want) throw new DataError(`${where}: item is empty.`);
    let hits = items.filter((x) => norm(x.m![6]) === want);
    if (!hits.length) hits = items.filter((x) => norm(x.m![6]).includes(want));
    if (!hits.length) throw new DataError(`${where}: no item matches "${ch.item}". Items: ${items.slice(0, 30).map((x) => x.m![6]).join("; ")}.`);
    if (hits.length > 1) throw new DataError(`${where}: "${ch.item}" matches ${hits.length} items: ${hits.slice(0, 5).map((x) => x.m![6]).join("; ")}. Use more of the text.`);
    const { i, m } = hits[0];
    const [, indent, marker, sp, box, sp2, text] = m!;
    if (ch.remove === true) {
      lines.splice(i, 1);
      changed.push({ item: text, did: "removed" });
      continue;
    }
    if (ch.checked === undefined && ch.text === undefined) throw new DataError(`${where}: say what to change: checked, text or remove.`);
    const nb = ch.checked === undefined ? box : ch.checked ? "x" : " ";
    const nt = ch.text === undefined ? text : String(ch.text).replace(/\s+/g, " ").trim();
    if (!nt) throw new DataError(`${where}: the new text is empty. To delete the item use remove: true.`);
    lines[i] = `${indent}${marker}${sp}[${nb}]${sp2}${nt}`;
    // Like a tap in the app: ticked items sink below the open ones in their list.
    if (ch.checked !== undefined && nb !== box) {
      const sorted = sortChecklist(lines, i);
      lines.splice(0, lines.length, ...sorted);
    }
    changed.push({ item: text, did: [ch.checked === true ? "checked" : ch.checked === false ? "unchecked" : "", ch.text !== undefined ? `renamed to "${nt}"` : ""].filter(Boolean).join(", ") });
  }
  return { body: lines.join("\n"), changed };
}

// MARK: A page's data
// The app's store (Pane/Model/NotePageData.swift): { values: {...}, collections: { name: [records] } },
// each record with a string id and created/updated stamps. The shape and size check is page.ts's.

/** RFC 7386 JSON merge patch: objects merge key by key, null removes a key, anything else replaces. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return patch;
  const out: Record<string, unknown> = typeof target === "object" && target !== null && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

export type StoreRecord = { id: string; created?: string; updated?: string; [k: string]: unknown };
export type Store = { values: Record<string, unknown>; collections: Record<string, StoreRecord[]> };
export type StoreChange = {
  values?: Record<string, unknown>;
  add?: Record<string, Record<string, unknown>[]>;
  update?: Record<string, ({ id: string } & Record<string, unknown>)[]>;
  remove?: Record<string, string[]>;
};

/**
 * The store after a change, as the app applies its own ops: values merge (null removes a key);
 * added records get an id (unless they bring an unused one) and created/updated stamps; updates
 * merge into the record with that id; removes take records by id. All or nothing.
 */
export function changeStore(doc: Store, ch: StoreChange, now: string, newId: () => string = () => crypto.randomUUID()): { store: Store; added: Record<string, string[]>; changed: number } {
  if (typeof ch !== "object" || ch === null) throw new DataError("Say what to change: values, add, update or remove.");
  const known = ["values", "add", "update", "remove"];
  const extra = Object.keys(ch).filter((k) => !known.includes(k));
  if (extra.length) throw new DataError(`Unknown change ${extra.join(", ")}: use values, add, update or remove.`);
  const store: Store = JSON.parse(JSON.stringify({ values: doc.values ?? {}, collections: doc.collections ?? {} }));
  const added: Record<string, string[]> = {};
  let changed = 0;
  const obj = (v: unknown, what: string) => { if (typeof v !== "object" || v === null || Array.isArray(v)) throw new DataError(`${what} must be an object.`); return v as Record<string, unknown>; };
  if (ch.values !== undefined) { store.values = mergePatch(store.values, obj(ch.values, "values")) as Record<string, unknown>; changed++; }
  for (const [name, list] of Object.entries(ch.add ? obj(ch.add, "add") : {})) {
    if (!Array.isArray(list)) throw new DataError(`add.${name} must be a list of records.`);
    const rows = store.collections[name] ??= [];
    for (const [i, fields] of list.entries()) {
      const f = { ...obj(fields, `add.${name}[${i}]`) };
      const id = typeof f.id === "string" && f.id && !rows.some((r) => r.id === f.id) ? f.id : newId();
      rows.push({ ...f, id, created: typeof f.created === "string" ? f.created : now, updated: now });
      (added[name] ??= []).push(id);
      changed++;
    }
  }
  for (const [name, list] of Object.entries(ch.update ? obj(ch.update, "update") : {})) {
    if (!Array.isArray(list)) throw new DataError(`update.${name} must be a list of { id, ...fields }.`);
    const rows = store.collections[name];
    if (!rows) throw new DataError(`No collection "${name}". Collections: ${Object.keys(store.collections).join(", ") || "none"}.`);
    for (const [i, patch] of list.entries()) {
      const p = obj(patch, `update.${name}[${i}]`);
      const k = rows.findIndex((r) => r.id === p.id);
      if (k < 0) throw new DataError(`update.${name}[${i}]: no record with id ${JSON.stringify(p.id)} in ${name}. Read the ids with get_page_data.`);
      rows[k] = { ...(mergePatch(rows[k], p) as StoreRecord), id: rows[k].id, updated: now };
      changed++;
    }
  }
  for (const [name, ids] of Object.entries(ch.remove ? obj(ch.remove, "remove") : {})) {
    if (!Array.isArray(ids)) throw new DataError(`remove.${name} must be a list of ids.`);
    const rows = store.collections[name];
    if (!rows) throw new DataError(`No collection "${name}".`);
    for (const id of ids) {
      const k = rows.findIndex((r) => r.id === id);
      if (k < 0) throw new DataError(`remove.${name}: no record with id ${JSON.stringify(id)}.`);
      rows.splice(k, 1);
      changed++;
    }
  }
  if (!changed) throw new DataError("Nothing to change: give values, add, update or remove.");
  return { store, added, changed };
}

/** A value at a dotted path ("values.goal", "collections.runs.0.km"), or undefined. */
export function atPath(data: unknown, path: string): unknown {
  let cur = data;
  for (const part of path.split(".").filter(Boolean)) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Records of a collection that match `where` (field → value or test, as for table rows), paged. */
export function queryRecords(store: Store, name: string, where: Record<string, unknown> = {}, limit = 50, offset = 0, fields?: string[]) {
  const all = store.collections[name];
  if (!all) throw new DataError(`No collection "${name}". Collections: ${Object.entries(store.collections).map(([k, v]) => `${k} (${v.length})`).join(", ") || "none"}.`);
  if (typeof where !== "object" || where === null || Array.isArray(where)) throw new DataError("where must be an object of field → value or test.");
  const tests = Object.entries(where).map(([k, v]) => [k, condition(k, v)] as const);
  const str = (x: unknown) => (x === null || x === undefined ? "" : typeof x === "object" ? JSON.stringify(x) : String(x));
  const hits = all.filter((r) => tests.every(([k, t]) => t(str(atPath(r, k)))));
  const page = hits.slice(offset, offset + limit).map((r) => (fields?.length ? Object.fromEntries(["id", ...fields].map((f) => [f, atPath(r, f) ?? null])) : r));
  return { collection: name, total: all.length, matched: hits.length, records: page, ...(offset + limit < hits.length ? { next_offset: offset + limit } : {}) };
}

/**
 * Records from pasted CSV/TSV for a collection. Numbers, true/false and empty cells become JSON
 * numbers, booleans and absent fields; "a.b" headers make nested objects; column_map renames.
 */
export function recordsFromCsv(text: string, map: Record<string, string> = {}): Record<string, unknown>[] {
  const { header, rows } = parseDelimited(text);
  const names = header.map((h) => Object.entries(map).find(([k]) => norm(k) === norm(h))?.[1] ?? h);
  if (names.some((n) => !n)) throw new DataError("Every pasted column needs a name in the header line.");
  if (rows.length > 20000) throw new DataError(`${rows.length} rows at once is too many; send at most 20000 per call.`);
  return rows.map((r) => {
    const out: Record<string, unknown> = {};
    names.forEach((n, i) => {
      const c = (r[i] ?? "").trim();
      if (c === "") return;
      const v: unknown = /^-?\d+(\.\d+)?$/.test(c) ? Number(c) : /^(true|false)$/i.test(c) ? c.toLowerCase() === "true" : c;
      const parts = n.split(".");
      let at = out;
      for (const p of parts.slice(0, -1)) at = (at[p] ??= {}) as Record<string, unknown>;
      at[parts[parts.length - 1]] = v;
    });
    return out;
  });
}

/** Every { "$new_file": { name, type, text | base64 } } in records, so they can be saved first. */
export function newFiles(value: unknown, found: { name: string; type: string; text?: string; base64?: string }[] = []) {
  if (Array.isArray(value)) value.forEach((v) => newFiles(v, found));
  else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (o.$new_file && typeof o.$new_file === "object") {
      const f = o.$new_file as Record<string, unknown>;
      if (typeof f.name !== "string" || !f.name.trim()) throw new DataError("$new_file needs a name, like \"receipt.txt\".");
      if ((typeof f.text === "string") === (typeof f.base64 === "string")) throw new DataError(`$new_file "${f.name}" needs text or base64 (one of them).`);
      found.push({ name: f.name, type: typeof f.type === "string" ? f.type : "", ...(typeof f.text === "string" ? { text: f.text } : { base64: f.base64 as string }) });
    } else Object.values(o).forEach((v) => newFiles(v, found));
  }
  return found;
}

/** The same value with each $new_file replaced by what saving it returned, in order. */
export function placeFiles(value: unknown, saved: Record<string, unknown>[], at = { i: 0 }): unknown {
  if (Array.isArray(value)) return value.map((v) => placeFiles(v, saved, at));
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (o.$new_file) return saved[at.i++];
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, placeFiles(v, saved, at)]));
  }
  return value;
}

/** Every { "$file": id } a value refers to. */
export function fileRefs(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => fileRefs(v, out));
  else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.$file === "string") out.push(o.$file);
    else Object.values(o).forEach((v) => fileRefs(v, out));
  }
  return out;
}

/** The records a question is about: a collection by name, or an array anywhere in values by a
 *  dotted path ("values.log", "values.localStorage.workouts"); a JSON string there (how
 *  localStorage keeps things) is parsed. */
export function recordsAt(store: Store, from: string): Record<string, unknown>[] {
  if (store.collections[from]) return store.collections[from];
  let v = atPath(store, from.startsWith("values.") || from.startsWith("collections.") ? from : `values.${from}`);
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { /* not JSON */ } }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    // An object of records keyed by id or date ({ "2026-10-01": { … } }): its entries, with the key.
    v = Object.entries(v as Record<string, unknown>).map(([key, x]) => (x && typeof x === "object" && !Array.isArray(x) ? { key, ...(x as object) } : { key, value: x }));
  }
  if (!Array.isArray(v)) {
    const arrays = [...Object.keys(store.collections).map((k) => `${k} (collection)`), ...Object.entries(store.values).filter(([, x]) => Array.isArray(x) || (typeof x === "string" && /^\s*\[/.test(x))).map(([k]) => `values.${k}`)];
    throw new DataError(`Nothing to query at "${from}". Lists in this app's data: ${arrays.join(", ") || "none"} (get_page_data shows all of it).`);
  }
  return v.map((x) => (x && typeof x === "object" ? x as Record<string, unknown> : { value: x }));
}

const WEEKDAY_MS = 86400000;
/** A record's group key: a field's value, or a date field bucketed by day, week (Monday) or month. */
function bucket(r: Record<string, unknown>, by: string): string {
  const [field, unit] = by.split(":");
  const raw = atPath(r, field);
  if (!unit) return raw === undefined || raw === null || raw === "" ? "(none)" : typeof raw === "object" ? JSON.stringify(raw) : String(raw);
  const s = String(raw ?? "");
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00:00Z" : s);
  if (isNaN(d.getTime())) return "(no date)";
  if (unit === "day") return d.toISOString().slice(0, 10);
  if (unit === "month") return d.toISOString().slice(0, 7);
  if (unit === "year") return d.toISOString().slice(0, 4);
  if (unit === "week") return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * WEEKDAY_MS).toISOString().slice(0, 10);
  throw new DataError(`group_by "${by}": the unit is day, week, month or year.`);
}

/**
 * Answers a question over an app's JSON: filter (where), group (a field, or a date field by day,
 * week, month or year) and sum / average / min / max of numeric fields, with counts.
 */
export function aggregate(records: Record<string, unknown>[], q: { where?: Record<string, unknown>; group_by?: string; sum?: string[]; avg?: string[]; min?: string[]; max?: string[]; sort?: "key" | "count" | string; limit?: number }) {
  const where = q.where ?? {};
  if (typeof where !== "object" || Array.isArray(where)) throw new DataError("where must be an object of field → value or test.");
  const tests = Object.entries(where).map(([k, v]) => [k, condition(k, v)] as const);
  const str = (x: unknown) => (x === null || x === undefined ? "" : typeof x === "object" ? JSON.stringify(x) : String(x));
  const hits = records.filter((r) => tests.every(([k, t]) => t(str(atPath(r, k)))));
  const num = (r: Record<string, unknown>, f: string) => { const v = atPath(r, f); const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
  const stats = (rows: Record<string, unknown>[]) => {
    const out: Record<string, unknown> = { count: rows.length };
    const pick = (fields: string[] | undefined, name: string, fn: (xs: number[]) => number) => {
      if (!fields?.length) return;
      out[name] = Object.fromEntries(fields.map((f) => { const xs = rows.map((r) => num(r, f)).filter((x): x is number => x !== null); return [f, xs.length ? Math.round(fn(xs) * 1000) / 1000 : null]; }));
    };
    pick(q.sum, "sum", (xs) => xs.reduce((a, b) => a + b, 0));
    pick(q.avg, "avg", (xs) => xs.reduce((a, b) => a + b, 0) / xs.length);
    pick(q.min, "min", (xs) => Math.min(...xs));
    pick(q.max, "max", (xs) => Math.max(...xs));
    return out;
  };
  const total = stats(hits);
  if (!q.group_by) return { matched: hits.length, of: records.length, ...total };
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of hits) { const k = bucket(r, q.group_by); groups.set(k, [...(groups.get(k) ?? []), r]); }
  let list = [...groups].map(([key, rows]) => ({ [q.group_by!]: key, ...stats(rows) }));
  const sort = q.sort ?? "key";
  list = list.sort((a, b) => sort === "key" ? String(a[q.group_by!]).localeCompare(String(b[q.group_by!]))
    : sort === "count" ? (b.count as number) - (a.count as number)
    : (((b.sum as Record<string, number>)?.[sort] ?? 0) - ((a.sum as Record<string, number>)?.[sort] ?? 0)));
  const limit = Math.min(Math.max(1, q.limit ?? 100), 500);
  return { matched: hits.length, of: records.length, total, groups: list.slice(0, limit), ...(list.length > limit ? { more_groups: list.length - limit } : {}) };
}

/**
 * The app's data as an AI should see it: what the app keeps in localStorage (values.localStorage,
 * strings, usually JSON.stringify'd) parsed into JSON, so records read and change as records.
 * closeStored turns them back into strings before the data is saved, as the app expects them.
 */
export function openStored<T extends { values: Record<string, unknown> }>(data: T): T {
  const ls = data.values?.localStorage;
  if (!ls || typeof ls !== "object" || Array.isArray(ls)) return data;
  const parsed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ls as Record<string, unknown>)) {
    if (typeof v === "string" && /^\s*[\[{"]|^\s*(true|false|null|-?\d)/.test(v)) { try { parsed[k] = JSON.parse(v); continue; } catch { /* plain text */ } }
    parsed[k] = v;
  }
  return { ...data, values: { ...data.values, localStorage: parsed } };
}
export function closeStored<T extends { values: Record<string, unknown> }>(data: T): T {
  const ls = data.values?.localStorage;
  if (!ls || typeof ls !== "object" || Array.isArray(ls)) return data;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ls as Record<string, unknown>)) if (v !== null && v !== undefined) out[k] = typeof v === "string" ? v : JSON.stringify(v);
  return { ...data, values: { ...data.values, localStorage: out } };
}

type Shape = string | { list: number; fields: Record<string, { type: string; examples: unknown[] }> } | { object: Record<string, Shape> };
const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "list" : typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? "date" : typeof v === "object" && v && "$file" in (v as object) ? "file" : typeof v);
/** The data's structure, inferred: lists of records with each field's type and a couple of example
 *  values, objects by key, and plain values by type. */
export function dataShape(v: unknown, depth = 0): Shape {
  if (Array.isArray(v)) {
    const recs = v.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[];
    if (!recs.length) return `list of ${[...new Set(v.map(typeOf))].join(" | ") || "nothing"} (${v.length})`;
    const fields: Record<string, { type: string; examples: unknown[] }> = {};
    for (const r of recs.slice(0, 200)) for (const [k, x] of Object.entries(r)) {
      const f = (fields[k] ??= { type: typeOf(x), examples: [] });
      if (f.type !== typeOf(x) && x !== null) f.type = [...new Set([...f.type.split(" | "), typeOf(x)])].join(" | ");
      const ex = typeof x === "object" && x !== null ? JSON.stringify(x).slice(0, 60) : typeof x === "string" ? x.slice(0, 60) : x;
      if (f.examples.length < 2 && !f.examples.some((e) => JSON.stringify(e) === JSON.stringify(ex))) f.examples.push(ex);
    }
    return { list: v.length, fields };
  }
  if (v && typeof v === "object") {
    if (depth > 3) return "object";
    // An object keyed by dates or ids, with records as values: shown as such.
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length > 6 && entries.every(([, x]) => x && typeof x === "object")) return { object: { [`(${entries.length} keys like "${entries[0][0]}")`]: dataShape(entries.map(([, x]) => x), depth + 1) } };
    return { object: Object.fromEntries(entries.map(([k, x]) => [k, dataShape(x, depth + 1)])) };
  }
  return typeOf(v);
}
