// The file-like tool set (files_tools.ts) on a seeded account: notes first, then an app and its data.
//   cd supabase/functions/mcp && deno test -A files_tools.pglite.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { schemaDB } from "./pglite.ts";
import { type Account, account, note, opened, toolContext } from "./sealed.ts";
import { ToolError } from "./tools.ts";
import { FILE_TOOLS, runFileTool } from "./files_tools.ts";

// deno-lint-ignore no-explicit-any
const tool = async (pg: PGlite, a: Account, name: string, args: Record<string, unknown> = {}) => await runFileTool(name, args, await toolContext(pg, a, true)) as any;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { assert(e instanceof ToolError, String(e)); return (e as Error).message; } throw new Error("expected a ToolError"); };
const GROCERIES = "Groceries\n\n## Dairy\n- [ ] Milk\n- [ ] Butter\n\n## Fruit\n- [x] Apples\n\nSee [[Recipes]] for ideas.\n";
const MOOD = "Mood\n\n<!-- pane-table: Date=date; Mood=scale 1-5; Walk=choice Yes|No -->\n| Date | Mood | Walk |\n| --- | --- | --- |\n| 2026-10-01 | 3 | Yes |\n";

Deno.test("twelve tools, named as ChatGPT and the directories expect", () => {
  assertEquals(FILE_TOOLS.map((t) => t.name), ["search", "list", "fetch", "create", "edit", "write", "move", "delete", "history", "restore", "pin", "see_app"]);
  for (const t of FILE_TOOLS) assertEquals(t.annotations.title, t.title);
});

Deno.test("notes as files: list, fetch, edit with checks, write, move, rename, pin, delete, restore, history", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const g = await note(pg, a, GROCERIES);
  const m = await note(pg, a, MOOD);

  const overview = await tool(pg, a, "list");
  assert(overview.recently_edited.some((n: { path: string }) => n.path === "Groceries.md"));
  const read = await tool(pg, a, "fetch", { id: "Groceries.md" });
  assertEquals([read.id, read.title, read.url], [g, "Groceries", `ambernotes://note/${g}`]);
  assertStringIncludes(read.text, "[[Recipes]]");
  assertEquals(read.metadata.links, ["Recipes"]);

  // Tick, untick and add under a heading, by editing the text; [[links]] stay as written.
  const ticked = await tool(pg, a, "edit", { id: g, edits: [{ old_text: "- [ ] Milk", new_text: "- [x] Milk" }, { old_text: "- [x] Apples", new_text: "- [ ] Apples\n- [ ] Pears" }] });
  assertEquals(ticked.checks, "ok");
  const body = (await opened(pg, a, g)).body!;
  assertStringIncludes(body, "- [x] Milk\n- [ ] Butter\n\n## Fruit\n- [ ] Apples\n- [ ] Pears\n\nSee [[Recipes]] for ideas.");
  const mangled = await tool(pg, a, "edit", { id: "Groceries.md", edits: [{ old_text: "- [ ] Butter", new_text: "-[ ] Butter" }] });
  assertStringIncludes(mangled.checks.join(), "won't show as a checklist item");

  // A tracker row: a value out of range is reported.
  const logged = await tool(pg, a, "edit", { id: m, edits: [{ old_text: "| 2026-10-01 | 3 | Yes |", new_text: "| 2026-10-01 | 3 | Yes |\n| 2026-10-02 | 7 | Maybe |" }] });
  assertStringIncludes(logged.checks.join("\n"), "from 1 to 5");
  assertStringIncludes(logged.checks.join("\n"), "one of Yes, No");

  // Create a note, a sub-note and a folder; move, rename, pin.
  const made = await tool(pg, a, "create", { content: "Trip\n\nLisbon in May.", path: "Travel" });
  assertEquals(made.created, "Travel/Trip.md");
  const sub = await tool(pg, a, "create", { content: "Packing\n- [ ] Passport", inside: "Travel/Trip.md" });
  assertEquals(sub.created, "Travel/Trip/Packing.md");
  assertStringIncludes((await opened(pg, a, made.id)).body!, `[Packing](pane-note:${sub.id})`);
  assertEquals((await tool(pg, a, "fetch", { id: "Travel/Trip/Packing.md" })).id, sub.id);
  assertEquals((await tool(pg, a, "create", { type: "folder", path: "Work/Clients/" })).created, "Work/Clients/");
  assertEquals((await tool(pg, a, "move", { id: "Travel/Trip.md", to: "Work/" })).moved, "Work/Trip.md");
  assertEquals((await tool(pg, a, "move", { id: made.id, to: "Work/Lisbon trip.md" })).moved, "Work/Lisbon trip.md");
  assertEquals((await opened(pg, a, made.id)).body!.split("\n")[0], "Lisbon trip");
  assertEquals((await tool(pg, a, "move", { id: "Work/Clients/", to: "Archive/Clients/" })).moved, "Archive/Clients/");
  assertEquals((await tool(pg, a, "pin", { id: g, pinned: true })).pinned, true);

  // Write a whole note; history and restore; delete and restore.
  await tool(pg, a, "write", { id: "Work/Lisbon trip.md", content: "Lisbon trip\n\nPorto too." });
  const h = await tool(pg, a, "history", { id: made.id });
  assert(h.revisions.length >= 1);
  await tool(pg, a, "restore", { id: made.id, version: h.revisions[h.revisions.length - 1].version });
  assertStringIncludes((await opened(pg, a, made.id)).body!, "Lisbon in May.");
  await tool(pg, a, "delete", { id: made.id });
  assert((await tool(pg, a, "list", { path: "Recently Deleted/" })).notes.some((n: { id: string }) => n.id === made.id));
  await tool(pg, a, "restore", { id: made.id });
  assertEquals((await tool(pg, a, "fetch", { id: made.id })).metadata.in_recently_deleted, undefined);

  // Search, and a wrong path says what exists.
  const found = await tool(pg, a, "search", { query: "butter" });
  assertEquals(found.results[0].path, "Groceries.md");
  // A unique title in the wrong folder still finds the note (its real path comes back); an unknown one says so.
  assertEquals((await tool(pg, a, "fetch", { id: "Nowhere/Groceries.md" })).metadata.path, "Groceries.md");
  assertStringIncludes(await fails(tool(pg, a, "fetch", { id: "Shopping.md" })), "No note at");
});

Deno.test("an app: create, its files, and data.json edited like a file, one change", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const made = await tool(pg, a, "create", { type: "app", path: "Health/Habits.md" });
  assertEquals(made.app, "Health/Habits.app/");
  const files = await tool(pg, a, "list", { path: "Health/Habits.app" });
  assert(files.files.some((f: { path: string }) => f.path === "Health/Habits.app/src/App.tsx"));
  assertStringIncludes((await tool(pg, a, "fetch", { id: "Health/Habits.app/README.md" })).text, "How this app runs in Amber Notes");
  const edited = await tool(pg, a, "edit", { id: "Health/Habits.app/src/screens/home.tsx", edits: [{ old_text: "Nothing here yet", new_text: "No habits yet" }] });
  assertStringIncludes(JSON.stringify(edited), "saved");
  // The app keeps its log in localStorage; the AI sees records and removes three dates.
  const log = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"].map((date) => ({ date, walk: true }));
  await tool(pg, a, "write", { id: "Health/Habits.app/data.json", content: JSON.stringify({ values: { localStorage: { habits: log } }, collections: {} }) });
  const d = await tool(pg, a, "fetch", { id: "Health/Habits.app/data.json" });
  assertEquals(JSON.parse(d.text).values.localStorage.habits.length, 5);
  const kept = log.filter((x) => x.date < "2026-10-03" || x.date > "2026-10-05");
  const r = await tool(pg, a, "write", { id: "Health/Habits.app/data.json", content: JSON.stringify({ values: { localStorage: { habits: kept } }, collections: {} }) });
  assertEquals(r.saved, "data.json");
  const [row] = (await pg.query(`select data_ct from public.note_pages p join public.notes n on n.id = p.note_id`)).rows as { data_ct: string }[];
  assert(row.data_ct);
  assertStringIncludes(await fails(tool(pg, a, "edit", { id: "Health/Habits.app/data.json", edits: [{ old_text: "\"values\": {", new_text: "\"values\": {{" }] })), "isn't valid JSON");
  assertEquals((await tool(pg, a, "see_app", { id: "Health/Habits.md" })).previews, "unavailable");
});

Deno.test("for sync tools: list all gives every note with its version; edit and write take expected_version", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const g = await note(pg, a, GROCERIES);
  await tool(pg, a, "create", { content: "Trip\n\nLisbon in May.", path: "Travel" });
  const sub = await tool(pg, a, "create", { content: "Packing\n- [ ] Passport", inside: "Travel/Trip.md" });
  const listed = await tool(pg, a, "list", { all: true });
  assertEquals(listed.notes.map((n: { path: string }) => n.path).sort(), ["Groceries.md", "Travel/Trip.md", "Travel/Trip/Packing.md"]);
  assert(listed.folders.includes("Travel/"));
  const v = listed.notes.find((n: { id: string }) => n.id === g).version;
  const edited = await tool(pg, a, "edit", { id: g, expected_version: v, edits: [{ old_text: "- [ ] Milk", new_text: "- [x] Milk" }] });
  assert(edited.version > v);
  assertStringIncludes(await fails(tool(pg, a, "write", { id: g, expected_version: v, content: "Groceries\n\nstale" })), "changed since");
  assertStringIncludes(await fails(tool(pg, a, "edit", { id: g, expected_version: v, edits: [{ old_text: "Butter", new_text: "Ghee" }] })), "changed since");
  const after = (await tool(pg, a, "list", { all: true })).notes.find((n: { id: string }) => n.id === g);
  assertEquals(after.version, edited.version);
  assertEquals((await tool(pg, a, "list", { all: true })).notes.find((n: { id: string }) => n.id === sub.id).path, "Travel/Trip/Packing.md");
});
