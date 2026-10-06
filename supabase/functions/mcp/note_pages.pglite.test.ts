// Note pages (prototype) in an in-process Postgres (PGlite): set_note_page and get_note_page, how a
// page is stored (sealed, beside the note, never in its text), and who can reach it.
//   cd supabase/functions/mcp && deno test -A note_pages.pglite.test.ts
import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { schemaDB } from "./pglite.ts";
import { type Account, account, app, lockedNote, note, notesPassword, opened, toolContext } from "./sealed.ts";
import { runTool, ToolError } from "./tools.ts";

// The note-page tools are a prototype, served only with this setting.
Deno.env.set("AMBER_MCP_TOOLS", "pages");

// deno-lint-ignore no-explicit-any
const tool = async (pg: PGlite, a: Account, name: string, args: Record<string, unknown> = {}, write = true) => await runTool(name, args, await toolContext(pg, a, write)) as any;
const HABITS = "Habit tracker\n\n| Date | Walk | Read |\n| --- | --- | --- |\n| 2026-10-03 | ✓ | |\n| 2026-10-04 | | ✓ |\n";
const PAGE = `<!doctype html><html><body><main id="grid"></main><script>amber.onChange((n) => { grid.textContent = n.tables[0].rows.length + " days" });</script></body></html>`;

Deno.test("a page is sealed beside the note; the note's text, version and history don't change", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, HABITS);
  const [before] = (await pg.query<{ version: string; body_ct: string }>(`select version, body_ct from public.notes where id = $1`, [id])).rows;
  const r = await tool(pg, a, "set_note_page", { title: "Habit tracker", html: PAGE });
  assertEquals([r.id, r.page], [id, "created"]);
  const [row] = (await pg.query<{ page_ct: string; client: string }>(`select page_ct, client from public.note_pages where note_id = $1`, [id])).rows;
  assert(row.page_ct.startsWith(`amb2.${a.keyId}.`) && !row.page_ct.includes("amber"));
  assertEquals(row.client, "Claude");
  assertEquals(await a.vault.openPage(id, row.page_ct), PAGE);
  const [after] = (await pg.query<{ version: string; body_ct: string }>(`select version, body_ct from public.notes where id = $1`, [id])).rows;
  assertEquals(after, before);
  assertEquals((await opened(pg, a, id)).body, HABITS);
  assertEquals((await pg.query(`select 1 from public.note_revisions where note_id = $1`, [id])).rows.length, 0);
});

Deno.test("get_note_page returns the page and the rules; read_note says there is one", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, HABITS);
  const none = await tool(pg, a, "get_note_page", { id }, false);
  assertEquals(none.has_page, false);
  assertStringIncludes(none.rules, "amber.update");
  assertEquals((await tool(pg, a, "read_note", { id }, false)).has_page, undefined);
  await tool(pg, a, "set_note_page", { id, html: PAGE });
  const got = await tool(pg, a, "get_note_page", { id }, false);
  assertEquals([got.has_page, got.html, got.made_by], [true, PAGE, "Claude"]);
  assertEquals((await tool(pg, a, "read_note", { id }, false)).has_page, true);
});

Deno.test("replacing and removing a page; removing keeps a row so devices see it went", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, HABITS);
  await tool(pg, a, "set_note_page", { id, html: PAGE });
  assertEquals((await tool(pg, a, "set_note_page", { id, html: PAGE.replace("days", "entries") })).page, "replaced");
  assertEquals((await tool(pg, a, "set_note_page", { id, html: "" })).page, "removed");
  assertEquals((await tool(pg, a, "set_note_page", { id, html: " " })).page, "none");
  const rows = (await pg.query<{ page_ct: string | null }>(`select page_ct from public.note_pages where note_id = $1`, [id])).rows;
  assertEquals(rows, [{ page_ct: null }]);
  assertEquals((await tool(pg, a, "get_note_page", { id }, false)).has_page, false);
  assertEquals((await opened(pg, a, id)).body, HABITS);
});

Deno.test("pages with external addresses or network calls are refused, and nothing is stored", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, HABITS);
  const err = await assertRejects(() => tool(pg, a, "set_note_page", { id, html: PAGE.replace("<main", `<img src="https://tracker.example/p.gif"><main`) }), ToolError);
  assertStringIncludes(err.message, "https://tracker.example/p.gif");
  await assertRejects(() => tool(pg, a, "set_note_page", { id, html: PAGE.replace("amber.onChange", "fetch('/x'); amber.onChange") }), ToolError, "fetch");
  assertEquals((await pg.query(`select 1 from public.note_pages`)).rows.length, 0);
});

Deno.test("read-only connections can read a page but not set one; locked notes take none", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, HABITS);
  await assertRejects(() => tool(pg, a, "set_note_page", { id, html: PAGE }, false), ToolError, "read-only");
  const locked = await lockedNote(pg, a, await notesPassword(pg, a), "Diary");
  await assertRejects(() => tool(pg, a, "set_note_page", { id: locked, html: PAGE }), ToolError, "locked");
});

Deno.test("locking a note takes its page; another account can't see or write one", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const b = await account(pg);
  const id = await note(pg, a, HABITS);
  await tool(pg, a, "set_note_page", { id, html: PAGE });
  assertEquals(await app(pg, b.id, `select * from public.note_pages`), []);
  const theirs = await b.vault.sealPage(id, PAGE);
  await assertRejects(() => app(pg, b.id, `insert into public.note_pages (note_id, page_ct) values ($1, $2)`, [id, theirs]));
  // A box sealed with an old key is refused, as for the note itself.
  const stale = await account(pg);
  const old = await stale.vault.sealPage(id, PAGE);
  await assertRejects(() => app(pg, a.id, `update public.note_pages set page_ct = $2 where note_id = $1`, [id, old]), Error, "old key");
  const lockKey = await notesPassword(pg, a);
  await app(pg, a.id, `update public.notes set body_ct = null, locked_body = $2 where id = $1`, [id, `amb2.${lockKey}.${btoa("x".repeat(48))}`]);
  assertEquals((await pg.query(`select 1 from public.note_pages where note_id = $1`, [id])).rows.length, 0);
});

// MARK: No data loss

const noteRow = async (pg: PGlite, id: string) =>
  (await pg.query(`select body_ct, head_ct, locked_body, version, updated_at, server_updated_at, body_source, body_client, body_at from public.notes where id = $1`, [id])).rows[0];

Deno.test("no page tool ever touches the note: its row is byte-identical and no version is made", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, HABITS);
  const before = await noteRow(pg, id);
  await tool(pg, a, "set_note_page", { id, html: PAGE });
  await tool(pg, a, "set_note_page", { id, html: PAGE.replace("days", "entries") });
  await tool(pg, a, "edit_note_page", { id, edits: [{ old_text: "entries", new_text: "days logged" }] });
  await tool(pg, a, "set_note_page", { id, html: "" });
  await tool(pg, a, "get_note_page", { id }, false);
  assertEquals(await noteRow(pg, id), before);
  assertEquals((await pg.query(`select 1 from public.note_revisions where note_id = $1`, [id])).rows.length, 0);
  assertEquals((await opened(pg, a, id)).body, HABITS);
});

Deno.test("the last 10 pages are kept, newest first, and an earlier one reads back whole", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, HABITS);
  const page = (i: number) => PAGE.replace("days", `days v${i}`);
  for (let i = 1; i <= 12; i++) await tool(pg, a, "set_note_page", { id, html: page(i) });
  const got = await tool(pg, a, "get_note_page", { id }, false);
  assertEquals(got.html, page(12));
  assertEquals(got.versions.length, 10);
  const oldest = got.versions[9], newest = got.versions[0];
  assertEquals((await tool(pg, a, "get_note_page", { id, version_id: newest.version_id }, false)).html, page(11));
  assertEquals((await tool(pg, a, "get_note_page", { id, version_id: oldest.version_id }, false)).html, page(2));
  // Removing the page keeps it with the others; the AI brings one back by sending its html.
  await tool(pg, a, "set_note_page", { id, html: "" });
  const after = await tool(pg, a, "get_note_page", { id }, false);
  assertEquals(after.has_page, false);
  assertEquals((await tool(pg, a, "get_note_page", { id, version_id: after.versions[0].version_id }, false)).html, page(12));
  await assertRejects(() => tool(pg, a, "get_note_page", { id, version_id: 999 }, false), ToolError, "No earlier page 999");
  // Sending the same page again isn't a new version.
  await tool(pg, a, "set_note_page", { id, html: page(12) });
  await tool(pg, a, "set_note_page", { id, html: page(12) });
  assertEquals((await tool(pg, a, "get_note_page", { id }, false)).versions[0].version_id, after.versions[0].version_id);
});

Deno.test("earlier pages are the owner's, read-only, and go when the note is locked", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const b = await account(pg);
  const id = await note(pg, a, HABITS);
  await tool(pg, a, "set_note_page", { id, html: PAGE });
  await tool(pg, a, "set_note_page", { id, html: PAGE.replace("days", "entries") });
  assertEquals((await app(pg, a.id, `select count(*)::int n from public.note_page_versions`))[0].n, 1);
  assertEquals(await app(pg, b.id, `select * from public.note_page_versions`), []);
  const box = (await app(pg, a.id, `select page_ct from public.note_page_versions`))[0].page_ct;
  await assertRejects(() => app(pg, a.id, `insert into public.note_page_versions (note_id, user_id, page_ct, made_at) values ($1, $2, $3, now())`, [id, a.id, box]));
  await assertRejects(() => app(pg, a.id, `delete from public.note_page_versions`).then((r) => { if ((r as unknown[]).length === 0) throw new Error("denied"); }));
  assertEquals((await pg.query(`select 1 from public.note_page_versions`)).rows.length, 1);
  const lockKey = await notesPassword(pg, a);
  await app(pg, a.id, `update public.notes set body_ct = null, locked_body = $2 where id = $1`, [id, `amb2.${lockKey}.${btoa("x".repeat(48))}`]);
  assertEquals((await pg.query(`select 1 from public.note_page_versions`)).rows.length, 0);
});

// MARK: Editing a page

Deno.test("edit_note_page changes the page in place, keeps the one before, and checks the result", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, HABITS);
  await assertRejects(() => tool(pg, a, "edit_note_page", { id, edits: [{ old_text: "a", new_text: "b" }] }), ToolError, "has no page");
  await tool(pg, a, "set_note_page", { id, html: PAGE });
  const r = await tool(pg, a, "edit_note_page", { id, edits: [{ old_text: `" days"`, new_text: `" days tracked"` }] });
  assertEquals(r.page, "replaced");
  const got = await tool(pg, a, "get_note_page", { id }, false);
  assertEquals(got.html, PAGE.replace(`" days"`, `" days tracked"`));
  assertEquals((await tool(pg, a, "get_note_page", { id, version_id: got.versions[0].version_id }, false)).html, PAGE);
  await assertRejects(() => tool(pg, a, "edit_note_page", { id, edits: [{ old_text: "nowhere", new_text: "x" }] }), ToolError, "get_note_page");
  await assertRejects(() => tool(pg, a, "edit_note_page", { id, edits: [{ old_text: "n", new_text: "x" }] }), ToolError, "appears");
  // An edit that would reach the network is refused whole.
  const err = await assertRejects(() => tool(pg, a, "edit_note_page", { id, edits: [{ old_text: "<main", new_text: `<img src="https://t.example/p.gif"><main` }] }), ToolError);
  assertStringIncludes(err.message, "https://t.example/p.gif");
  await assertRejects(() => tool(pg, a, "edit_note_page", { id, edits: [{ old_text: "<main", new_text: "<main" }] }, false), ToolError, "read-only");
  assertEquals((await tool(pg, a, "get_note_page", { id }, false)).html, got.html);
  assertEquals((await tool(pg, a, "edit_note_page", { id, edits: [{ old_text: "<main", new_text: "<main" }] })).page, "unchanged");
});

// MARK: Page data

const writeData = async (pg: PGlite, a: Account, id: string, data: unknown) => {
  const box = await a.vault.sealPageData(id, JSON.stringify(data));
  await app(pg, a.id, `insert into public.note_pages (note_id, data_ct) values ($1, $2) on conflict (note_id) do update set data_ct = excluded.data_ct`, [id, box]);
};

Deno.test("a page's data is sealed next to it, readable by get_note_page, and never touches the note", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, HABITS);
  await tool(pg, a, "set_note_page", { id, html: PAGE });
  const before = await noteRow(pg, id);
  const data = { values: { goal: 4 }, collections: { workouts: [{ id: "w1", created: "2026-10-05T07:00:00Z", kind: "Run", km: 5.2 }] } };
  await writeData(pg, a, id, data);
  const [row] = (await pg.query<{ data_ct: string }>(`select data_ct from public.note_pages where note_id = $1`, [id])).rows;
  assert(row.data_ct.startsWith(`amb2.${a.keyId}.`) && !row.data_ct.includes("Run"));
  const got = await tool(pg, a, "get_note_page", { id }, false);
  assertEquals(got.data, data);
  assertEquals(await noteRow(pg, id), before);
  // A box from an old key is refused, and so is another account's write.
  const stale = await account(pg);
  const old = await stale.vault.sealPageData(id, "{}");
  await assertRejects(() => app(pg, a.id, `update public.note_pages set data_ct = $2 where note_id = $1`, [id, old]), Error, "old key");
  const b = await account(pg);
  const theirs = await b.vault.sealPageData(id, "{}");
  assertEquals(await app(pg, b.id, `update public.note_pages set data_ct = $2 where note_id = $1 returning 1`, [id, theirs]), []);
});

Deno.test("data changes keep a version at most once a minute; a new page keeps its data with it", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = await note(pg, a, HABITS);
  await tool(pg, a, "set_note_page", { id, html: PAGE });
  await writeData(pg, a, id, { values: { n: 1 }, collections: {} });
  await writeData(pg, a, id, { values: { n: 2 }, collections: {} });
  await writeData(pg, a, id, { values: { n: 3 }, collections: {} });
  let got = await tool(pg, a, "get_note_page", { id }, false);
  assertEquals(got.data.values, { n: 3 });
  assertEquals(got.versions.map((v: { kept_because: string }) => v.kept_because), ["data changed"]);
  assertEquals((await tool(pg, a, "get_note_page", { id, version_id: got.versions[0].version_id }, false)).data.values, { n: 1 });
  // A minute later the next change is kept again.
  await pg.query(`update public.note_page_versions set replaced_at = replaced_at - interval '2 minutes'`);
  await writeData(pg, a, id, { values: { n: 4 }, collections: {} });
  // Replacing the page keeps the old page together with the data it had.
  await tool(pg, a, "set_note_page", { id, html: PAGE.replace("days", "entries") });
  got = await tool(pg, a, "get_note_page", { id }, false);
  assertEquals(got.versions.map((v: { kept_because: string }) => v.kept_because), ["page changed", "data changed", "data changed"]);
  const kept = await tool(pg, a, "get_note_page", { id, version_id: got.versions[0].version_id }, false);
  assertEquals([kept.html, kept.data.values], [PAGE, { n: 4 }]);
  assertEquals(got.data.values, { n: 4 });
});

Deno.test("list_api_keys shows names, hosts and whether set, never values", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const id = crypto.randomUUID();
  const meta = await a.vault.sealAPIKeyMeta(id, JSON.stringify({ name: "OpenWeather", hosts: ["api.openweathermap.org"], set: true }));
  await app(pg, a.id, `insert into public.api_key_names (id, meta_ct) values ($1, $2)`, [id, meta]);
  const r = await tool(pg, a, "list_api_keys", {}, false);
  assertEquals(r.keys, [{ name: "OpenWeather", hosts: ["api.openweathermap.org"], set: true }]);
  const b = await account(pg);
  assertEquals((await tool(pg, b, "list_api_keys", {}, false)).keys, []);
});
