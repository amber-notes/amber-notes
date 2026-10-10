// What edit and write (the file-like tools) say after a note changes: real breakage only. A table
// row with the wrong number of cells or table-looking lines that no longer make a table, a
// checklist line the app won't read as one, and tracker values outside their column's type (what
// log_table_row used to refuse). Only what the change introduced is reported. Pure; tested in
// note_checks.test.ts.
import { coerce, findTables, tableCells, typeSpec } from "./notes.ts";

const CHECK = /^\s*[-*+]\s+\[[ xX]\]\s+\S/;
// Lines someone meant as a checklist item but the app won't tick: "-[ ]", "- []", "- [ x]", "- [v] a".
const NEAR_CHECK = /^\s*[-*+]\s*\[[^\]]{0,3}\]/;

/** Lines that start like a table row but aren't part of any table. */
function strayRows(body: string): string[] {
  const lines = body.split("\n");
  const inTable = new Set<number>();
  for (const t of findTables(body)) for (let k = t.start; k <= t.end; k++) inTable.add(k);
  let code = false;
  const out: string[] = [];
  lines.forEach((l, k) => {
    if (/^\s*(```|~~~)/.test(l)) { code = !code; return; }
    if (!code && /^\s*\|.*\|\s*$/.test(l) && !inTable.has(k)) out.push(l.trim());
  });
  return out;
}

/** Rows whose cell count differs from their table's header. */
function raggedRows(body: string): string[] {
  const lines = body.split("\n");
  const out: string[] = [];
  for (const t of findTables(body)) {
    for (let k = t.start; k <= t.end; k++) {
      const l = lines[k];
      if (!/^\s*\|/.test(l) || /^[\s|:-]+$/.test(l)) continue;
      const n = tableCells(l).length;
      if (n !== t.columns.length) out.push(`"${l.trim().slice(0, 80)}" has ${n} cells; its table has ${t.columns.length} columns (${t.columns.map((c) => c.name).join(", ")}).`);
    }
  }
  return out;
}

/** Tracker cells that don't fit their column's type (a scale out of range, a choice not in the list…). */
function badTrackerValues(body: string, today: string): string[] {
  const out: string[] = [];
  for (const t of findTables(body)) {
    if (!t.typed) continue;
    for (const r of t.rows) {
      t.columns.forEach((col, i) => {
        if (col.type.kind === "text" || !r[i]) return;
        try { coerce(r[i], col, today); } catch (e) { out.push(`${(e as Error).message} Column ${col.name} is ${typeSpec(col.type)}.`); }
      });
    }
  }
  return out;
}

/** What the change broke: each problem in the new text that wasn't in the old one. */
export function noteChecks(before: string, after: string, today: string): string[] {
  const fresh = (now: string[], was: string[]) => { const left = [...was]; return now.filter((x) => { const i = left.indexOf(x); if (i >= 0) { left.splice(i, 1); return false; } return true; }); };
  const near = (b: string) => b.split("\n").filter((l) => NEAR_CHECK.test(l) && !CHECK.test(l)).map((l) => l.trim());
  return [
    ...fresh(raggedRows(after), raggedRows(before)).map((m) => `Table row: ${m}`),
    ...fresh(strayRows(after), strayRows(before)).map((l) => `"${l.slice(0, 80)}" looks like a table row but isn't in a table any more (a table needs its header and a | --- | line right under it, with no blank lines between rows).`),
    ...fresh(near(after), near(before)).map((l) => `"${l.slice(0, 80)}" won't show as a checklist item: write "- [ ] text" (or "- [x] text").`),
    ...fresh(badTrackerValues(after, today), badTrackerValues(before, today)).map((m) => `Tracker value: ${m}`),
  ];
}
