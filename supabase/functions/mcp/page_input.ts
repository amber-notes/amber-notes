// Note pages (prototype): what a page is handed as window.amber.note, and the edits it can ask
// for, as the app computes them (Pane/Model/NotePage.swift). The server uses it to show an AI
// exactly what its page will get (get_note_page); the page evals use it to run pages outside the
// app. Pure, so it's unit-tested against the same cases as the Swift.

import { tableCells } from "./notes.ts";
import { addChecklistItems } from "./data_ops.ts";

export type PageNote = {
  title: string;
  markdown: string;
  today: string;
  tables: { index: number; columns: { name: string; type: string }[]; rows: string[][] }[];
  checklists: { line: number; text: string; checked: boolean }[];
};

const isRow = (l: string) => l.trim().startsWith("|");
const isSeparator = (l: string) => { const t = l.trim(); return t.startsWith("|") && t.includes("-") && [...t].every((c) => "|-: ".includes(c)); };
const CHECK = /^([ \t]*)([-*+])([ \t]+)\[([ xX])\][ \t]+/;

type Found = { columns: { name: string; type: string }[]; rows: string[][]; rowLines: number[]; end: number };

function tables(lines: string[]): Found[] {
  const out: Found[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!(isRow(lines[i]) && i + 1 < lines.length && isSeparator(lines[i + 1]))) { i++; continue; }
    const types = new Map<string, string>();
    const above = i > 0 ? lines[i - 1].trim() : "";
    if (above.startsWith("<!--") && above.includes("pane-table:")) {
      for (const part of above.slice(above.indexOf("pane-table:") + 11).replace(/-->\s*$/, "").split(";")) {
        const eq = part.indexOf("=");
        if (eq > 0) types.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
      }
    }
    const header = tableCells(lines[i]);
    const rows: string[][] = [], rowLines: number[] = [];
    let j = i + 2;
    while (j < lines.length && isRow(lines[j])) {
      const c = tableCells(lines[j]);
      while (c.length < header.length) c.push("");
      rows.push(c.slice(0, header.length));
      rowLines.push(j);
      j++;
    }
    out.push({ columns: header.map((name) => ({ name, type: types.get(name) ?? "text" })), rows, rowLines, end: j });
    i = j;
  }
  return out;
}

function titleOf(body: string): string {
  for (const l of body.split("\n")) {
    const t = l.replace(/^#{1,6}\s+/, "").trim();
    if (t) return t;
  }
  return "New Note";
}

/** window.amber.note for a note's markdown. */
export function noteForPage(body: string, today: string): PageNote {
  const lines = body.split("\n");
  return {
    title: titleOf(body),
    markdown: body,
    today,
    tables: tables(lines).map((t, index) => ({ index, columns: t.columns, rows: t.rows })),
    checklists: lines.flatMap((l, i) => {
      const m = l.match(CHECK);
      return m ? [{ line: i + 1, text: l.slice(m[0].length), checked: m[4] !== " " }] : [];
    }),
  };
}

export type PageOp =
  | { op: "toggle_checklist"; line: number }
  | { op: "set_cell"; table: number; row: number; col: number | string; value: unknown }
  | { op: "append_row"; table: number; values: Record<string, unknown> | unknown[] }
  | { op: "delete_row"; table: number; row: number }
  | { op: "move_row"; table: number; from: number; to: number }
  | { op: "set_text"; heading: string; text: string }
  | { op: "add_checklist_item"; text: string; under_heading?: string };

const text = (v: unknown): string => {
  const s = typeof v === "string" ? v : typeof v === "boolean" ? (v ? "Yes" : "No") : typeof v === "number" ? String(v) : v === null || v === undefined ? "" : (() => { throw new Error("Cell values are text."); })();
  if (s.length > 500) throw new Error("A cell holds at most 500 characters.");
  return s.replace(/\r/g, " ").replace(/\n/g, " ");
};
const whole = (v: unknown, k: string) => { if (typeof v !== "number" || !Number.isInteger(v)) throw new Error(`${k} must be a whole number.`); return v; };
const rowLine = (cells: string[]) => "| " + cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ") + " |";

/** The note after a page's amber.update(op) or amber.update([ops]) (one change, all or nothing). */
export function applyPageOp(body: string, raw: unknown): string {
  if (Array.isArray(raw)) {
    if (!raw.length) throw new Error("Send at least one op.");
    return raw.reduce((b: string, op, i) => { try { return applyOne(b, op); } catch (e) { throw new Error(`Op ${i + 1}: ${(e as Error).message}`); } }, body);
  }
  return applyOne(body, raw);
}

function applyOne(body: string, raw: unknown): string {
  const m = raw as Record<string, unknown>;
  if (!m || typeof m !== "object" || typeof m.op !== "string") throw new Error("Send { op, … }.");
  const lines = body.split("\n");
  const table = (i: number) => {
    const all = tables(lines);
    if (i < 0 || i >= all.length) throw new Error(all.length ? `Table ${i} doesn't exist (0-${all.length - 1}).` : "This note has no table.");
    return all[i];
  };
  const column = (t: Found, c: unknown) => {
    if (typeof c === "string") {
      const i = t.columns.findIndex((x) => x.name.toLowerCase() === c.toLowerCase());
      if (i < 0) throw new Error(`No column ${c}. Columns: ${t.columns.map((x) => x.name).join(", ")}.`);
      return i;
    }
    const i = whole(c, "col");
    if (i < 0 || i >= t.columns.length) throw new Error(`Column ${i} doesn't exist (0-${t.columns.length - 1}).`);
    return i;
  };
  switch (m.op) {
    case "toggle_checklist": {
      const line = whole(m.line, "line");
      const k = line - 1;
      const hit = lines[k]?.match(CHECK);
      if (!hit) throw new Error(`Line ${line} isn't a checklist item.`);
      const at = hit[1].length + hit[2].length + hit[3].length + 1;
      lines[k] = lines[k].slice(0, at) + (hit[4] === " " ? "x" : " ") + lines[k].slice(at + 1);
      // Ticked items sink below open ones in their run, as in the app.
      const indent = hit[1];
      const same = (j: number) => { const x = lines[j]?.match(CHECK); return x && x[1] === indent ? x : null; };
      let lo = k, hi = k;
      while (lo > 0 && same(lo - 1)) lo--;
      while (hi + 1 < lines.length && same(hi + 1)) hi++;
      const run = lines.slice(lo, hi + 1);
      const open = run.filter((l) => l.match(CHECK)![4] === " "), done = run.filter((l) => l.match(CHECK)![4] !== " ");
      lines.splice(lo, run.length, ...open, ...done);
      return lines.join("\n");
    }
    case "set_cell": {
      const t = table(whole(m.table, "table"));
      const row = whole(m.row, "row");
      if (row < 0 || row >= t.rows.length) throw new Error(`Table ${m.table} has ${t.rows.length} rows (0-${t.rows.length - 1}).`);
      const cells = [...t.rows[row]];
      cells[column(t, m.col)] = text(m.value);
      lines[t.rowLines[row]] = rowLine(cells);
      return lines.join("\n");
    }
    case "append_row": {
      const t = table(whole(m.table, "table"));
      const cells = t.columns.map(() => "");
      if (Array.isArray(m.values)) {
        if (m.values.length > cells.length) throw new Error(`Table ${m.table} has ${cells.length} columns.`);
        m.values.forEach((v, i) => { cells[i] = text(v); });
      } else if (m.values && typeof m.values === "object") {
        for (const [k, v] of Object.entries(m.values)) cells[column(t, k)] = text(v);
      } else {
        throw new Error("values must be an object or a list.");
      }
      lines.splice(t.end, 0, rowLine(cells));
      return lines.join("\n");
    }
    case "delete_row": {
      const t = table(whole(m.table, "table"));
      const row = whole(m.row, "row");
      if (row < 0 || row >= t.rows.length) throw new Error(`Table ${m.table} has ${t.rows.length} rows (0-${t.rows.length - 1}).`);
      lines.splice(t.rowLines[row], 1);
      return lines.join("\n");
    }
    case "move_row": {
      const t = table(whole(m.table, "table"));
      const from = whole(m.from, "from"), to = whole(m.to, "to"), n = t.rows.length;
      if (from < 0 || from >= n || to < 0 || to >= n) throw new Error(`Table ${m.table} has ${n} rows (0-${n - 1}).`);
      if (from === to) return body;
      const [line] = lines.splice(t.rowLines[from], 1);
      lines.splice(t.rowLines[to], 0, line);
      return lines.join("\n");
    }
    case "set_text": {
      const want = typeof m.heading === "string" ? m.heading.trim().toLowerCase() : "";
      if (!want) throw new Error("heading must be the heading's text.");
      if (typeof m.text !== "string" || m.text.length > 20_000) throw new Error("text must be text, at most 20,000 characters.");
      const level = (l: string) => { const h = l.match(/^(#{1,6}) /); return h ? h[1].length : null; };
      const at = lines.findIndex((l) => level(l) !== null && l.replace(/^#+/, "").trim().toLowerCase() === want);
      if (at < 0) throw new Error(`No heading ${m.heading}.`);
      const lv = level(lines[at])!;
      let end = at + 1;
      while (end < lines.length && (level(lines[end]) === null || level(lines[end])! > lv)) end++;
      const section = m.text.replace(/\r/g, "").split("\n");
      while (section.length && !section[section.length - 1].trim()) section.pop();
      if (end < lines.length) section.push("");
      lines.splice(at + 1, end - at - 1, ...section);
      return lines.join("\n");
    }
    case "add_column": {
      const t = table(whole(m.table, "table"));
      const name = typeof m.name === "string" ? m.name.trim() : "";
      if (!name || name.includes("|")) throw new Error("name must be a column name.");
      if (t.columns.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new Error(`Table ${m.table} already has a column ${name}.`);
      const at = m.after !== undefined ? column(t, m.after) + 1 : t.columns.length;
      const ins = (cells: string[], v: string) => { const c = [...cells]; c.splice(at, 0, v); return c; };
      const header = t.rowLines.length ? t.rowLines[0] - 2 : t.end - 2;
      lines[header] = rowLine(ins(t.columns.map((c) => c.name), name));
      lines[header + 1] = "|" + Array(t.columns.length + 1).fill(" --- ").join("|") + "|";
      t.rowLines.forEach((k, r) => { lines[k] = rowLine(ins(t.rows[r], "")); });
      const typeLine = header > 0 && lines[header - 1].includes("pane-table:") ? header - 1 : -1;
      if (typeLine >= 0) {
        const cols = t.columns.map((c) => `${c.name}=${c.type}`);
        cols.splice(at, 0, `${name}=${typeof m.type === "string" ? m.type : "text"}`);
        lines[typeLine] = `<!-- pane-table: ${cols.join("; ")} -->`;
      }
      return lines.join("\n");
    }
    case "rename_column": {
      const t = table(whole(m.table, "table"));
      const c = column(t, m.col);
      const to = typeof m.to === "string" ? m.to.trim() : "";
      if (!to || to.includes("|")) throw new Error("to must be a column name.");
      if (t.columns.some((x, k) => k !== c && x.name.toLowerCase() === to.toLowerCase())) throw new Error(`Table ${m.table} already has a column ${to}.`);
      const header = t.rowLines.length ? t.rowLines[0] - 2 : t.end - 2;
      const names = t.columns.map((x) => x.name);
      names[c] = to;
      lines[header] = rowLine(names);
      const typeLine = header > 0 && lines[header - 1].includes("pane-table:") ? header - 1 : -1;
      if (typeLine >= 0) lines[typeLine] = `<!-- pane-table: ${t.columns.map((x, k) => `${k === c ? to : x.name}=${x.type}`).join("; ")} -->`;
      return lines.join("\n");
    }
    case "add_checklist_item": {
      // As the add_checklist_items tool: after the last open item of the heading's checklist (or
      // the note's first one); a note without one gets a new checklist at the end.
      const t = text(m.text).trim();
      if (!t) throw new Error("text is empty.");
      const h = typeof m.under_heading === "string" && m.under_heading.trim() ? m.under_heading : undefined;
      return addChecklistItems(body, [t], h).body;
    }
    default:
      throw new Error(`Unknown op ${m.op}.`);
  }
}
