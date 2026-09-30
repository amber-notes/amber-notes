// Locked notes (20260930150000_locked_notes.sql) on the whole schema in an in-process Postgres
// (PGlite), with the MCP tools running against it unchanged. Needs no Docker or local stack:
//   cd supabase/functions/mcp && deno test -A locked.pglite.test.ts
// locked.e2e.test.ts runs the MCP checks against the real local stack.
import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { asUser, newUser, schemaDB, sqlFor } from "./pglite.ts";
import { runTool, ToolError } from "./tools.ts";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
/** A salt and its key id, as the app makes them (16 random bytes; SHA-256 of them, 16 hex digits). */
async function newSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return { salt: b64(bytes), key: [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("") };
}
const FIRST = await newSalt();
const SECOND = await newSalt();
const KEY = FIRST.key;
const OLD_KEY = SECOND.key;
/** What the app stores: its key id and an AES-GCM box. The server never opens it, so any bytes do. */
const sealed = (key = KEY, format = "amb2") => `${format}.${key}.${b64(crypto.getRandomValues(new Uint8Array(48)))}`;

async function setUp() {
  const pg = await schemaDB();
  const me = await newUser(pg);
  await asUser(pg, me, `insert into public.note_locks (salt, iterations, key_id, verifier, hint) values ($1, 600000, $2, 'v', 'Blue')`,
    [FIRST.salt, KEY]);
  return { pg, me };
}

/** The settings a password change sends: the new salt, and the old setup carried forward with a proof. */
function changeTo(next: { salt: string; key: string }, from = FIRST, earlier: unknown[] = []) {
  return { salt: next.salt, iterations: 600000, key_id: next.key, verifier: "v2", hint: "Green",
    previous: [...earlier, { salt: from.salt, iterations: 600000, key_id: from.key, proof: sealed(next.key) }] };
}

async function note(pg: PGlite, me: string, body: string, locked?: string) {
  const id = crypto.randomUUID();
  await asUser(pg, me, `insert into public.notes (id, body, locked_body) values ($1, $2, $3)`, [id, body, locked ?? null]);
  return id;
}

/** The app writes through the API with its device and that it knows about locked notes. */
const app = (pg: PGlite, me: string, sql: string, params: unknown[] = []) =>
  asUser(pg, me, sql, params, { "request.headers": JSON.stringify({ "x-pane-device": "Mac", "x-amber-client": "lock-aware/1" }) });
/** A build from before locked notes: through the API, without the header. */
const oldApp = (pg: PGlite, me: string, sql: string, params: unknown[] = []) =>
  asUser(pg, me, sql, params, { "request.headers": JSON.stringify({ "x-pane-device": "iPhone" }) });

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
  assert(kept.rows[0].locked_body.startsWith(`amb2.${KEY}.`));
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

Deno.test("a note sealed with another password's key is refused; after a change only the new key goes in", async () => {
  const { pg, me } = await setUp();
  await refused(note(pg, me, "Other", sealed(SECOND.key)), "different notes password");
  const id = await note(pg, me, "Diary", sealed());
  await app(pg, me, `select public.change_notes_password($1, $2)`, [JSON.stringify(changeTo(SECOND)), KEY]);
  // A pin on a note still sealed with the old key is fine; sealing with it again isn't.
  await app(pg, me, `update public.notes set is_pinned = true where id = $1`, [id]);
  await refused(app(pg, me, `update public.notes set locked_body = $2 where id = $1`, [id, sealed(KEY)]), "different notes password");
  await app(pg, me, `update public.notes set locked_body = $2 where id = $1`, [id, sealed(SECOND.key)]);
  // The setup can't be deleted, or changed except through change_notes_password.
  await refused(asUser(pg, me, `delete from public.note_locks`), "permission denied");
  await refused(asUser(pg, me, `update public.note_locks set hint = 'x'`), "permission denied");
});

Deno.test("an old build can't write the notes of an account that locks notes", async () => {
  const { pg, me } = await setUp();
  const id = await note(pg, me, "Plan");
  await refused(oldApp(pg, me, `update public.notes set body = 'Plan\n\nleaked' where id = $1`, [id]), "Update Amber Notes");
  await refused(oldApp(pg, me, `insert into public.notes (id, body) values ($1, 'Copy of a locked note')`, [crypto.randomUUID()]), "Update Amber Notes");
  await app(pg, me, `update public.notes set body = 'Plan\n\nfine' where id = $1`, [id]);
  // An account without a notes password is left alone; so is the MCP server (no request headers).
  const other = await newUser(pg);
  await oldApp(pg, other, `insert into public.notes (id, body) values ($1, 'Old build, no locks')`, [crypto.randomUUID()]);
  await tool(pg, me, "append_to_note", { id, text: "- from an AI" });
});

Deno.test("a new setup must carry the old one forward with a proof", async () => {
  const { pg, me } = await setUp();
  const lock = async () => (await pg.query<{ key_id: string; previous: unknown[] }>(`select key_id, previous from public.note_locks where user_id = $1`, [me])).rows[0];
  const bad = [
    [{ ...changeTo(SECOND), key_id: "0000000000000000" }, "SHA-256(salt)"],
    [{ ...changeTo(SECOND), previous: [] }, "proof"],
    [{ ...changeTo(SECOND), previous: [{ salt: FIRST.salt, iterations: 600000, key_id: KEY }] }, "proof"],
    [{ ...changeTo(SECOND), previous: [{ salt: SECOND.salt, iterations: 600000, key_id: SECOND.key, proof: "x" }] }, "keep every earlier one"],
  ] as const;
  for (const [settings, why] of bad) {
    await refused(app(pg, me, `select public.change_notes_password($1, $2)`, [JSON.stringify(settings), KEY]), why);
    assertEquals((await lock()).key_id, KEY);
  }
  // Someone else changed it first.
  await refused(app(pg, me, `select public.change_notes_password($1, $2)`, [JSON.stringify(changeTo(SECOND)), SECOND.key]), "changed on another device");
  await app(pg, me, `select public.change_notes_password($1, $2)`, [JSON.stringify(changeTo(SECOND)), KEY]);
  const after = await lock();
  assertEquals(after.key_id, SECOND.key);
  assertEquals((after.previous as { key_id: string }[]).map((p) => p.key_id), [KEY]);
  // A first setup has no history to smuggle in.
  const other = await newUser(pg);
  await refused(asUser(pg, other, `insert into public.note_locks (salt, iterations, key_id, verifier, previous) values ($1, 600000, $2, 'v', $3)`,
    [FIRST.salt, KEY, JSON.stringify([{ salt: SECOND.salt, iterations: 600000, key_id: SECOND.key, proof: "p" }])]), "no earlier ones");
});

Deno.test("changing the password seals every note again at once and drops versions sealed with the old key", async () => {
  const { pg, me } = await setUp();
  const a = await note(pg, me, "One", sealed());
  const b = await note(pg, me, "Two", sealed());
  const missed = await note(pg, me, "Three", sealed());
  await asUser(pg, me, `update public.notes set locked_body = $2 where id = $1`, [a, sealed()], { "pane.source": "restore" });
  const version = async (id: string) => Number((await pg.query<{ version: number }>(`select version from public.notes where id = $1`, [id])).rows[0].version);
  const lockKey = async () => (await pg.query<{ key_id: string }>(`select key_id from public.note_locks where user_id = $1`, [me])).rows[0].key_id;

  // One note moved on since the app looked: nothing changes at all.
  const stale = [{ id: a, version: (await version(a)) - 1, body: "One", locked_body: sealed(SECOND.key) }];
  await refused(app(pg, me, `select public.change_notes_password($1, $2, $3)`, [JSON.stringify(changeTo(SECOND)), KEY, JSON.stringify(stale)]), "changed on another device");
  assertEquals(await lockKey(), KEY);

  const notes = [a, b].map(async (id, i) => ({ id, version: await version(id), body: ["One", "Two"][i], locked_body: sealed(SECOND.key) }));
  const [{ r }] = await app(pg, me, `select public.change_notes_password($1, $2, $3) as r`,
    [JSON.stringify(changeTo(SECOND)), KEY, JSON.stringify(await Promise.all(notes))]) as { r: { notes: { id: string }[]; stale: string[]; versions_removed: number } }[];
  assertEquals(await lockKey(), SECOND.key);
  assertEquals(r.notes.map((n) => n.id).sort(), [a, b].sort());
  assertEquals(r.stale, [missed]);
  assert(r.versions_removed >= 1);
  const left = await pg.query<{ locked_body: string }>(`select locked_body from public.note_revisions where user_id = $1 and locked_body is not null`, [me]);
  assert(left.rows.every((v) => v.locked_body.split(".")[1] === SECOND.key), "no version sealed with the old key is kept");
});

Deno.test("a note that links a file or a sub-note can't be locked", async () => {
  const { pg, me } = await setUp();
  const file = await note(pg, me, "Scan\n\n![x](pane-file:3f2b2a1c-0000-4000-8000-000000000000)");
  const parent = await note(pg, me, "Trip\n\n[Hotel](pane-note:3f2b2a1c-0000-4000-8000-000000000001)");
  for (const id of [file, parent]) {
    await refused(app(pg, me, `update public.notes set body = 'X', locked_body = $2 where id = $1`, [id, sealed()]), "files or sub-notes");
  }
});

Deno.test("only amb2 boxes (bound to their note) are accepted", async () => {
  const { pg, me } = await setUp();
  await note(pg, me, "New", sealed(KEY, "amb2"));
  for (const format of ["amb1", "amb3"]) await refused(note(pg, me, "Other", sealed(KEY, format)), "check");
});

Deno.test("a locked note's sealed text counts toward the storage quota", async () => {
  const { pg, me } = await setUp();
  const used = async () => Number((await pg.query<{ b: number }>(`select notes_bytes as b from public.pane_usage where user_id = $1`, [me])).rows[0].b);
  const id = await note(pg, me, "Diary\n\n" + "x".repeat(1000));
  const plain = await used();
  const box = sealed(KEY) + "A".repeat(4000);
  await app(pg, me, `update public.notes set body = 'Diary', locked_body = $2 where id = $1`, [id, box]);
  assertEquals(await used(), plain - ("Diary\n\n" + "x".repeat(1000)).length + "Diary".length + box.length);
  // Unlocking gives the sealed bytes back.
  await app(pg, me, `update public.notes set body = 'Diary', locked_body = null where id = $1`, [id]);
  assertEquals(await used(), plain - ("Diary\n\n" + "x".repeat(1000)).length + "Diary".length);
  // Over the account's quota, a big sealed text is refused like a big body.
  await pg.query(`update public.pane_usage set notes_bytes = 100 * 1024 * 1024 - 100 where user_id = $1`, [me]);
  await refused(app(pg, me, `update public.notes set locked_body = $2 where id = $1`, [id, box]), "");
});

Deno.test("the AI guard also holds for an MCP server that only sets pane.source", async () => {
  const { pg, me } = await setUp();
  const id = await note(pg, me, "Bank", sealed());
  const old = { "pane.source": "mcp", "pane.client": "Claude" };
  await refused(asUser(pg, me, `update public.notes set body = 'PIN 4821' where id = $1`, [id], old), "This note is locked");
  const open = await note(pg, me, "Open");
  await refused(asUser(pg, me, `update public.notes set body = 'Open', locked_body = $2 where id = $1`, [open, sealed()], old), "This note is locked");
});

Deno.test("a password change naming another account's note changes nothing at all", async () => {
  const { pg, me } = await setUp();
  const mine = await note(pg, me, "Mine", sealed());
  const other = await newUser(pg);
  await asUser(pg, other, `insert into public.note_locks (salt, iterations, key_id, verifier) values ($1, 600000, $2, 'v')`, [FIRST.salt, KEY]);
  const theirs = await note(pg, other, "Theirs", sealed());
  const version = async (id: string) => Number((await pg.query<{ version: number }>(`select version from public.notes where id = $1`, [id])).rows[0].version);
  const notes = [
    { id: mine, version: await version(mine), body: "Mine", locked_body: sealed(SECOND.key) },
    { id: theirs, version: await version(theirs), body: "Hijacked", locked_body: sealed(SECOND.key) },
  ];
  await refused(app(pg, me, `select public.change_notes_password($1, $2, $3)`, [JSON.stringify(changeTo(SECOND)), KEY, JSON.stringify(notes)]), "changed on another device");
  const rows = await pg.query<{ id: string; body: string; key: string }>(`select id, body, split_part(locked_body, '.', 2) as key from public.notes where id in ($1, $2)`, [mine, theirs]);
  assert(rows.rows.every((r) => r.key === KEY), "neither note changed");
  assertEquals((await pg.query<{ key_id: string }>(`select key_id from public.note_locks where user_id = $1`, [me])).rows[0].key_id, KEY);
});

Deno.test("request headers that aren't valid JSON count as an old build", async () => {
  const { pg, me } = await setUp();
  const id = await note(pg, me, "Plan");
  await refused(asUser(pg, me, `update public.notes set body = 'Plan, edited' where id = $1`, [id], { "request.headers": "{not json" }), "Update Amber Notes");
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
  const mcp = { "pane.source": "mcp", "pane.agent": "mcp", "pane.client": "Claude" };
  await refused(asUser(pg, me, `update public.notes set body = 'Changed' where id = $1`, [id], mcp), "This note is locked");
  // A tool that sets pane.source (a restore does) is still the AI.
  await refused(asUser(pg, me, `update public.notes set body = 'Changed' where id = $1`, [id], { ...mcp, "pane.source": "restore" }), "This note is locked");
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

// sec-review's probes (P2-P4), as regression tests.

Deno.test("P2: a password change drops versions sealed with the old key", async () => {
  const { pg, me } = await setUp();
  const id = await note(pg, me, "Diary", sealed());
  await app(pg, me, `update public.notes set locked_body = $2 where id = $1`, [id, sealed()]); // a version under KEY
  const [{ version }] = await asUser<{ version: number }>(pg, me, `select version from public.notes where id = $1`, [id]);
  await app(pg, me, `select public.change_notes_password($1, $2, $3)`,
    [JSON.stringify(changeTo(SECOND)), KEY, JSON.stringify([{ id, version, body: "Diary", locked_body: sealed(SECOND.key) }])]);
  const old = await pg.query(`select 1 from public.note_revisions where note_id = $1 and split_part(locked_body, '.', 2) = $2`, [id, KEY]);
  assertEquals(old.rows.length, 0);
});

Deno.test("P3: note_locks can't drop the salt that sealed existing notes", async () => {
  const { pg, me } = await setUp();
  await note(pg, me, "Diary", sealed());
  const planted = await newSalt();
  await refused(asUser(pg, me, `update public.note_locks set salt = $1, key_id = $2, verifier = 'x', previous = '[]'`, [planted.salt, planted.key]), "");
  await refused(asUser(pg, me, `update public.note_locks set salt = $1`, [planted.salt]), "");
  // Not through the password change either: the old setup must be carried forward.
  await refused(app(pg, me, `select public.change_notes_password($1, $2)`, [JSON.stringify({ ...changeTo(planted), previous: [] }), KEY]), "proof");
  const [{ key_id }] = await asUser<{ key_id: string }>(pg, me, `select key_id from public.note_locks`);
  assertEquals(key_id, KEY);
});

Deno.test("P4: the MCP can't lift the lock guard by switching pane.source", async () => {
  const { pg, me } = await setUp();
  const id = await note(pg, me, "Bank", sealed());
  await refused(asUser(pg, me,
    `with s as materialized (select set_config('pane.source', 'restore', true) v) update public.notes set body = 'PIN 4821' where id = $1 and exists (select 1 from s)`,
    [id], { "pane.source": "mcp", "pane.agent": "mcp" }), "locked");
});
