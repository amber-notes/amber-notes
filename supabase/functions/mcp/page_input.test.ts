// What a page is handed and the edits it can ask for (page_input.ts), the TypeScript twin of
// Pane/Model/NotePage.swift that the server and the page evals use.
//   cd supabase/functions/mcp && deno test -A page_input.test.ts
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { applyPageOp, noteForPage } from "./page_input.ts";

const BODY = "Trip\n\n## Pack\n- [ ] Passport\n- [x] Charger\n\n| Date | Km |\n|:--|--:|\n| 2026-10-01 | 5 |\n";

Deno.test("the note as a page sees it", () => {
  const n = noteForPage(BODY, "2026-10-05");
  assertEquals(n.title, "Trip");
  assertEquals(n.checklists, [{ line: 4, text: "Passport", checked: false }, { line: 5, text: "Charger", checked: true }]);
  assertEquals(n.tables, [{ index: 0, columns: [{ name: "Date", type: "text" }, { name: "Km", type: "text" }], rows: [["2026-10-01", "5"]] }]);
});

Deno.test("page edits: tick (ticked items sink), set a cell, add a row, add a checklist item", () => {
  assertEquals(applyPageOp(BODY, { op: "toggle_checklist", line: 4 }).split("\n").slice(3, 5), ["- [x] Passport", "- [x] Charger"]);
  assertEquals(applyPageOp(BODY, { op: "set_cell", table: 0, row: 0, col: "km", value: 7 }).split("\n")[8], "| 2026-10-01 | 7 |");
  assertEquals(applyPageOp(BODY, { op: "append_row", table: 0, values: { Date: "2026-10-02", Km: "3" } }).split("\n")[9], "| 2026-10-02 | 3 |");
  assertEquals(applyPageOp(BODY, { op: "add_checklist_item", text: "Socks", under_heading: "Pack" }).split("\n").slice(3, 6), ["- [ ] Passport", "- [ ] Socks", "- [x] Charger"]);
  const two = applyPageOp(BODY, { op: "append_row", table: 0, values: ["2026-10-02", "3"] });
  assertEquals(applyPageOp(two, { op: "move_row", table: 0, from: 1, to: 0 }).split("\n").slice(8, 10), ["| 2026-10-02 | 3 |", "| 2026-10-01 | 5 |"]);
  assertEquals(applyPageOp(two, { op: "delete_row", table: 0, row: 0 }).split("\n").slice(8), ["| 2026-10-02 | 3 |", ""]);
  assertEquals(applyPageOp(BODY, { op: "set_text", heading: "pack", text: "Nothing yet.\n" }), "Trip\n\n## Pack\nNothing yet.");
  assertThrows(() => applyPageOp(BODY, { op: "toggle_checklist", line: 1 }), Error, "isn't a checklist item");
  assertThrows(() => applyPageOp(BODY, { op: "set_cell", table: 0, row: 0, col: "Pace", value: "1" }), Error, "No column Pace");
});

Deno.test("several ops as one change, and column ops keep a typed table's types", () => {
  const typed = "Runs\n\n<!-- pane-table: Date=date; Km=number -->\n| Date | Km |\n| --- | --- |\n| 2026-10-01 | 5 |\n";
  const out = applyPageOp(typed, [
    { op: "add_column", table: 0, name: "Feel", type: "scale 1-5", after: "Date" },
    { op: "rename_column", table: 0, col: "Km", to: "Distance" },
    { op: "append_row", table: 0, values: { Date: "2026-10-02", Distance: "7", Feel: "4" } },
  ]);
  assertEquals(out, "Runs\n\n<!-- pane-table: Date=date; Feel=scale 1-5; Distance=number -->\n| Date | Feel | Distance |\n| --- | --- | --- |\n| 2026-10-01 |  | 5 |\n| 2026-10-02 | 4 | 7 |\n");
  assertThrows(() => applyPageOp(typed, [{ op: "append_row", table: 0, values: { Date: "x" } }, { op: "rename_column", table: 0, col: "Nope", to: "X" }]), Error, "Op 2: No column Nope");
});
