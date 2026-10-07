import { assertEquals, assertStringIncludes } from "@std/assert";
import { format, readText } from "./format.ts";

Deno.test("search: path, then the snippet on one line; grep lines; counts", () => {
  assertEquals(format("search", { results: [{ id: "Groceries.md", snippet: "- [ ] «Butter»\n\nSee" }] }), "Groceries.md\n  - [ ] «Butter» See");
  assertEquals(format("search", { results: [] }), "No notes match.");
  assertEquals(format("search", { lines: ["Work/B.md:3: Deposit 2400"], more: "4 more: offset 1." }), "Work/B.md:3: Deposit 2400\n4 more: offset 1.");
  assertEquals(format("search", { matches: 3, notes: 2 }), "3 matches in 2 notes");
});

Deno.test("list: a folder, newest first, and a glob", () => {
  const o = format("list", { path: "/", entries: [{ path: "Work/", type: "folder" }, { path: "A.md", type: "note", updated: "2026-10-06T08:00:00Z", pinned: true }], recently_deleted: '1 in "Recently Deleted/"' });
  assertStringIncludes(o, "  Work/");
  assertStringIncludes(o, "A.md   2026-10-06 08:00  pinned");
  assertStringIncludes(o, '(1 in "Recently Deleted/")');
  assertEquals(format("list", { pattern: "**/*.pdf", matches: [] }), "**/*.pdf\n  (empty)");
});

Deno.test("changes say what happened, and what the checks found", () => {
  assertEquals(format("edit", { edited: "Work/B.md", checks: "ok" }), "Edited Work/B.md");
  assertEquals(format("write", { written: "B.md", checks: ["A table row has 2 cells, not 3."] }), "Wrote B.md\n  check: A table row has 2 cells, not 3.");
  assertEquals(format("delete", { deleted: "B.md", now_at: "Recently Deleted/B.md", restore_with: "restore" }), 'Moved B.md to Recently Deleted/B.md. Bring it back with: amber restore "Recently Deleted/B.md"');
  assertEquals(format("restore", { restored: "Work/B.md" }), "Restored Work/B.md.");
  assertEquals(format("pin", { path: "B.md", pinned: false }), "Unpinned B.md");
});

Deno.test("read prints the text without line numbers, unless asked", () => {
  assertEquals(readText({ text: "     1\tGroceries\n     2\t- [ ] Milk" }), "Groceries\n- [ ] Milk");
  assertEquals(readText({ text: "     1\tGroceries" }, true), "     1\tGroceries");
});

Deno.test("something unexpected prints as JSON rather than nothing", () => {
  assertEquals(format("move", { surprise: 1 }), '{\n  "surprise": 1\n}');
});
