import { assertEquals, assertStringIncludes } from "@std/assert";
import { format } from "./format.ts";

Deno.test("search: path, then the snippet on one line", () => {
  assertEquals(format("search", { results: [{ path: "Groceries.md", snippet: "- [ ] «Butter»\n\nSee" }] }), "Groceries.md\n  - [ ] «Butter» See");
  assertEquals(format("search", { results: [] }), "No notes match.");
});

Deno.test("list: the overview and a folder", () => {
  const o = format("list", { notes: 3, folders: [{ path: "Work/", notes: 2 }], pinned: [{ path: "A.md", updated: "2026-10-06T08:00:00Z", pinned: true }], recently_edited: [], recently_deleted: 1 });
  assertStringIncludes(o, "3 notes, 1 in Recently Deleted");
  assertStringIncludes(o, "  Work/");
  assertStringIncludes(o, "A.md  2026-10-06 08:00  pinned");
  assertEquals(format("list", { path: "Work/", folders: ["Work/Clients/"], notes: [{ path: "Work/B.md", updated: "2026-10-06T09:30:00Z" }] }), "Work/\n  Work/Clients/\n  Work/B.md  2026-10-06 09:30");
});

Deno.test("changes say what happened, and what the checks found", () => {
  assertEquals(format("edit", { edited: "Work/B.md", version: 4, checks: "ok" }), "Edited Work/B.md (version 4)");
  assertEquals(format("write", { written: "B.md", version: 2, checks: ["A table row has 2 cells, not 3."] }), "Wrote B.md (version 2)\n  check: A table row has 2 cells, not 3.");
  assertEquals(format("delete", { deleted: { id: "i1", title: "B", moved_to: "Recently Deleted", sub_notes_moved: 0 } }), 'Moved "B" to Recently Deleted. Bring it back with: amber restore i1');
  assertEquals(format("restore", { restored: { id: "i1", title: "B", restored_to: "Work", sub_notes_restored: 0 } }), 'Restored "B" to Work/.');
  assertEquals(format("pin", { path: "B.md", pinned: false }), "Unpinned B.md");
});

Deno.test("something unexpected prints as JSON rather than nothing", () => {
  assertEquals(format("move", { surprise: 1 }), '{\n  "surprise": 1\n}');
});
