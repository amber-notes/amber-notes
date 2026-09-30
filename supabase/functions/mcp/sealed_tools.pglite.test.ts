// The MCP tools on sealed notes (20261001090000_e2ee.sql) in an in-process Postgres (PGlite): what
// they write, what they leave alone, and the scan budget for work that opens every note.
//   cd supabase/functions/mcp && deno test -A sealed_tools.pglite.test.ts
import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { schemaDB } from "./pglite.ts";
import { type Account, account, app, edit, folder, note, opened, toolContext } from "./sealed.ts";
import { runTool, scanLimits, ToolError } from "./tools.ts";

// deno-lint-ignore no-explicit-any
const tool = async (pg: PGlite, a: Account, name: string, args: Record<string, unknown> = {}) => await runTool(name, args, await toolContext(pg, a)) as any;
const row = async (pg: PGlite, id: string) =>
  (await pg.query<{ body_ct: string; head_ct: string; version: number }>(`select body_ct, head_ct, version from public.notes where id = $1`, [id])).rows[0];
const revisions = async (pg: PGlite, id: string) => (await pg.query(`select 1 from public.note_revisions where note_id = $1`, [id])).rows.length;

Deno.test("an AI edit is sealed with the account's key; its head is the new title and preview", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, "Groceries\n\n- milk");
  await tool(pg, a, "append_to_note", { id, text: "- eggs" });
  const r = await row(pg, id);
  assert(r.body_ct.startsWith(`amb2.${a.keyId}.`) && r.head_ct.startsWith(`amb2.${a.keyId}.`));
  assertEquals(await opened(pg, a, id), { head: { title: "Groceries", preview: "milk · eggs" }, body: "Groceries\n\n- milk\n- eggs\n" });
  const created = (await tool(pg, a, "create_note", { body: "# Trip\n\nLisbon", folder: "Travel/2026" })).created;
  assertEquals((await opened(pg, a, created.id)).head, { title: "Trip", preview: "Lisbon" });
  assertEquals(created.folder, "Travel/2026");
  const names = (await pg.query<{ id: string; name_ct: string }>(`select id, name_ct from public.folders`)).rows;
  assertEquals((await Promise.all(names.map((f) => a.vault.openFolder(f.id, f.name_ct)))).sort(), ["2026", "Travel"]);
});

Deno.test("unchanged text isn't sealed again, and moving or pinning never touches the boxes", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const body = "List\n\n- [ ] open\n- [x] done";
  const id = await note(pg, a, body);
  const before = await row(pg, id);
  await tool(pg, a, "replace_note_body", { id, body });
  await tool(pg, a, "set_checklist_item", { id, item: "done", checked: true });
  await tool(pg, a, "edit_note", { id, edits: [{ old_text: "open", new_text: "open" }] });
  await tool(pg, a, "pin_note", { id, pinned: true });
  await tool(pg, a, "move_note", { id, folder: "Elsewhere" });
  const after = await row(pg, id);
  assertEquals([after.body_ct, after.head_ct], [before.body_ct, before.head_ct]);
  assertEquals(await revisions(pg, id), 0);
  // A body change that leaves title and preview alone keeps the head's box too.
  await tool(pg, a, "edit_note", { id, edits: [{ old_text: "List", new_text: "List" + " ".repeat(3) }] });
  assertEquals((await row(pg, id)).head_ct, before.head_ct);
});

Deno.test("restoring a version copies its boxes back as they are", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, "Plan\n\nfirst");
  const first = await row(pg, id);
  await tool(pg, a, "replace_note_body", { id, body: "Plan\n\nsecond" });
  const h = await tool(pg, a, "note_history", { id });
  assertEquals(h.revisions[0].preview, "first");
  assertEquals(h.revisions[0].characters, "Plan\n\nfirst".length);
  const r = await tool(pg, a, "restore_revision", { id, revision_id: h.revisions[0].revision_id });
  assertEquals(r.restored.title, "Plan");
  const now = await row(pg, id);
  assertEquals([now.body_ct, now.head_ct], [first.body_ct, first.head_ct]);
  const [{ body_source }] = (await pg.query<{ body_source: string }>(`select body_source from public.notes where id = $1`, [id])).rows;
  assertEquals(body_source, "restore");
});

Deno.test("an AI edit of a shared note rewrites its public copy in the same transaction", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, "Menu\n\nSoup");
  const [{ r }] = await app(pg, a.id, `select public.share_note($1, false, $2) as r`, [id, JSON.stringify({ title: "Menu", body: "Menu\n\nSoup", pages: [], files: [] })]);
  await tool(pg, a, "edit_note", { id, edits: [{ old_text: "Soup", new_text: "Salad" }] });
  const page = (await pg.query<{ p: { title: string; body: string } }>(`select public.shared_note($1) as p`, [r.slug])).rows[0].p;
  assertEquals([page.title, page.body], ["Menu", "Menu\n\nSalad"]);
});

Deno.test("lists hide sub-notes a live parent links, by opening the parents", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const f = await folder(pg, a, "Trips");
  const parent = await note(pg, a, "Trip", { folder: f });
  const linked = await note(pg, a, "Day 1", { parent, folder: f });
  const loose = await note(pg, a, "Day 2", { parent, folder: f });
  await edit(pg, a, parent, `Trip\n\n[Day 1](pane-note:${linked})`);
  const ids = (r: { notes: { id: string }[] }) => r.notes.map((n) => n.id).sort();
  assertEquals(ids(await tool(pg, a, "list_notes")), [parent, loose].sort());
  assertEquals(ids(await tool(pg, a, "list_notes", { sort: "title" })), [parent, loose].sort());
  assertEquals(ids(await tool(pg, a, "list_notes", { include_sub_notes: true })), [parent, linked, loose].sort());
  assertEquals((await tool(pg, a, "list_folders")).folders, [{ path: "Trips", id: f, notes: 2 }]);
  const overview = await tool(pg, a, "get_overview");
  assertEquals(overview.total_notes, 2);
  assertEquals((await tool(pg, a, "read_note", { id: parent })).sub_notes.map((s: { title: string }) => s.title).sort(), ["Day 1", "Day 2"]);
  // Paging counts only what's listed.
  const page = await tool(pg, a, "list_notes", { limit: 1, offset: 1 });
  assertEquals(page.notes.length, 1);
  assertEquals(page.next_offset, null);
});

Deno.test("finding a note by title opens the heads; two notes with the title need an id", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, "Packing list\n\n- passport");
  assertEquals((await tool(pg, a, "read_note", { title: "packing LIST" })).id, id);
  const e = await assertRejects(() => tool(pg, a, "read_note", { title: "packing" }), ToolError);
  assertStringIncludes(e.message, `Close matches: Packing list (${id})`);
  await note(pg, a, "Packing list\n\n- charger");
  assertStringIncludes((await assertRejects(() => tool(pg, a, "read_note", { title: "Packing list" }), ToolError)).message, "2 notes are titled");
});

Deno.test("a search that runs out of time says how far it got; a spent budget refuses", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  for (const n of ["One", "Two", "Three"]) await note(pg, a, `${n}\n\nsaffron`);
  const full = await tool(pg, a, "search_notes", { query: "saffron" });
  assertEquals(full.results.length, 3);
  assertEquals(full.searched, undefined);
  const cap = scanLimits.capMs;
  scanLimits.capMs = 0;
  try {
    const part = await tool(pg, a, "search_notes", { query: "saffron" });
    assertEquals(part.results.length, 1);
    assertEquals(part.searched, "the most recently edited note of 3");
  } finally {
    scanLimits.capMs = cap;
  }
  // The time spent was charged; with the budget used up, scans wait.
  await app(pg, a.id, `select public.pane_scan_budget(40000)`);
  for (const [name, args] of [["search_notes", { query: "saffron" }], ["search", { query: "saffron" }], ["list_notes", { sort: "title" }], ["read_note", { title: "One" }], ["list_files", {}], ["get_overview", {}]] as const) {
    const e = await assertRejects(() => tool(pg, a, name, args), ToolError);
    assertEquals(e.message, "Your AI has searched a lot in the last minute. Try again shortly.", name);
  }
  // Work that needs no scan still runs.
  assertEquals((await tool(pg, a, "list_notes")).notes.length, 3);
});
