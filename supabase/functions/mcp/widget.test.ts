// What set_note_widget accepts as a widget (widget_spec.ts).
//   cd supabase/functions/mcp && deno test -A widget.test.ts
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { MAX_WIDGET_BYTES, widgetProblems } from "./widget_spec.ts";

const habit = JSON.parse(await Deno.readTextFile(new URL("../../../demo/note-pages/habit-tracker.widget.json", import.meta.url)));

Deno.test("the habit tracker's widget passes", () => {
  assertEquals(widgetProblems(habit), []);
  assertEquals(widgetProblems(JSON.stringify(habit)), []);
});

Deno.test("unknown blocks, bindings and sizes are refused with what's allowed", () => {
  assertStringIncludes(widgetProblems({ small: [{ type: "html", text: "<b>" }] }).join(), "unknown block type");
  assertStringIncludes(widgetProblems({ small: [{ type: "number", value: { eval: "1+1" } }] }).join(), "a binding is one of");
  assertStringIncludes(widgetProblems({ huge: [] }).join(), "at least one size");
  assertStringIncludes(widgetProblems({ small: [], tv: [] }).join(), "Unknown keys: tv");
  assertStringIncludes(widgetProblems("{not json").join(), "valid JSON");
});

Deno.test("buttons only make the page's own edits, at most two of them", () => {
  assertStringIncludes(widgetProblems({ small: [{ type: "button", label: "Go", op: { op: "delete_note" } }] }).join(), "toggle_today or toggle_checklist");
  assertStringIncludes(widgetProblems({ small: [{ type: "button", label: "Go", op: { op: "toggle_today", table: 0 } }] }).join(), "needs table");
  const b = (column: string) => ({ type: "button", label: column, op: { op: "toggle_today", table: 0, column } });
  assertEquals(widgetProblems({ small: [b("Walk")], medium: [b("Walk"), b("Read")] }), []);
  assertStringIncludes(widgetProblems({ medium: [b("Walk"), b("Read"), b("Stretch")] }).join(), "at most 2 different buttons");
});

Deno.test("limits: blocks per size, nesting, size", () => {
  assertStringIncludes(widgetProblems({ small: Array(9).fill({ type: "text", text: "x" }) }).join(), "at most 8");
  assertStringIncludes(widgetProblems({ small: [{ type: "row", blocks: [{ type: "row", blocks: [{ type: "text", text: "x" }] }] }] }).join(), "rows don't nest");
  assertStringIncludes(widgetProblems({ small: [{ type: "text", text: "x".repeat(MAX_WIDGET_BYTES) }] }).join(), "the limit is 8 KB");
});
