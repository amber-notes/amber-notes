// Note pages (prototype) in an in-process Postgres (PGlite): set_note_page and get_note_page, how a
// page is stored (sealed, beside the note, never in its text), and who can reach it.
//   cd supabase/functions/mcp && deno test -A note_pages.pglite.test.ts
import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { schemaDB } from "./pglite.ts";
import { type Account, account, app, lockedNote, note, notesPassword, opened, toolContext } from "./sealed.ts";
import { runTool, ToolError } from "./tools.ts";

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
