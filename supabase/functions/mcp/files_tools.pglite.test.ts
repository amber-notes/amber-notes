// The file-like tool set (files_tools.ts) on a seeded account: notes first, then an app and its data.
//   cd supabase/functions/mcp && deno test -A files_tools.pglite.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { schemaDB } from "./pglite.ts";
import { type Account, account, app, edit, file, folder, note, opened, stubStorage, toolContext } from "./sealed.ts";
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

Deno.test("notes as files: paths only, list, fetch with lines, edit like Edit, write, move, rename, pin, delete, restore, history", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const g = await note(pg, a, GROCERIES);
  const m = await note(pg, a, MOOD);

  const top = await tool(pg, a, "list");
  assert(top.entries.some((n: { path: string }) => n.path === "Groceries.md"));
  const read = await tool(pg, a, "fetch", { id: "Groceries.md" });
  assertEquals([read.id, read.title], ["Groceries.md", "Groceries"]);
  // cat -n: numbered lines; [[links]] listed.
  assertStringIncludes(read.text, "     4\t- [ ] Milk");
  assertEquals(read.metadata.links, ["Recipes"]);

  // Edit: one change, old_string must match once; errors say what to do.
  const ticked = await tool(pg, a, "edit", { path: "Groceries.md", old_string: "- [ ] Milk", new_string: "- [x] Milk" });
  assertEquals(ticked.checks, "ok");
  assertStringIncludes(await fails(tool(pg, a, "edit", { path: "Groceries.md", old_string: "- [", new_string: "* [" })), "3 times");
  assertStringIncludes(await fails(tool(pg, a, "edit", { path: "Groceries.md", old_string: "     5\t- [ ] Butter", new_string: "x" })), "line number");
  assertStringIncludes(await fails(tool(pg, a, "edit", { path: "Groceries.md", old_string: "- [ ] butter", new_string: "x" })), "different capitals");
  const mangled = await tool(pg, a, "edit", { path: "Groceries.md", old_string: "- [ ] Butter", new_string: "-[ ] Butter" });
  assertStringIncludes(mangled.checks.join(), "won't show as a checklist item");
  assertStringIncludes((await opened(pg, a, g)).body!, "- [x] Milk\n-[ ] Butter");

  // Read before edit: never read here, or changed since (a device edited it).
  assertStringIncludes(await fails(tool(pg, a, "edit", { path: "Mood.md", old_string: "| 2026-10-01 | 3 | Yes |", new_string: "x" })), "Read Mood.md with fetch");
  await tool(pg, a, "fetch", { id: "Mood.md" });
  await edit(pg, a, m, MOOD + "| 2026-10-02 | 4 | No |\n");
  assertStringIncludes(await fails(tool(pg, a, "edit", { path: "Mood.md", old_string: "| 2026-10-01 | 3 | Yes |", new_string: "x" })), "changed since you read it");
  await tool(pg, a, "fetch", { id: "Mood.md" });
  const logged = await tool(pg, a, "edit", { path: "Mood.md", old_string: "| 2026-10-02 | 4 | No |", new_string: "| 2026-10-02 | 4 | No |\n| 2026-10-03 | 7 | Maybe |" });
  assertStringIncludes(logged.checks.join("\n"), "from 1 to 5");
  // Its own edit keeps it read: a second edit needs no fetch.
  await tool(pg, a, "edit", { path: "Mood.md", old_string: "| 7 | Maybe |", new_string: "| 5 | Yes |" });

  // Long text is read in parts.
  const long = await note(pg, a, "Log\n" + Array.from({ length: 3000 }, (_, i) => `line ${i + 2}`).join("\n"));
  const first = await tool(pg, a, "fetch", { id: "Log.md" });
  assertStringIncludes(first.metadata.truncated, "Continue with offset 2001");
  const part = await tool(pg, a, "fetch", { id: "Log.md", offset: 2990, limit: 3 });
  assertEquals(part.text, "  2990\tline 2990\n  2991\tline 2991\n  2992\tline 2992");
  assert(long);

  // Create by path: folders as needed; in a note's folder, a sub-note (linked, by path, from its parent).
  assertEquals((await tool(pg, a, "create", { path: "Travel/Trip.md", content: "Lisbon in May." })).created, "Travel/Trip.md");
  assertEquals((await opened(pg, a, (await tool(pg, a, "fetch", { id: "Travel/Trip.md" })).url.split("/").pop())).body!.split("\n")[0], "Trip");
  assertEquals((await tool(pg, a, "create", { path: "Travel/Trip/Packing.md", content: "Packing\n- [ ] Passport" })).created, "Travel/Trip/Packing.md");
  const trip = await tool(pg, a, "fetch", { id: "Travel/Trip.md" });
  assertStringIncludes(trip.text, "[Packing](<Travel/Trip/Packing.md>)");
  assertEquals(trip.metadata.sub_notes, ["Travel/Trip/Packing.md"]);
  assertEquals((await tool(pg, a, "list", { path: "Travel/Trip/" })).entries.map((e: { path: string }) => e.path), ["Travel/Trip/Packing.md"]);
  // write makes a note that isn't there; same title twice gets " (2)", oldest keeps the name.
  assertEquals((await tool(pg, a, "write", { path: "Travel/Ideas.md", content: "Ideas\n\nSintra" })).created, "Travel/Ideas.md");
  assertEquals((await tool(pg, a, "create", { type: "folder", path: "Work/Clients/" })).created, "Work/Clients/");

  // Move and rename; into a note's folder makes a sub-note; folders move.
  assertEquals((await tool(pg, a, "move", { path: "Travel/Trip.md", to: "Work/" })).moved, "Work/Trip.md");
  assertEquals((await tool(pg, a, "list", { path: "Work/Trip/" })).entries[0].path, "Work/Trip/Packing.md");
  assertEquals((await tool(pg, a, "move", { path: "Work/Trip.md", to: "Work/Lisbon trip.md" })).moved, "Work/Lisbon trip.md");
  assertEquals((await tool(pg, a, "move", { path: "Travel/Ideas.md", to: "Work/Lisbon trip/" })).moved, "Work/Lisbon trip/Ideas.md");
  assertEquals((await tool(pg, a, "move", { path: "Work/Clients/", to: "Archive/Clients/" })).moved, "Archive/Clients/");
  assertEquals((await tool(pg, a, "pin", { path: "Groceries.md", pinned: true })).pinned, true);

  // Write a whole note (read first); history and restore; delete and restore.
  await tool(pg, a, "fetch", { id: "Work/Lisbon trip.md" });
  const w = await tool(pg, a, "write", { path: "Work/Lisbon trip.md", content: "Lisbon trip\n\nPorto too.\n\n[Packing](<Work/Lisbon trip/Packing.md>)" });
  assertEquals(w.written, "Work/Lisbon trip.md");
  const trip2 = (await pg.query(`select id from public.notes where parent_id is null and id in (select parent_id from public.notes where parent_id is not null) limit 1`)).rows[0] as { id: string };
  assertStringIncludes((await opened(pg, a, trip2.id)).body!, "(pane-note:");
  const h = await tool(pg, a, "history", { path: "Work/Lisbon trip.md" });
  assert(h.versions.length >= 1);
  // The first version had the first title: restoring it renames the note back.
  assertEquals((await tool(pg, a, "restore", { path: "Work/Lisbon trip.md", version: h.versions[h.versions.length - 1].version })).restored, "Work/Trip.md");
  assertStringIncludes((await opened(pg, a, trip2.id)).body!, "Lisbon in May.");
  const gone = await tool(pg, a, "delete", { path: "Work/Trip.md" });
  assertEquals(gone.now_at, "Recently Deleted/Trip.md");
  assertEquals((await tool(pg, a, "list", { path: "Recently Deleted/Trip/" })).entries.length, 2);
  assertEquals((await tool(pg, a, "restore", { path: "Recently Deleted/Trip.md" })).restored, "Work/Trip.md");

  // A unique name in the wrong place still finds the note; an unknown one says so.
  assertEquals((await tool(pg, a, "fetch", { id: "Nowhere/Groceries.md" })).id, "Groceries.md");
  assertStringIncludes(await fails(tool(pg, a, "fetch", { id: "Shopping.md" })), "Nothing at");

  // No answer above or below carries an id.
  const everything = JSON.stringify([await tool(pg, a, "list"), await tool(pg, a, "list", { pattern: "**" }), await tool(pg, a, "fetch", { id: "Work/Trip.md" }), await tool(pg, a, "search", { query: "packing" })]);
  for (const row of (await pg.query(`select id from public.notes`)).rows as { id: string }[]) assert(!everything.replace(/ambernotes:\/\/note\/[0-9a-f-]{36}/g, "").includes(row.id), "an id leaked");
});

Deno.test("search like grep and ranked, list like glob, at scale-ish", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const work = await folder(pg, a, "Work");
  const clients = await folder(pg, a, "Clients", work);
  await note(pg, a, "Acme\n\nDeposit for the Lisbon apartment: pending.\nCall Ana.", { folder: clients });
  await note(pg, a, "Acme\n\nThe other Acme.", { folder: clients });
  await note(pg, a, "Budget 2026\n\nRent 1200\nDeposit 2400", { folder: work, pinned: true });
  for (let i = 0; i < 30; i++) await note(pg, a, `Daily ${i}\n\nNothing much.`, { folder: work });
  // Same name, one folder: the older keeps the name.
  const paths = (await tool(pg, a, "list", { path: "Work/Clients/" })).entries.map((e: { path: string }) => e.path).sort();
  assertEquals(paths, ["Work/Clients/Acme (2).md", "Work/Clients/Acme.md"]);
  // Ranked.
  const ranked = await tool(pg, a, "search", { query: "lisbon deposit" });
  assertEquals(ranked.results[0].id, "Work/Clients/Acme.md");
  // grep: files, content with context, count; scope, pinned, title_only, case.
  assertEquals((await tool(pg, a, "search", { pattern: "deposit" })).files.sort(), ["Work/Budget 2026.md", "Work/Clients/Acme.md"]);
  assertEquals((await tool(pg, a, "search", { pattern: "deposit", case_sensitive: true })).files, []);
  assertEquals((await tool(pg, a, "search", { pattern: "(?i)DEPOSIT|nothing at all", case_sensitive: true })).files.length, 2);
  assertEquals((await tool(pg, a, "search", { pattern: "deposit", path: "Work/Clients/" })).files, ["Work/Clients/Acme.md"]);
  assertEquals((await tool(pg, a, "search", { pattern: "deposit", pinned: true })).files, ["Work/Budget 2026.md"]);
  const lines = await tool(pg, a, "search", { pattern: "^Deposit \\d+", output: "content", context: 1 });
  assertEquals(lines.lines, ["Work/Budget 2026.md:3- Rent 1200", "Work/Budget 2026.md:4: Deposit 2400"]);
  assertEquals((await tool(pg, a, "search", { pattern: "nothing much", output: "count" })).matches, 30);
  assertEquals((await tool(pg, a, "search", { pattern: "acme", title_only: true })).files.length, 2);
  const paged = await tool(pg, a, "search", { pattern: "Daily", limit: 10, offset: 10 });
  assertEquals(paged.files.length, 10);
  assertStringIncludes(paged.more, "10 more: offset 20");
  // The word index narrows, never hides: substrings inside words, notes changed since it was built.
  assertEquals((await tool(pg, a, "search", { pattern: "posit" })).files.length, 2);
  await note(pg, a, "Late\n\nAnother deposit, added after the index.", { folder: work });
  assertEquals((await tool(pg, a, "search", { pattern: "deposit" })).files.length, 3);
  assertEquals((await tool(pg, a, "search", { query: "another deposit" })).results[0].id, "Work/Late.md");
  // list: glob, newest first, paging.
  assertEquals((await tool(pg, a, "list", { pattern: "**/Acme*.md" })).matches.length, 2);
  assertEquals((await tool(pg, a, "list", { path: "Work/", pattern: "Daily 1*" })).matches.length, 11);
  const page1 = await tool(pg, a, "list", { path: "Work/", limit: 5 });
  assertEquals(page1.entries[0].path, "Work/Clients/");
  assertStringIncludes(page1.more, "offset 5");
});

Deno.test("a note's files live in its folder, and links show paths", async () => {
  const base = "https://proj.supabase.co";
  Deno.env.set("SUPABASE_URL", base);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  const pg = await schemaDB();
  const a = await account(pg);
  const f = await file(pg, a, "contract.txt", "public.plain-text", new TextEncoder().encode("Signed 2026-09-30."));
  const id = await note(pg, a, `Acme\n\n![contract.txt](pane-file:${f.id})\n`);
  const unstub = stubStorage(base, new Map([[f.path, f.sealed]]));
  try {
    assertEquals((await tool(pg, a, "list", { path: "Acme/" })).entries, [{ path: "Acme/contract.txt", type: "file", kind: "text/plain", bytes: 18 }]);
    const n = await tool(pg, a, "fetch", { id: "Acme.md" });
    assertStringIncludes(n.text, "![contract.txt](<Acme/contract.txt>)");
    assertEquals(n.metadata.files, ["Acme/contract.txt"]);
    assertStringIncludes(JSON.stringify(await tool(pg, a, "fetch", { id: "Acme/contract.txt" })), "Signed 2026-09-30.");
    // A glob and a search by name find it too (from the word index).
    assertEquals((await tool(pg, a, "list", { pattern: "**/*.txt" })).matches, [{ path: "Acme/contract.txt", type: "file" }]);
    assertEquals((await tool(pg, a, "search", { pattern: "contract", type: "file" })).files, ["Acme/contract.txt"]);
    // Editing around the link keeps it a file link.
    await tool(pg, a, "edit", { path: "Acme.md", old_string: "Acme\n", new_string: "Acme\n\nThe contract:" });
    assertStringIncludes((await opened(pg, a, id)).body!, `![contract.txt](pane-file:${f.id})`);
  } finally {
    unstub();
  }
});

Deno.test("an app: create, its files, and data.json edited like a file, one change", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const made = await tool(pg, a, "create", { type: "app", path: "Health/Habits.md" });
  assertEquals(made.app, "Health/Habits.app/");
  const files = await tool(pg, a, "list", { path: "Health/Habits.app" });
  assert(files.files.some((f: { path: string }) => f.path === "Health/Habits.app/src/App.tsx"));
  assertStringIncludes((await tool(pg, a, "fetch", { id: "Health/Habits.app/README.md" })).text, "How this app runs in Amber Notes");
  // docs/ is the app's memory: the README sends the AI there, and data.json's notes come from it.
  assertStringIncludes((await tool(pg, a, "fetch", { id: "Health/Habits.app/README.md" })).text, "Read docs/ first");
  assertStringIncludes((await tool(pg, a, "fetch", { id: "Health/Habits.app/docs/README.md" })).text, "## Known gaps");
  // The starter counts as read.
  const edited = await tool(pg, a, "edit", { path: "Health/Habits.app/src/screens/home.tsx", old_string: "Nothing here yet", new_string: "No habits yet" });
  assertStringIncludes(JSON.stringify(edited), "saved");
  // The app keeps its log in localStorage; the AI sees records and removes three dates.
  const log = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"].map((date) => ({ date, walk: true }));
  await tool(pg, a, "fetch", { id: "Health/Habits.app/data.json" });
  await tool(pg, a, "write", { path: "Health/Habits.app/data.json", content: JSON.stringify({ values: { localStorage: { habits: log } }, collections: {} }) });
  const d = await tool(pg, a, "fetch", { id: "Health/Habits.app/data.json" });
  assertStringIncludes(d.metadata.readme_data, "useCollection(\"items\")");
  assertEquals(JSON.parse(d.text.replace(/^ *\d+\t/gm, "")).values.localStorage.habits.length, 5);
  const kept = log.filter((x) => x.date < "2026-10-03" || x.date > "2026-10-05");
  const r = await tool(pg, a, "write", { path: "Health/Habits.app/data.json", content: JSON.stringify({ values: { localStorage: { habits: kept } }, collections: {} }) });
  assertEquals(r.saved, "Health/Habits.app/data.json");
  const [row] = (await pg.query(`select data_ct from public.note_pages p join public.notes n on n.id = p.note_id`)).rows as { data_ct: string }[];
  assert(row.data_ct);
  assertStringIncludes(await fails(tool(pg, a, "edit", { path: "Health/Habits.app/data.json", old_string: "\"values\": {", new_string: "\"values\": {{" })), "isn't valid JSON");
  assertEquals((await tool(pg, a, "see_app", { path: "Health/Habits.app" })).previews, "unavailable");
  // What a session read is kept as ids and keyed tags: no file name or text is readable there.
  const reads = JSON.stringify((await pg.query(`select item, stamp from public.mcp_reads`)).rows);
  assert(reads.includes("note:") && reads.includes("file:"), reads.slice(0, 200));
  for (const plain of ["home.tsx", "screens", "README", "habits", "2026-10"]) assert(!reads.toLowerCase().includes(plain.toLowerCase()), plain);
  // A device that couldn't open the live app says so; the AI sees it when it looks.
  await app(pg, a.id, `insert into public.app_load_failures (note_id, message, device) select note_id, 'TypeError: x is undefined', 'iPhone' from public.note_pages limit 1`);
  assertEquals((await tool(pg, a, "fetch", { id: "Health/Habits.app" })).metadata.load_failure.message, "TypeError: x is undefined");
  assertEquals((await tool(pg, a, "see_app", { path: "Health/Habits.app" })).load_failure.device, "iPhone");
});

Deno.test("every call takes one from the MCP bucket, failed ones too (one statement, its own transaction)", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const left = async () => ((await pg.query(`select tokens from public.pane_rate where user_id = $1 and bucket = 'mcp'`, [a.id])).rows[0] as { tokens: number } | undefined)?.tokens;
  await tool(pg, a, "list");
  const after1 = await left();
  assert(after1 !== undefined && after1 <= 599.5, String(after1));
  await fails(tool(pg, a, "fetch", { id: "Nothing here.md" }));
  assert((await left())! < after1!, "a failed call is counted");
});
