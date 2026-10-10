// The data tools' pure helpers (data_ops.ts).
//   cd supabase/functions/mcp && deno test -A data_ops.test.ts
import { assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { addChecklistItems, addRows, changeStore, DataError, deleteRows, editColumns, mergePatch, newTable, parseDelimited, pastedRows, resolveTable, updateChecklistItems, updateRows } from "./data_ops.ts";
import { findTables } from "./notes.ts";

const TODAY = "2026-10-05";
const READING = "Reading log\n\nIntro line.\n\n## Books\n\n| Title | Author | Rating |\n|:---|:---|---:|\n| Dune | Herbert | 5 |\n| Emma | Austen | 4 |\n\nAfter the table.\n";
const TRACKER = "Runs\n\n<!-- pane-table: Date=date; Km=number; Feel=scale 1-5 -->\n| Date | Km | Feel |\n| --- | --- | --- |\n| 2026-10-01 | 5 | 3 |\n| 2026-10-03 | 7.5 | 4 |\n";

const otherLines = (before: string, after: string) => {
  const a = before.split("\n"), b = after.split("\n");
  return a.filter((l) => !l.startsWith("|")).join("\n") === b.filter((l) => !l.startsWith("|")).join("\n");
};

Deno.test("rows are added without touching any other line, even the table's own formatting", () => {
  const r = addRows(READING, undefined, [{ title: "Ulysses", Author: "Joyce", Rating: 3 }, ["Beloved", "Morrison", "5"]], TODAY);
  assertEquals(r.added, 2);
  assertStringIncludes(r.body, "|:---|:---|---:|\n| Dune | Herbert | 5 |\n| Emma | Austen | 4 |\n| Ulysses | Joyce | 3 |\n| Beloved | Morrison | 5 |\n\nAfter the table.");
});

Deno.test("dated tracker rows go in date order; types are checked for every row before any lands", () => {
  const r = addRows(TRACKER, "Km", [{ Date: "2026-10-02", Km: "6,2", Feel: 5 }, { Date: "2026-10-09", Km: 3 }], TODAY);
  assertEquals(findTables(r.body)[0].rows.map((x) => x[0]), ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-09"]);
  assertEquals(findTables(r.body)[0].rows[1], ["2026-10-02", "6.2", "5"]);
  const e = assertThrows(() => addRows(TRACKER, 0, [{ Date: "2026-10-04", Km: 1 }, { Date: "2026-10-05", Feel: 9 }], TODAY), DataError);
  assertStringIncludes(e.message, "Row 2: Feel must be a whole number from 1 to 5");
});

Deno.test("unknown columns are refused with the column list and the fix", () => {
  const e = assertThrows(() => addRows(READING, undefined, [{ Title: "X", Pages: 300 }], TODAY), DataError);
  assertStringIncludes(e.message, `unknown column "Pages"`);
  assertStringIncludes(e.message, "edit_table_columns");
});

Deno.test("tables are found by heading, column name or index; a bad name lists the tables", () => {
  assertEquals(resolveTable(READING, "Books").index, 0);
  assertEquals(resolveTable(READING, "author").index, 0);
  assertStringIncludes(assertThrows(() => resolveTable(READING, "Movies"), DataError).message, `0 ("Books"): Title, Author, Rating`);
});

Deno.test("update and delete match rows by values and refuse ambiguous matches", () => {
  const u = updateRows(READING, undefined, { Title: "emma" }, { Rating: 5 }, TODAY);
  assertStringIncludes(u.body, "| Emma | Austen | 5 |");
  assertEquals(otherLines(READING, u.body), true);
  const two = READING.replace("| Emma | Austen | 4 |", "| Emma | Austen | 4 |\n| Persuasion | Austen | 4 |");
  assertStringIncludes(assertThrows(() => deleteRows(two, undefined, { Author: "Austen" }), DataError).message, "2 rows match");
  const d = deleteRows(two, undefined, { Author: "Austen" }, { all: true });
  assertEquals(d.deleted, 2);
  assertEquals(findTables(d.body)[0].rows, [["Dune", "Herbert", "5"]]);
  assertStringIncludes(assertThrows(() => updateRows(READING, undefined, { Title: "Nope" }, { Rating: 1 }, TODAY), DataError).message, "read_table");
});

Deno.test("renaming a column keeps every value; removing one with values needs drop_values", () => {
  const r = editColumns(READING, undefined, [{ rename: "Rating", to: "Stars" }, { add: "Finished", type: "date", after: "Author" }], TODAY, false);
  const t = findTables(r.body)[0];
  assertEquals(t.columns.map((c) => c.name), ["Title", "Author", "Finished", "Stars"]);
  assertEquals(t.rows, [["Dune", "Herbert", "", "5"], ["Emma", "Austen", "", "4"]]);
  assertStringIncludes(r.body, "After the table.");
  assertStringIncludes(assertThrows(() => editColumns(READING, undefined, [{ remove: "Author" }], TODAY, false), DataError).message, "drop_values: true");
  assertStringIncludes(assertThrows(() => editColumns(READING, undefined, [{ set_type: "Author", type: "number" }], TODAY, false), DataError).message, "don't fit number");
});

Deno.test("pasted CSV, TSV and markdown tables become rows, with quoted fields and a header map", () => {
  assertEquals(parseDelimited('a,b\n"x, y",2\n"say ""hi""",3\n').rows, [["x, y", "2"], ['say "hi"', "3"]]);
  assertEquals(parseDelimited("a\tb\n1\t2").delimiter, "\t");
  assertEquals(parseDelimited("| a | b |\n|---|---|\n| 1 | 2 |").rows, [["1", "2"]]);
  const rows = pastedRows(READING, undefined, "Book;Writer;Rating\nIliad;Homer;5", { Book: "Title", Writer: "Author" });
  assertEquals(rows, [{ Title: "Iliad", Author: "Homer", Rating: "5" }]);
  assertStringIncludes(assertThrows(() => pastedRows(READING, undefined, "Title,Pages\nX,3"), DataError).message, "column_map");
});

Deno.test("200 pasted rows land in one change", () => {
  const csv = "Title,Author,Rating\n" + Array.from({ length: 200 }, (_, i) => `Book ${i},Author ${i},${i % 5 + 1}`).join("\n");
  const r = addRows(READING, undefined, pastedRows(READING, undefined, csv), TODAY);
  assertEquals(findTables(r.body)[0].rows.length, 202);
  assertEquals(otherLines(READING, r.body), true);
});

Deno.test("checklist items: added above ticked ones, under a heading, renamed, ticked, removed", () => {
  const body = "Trip\n\n## Pack\n- [ ] Passport\n- [x] Charger\n\n## Do\n- [ ] Book hotel\n";
  const a = addChecklistItems(body, ["Socks", "- [ ] Sunscreen"], "Pack");
  assertStringIncludes(a.body, "- [ ] Passport\n- [ ] Socks\n- [ ] Sunscreen\n- [x] Charger");
  const none = addChecklistItems("Shopping\n\nMilk is out.", ["Milk"]);
  assertStringIncludes(none.body, "Milk is out.\n\n- [ ] Milk\n");
  const u = updateChecklistItems(body, [{ item: "passport", checked: true }, { item: "Book hotel", text: "Book hotel in Porto" }, { item: "Charger", remove: true }]);
  assertEquals(u.body, "Trip\n\n## Pack\n- [x] Passport\n\n## Do\n- [ ] Book hotel in Porto\n");
});

Deno.test("page data: values merge, records are added with ids and stamps, updated and removed by id", () => {
  assertEquals(mergePatch({ a: 1, s: { x: 1, y: 2 } }, { s: { y: null, z: 3 }, b: [1] }), { a: 1, s: { x: 1, z: 3 }, b: [1] });
  let n = 0;
  const id = () => `id${++n}`;
  const one = changeStore({ values: { goal: 3 }, collections: {} }, { values: { goal: 5, unit: "km" }, add: { runs: [{ km: 5 }, { id: "fixed", km: 7 }] } }, "2026-10-05T08:00:00Z", id);
  assertEquals(one.store.values, { goal: 5, unit: "km" });
  assertEquals(one.added, { runs: ["id1", "fixed"] });
  assertEquals(one.store.collections.runs[0], { km: 5, id: "id1", created: "2026-10-05T08:00:00Z", updated: "2026-10-05T08:00:00Z" });
  const two = changeStore(one.store, { update: { runs: [{ id: "fixed", km: 8, note: "hills" }] }, remove: { runs: ["id1"] } }, "2026-10-05T09:00:00Z", id);
  assertEquals(two.store.collections.runs, [{ id: "fixed", km: 8, note: "hills", created: "2026-10-05T08:00:00Z", updated: "2026-10-05T09:00:00Z" }]);
  assertStringIncludes(assertThrows(() => changeStore(two.store, { update: { runs: [{ id: "nope" }] } }, "x"), DataError).message, "get_page_data");
  assertStringIncludes(assertThrows(() => changeStore(two.store, { patch: {} } as never, "x"), DataError).message, "Unknown change");
});

Deno.test("where takes ranges, prefixes, contains and empty", () => {
  const runs = "Runs\n\n| Date | Km | Notes |\n| --- | --- | --- |\n| 2026-08-28 | 5 | easy |\n| 2026-09-02 | 12 | long run |\n| 2026-09-30 | 6 |  |\n| 2026-10-02 | 9 | hills |\n";
  assertEquals(deleteRows(runs, undefined, { Date: { from: "2026-09-01", to: "2026-09-30" } }, { all: true }).deleted, 2);
  assertEquals(deleteRows(runs, undefined, { Date: { starts_with: "2026-09" } }, { all: true }).deleted, 2);
  assertEquals(updateRows(runs, undefined, { Km: { from: 9 } }, { Notes: "far" }, TODAY, { all: true }).updated, 2);
  assertEquals(deleteRows(runs, undefined, { Notes: { empty: true } }).rows, [{ Date: "2026-09-30", Km: "6", Notes: "" }]);
  assertEquals(deleteRows(runs, undefined, { Notes: { contains: "LONG" } }).deleted, 1);
  assertStringIncludes(assertThrows(() => deleteRows(runs, undefined, { Date: { after: "x" } }), DataError).message, "from, to");
});

Deno.test("a missing table is created from the columns, typed, at the end or under a heading", () => {
  const body = newTable("Running\n\nMy runs.\n\n## Log\n\nSoon.\n\n## Other\nx\n", ["Date", "Km"], { Date: "date", km: "number" }, "Log");
  assertStringIncludes(body, "Soon.\n\n<!-- pane-table: Date=date; Km=number -->\n| Date | Km |\n| --- | --- |\n\n## Other");
  const r = addRows(body, 0, [{ Date: "2026-10-01", Km: "5,5" }], TODAY);
  assertStringIncludes(r.body, "| --- | --- |\n| 2026-10-01 | 5.5 |\n");
  assertEquals(newTable("Note", ["A"]), "Note\n\n| A |\n| --- |\n");
});
