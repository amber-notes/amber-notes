// Locked notes (20260930150000_locked_notes.sql) on the whole schema in an in-process Postgres
// (PGlite), with the MCP tools running against it unchanged. Needs no Docker or local stack:
//   cd supabase/functions/mcp && deno test -A locked.pglite.test.ts
// locked.e2e.test.ts runs the MCP checks against the real local stack.
import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { asUser, newUser, schemaDB, sqlFor } from "./pglite.ts";
import { runTool, ToolError } from "./tools.ts";

/** A key id as the app makes one (8 random bytes in hex), made fresh each run. */
const keyId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
const KEY = keyId();
const OLD_KEY = keyId();
/** What the app stores: its key id and an AES-GCM box. The server never opens it, so any bytes do. */
const sealed = (key = KEY) => `amb1.${key}.${btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(48))))}`;

async function setUp() {
  const pg = await schemaDB();
  const me = await newUser(pg);
  await asUser(pg, me, `insert into public.note_locks (salt, iterations, key_id, verifier, hint) values ($1, 600000, $2, 'v', 'Blue')`,
    [btoa("sixteen byte salt!"), KEY]);
  return { pg, me };
}

async function note(pg: PGlite, me: string, body: string, locked?: string) {
  const id = crypto.randomUUID();
  await asUser(pg, me, `insert into public.notes (id, body, locked_body) values ($1, $2, $3)`, [id, body, locked ?? null]);
  return id;
}

/** The app writes as 'app' with its device in the header. */
const app = (pg: PGlite, me: string, sql: string, params: unknown[] = []) =>
  asUser(pg, me, sql, params, { "request.headers": JSON.stringify({ "x-pane-device": "Mac" }) });

const tool = (pg: PGlite, me: string, name: string, args: Record<string, unknown> = {}) =>
  runTool(name, args, { sql: sqlFor(pg), userId: me, client: "Claude", canWrite: true }) as Promise<any>;

async function refused(p: Promise<unknown>, text: string) {
  const e = await assertRejects(() => p);
  assertStringIncludes((e as Error).message, text);
}

Deno.test("locking deletes every earlier version, and later versions keep only ciphertext", async () => {
  const { pg, me } = await setUp();
  const id = await note(pg, me, "Bank\n\nPIN 1234");
  await asUser(pg, me, `update public.notes set body = 'Bank\n\nPIN 1234\nPUK 5678' where id = $1`, [id], { "pane.source": "mcp", "pane.client": "Claude" });
  await app(pg, me, `update public.notes set body = 'Bank\n\nPIN 4321' where id = $1`, [id]);
  const before = await pg.query<{ n: number }>(`select count(*)::int as n from public.note_revisions where note_id = $1`, [id]);
  assertEquals(before.rows[0].n, 2);

  await app(pg, me, `update public.notes set body = 'Bank', locked_body = $2 where id = $1`, [id, sealed()]);
  const after = await pg.query(`select * from public.note_revisions where note_id = $1`, [id]);
  assertEquals(after.rows.length, 0, "no readable version may stay behind");

  // An edit while locked keeps the old ciphertext and the title, never text.
  await asUser(pg, me, `update public.notes set locked_body = $2 where id = $1`, [id, sealed()], { "pane.source": "restore" });
  const kept = await pg.query<{ body: string; locked_body: string }>(`select body, locked_body from public.note_revisions where note_id = $1`, [id]);
  assertEquals(kept.rows.length, 1);
  assertEquals(kept.rows[0].body, "Bank");
  assert(kept.rows[0].locked_body.startsWith(`amb1.${KEY}.`));
  const dump = JSON.stringify((await pg.query(`select * from public.note_revisions where note_id = $1`, [id])).rows);
  assert(!dump.includes("PIN"), "no revision has the text");
});

Deno.test("a locked note's body is its title only", async () => {
  const { pg, me } = await setUp();
  await refused(note(pg, me, "Bank\n\nPIN 1234", sealed()), "notes_locked_title_only");
  const id = await note(pg, me, "Bank", sealed());
  const [row] = (await pg.query<{ title: string }>(`select title from public.notes where id = $1`, [id])).rows;
  assertEquals(row.title, "Bank");
});

Deno.test("a note sealed with an old password's key is refused; changing the password lets the new key in", async () => {
  const { pg, me } = await setUp();
  await refused(note(pg, me, "Old", sealed(OLD_KEY)), "different notes password");
  const id = await note(pg, me, "Diary", sealed());
  // A pin on a note still sealed with the current key is fine; so is one after the password changed.
  await asUser(pg, me, `update public.note_locks set key_id = $1, salt = $2`, [OLD_KEY, btoa("another salt here!")]);
  await app(pg, me, `update public.notes set is_pinned = true where id = $1`, [id]);
  await refused(app(pg, me, `update public.notes set locked_body = $2 where id = $1`, [id, sealed()]), "different notes password");
  await app(pg, me, `update public.notes set locked_body = $2 where id = $1`, [id, sealed(OLD_KEY)]);
  // The password setup can't be deleted.
  await refused(asUser(pg, me, `delete from public.note_locks`), "permission denied");
});

Deno.test("locking a shared note stops its link, and a locked note can't be shared", async () => {
  const { pg, me } = await setUp();
  const id = await note(pg, me, "Plans\n\nSecret");
  const [{ slug }] = await asUser<{ slug: string }>(pg, me, `select public.share_note($1) as slug`, [id]);
  assert((await pg.query<{ p: unknown }>(`select public.shared_note($1) as p`, [slug])).rows[0].p);
  await app(pg, me, `update public.notes set body = 'Plans', locked_body = $2 where id = $1`, [id, sealed()]);
  assertEquals((await pg.query<{ p: unknown }>(`select public.shared_note($1) as p`, [slug])).rows[0].p, null);
  const live = await pg.query(`select 1 from public.note_shares where note_id = $1 and revoked_at is null`, [id]);
  assertEquals(live.rows.length, 0);
  await refused(asUser(pg, me, `select public.share_note($1)`, [id]), "can't be shared");
});

Deno.test("a locked sub-note doesn't show through its parent's link", async () => {
  const { pg, me } = await setUp();
  const parent = await note(pg, me, "Trip");
  const child = crypto.randomUUID();
  await asUser(pg, me, `insert into public.notes (id, body, parent_id, locked_body) values ($1, 'Passport numbers', $2, $3)`, [child, parent, sealed()]);
  await app(pg, me, `update public.notes set body = $2 where id = $1`, [parent, `Trip\n\n[Passport numbers](pane-note:${child})`]);
  const [{ slug }] = await asUser<{ slug: string }>(pg, me, `select public.share_note($1, true) as slug`, [parent]);
  const page = (await pg.query<{ p: { subnotes: unknown[] } }>(`select public.shared_note($1) as p`, [slug])).rows[0].p;
  assertEquals(page.subnotes, []);
  assertEquals((await pg.query<{ p: unknown }>(`select public.shared_note($1, $2) as p`, [slug, child])).rows[0].p, null);
});

Deno.test("restoring a version saved while locked brings the ciphertext back", async () => {
  const { pg, me } = await setUp();
  const id = await note(pg, me, "Diary", sealed());
  const first = (await pg.query<{ locked_body: string }>(`select locked_body from public.notes where id = $1`, [id])).rows[0].locked_body;
  await asUser(pg, me, `update public.notes set locked_body = $2 where id = $1`, [id, sealed()], { "pane.source": "restore" });
  const [rev] = (await pg.query<{ version: number }>(`select version from public.note_revisions where note_id = $1`, [id])).rows;
  const [back] = await asUser<{ body: string; locked_body: string }>(pg, me, `select body, locked_body from public.restore_note_version($1, $2)`, [id, rev.version]);
  assertEquals([back.body, back.locked_body], ["Diary", first]);
});

Deno.test("MCP: search skips locked notes; the list shows them as locked, title only", async () => {
  const { pg, me } = await setUp();
  await note(pg, me, "Groceries\n\nOat milk and saffron");
  const locked = await note(pg, me, "Saffron recipe", sealed());
  for (const [name, key] of [["search_notes", "results"], ["search", "results"]] as const) {
    const r = await tool(pg, me, name, { query: "saffron" });
    assertEquals(r[key].length, 1, `${name} finds only the open note`);
    assert(r[key].every((x: { id: string }) => x.id !== locked));
  }
  const list = await tool(pg, me, "list_notes");
  const row = list.notes.find((n: { id: string }) => n.id === locked);
  assertEquals(row.title, "Saffron recipe");
  assertEquals(row.locked, true);
  assertEquals(row.preview, undefined);
  const overview = await tool(pg, me, "get_overview");
  assert(overview.recently_edited.some((n: { id: string; locked?: boolean }) => n.id === locked && n.locked));
});

Deno.test("MCP: reading a locked note says it's locked; by id or by title", async () => {
  const { pg, me } = await setUp();
  const id = await note(pg, me, "Passwords", sealed());
  for (const [name, args] of [["read_note", { id }], ["read_note", { title: "Passwords" }], ["fetch", { id }], ["note_history", { id }], ["read_table", { id }]] as const) {
    const e = await assertRejects(() => tool(pg, me, name, args), ToolError);
    assertStringIncludes(e.message, "This note is locked", name);
  }
});

Deno.test("MCP: every change to a locked note is refused and nothing changes", async () => {
  const { pg, me } = await setUp();
  const id = await note(pg, me, "Passwords", sealed());
  const before = (await pg.query(`select * from public.notes where id = $1`, [id])).rows[0];
  const attempts: [string, Record<string, unknown>][] = [
    ["edit_note", { id, edits: [{ old_text: "Passwords", new_text: "Mine" }] }],
    ["append_to_note", { id, text: "- more" }],
    ["replace_note_body", { id, body: "Hacked" }],
    ["set_checklist_item", { id, item: "x", checked: true }],
    ["create_sub_note", { id, body: "Child" }],
    ["move_note", { id, folder: "Elsewhere" }],
    ["pin_note", { id, pinned: true }],
    ["delete_note", { id }],
    ["log_table_row", { id, values: { a: 1 } }],
  ];
  for (const [name, args] of attempts) {
    const e = await assertRejects(() => tool(pg, me, name, args), ToolError);
    assertStringIncludes(e.message, "This note is locked", name);
  }
  const after = (await pg.query(`select * from public.notes where id = $1`, [id])).rows[0];
  assertEquals(after, before);
});

Deno.test("MCP: even a raw write as an AI can't change or lock a note", async () => {
  const { pg, me } = await setUp();
  const id = await note(pg, me, "Passwords", sealed());
  const open = await note(pg, me, "Open note");
  const mcp = { "pane.source": "mcp", "pane.client": "Claude" };
  await refused(asUser(pg, me, `update public.notes set body = 'Changed' where id = $1`, [id], mcp), "This note is locked");
  await refused(asUser(pg, me, `update public.notes set locked_body = null where id = $1`, [id], mcp), "This note is locked");
  await refused(asUser(pg, me, `update public.notes set body = 'Open note', locked_body = $2 where id = $1`, [open, sealed()], mcp), "This note is locked");
});

Deno.test("MCP: history of a note that was locked shows those versions as locked, and won't restore them", async () => {
  const { pg, me } = await setUp();
  const id = await note(pg, me, "Diary", sealed());
  // Unlocked in the app: the locked text becomes a version.
  await app(pg, me, `update public.notes set body = 'Diary\n\nDear diary', locked_body = null where id = $1`, [id]);
  const h = await tool(pg, me, "note_history", { id });
  assertEquals(h.revisions.length, 1);
  assertEquals(h.revisions[0].locked, true);
  assertEquals(h.revisions[0].preview, undefined);
  const e = await assertRejects(() => tool(pg, me, "restore_revision", { id, revision_id: h.revisions[0].revision_id }), ToolError);
  assertStringIncludes(e.message, "saved while the note was locked");
});
