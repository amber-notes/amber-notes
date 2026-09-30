// Locked notes (20260930150000_locked_notes.sql, as 20261001090000_e2ee.sql leaves them) on the whole
// schema in an in-process Postgres (PGlite), with the MCP tools running against it unchanged. Every
// note is sealed with the account's key; a locked note's text is sealed again with the notes
// password, and its head holds only its title. Needs no Docker or local stack:
//   cd supabase/functions/mcp && deno test -A locked.pglite.test.ts
// locked.e2e.test.ts runs the MCP checks against the real local stack.
import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { toBase64 } from "../_shared/e2ee.ts";
import { previewOf, titleOf } from "./notes.ts";
import { asUser, schemaDB } from "./pglite.ts";
import { type Account, account, app, edit, note, opened, share, toolContext } from "./sealed.ts";
import { runTool, ToolError } from "./tools.ts";

/** A salt and its key id, as the app makes them (16 random bytes; SHA-256 of them, 16 hex digits). */
async function newSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return { salt: toBase64(bytes), key: [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("") };
}
const FIRST = await newSalt();
const SECOND = await newSalt();
const KEY = FIRST.key;
/** A locked note's text as the app stores it: the password's key id and an AES-GCM box. The server never opens it. */
const sealed = (key = KEY, format = "amb2") => `${format}.${key}.${toBase64(crypto.getRandomValues(new Uint8Array(48)))}`;

async function setUp() {
  const pg = await schemaDB();
  const a = await account(pg);
  await app(pg, a.id, `insert into public.note_locks (salt, iterations, key_id, verifier, hint) values ($1, 600000, $2, 'v', 'Blue')`, [FIRST.salt, KEY]);
  return { pg, a, me: a.id };
}

/** The settings a password change sends: the new salt, and the old setup carried forward with a proof. */
function changeTo(next: { salt: string; key: string }, from = FIRST, earlier: unknown[] = []) {
  return { salt: next.salt, iterations: 600000, key_id: next.key, verifier: "v2", hint: "Green",
    previous: [...earlier, { salt: from.salt, iterations: 600000, key_id: from.key, proof: sealed(next.key) }] };
}

/** A locked note as the app writes it: the head is the title only, no body box. */
async function locked(pg: PGlite, a: Account, title: string, box = sealed(), extra: { parent?: string } = {}) {
  const id = crypto.randomUUID();
  await app(pg, a.id, `insert into public.notes (id, head_ct, locked_body, parent_id) values ($1, $2, $3, $4)`,
    [id, await a.vault.sealHead(id, { title }), box, extra.parent ?? null]);
  return id;
}

/** Locking a note in the app: the title-only head and the password's box replace the text. */
async function lock(pg: PGlite, a: Account, id: string, title: string, box = sealed(), settings?: Record<string, string>) {
  const sql = `update public.notes set body_ct = null, head_ct = $2, locked_body = $3 where id = $1`;
  const params = [id, await a.vault.sealHead(id, { title }), box];
  return settings ? await asUser(pg, a.id, sql, params, settings) : await app(pg, a.id, sql, params);
}

/** A build from before locked notes: through the API, without the header. */
const oldApp = (pg: PGlite, me: string, sql: string, params: unknown[] = []) =>
  asUser(pg, me, sql, params, { "request.headers": JSON.stringify({ "x-pane-device": "iPhone" }) });

// deno-lint-ignore no-explicit-any
const tool = async (pg: PGlite, a: Account, name: string, args: Record<string, unknown> = {}) => await runTool(name, args, await toolContext(pg, a)) as any;

async function refused(p: Promise<unknown>, text: string) {
  const e = await assertRejects(() => p);
  assertStringIncludes((e as Error).message, text);
}

const version = async (pg: PGlite, id: string) => Number((await pg.query<{ version: number }>(`select version from public.notes where id = $1`, [id])).rows[0].version);

Deno.test("locking deletes every earlier version, and later versions keep only ciphertext and the title", async () => {
  const { pg, a } = await setUp();
  const id = await note(pg, a, "Bank\n\nPIN 1234");
  await edit(pg, a, id, "Bank\n\nPIN 1234\nPUK 5678", { "pane.source": "mcp", "pane.client": "Claude" });
  await edit(pg, a, id, "Bank\n\nPIN 4321");
  assertEquals((await pg.query<{ n: number }>(`select count(*)::int as n from public.note_revisions where note_id = $1`, [id])).rows[0].n, 2);

  await lock(pg, a, id, "Bank");
  assertEquals((await pg.query(`select * from public.note_revisions where note_id = $1`, [id])).rows.length, 0, "no version the AI could open may stay behind");

  // An edit while locked keeps the old box and the title-only head, never a body box.
  await lock(pg, a, id, "Bank", sealed(), { "pane.source": "restore" });
  const kept = (await pg.query<{ body_ct: string | null; head_ct: string; locked_body: string }>(`select body_ct, head_ct, locked_body from public.note_revisions where note_id = $1`, [id])).rows;
  assertEquals(kept.length, 1);
  assertEquals(kept[0].body_ct, null);
  assertEquals(await a.vault.openHead(id, kept[0].head_ct), { title: "Bank" });
  assert(kept[0].locked_body.startsWith(`amb2.${KEY}.`));
});

Deno.test("a locked note has no body box, and its head opens to its title only", async () => {
  const { pg, a } = await setUp();
  const id = crypto.randomUUID();
  await refused(app(pg, a.id, `insert into public.notes (id, head_ct, body_ct, locked_body) values ($1, $2, $3, $4)`,
    [id, await a.vault.sealHead(id, { title: "Bank" }), await a.vault.sealBody(id, "Bank\n\nPIN 1234"), sealed()]), "notes_sealed");
  const ok = await locked(pg, a, "Bank");
  assertEquals((await opened(pg, a, ok)).head, { title: "Bank" });
});

Deno.test("a note sealed with another password's key is refused; after a change only the new key goes in", async () => {
  const { pg, a, me } = await setUp();
  await refused(locked(pg, a, "Other", sealed(SECOND.key)), "different notes password");
  const id = await locked(pg, a, "Diary");
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
  const { pg, a, me } = await setUp();
  const id = await note(pg, a, "Plan");
  await refused(oldApp(pg, me, `update public.notes set body_ct = $2 where id = $1`, [id, await a.vault.sealBody(id, "Plan\n\nleaked")]), "Update Amber Notes");
  const other = crypto.randomUUID();
  await refused(oldApp(pg, me, `insert into public.notes (id, head_ct, body_ct) values ($1, $2, $3)`,
    [other, await a.vault.sealHead(other, { title: "Copy" }), await a.vault.sealBody(other, "Copy")]), "Update Amber Notes");
  await edit(pg, a, id, "Plan\n\nfine");
  // An account without a notes password is left alone; so is the MCP server (no request headers).
  const b = await account(pg);
  const theirs = crypto.randomUUID();
  await oldApp(pg, b.id, `insert into public.notes (id, head_ct, body_ct) values ($1, $2, $3)`,
    [theirs, await b.vault.sealHead(theirs, { title: "Old build" }), await b.vault.sealBody(theirs, "Old build, no locks")]);
  await tool(pg, a, "append_to_note", { id, text: "- from an AI" });
});

Deno.test("a new setup must carry the old one forward with a proof", async () => {
  const { pg, me } = await setUp();
  const lockRow = async () => (await pg.query<{ key_id: string; previous: unknown[] }>(`select key_id, previous from public.note_locks where user_id = $1`, [me])).rows[0];
  const bad = [
    [{ ...changeTo(SECOND), key_id: "0000000000000000" }, "SHA-256(salt)"],
    [{ ...changeTo(SECOND), previous: [] }, "proof"],
    [{ ...changeTo(SECOND), previous: [{ salt: FIRST.salt, iterations: 600000, key_id: KEY }] }, "proof"],
    [{ ...changeTo(SECOND), previous: [{ salt: SECOND.salt, iterations: 600000, key_id: SECOND.key, proof: "x" }] }, "keep every earlier one"],
  ] as const;
  for (const [settings, why] of bad) {
    await refused(app(pg, me, `select public.change_notes_password($1, $2)`, [JSON.stringify(settings), KEY]), why);
    assertEquals((await lockRow()).key_id, KEY);
  }
  // Someone else changed it first.
  await refused(app(pg, me, `select public.change_notes_password($1, $2)`, [JSON.stringify(changeTo(SECOND)), SECOND.key]), "changed on another device");
  await app(pg, me, `select public.change_notes_password($1, $2)`, [JSON.stringify(changeTo(SECOND)), KEY]);
  const after = await lockRow();
  assertEquals(after.key_id, SECOND.key);
  assertEquals((after.previous as { key_id: string }[]).map((p) => p.key_id), [KEY]);
  // A first setup has no history to smuggle in.
  const other = await account(pg);
  await refused(asUser(pg, other.id, `insert into public.note_locks (salt, iterations, key_id, verifier, previous) values ($1, 600000, $2, 'v', $3)`,
    [FIRST.salt, KEY, JSON.stringify([{ salt: SECOND.salt, iterations: 600000, key_id: SECOND.key, proof: "p" }])]), "no earlier ones");
});

Deno.test("changing the password seals every note again at once and drops versions sealed with the old key", async () => {
  const { pg, a, me } = await setUp();
  const one = await locked(pg, a, "One");
  const two = await locked(pg, a, "Two");
  const missed = await locked(pg, a, "Three");
  await asUser(pg, me, `update public.notes set locked_body = $2 where id = $1`, [one, sealed()], { "pane.source": "restore" });
  const lockKey = async () => (await pg.query<{ key_id: string }>(`select key_id from public.note_locks where user_id = $1`, [me])).rows[0].key_id;

  // One note moved on since the app looked: nothing changes at all.
  const stale = [{ id: one, version: (await version(pg, one)) - 1, locked_body: sealed(SECOND.key) }];
  await refused(app(pg, me, `select public.change_notes_password($1, $2, $3)`, [JSON.stringify(changeTo(SECOND)), KEY, JSON.stringify(stale)]), "changed on another device");
  assertEquals(await lockKey(), KEY);

  const notes = await Promise.all([one, two].map(async (id) => ({ id, version: await version(pg, id), locked_body: sealed(SECOND.key) })));
  const [{ r }] = await app(pg, me, `select public.change_notes_password($1, $2, $3) as r`, [JSON.stringify(changeTo(SECOND)), KEY, JSON.stringify(notes)]) as
    { r: { notes: { id: string }[]; stale: string[]; versions_removed: number } }[];
  assertEquals(await lockKey(), SECOND.key);
  assertEquals(r.notes.map((n) => n.id).sort(), [one, two].sort());
  assertEquals(r.stale, [missed]);
  assert(r.versions_removed >= 1);
  const left = await pg.query<{ locked_body: string }>(`select locked_body from public.note_revisions where user_id = $1 and locked_body is not null`, [me]);
  assert(left.rows.every((v) => v.locked_body.split(".")[1] === SECOND.key), "no version sealed with the old key is kept");
});

Deno.test("only amb2 boxes are accepted as a locked note's text", async () => {
  const { pg, a } = await setUp();
  await locked(pg, a, "New", sealed(KEY, "amb2"));
  for (const format of ["amb1", "amb3"]) await refused(locked(pg, a, "Other", sealed(KEY, format)), "check");
});

Deno.test("a locked note's sealed text counts toward the storage quota", async () => {
  const { pg, a, me } = await setUp();
  const used = async () => Number((await pg.query<{ b: number }>(`select notes_bytes as b from public.pane_usage where user_id = $1`, [me])).rows[0].b);
  const size = async (id: string) => Number((await pg.query<{ s: number }>(`select public.pane_note_size(body_ct, head_ct, locked_body) as s from public.notes where id = $1`, [id])).rows[0].s);
  const id = await note(pg, a, "Diary\n\n" + "x".repeat(1000));
  const open = await size(id);
  const before = await used();
  const box = sealed(KEY) + "A".repeat(4000);
  await lock(pg, a, id, "Diary", box);
  const lockedSize = await size(id);
  assert(lockedSize >= box.length);
  assertEquals(await used(), before - open + lockedSize);
  // Over the account's quota, a big sealed text is refused like a big body.
  await pg.query(`update public.pane_usage set notes_bytes = 100 * 1024 * 1024 - 100 where user_id = $1`, [me]);
  await refused(app(pg, me, `update public.notes set locked_body = $2 where id = $1`, [id, box + "A".repeat(4000)]), "");
});

Deno.test("the AI guard also holds for an MCP server that only sets pane.source", async () => {
  const { pg, a, me } = await setUp();
  const id = await locked(pg, a, "Bank");
  const old = { "pane.source": "mcp", "pane.client": "Claude" };
  await refused(asUser(pg, me, `update public.notes set head_ct = $2 where id = $1`, [id, await a.vault.sealHead(id, { title: "PIN 4821" })], old), "This note is locked");
  const open = await note(pg, a, "Open");
  await refused(lock(pg, a, open, "Open", sealed(), old), "This note is locked");
});

Deno.test("a password change naming another account's note changes nothing at all", async () => {
  const { pg, a, me } = await setUp();
  const mine = await locked(pg, a, "Mine");
  const b = await account(pg);
  await app(pg, b.id, `insert into public.note_locks (salt, iterations, key_id, verifier) values ($1, 600000, $2, 'v')`, [FIRST.salt, KEY]);
  const theirs = await locked(pg, b, "Theirs");
  const notes = [
    { id: mine, version: await version(pg, mine), locked_body: sealed(SECOND.key) },
    { id: theirs, version: await version(pg, theirs), locked_body: sealed(SECOND.key) },
  ];
  await refused(app(pg, me, `select public.change_notes_password($1, $2, $3)`, [JSON.stringify(changeTo(SECOND)), KEY, JSON.stringify(notes)]), "changed on another device");
  const rows = await pg.query<{ key: string }>(`select split_part(locked_body, '.', 2) as key from public.notes where id in ($1, $2)`, [mine, theirs]);
  assert(rows.rows.every((r) => r.key === KEY), "neither note changed");
  assertEquals((await pg.query<{ key_id: string }>(`select key_id from public.note_locks where user_id = $1`, [me])).rows[0].key_id, KEY);
});

Deno.test("request headers that aren't valid JSON count as an old build", async () => {
  const { pg, a } = await setUp();
  const id = await note(pg, a, "Plan");
  await refused(edit(pg, a, id, "Plan, edited", { "request.headers": "{not json" }), "Update Amber Notes");
});

Deno.test("locking a shared note stops its link, and a locked note can't be shared", async () => {
  const { pg, a, me } = await setUp();
  const id = await note(pg, a, "Plans\n\nSecret");
  const r = await share(pg, a, id, { title: "Plans", body: "Plans\n\nSecret" });
  assert((await pg.query<{ p: unknown }>(`select public.shared_note($1) as p`, [r.slug])).rows[0].p);
  await lock(pg, a, id, "Plans");
  assertEquals((await pg.query<{ p: unknown }>(`select public.shared_note($1) as p`, [r.slug])).rows[0].p, null);
  assertEquals((await pg.query(`select 1 from public.note_shares where note_id = $1 and revoked_at is null`, [id])).rows.length, 0);
  await refused(share(pg, a, id, { title: "Plans", body: "Plans" }), "can't be shared");
});

Deno.test("a locked sub-note doesn't show through its parent's link", async () => {
  const { pg, a, me } = await setUp();
  const parent = await note(pg, a, "Trip");
  const child = await locked(pg, a, "Passport numbers", sealed(), { parent });
  await edit(pg, a, parent, `Trip\n\n[Passport numbers](pane-note:${child})`);
  // Even a device that publishes the locked note as a page gets it left out.
  const r = await share(pg, a, parent, { title: "Trip", body: "Trip", pages: [{ id: child, parent_id: parent, title: "Passport numbers", body: "P123" }] }, true);
  const page = (await pg.query<{ p: { subnotes: unknown[] } }>(`select public.shared_note($1) as p`, [r.slug])).rows[0].p;
  assertEquals(page.subnotes, []);
  assertEquals((await pg.query<{ p: unknown }>(`select public.shared_note($1, $2) as p`, [r.slug, child])).rows[0].p, null);
});

Deno.test("restoring a version saved while locked brings the ciphertext back", async () => {
  const { pg, a, me } = await setUp();
  const id = await locked(pg, a, "Diary");
  const first = (await pg.query<{ locked_body: string }>(`select locked_body from public.notes where id = $1`, [id])).rows[0].locked_body;
  await asUser(pg, me, `update public.notes set locked_body = $2 where id = $1`, [id, sealed()], { "pane.source": "restore" });
  const [rev] = (await pg.query<{ version: number }>(`select version from public.note_revisions where note_id = $1`, [id])).rows;
  const [back] = await asUser<{ head_ct: string; locked_body: string }>(pg, me, `select head_ct, locked_body from public.restore_note_version($1, $2)`, [id, rev.version]);
  assertEquals(back.locked_body, first);
  assertEquals(await a.vault.openHead(id, back.head_ct), { title: "Diary" });
});

Deno.test("MCP: search skips locked notes; the list shows them as locked, title only", async () => {
  const { pg, a } = await setUp();
  await note(pg, a, "Groceries\n\nOat milk and saffron");
  const lockedId = await locked(pg, a, "Saffron recipe");
  for (const [name, key] of [["search_notes", "results"], ["search", "results"]] as const) {
    const r = await tool(pg, a, name, { query: "saffron" });
    assertEquals(r[key].length, 1, `${name} finds only the open note`);
    assert(r[key].every((x: { id: string }) => x.id !== lockedId));
  }
  const list = await tool(pg, a, "list_notes");
  const row = list.notes.find((n: { id: string }) => n.id === lockedId);
  assertEquals(row.title, "Saffron recipe");
  assertEquals(row.locked, true);
  assertEquals(row.preview, undefined);
  const overview = await tool(pg, a, "get_overview");
  assert(overview.recently_edited.some((n: { id: string; locked?: boolean }) => n.id === lockedId && n.locked));
});

Deno.test("MCP: reading a locked note says it's locked; by id or by title", async () => {
  const { pg, a } = await setUp();
  const id = await locked(pg, a, "Passwords");
  for (const [name, args] of [["read_note", { id }], ["read_note", { title: "Passwords" }], ["fetch", { id }], ["note_history", { id }], ["read_table", { id }]] as const) {
    const e = await assertRejects(() => tool(pg, a, name, args), ToolError);
    assertStringIncludes(e.message, "This note is locked", name);
  }
});

Deno.test("MCP: every change to a locked note is refused and nothing changes", async () => {
  const { pg, a } = await setUp();
  const id = await locked(pg, a, "Passwords");
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
    ["restore_revision", { id, revision_id: 1 }],
  ];
  for (const [name, args] of attempts) {
    const e = await assertRejects(() => tool(pg, a, name, args), ToolError);
    assertStringIncludes(e.message, "This note is locked", name);
  }
  assertEquals((await pg.query(`select * from public.notes where id = $1`, [id])).rows[0], before);
});

Deno.test("MCP: even a raw write as an AI can't change or lock a note", async () => {
  const { pg, a, me } = await setUp();
  const id = await locked(pg, a, "Passwords");
  const open = await note(pg, a, "Open note");
  const mcp = { "pane.source": "mcp", "pane.agent": "mcp", "pane.client": "Claude" };
  const head = await a.vault.sealHead(id, { title: "Changed" });
  await refused(asUser(pg, me, `update public.notes set head_ct = $2 where id = $1`, [id, head], mcp), "This note is locked");
  // A tool that sets pane.source (a restore does) is still the AI.
  await refused(asUser(pg, me, `update public.notes set head_ct = $2 where id = $1`, [id, head], { ...mcp, "pane.source": "restore" }), "This note is locked");
  await refused(asUser(pg, me, `update public.notes set locked_body = null, body_ct = $2 where id = $1`, [id, await a.vault.sealBody(id, "x")], mcp), "This note is locked");
  await refused(lock(pg, a, open, "Open note", sealed(), mcp), "This note is locked");
});

Deno.test("MCP: history of a note that was locked shows those versions as locked, and won't restore them", async () => {
  const { pg, a, me } = await setUp();
  const id = await locked(pg, a, "Diary");
  // Unlocked in the app: the locked text becomes a version.
  const body = "Diary\n\nDear diary";
  await app(pg, me, `update public.notes set body_ct = $2, head_ct = $3, locked_body = null where id = $1`,
    [id, await a.vault.sealBody(id, body), await a.vault.sealHead(id, { title: titleOf(body), preview: previewOf(body) })]);
  const h = await tool(pg, a, "note_history", { id });
  assertEquals(h.revisions.length, 1);
  assertEquals(h.revisions[0].locked, true);
  assertEquals(h.revisions[0].title, "Diary");
  assertEquals(h.revisions[0].preview, undefined);
  const e = await assertRejects(() => tool(pg, a, "restore_revision", { id, revision_id: h.revisions[0].revision_id }), ToolError);
  assertStringIncludes(e.message, "saved while the note was locked");
});

// sec-review's probes (P2-P4), as regression tests.

Deno.test("P2: a password change drops versions sealed with the old key", async () => {
  const { pg, a, me } = await setUp();
  const id = await locked(pg, a, "Diary");
  await app(pg, me, `update public.notes set locked_body = $2 where id = $1`, [id, sealed()]); // a version under KEY
  await app(pg, me, `select public.change_notes_password($1, $2, $3)`,
    [JSON.stringify(changeTo(SECOND)), KEY, JSON.stringify([{ id, version: await version(pg, id), locked_body: sealed(SECOND.key) }])]);
  const old = await pg.query(`select 1 from public.note_revisions where note_id = $1 and split_part(locked_body, '.', 2) = $2`, [id, KEY]);
  assertEquals(old.rows.length, 0);
});

Deno.test("P3: note_locks can't drop the salt that sealed existing notes", async () => {
  const { pg, a, me } = await setUp();
  await locked(pg, a, "Diary");
  const planted = await newSalt();
  await refused(asUser(pg, me, `update public.note_locks set salt = $1, key_id = $2, verifier = 'x', previous = '[]'`, [planted.salt, planted.key]), "");
  await refused(asUser(pg, me, `update public.note_locks set salt = $1`, [planted.salt]), "");
  // Not through the password change either: the old setup must be carried forward.
  await refused(app(pg, me, `select public.change_notes_password($1, $2)`, [JSON.stringify({ ...changeTo(planted), previous: [] }), KEY]), "proof");
  const [{ key_id }] = await asUser<{ key_id: string }>(pg, me, `select key_id from public.note_locks`);
  assertEquals(key_id, KEY);
});

Deno.test("P4: the MCP can't lift the lock guard by switching pane.source", async () => {
  const { pg, a, me } = await setUp();
  const id = await locked(pg, a, "Bank");
  await refused(asUser(pg, me,
    `with s as materialized (select set_config('pane.source', 'restore', true) v) update public.notes set head_ct = $2 where id = $1 and exists (select 1 from s)`,
    [id, await a.vault.sealHead(id, { title: "PIN 4821" })], { "pane.source": "mcp", "pane.agent": "mcp" }), "locked");
});
