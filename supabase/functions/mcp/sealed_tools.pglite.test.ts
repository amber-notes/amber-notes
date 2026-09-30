// The MCP tools on sealed notes (20261001090000_e2ee.sql) in an in-process Postgres (PGlite): what
// they write, what they leave alone, and the scan budget for work that opens every note.
//   cd supabase/functions/mcp && deno test -A sealed_tools.pglite.test.ts
import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { schemaDB } from "./pglite.ts";
import { type Account, account, app, edit, file, folder, note, opened, share, stubStorage, toolContext } from "./sealed.ts";
import { MAX_FILE_BYTES, readCapped, runTool, scanLimits, ToolError } from "./tools.ts";

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

const copyOf = async (pg: PGlite, slug: string, sub?: string) =>
  (await pg.query<{ p: { title: string; body: string } }>(`select public.shared_note($1, $2) as p`, [slug, sub ?? null])).rows[0].p;

Deno.test("an AI edit of a shared note rewrites its public copy in the same transaction", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, "Menu\n\nSoup");
  const r = await share(pg, a, id, { title: "Menu", body: "Menu\n\nSoup" });
  await tool(pg, a, "edit_note", { id, edits: [{ old_text: "Soup", new_text: "Salad" }] });
  const page = await copyOf(pg, r.slug);
  assertEquals([page.title, page.body], ["Menu", "Menu\n\nSalad"]);
});

// A row in note_shares or note_share_pages is only a claim: anyone who can write the database can
// plant one. The AI server republishes only under links the account's key tagged, and a page only
// when the link's root reaches it through its sealed text.
Deno.test("an AI edit republishes only links the account's key verifies, and pages the root's text reaches", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const planted = (slug: string, noteId: string, tag: string | null, subnotes = false) =>
    pg.query(`insert into public.note_shares (slug, note_id, user_id, include_subnotes, share_tag, title, body, published_at)
              values ($1, $2, $3, $4, $5, 'Old', 'Old', now())`, [slug, noteId, a.id, subnotes, tag]);
  const plantedPage = (slug: string, noteId: string, parent: string) =>
    pg.query(`insert into public.note_share_pages (slug, note_id, parent_id, title, body) values ($1, $2, $3, 'Old', 'Old')`, [slug, noteId, parent]);

  // A private note with a planted link: a tag of zeros, then no tag.
  const diary = await note(pg, a, "Diary\n\nprivate");
  await planted("z".repeat(24), diary, "0".repeat(64));
  await tool(pg, a, "append_to_note", { id: diary, text: "more private" });
  assertEquals((await copyOf(pg, "z".repeat(24))).body, "Old");
  await pg.query(`update public.note_shares set share_tag = null where slug = $1`, ["z".repeat(24)]);
  await tool(pg, a, "append_to_note", { id: diary, text: "even more" });
  assertEquals((await copyOf(pg, "z".repeat(24))).body, "Old");

  // A trip shared with its sub-notes: Day 1 is linked from the trip, Day 2 from Day 1.
  const trip = await note(pg, a, "Trip\n\nLisbon");
  const day1 = await note(pg, a, "Day 1\n\nMuseum", { parent: trip });
  const day2 = await note(pg, a, "Day 2\n\nBeach", { parent: day1 });
  await edit(pg, a, trip, `Trip\n\nLisbon\n[Day 1](pane-note:${day1})`);
  await edit(pg, a, day1, `Day 1\n\nMuseum\n[Day 2](pane-note:${day2})`);
  // A private note moved under the trip by parent_id alone: no link to it in the trip's text.
  const secret = await note(pg, a, "Secret\n\nnot shared", { parent: trip });
  // And one more private note, not under the trip at all.
  const other = await note(pg, a, "Other\n\nnot shared");
  const s = await share(pg, a, trip, {
    title: "Trip", body: `Trip\n\nLisbon\n[Day 1](pane-note:${day1})`,
    pages: [
      { id: day1, parent_id: trip, title: "Day 1", body: "Day 1\n\nMuseum" },
      { id: day2, parent_id: day1, title: "Day 2", body: "Day 2\n\nBeach" },
    ],
  }, true);
  await plantedPage(s.slug, secret, trip);
  await plantedPage(s.slug, other, trip);

  await tool(pg, a, "replace_note_body", { id: day2, body: "Day 2\n\nBeach, then dinner" });
  assertEquals((await copyOf(pg, s.slug, day2)).body, "Day 2\n\nBeach, then dinner");
  await tool(pg, a, "replace_note_body", { id: secret, body: "Secret\n\nstill not shared" });
  await tool(pg, a, "replace_note_body", { id: other, body: "Other\n\nstill not shared" });
  const pages = (await pg.query<{ note_id: string; body: string }>(`select note_id, body from public.note_share_pages where slug = $1`, [s.slug])).rows;
  assertEquals(pages.find((p) => p.note_id === secret)?.body, "Old");
  assertEquals(pages.find((p) => p.note_id === other)?.body, "Old");

  // The same link planted without sub-notes (its tag no longer verifies) publishes no pages at all,
  // and neither does a tag made for include_subnotes = false on a link that claims true.
  await pg.query(`update public.note_shares set include_subnotes = false where slug = $1`, [s.slug]);
  await tool(pg, a, "replace_note_body", { id: day1, body: `Day 1\n\nMuseum, closed\n[Day 2](pane-note:${day2})` });
  assertEquals((await copyOf(pg, s.slug)).body, `Trip\n\nLisbon\n[Day 1](pane-note:${day1})`);
  const [{ body: day1Copy }] = (await pg.query<{ body: string }>(`select body from public.note_share_pages where slug = $1 and note_id = $2`, [s.slug, day1])).rows;
  assertEquals(day1Copy, "Day 1\n\nMuseum");
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

Deno.test("get_file refuses a file over the cap by its stored size, and never reads more than the cap", async () => {
  const base = "https://proj.supabase.co";
  Deno.env.set("SUPABASE_URL", base);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  const pg = await schemaDB();
  const a = await account(pg);
  const small = await file(pg, a, "notes.txt", "public.plain-text", new TextEncoder().encode("hello"));
  const objects = new Map([[small.path, small.sealed]]);
  let downloads = 0;
  const unstub = stubStorage(base, objects, () => { throw new Error("unexpected fetch"); });
  const counting = globalThis.fetch;
  globalThis.fetch = (input, init) => { downloads++; return counting(input, init); };
  try {
    const ok = await tool(pg, a, "get_file", { id: small.id });
    assertEquals(ok.content[1], { type: "text", text: "hello" });
    assertEquals(downloads, 1);
    // Stored as bigger than the cap: refused before anything is downloaded.
    await pg.query(`update public.attachments set size = $2 where id = $1`, [small.id, MAX_FILE_BYTES + 1]);
    assertStringIncludes((await assertRejects(() => tool(pg, a, "get_file", { id: small.id }), ToolError)).message, "Files over 8 MB");
    assertEquals(downloads, 1);
    // A stored size that says small, and an object that isn't: reading stops at the cap.
    await pg.query(`update public.attachments set size = 5 where id = $1`, [small.id]);
    objects.set(small.path, new Uint8Array(MAX_FILE_BYTES + 1024));
    assertStringIncludes((await assertRejects(() => tool(pg, a, "get_file", { id: small.id }), ToolError)).message, "Files over 8 MB");
  } finally {
    unstub();
  }
});

Deno.test("readCapped trusts neither a missing nor a wrong Content-Length", async () => {
  const stream = (chunks: number, size: number) => {
    let sent = 0;
    return new ReadableStream<Uint8Array>({ pull(c) { if (sent++ < chunks) c.enqueue(new Uint8Array(size)); else c.close(); } });
  };
  assertEquals((await readCapped(new Response(stream(4, 10)), 40)).length, 40);
  // No length: counted while read, and stopped once past the cap.
  let pulled = 0;
  const endless = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(10)); } });
  await assertRejects(() => readCapped(new Response(endless), 45), RangeError);
  assert(pulled <= 7, `pulled ${pulled}`);
  // A declared length over the cap: refused without reading.
  let read = false;
  const declared = new Response(new ReadableStream<Uint8Array>({ pull(c) { read = true; c.close(); } }), { headers: { "content-length": "1000" } });
  await assertRejects(() => readCapped(declared, 100), RangeError);
  assertEquals(read, false);
  // A declared length under the cap that the body exceeds: still stopped.
  await assertRejects(() => readCapped(new Response(stream(5, 10), { headers: { "content-length": "10" } }), 20), RangeError);
});
