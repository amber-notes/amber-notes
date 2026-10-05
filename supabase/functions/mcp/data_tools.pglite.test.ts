// The data tools and page data (data_tools.ts) in an in-process Postgres (PGlite): rows in and out
// without touching the page, page data sealed beside it, and the guide.
//   cd supabase/functions/mcp && deno test -A data_tools.pglite.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { schemaDB } from "./pglite.ts";
import { type Account, account, lockedNote, note, notesPassword, opened, toolContext } from "./sealed.ts";
import { runTool, ToolError } from "./tools.ts";

// deno-lint-ignore no-explicit-any
const tool = async (pg: PGlite, a: Account, name: string, args: Record<string, unknown> = {}, write = true) => await runTool(name, args, await toolContext(pg, a, write)) as any;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { assert(e instanceof ToolError, String(e)); return (e as Error).message; } throw new Error("expected a ToolError"); };
const CRM = "Clients\n\n| Company | Stage | Value |\n|:--|:--|--:|\n| Acme | Lead | 8000 |\n| Nordljus | Won | 3000 |\n\nNotes below.\n";
const PAGE = `<!doctype html><html lang="en"><body><main id="m"></main><script>amber.onChange((n, d) => { m.textContent = n.tables[0].rows.length + " " + JSON.stringify(d) });</script></body></html>`;

Deno.test("rows go in from a list or pasted CSV, the page and other lines untouched", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, CRM);
  await tool(pg, a, "set_note_page", { id, html: PAGE });
  const r = await tool(pg, a, "add_table_rows", { id, rows: [{ company: "Berg", Stage: "Lead", Value: 100 }] });
  assertEquals([r.added_rows, r.table.total_rows], [1, 3]);
  const csv = await tool(pg, a, "add_table_rows", { title: "Clients", csv: "Firm;Status;Deal\nOy;Won;5\n\"A, B\";Lead;6", column_map: { Firm: "Company", Status: "Stage", Deal: "Value" } });
  assertEquals(csv.added_rows, 2);
  const body = (await opened(pg, a, id)).body!;
  assertStringIncludes(body, "|:--|:--|--:|\n| Acme | Lead | 8000 |\n| Nordljus | Won | 3000 |\n| Berg | Lead | 100 |\n| Oy | Won | 5 |\n| A, B | Lead | 6 |\n\nNotes below.\n");
  assertEquals((await tool(pg, a, "get_note_page", { id }, false)).html, PAGE);
  assertStringIncludes(await fails(tool(pg, a, "add_table_rows", { id, rows: [{ Owner: "x" }] })), "edit_table_columns");
});

Deno.test("updates and deletes match by values; ambiguous matches are refused", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, CRM.replace("| Nordljus | Won | 3000 |", "| Nordljus | Won | 3000 |\n| Oy | Lead | 1 |"));
  assertEquals((await tool(pg, a, "update_table_rows", { id, where: { company: "acme" }, set: { Stage: "Won" } })).updated_rows, 1);
  assertStringIncludes(await fails(tool(pg, a, "delete_table_rows", { id, where: { Stage: "Won" } })), "2 rows match");
  assertEquals((await tool(pg, a, "delete_table_rows", { id, where: { Stage: "Won" }, all: true })).deleted_rows, 2);
  assertStringIncludes((await opened(pg, a, id)).body!, "|:--|:--|--:|\n| Oy | Lead | 1 |\n\nNotes below.");
});

Deno.test("renaming a column keeps values and points at the page", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, CRM);
  await tool(pg, a, "set_note_page", { id, html: PAGE });
  const r = await tool(pg, a, "edit_table_columns", { id, changes: [{ rename: "Value", to: "Amount" }] });
  assertStringIncludes(r.page, "edit_note_page");
  assertStringIncludes((await opened(pg, a, id)).body!, "| Company | Stage | Amount |");
  assertStringIncludes((await opened(pg, a, id)).body!, "| Acme | Lead | 8000 |");
  assertStringIncludes(await fails(tool(pg, a, "edit_table_columns", { id, changes: [{ remove: "Stage" }] })), "drop_values");
});

Deno.test("checklist items are added and changed by text", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, "Trip\n\n## Pack\n- [ ] Passport\n- [x] Charger\n");
  await tool(pg, a, "add_checklist_items", { id, items: ["Socks"], under_heading: "Pack" });
  await tool(pg, a, "update_checklist_items", { id, changes: [{ item: "passport", checked: true }] });
  assertEquals((await opened(pg, a, id)).body, "Trip\n\n## Pack\n- [ ] Socks\n- [x] Passport\n- [x] Charger\n");
});

Deno.test("page data: values and collections go in at will, sealed in note_pages, kept when the page is replaced", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, CRM);
  await tool(pg, a, "set_note_page", { id, html: PAGE });
  await tool(pg, a, "update_page_data", { id, replace: { values: { goal: 5, view: { tab: "all", sort: "value" } } } });
  const r = await tool(pg, a, "update_page_data", { id, values: { view: { sort: null, month: "2026-10" } }, add: { calls: [{ who: "Acme", mins: 20 }, { who: "Oy", mins: 5 }] } });
  assertEquals(r.data.values, { goal: 5, view: { tab: "all", month: "2026-10" } });
  assertEquals(r.added_ids.calls.length, 2);
  const [first] = r.added_ids.calls;
  await tool(pg, a, "update_page_data", { id, update: { calls: [{ id: first, mins: 25 }] }, remove: { calls: [r.added_ids.calls[1]] } });
  const [row] = (await pg.query<{ data_ct: string }>(`select data_ct from public.note_pages where note_id = $1`, [id])).rows;
  assert(row.data_ct.startsWith(`amb2.${a.keyId}.`) && !row.data_ct.includes("Acme"));
  assertEquals((await tool(pg, a, "get_page_data", { id, path: "collections.calls.0.mins" }, false)).value, 25);
  assertStringIncludes(await fails(tool(pg, a, "update_page_data", { id, update: { calls: [{ id: "nope", mins: 1 }] } })), "get_page_data");
  assertStringIncludes(await fails(tool(pg, a, "update_page_data", { id, replace: { rows: [] } })), "Unknown top-level key");
  await tool(pg, a, "set_note_page", { id, html: PAGE.replace("rows", "rows ") });
  const got = await tool(pg, a, "get_note_page", { id }, false);
  assertEquals(got.data.values.goal, 5);
  assertEquals(got.page_input.tables[0].columns.map((c: { name: string }) => c.name), ["Company", "Stage", "Value"]);
  await fails(tool(pg, a, "update_page_data", { id, values: { x: 1 } }, false));
  const locked = await lockedNote(pg, a, await notesPassword(pg, a), "Secret");
  await fails(tool(pg, a, "update_page_data", { id: locked, values: { a: 1 } }));
});

Deno.test("app data: 500 imported records, queries, nested values and files", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, "Glucose\n\nReadings live in the app.");
  const csv = "when,mmol,meal.kind,meal.carbs\n" + Array.from({ length: 500 }, (_, i) => `2026-09-${String(1 + (i % 30)).padStart(2, "0")}T0${i % 10}:00,${(4 + (i % 50) / 10).toFixed(1)},${i % 2 ? "lunch" : "dinner"},${i}`).join("\n");
  const r = await tool(pg, a, "update_page_data", { id, import: { collection: "readings", csv }, values: { program: { weeks: [{ week: 1, days: [{ day: "Mon", sets: [{ reps: 5, kg: 60 }] }] }] } } });
  assertEquals(r.added_ids.readings.count, 500);
  const q = await tool(pg, a, "get_page_data", { id, collection: "readings", where: { "meal.kind": "lunch", mmol: { from: 8 } }, limit: 3, fields: ["mmol"] }, false);
  assertEquals([q.total, q.records.length, typeof q.records[0].mmol], [500, 3, "number"]);
  assert(q.matched > 3 && q.next_offset === 3);
  assertEquals((await tool(pg, a, "get_page_data", { id, path: "values.program.weeks.0.days.0.sets.0.kg" }, false)).value, 60);
  // A new file for a record: sealed in Storage, referenced by id; an unknown id is refused.
  const stored = new Map<string, Uint8Array>();
  const prev = globalThis.fetch;
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/storage/v1/object/files/")) { stored.set(url.split("/files/")[1], new Uint8Array(init!.body as Uint8Array)); return Promise.resolve(new Response("{}")); }
    return prev(input, init);
  };
  try {
    const first = q.records[0].id;
    const f = await tool(pg, a, "update_page_data", { id, update: { readings: [{ id: first, note: { $new_file: { name: "meter.txt", type: "text/plain", text: "Meter photo notes" } } }] } });
    const ref = f.files_saved[0].$file;
    assert(stored.has(`${a.id}/${ref}`) && !new TextDecoder().decode(stored.get(`${a.id}/${ref}`)!).includes("Meter"));
    assertEquals((await tool(pg, a, "get_page_data", { id, collection: "readings", where: { id: first } }, false)).records[0].note.$file, ref);
    assertStringIncludes(await fails(tool(pg, a, "update_page_data", { id, values: { pic: { $file: crypto.randomUUID() } } })), "list_files");
  } finally {
    globalThis.fetch = prev;
  }
});

Deno.test("the guide and templates come from get_page_guide", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  assertStringIncludes((await tool(pg, a, "get_page_guide", {}, false)).guide, "amber.onChange");
  assertStringIncludes((await tool(pg, a, "get_page_guide", { template: "budget" }, false)).html, "amber.update");
});

Deno.test("query_app_data answers over an app's JSON: collections, lists in values, localStorage strings", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, "Training\n");
  const runs = [
    { date: "2026-09-29", kind: "Run", km: 5 }, { date: "2026-10-01", kind: "Run", km: 6.5 }, { date: "2026-10-02", kind: "Bike", km: 20 },
    { date: "2026-10-06", kind: "Run", km: "7,5" },
  ];
  await tool(pg, a, "update_page_data", { id, add: { sessions: runs }, values: { log: runs, localStorage: { workouts: JSON.stringify(runs) } } });
  const week = await tool(pg, a, "query_app_data", { id, from: "sessions", group_by: "date:week", sum: ["km"] }, false);
  assertEquals(week.groups.map((g: any) => [g["date:week"], g.count, g.sum.km]), [["2026-09-28", 3, 31.5], ["2026-10-05", 1, 7.5]]);
  const runsOnly = await tool(pg, a, "query_app_data", { id, from: "localStorage.workouts", where: { kind: "run", date: { from: "2026-09-28", to: "2026-10-04" } }, avg: ["km"], max: ["km"] }, false);
  assertEquals([runsOnly.matched, runsOnly.avg.km, runsOnly.max.km], [2, 5.75, 6.5]);
  assertEquals((await tool(pg, a, "query_app_data", { id, from: "log", group_by: "kind", sort: "count" }, false)).groups[0], { kind: "Run", count: 3 });
  assertStringIncludes(await fails(tool(pg, a, "query_app_data", { id, from: "nope" }, false)), "sessions (collection)");
});
