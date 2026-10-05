// Note page widgets (prototype) in an in-process Postgres (PGlite): set_note_widget seals the spec
// in the page's row, get_note_page returns it, and a bad spec is refused with reasons.
//   cd supabase/functions/mcp && deno test -A note_widgets.pglite.test.ts
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { schemaDB } from "./pglite.ts";
import { type Account, account, note, toolContext } from "./sealed.ts";
import { runTool, ToolError } from "./tools.ts";

// deno-lint-ignore no-explicit-any
const tool = async (pg: PGlite, a: Account, name: string, args: Record<string, unknown> = {}, write = true) => await runTool(name, args, await toolContext(pg, a, write)) as any;
const HABITS = "Habit tracker\n\n| Date | Walk | Read |\n| --- | --- | --- |\n| 2026-10-03 | ✓ | |\n";
const WIDGET = { small: [{ type: "number", value: { streak: { table: 0, column: "Walk" } }, label: "day streak" }, { type: "button", label: "Walk", op: { op: "toggle_today", table: 0, column: "Walk" } }] };

Deno.test("a widget is sealed in the page's row and comes back from get_note_page", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, HABITS);
  const r = await tool(pg, a, "set_note_widget", { id, widget: WIDGET });
  assertEquals(r.widget, "created");
  const [row] = (await pg.query<{ widget_ct: string; page_ct: string | null }>(`select widget_ct, page_ct from public.note_pages where note_id = $1`, [id])).rows;
  assert(row.widget_ct.startsWith(`amb2.${a.keyId}.`) && !row.widget_ct.includes("streak"));
  assertEquals(row.page_ct, null);
  assertEquals(JSON.parse(await a.vault.openWidget(id, row.widget_ct)), WIDGET);
  assertEquals((await tool(pg, a, "get_note_page", { id }, false)).widget, WIDGET);
  assertEquals((await tool(pg, a, "set_note_widget", { id, widget: WIDGET })).widget, "replaced");
  assertEquals((await tool(pg, a, "set_note_widget", { id, widget: null })).widget, "removed");
  assertEquals((await tool(pg, a, "get_note_page", { id }, false)).widget, undefined);
});

Deno.test("a widget with an unknown block is refused, saying why", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, HABITS);
  const e = await assertRejects(() => tool(pg, a, "set_note_widget", { id, widget: { small: [{ type: "webview" }] } }), ToolError);
  assert(e.message.includes("unknown block type"));
});
