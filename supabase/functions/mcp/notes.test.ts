// Unit tests for the pure markdown helpers: deno test notes.test.ts
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { appendText, applyEdits, coerce, findTables, outline, replaceTable, setChecklistItem, sliceLines, sortChecklist, tableMarkdown, titleOf } from "./notes.ts";

Deno.test("titles follow the app's rules", () => {
  const cases: [string, string][] = [
    ["- [ ] Task x\nmore", "Task x"],
    ["<u>Under</u>", "Under"],
    ["snake_case_x", "snake_case_x"],
    ["[Link](https://x.y)", "Link"],
    ["> Quote", "Quote"],
    ["\n\n  # Heading", "Heading"],
    ["**Bold** and *it* and _em_", "Bold and it and em"],
    ["| a | b |", "a  b"],
    ["---\n\nReal", "Real"],
    ["", "New Note"],
    ["```\ncode", "code"],
    ["1. First", "First"],
    ["* [ ] star", "[ ] star"],
    ["2 * 3 * 4", "2 * 3 * 4"],
    ["__init__ file", "init file"],
    ["🍜 Ramen — «ÅÄÖ»", "🍜 Ramen — «ÅÄÖ»"],
  ];
  for (const [body, title] of cases) assertEquals(titleOf(body), title, JSON.stringify(body));
});

Deno.test("edits: exact, unique, ordered, all-or-nothing", () => {
  assertEquals(applyEdits("a b c", [{ old_text: "b", new_text: "B" }, { old_text: "c", new_text: "$&" }]), "a B $&");
  assertThrows(() => applyEdits("x x", [{ old_text: "x", new_text: "y" }]), Error, "appears 2 times");
  assertEquals(applyEdits("x x", [{ old_text: "x", new_text: "y", replace_all: true }]), "y y");
  assertThrows(() => applyEdits("abc", [{ old_text: "", new_text: "y" }]), Error, "empty");
  assertThrows(() => applyEdits("abc", [{ old_text: "zzz", new_text: "y" }]), Error, "not found");
});

Deno.test("append: end, section, start, list spacing", () => {
  assertEquals(appendText("Title\n- a", "- b"), "Title\n- a\n- b\n");
  assertEquals(appendText("Title\nText", "More"), "Title\nText\n\nMore\n");
  assertEquals(appendText("T\n## A\n1\n\n## B\n2", "x", "a"), "T\n## A\n1\nx\n\n## B\n2");
  assertEquals(appendText("T\nbody", "first", undefined, true), "T\nfirst\nbody");
  assertThrows(() => appendText("T\n## A", "x", "Nope"), Error, "Headings in this note: A");
});

Deno.test("checklists: tick by text, ticked items sink like in the app", () => {
  const body = "Todo\n- [ ] Milk\n- [ ] Eggs\n- [ ] Bread\nAfter";
  const r = setChecklistItem(body, "milk", true);
  assertEquals(r.body, "Todo\n- [ ] Eggs\n- [ ] Bread\n- [x] Milk\nAfter");
  assertEquals(setChecklistItem(r.body, "Milk", false).body, "Todo\n- [ ] Eggs\n- [ ] Bread\n- [ ] Milk\nAfter");
  assertThrows(() => setChecklistItem("- [ ] Milk\n- [ ] Oat milk", "mil", true), Error, "matches 2");
  assertEquals(setChecklistItem("- [ ] Milk\n- [ ] Oat milk", "Milk", true).body, "- [ ] Oat milk\n- [x] Milk");
});

Deno.test("checklist sort leaves nested lists alone", () => {
  const lines = ["- [x] A", "- [ ] B", "  - [ ] child"];
  assertEquals(sortChecklist(lines, 0), lines);
  assertEquals(sortChecklist(["- [x] A", "- [ ] B"], 1), ["- [ ] B", "- [x] A"]);
  assertEquals(sortChecklist(["plain"], 0), ["plain"]);
});

Deno.test("typed tables: the app's format round-trips", () => {
  // Exactly what the app writes for a grid with typed columns.
  const app = "Log\n\n<!-- pane-table: Date=date; Hours=number; Done=choice Yes|No; Note=text -->\n| Date | Hours | Done | Note |\n| --- | --- | --- | --- |\n| 2026-09-27 | 3 | Yes | a \\| b |\n|   | 2 | No |   |\n\nAfter";
  const [t] = findTables(app);
  assertEquals(t.columns.map((c) => c.type.kind), ["date", "number", "choice", "text"]);
  assertEquals(t.rows[0], ["2026-09-27", "3", "Yes", "a | b"]);
  assertEquals(t.rows[1], ["", "2", "No", ""]);
  assertEquals(findTables(replaceTable(app, t))[0].rows, t.rows);
  assertEquals(replaceTable(app, t).split("\n").slice(-2), ["", "After"]);
  assertEquals(tableMarkdown(t).split("\n")[0], "<!-- pane-table: Date=date; Hours=number; Done=choice Yes|No; Note=text -->");
});

Deno.test("typed tables inside code blocks are examples, not trackers", () => {
  const body = "```\n<!-- pane-table: A=text -->\n| A |\n| --- |\n| 1 |\n```\n";
  assertEquals(findTables(body).length, 0);
});

Deno.test("values: Yes/No takes booleans, scales and dates are checked", () => {
  const yn = { name: "Done", type: { kind: "choice" as const, options: ["Yes", "No"] } };
  assertEquals(coerce(true, yn, "2026-09-28"), "Yes");
  assertEquals(coerce("false", yn, "2026-09-28"), "No");
  assertEquals(coerce("yes", yn, "2026-09-28"), "Yes");
  assertThrows(() => coerce("maybe", yn, "x"), Error, "one of Yes, No");
  const scale = { name: "Energy", type: { kind: "scale" as const, min: 1, max: 10 } };
  assertThrows(() => coerce(11, scale, "x"), Error, "from 1 to 10");
  assertThrows(() => coerce(2.5, scale, "x"), Error, "whole number");
  assertEquals(coerce("today", { name: "Date", type: { kind: "date" } }, "2026-09-28"), "2026-09-28");
  assertEquals(coerce("7,5", { name: "H", type: { kind: "number" } }, "x"), "7.5");
});

Deno.test("line ranges and outline", () => {
  assertEquals(sliceLines("a\nb\nc", 2, 3, true), "2│ b\n3│ c");
  const o = outline("T\n## One\n- [ ] a\n- [x] b");
  assertEquals(o.headings, [{ line: 2, level: 2, text: "One" }]);
  assertEquals(o.checklist, { open: 1, done: 1 });
});
