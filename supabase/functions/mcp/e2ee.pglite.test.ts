// End-to-end encryption (20261001090000_e2ee.sql) on the whole schema in an in-process Postgres
// (PGlite): the account key, the guards that keep anything readable or stale out, versions of
// ciphertext, and shared-page copies. Needs no Docker or local stack:
//   cd supabase/functions/mcp && deno test -A e2ee.pglite.test.ts
import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { asUser, newUser, schemaDB } from "./pglite.ts";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
/** A box as the app makes it. The server never opens one, so any bytes do. */
const box = (key: string) => `amb2.${key}.${b64(crypto.getRandomValues(new Uint8Array(48)))}`;

async function refused(p: Promise<unknown>, text: string) {
  const e = await assertRejects(() => p);
  assertStringIncludes((e as Error).message, text);
}

const app = (pg: PGlite, me: string, sql: string, params: unknown[] = []) =>
  asUser<any>(pg, me, sql, params, { "request.headers": JSON.stringify({ "x-pane-device": "Mac", "x-amber-client": "lock-aware/1 e2ee/1" }) });

async function withKey(pg: PGlite, me: string, key = hex(8), generation = 0) {
  const [row] = await app(pg, me, `select * from public.create_account_key($1, $2, $3, $4)`, [key, hex(32), box(key), generation]);
  return { key, row };
}

async function note(pg: PGlite, me: string, key: string, extra: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  await app(pg, me, `insert into public.notes (id, head_ct, body_ct, parent_id) values ($1, $2, $3, $4)`,
    [id, box(key), box(key), extra.parent_id ?? null]);
  return id;
}

Deno.test("a key is made once: the second device racing gets the first one's", async () => {
  const pg = await schemaDB();
  const me = await newUser(pg);
  const a = await withKey(pg, me);
  const b = await withKey(pg, me);
  assertEquals(a.row.created, true);
  assertEquals(b.row.created, false);
  assertEquals(b.row.key_id, a.key);
  // Nobody writes the row directly, and its key can't change.
  await refused(app(pg, me, `insert into public.account_keys (user_id, key_id, verifier, recovery_wrap) values ($1, $2, $3, $4)`,
    [me, a.key, hex(32), box(a.key)]), "permission denied");
  await refused(app(pg, me, `update public.account_keys set key_id = $1`, [hex(8)]), "permission denied");
  await refused(pg.query(`update public.account_keys set key_id = $1`, [hex(8)]), "can't be replaced");
  // The recovery wrap must hold this key.
  const other = await newUser(pg);
  await refused(app(pg, other, `select * from public.create_account_key($1, $2, $3, 0)`, [a.key, hex(32), box(hex(8))]), "account_keys_wrap_names_key");
  // Another account can't read it.
  assertEquals((await app(pg, other, `select * from public.account_keys`)).length, 0);
  assertEquals((await app(pg, me, `select recovery_saved_at from public.account_keys`))[0].recovery_saved_at, null);
  await app(pg, me, `select public.mark_recovery_key_saved()`);
  assert((await app(pg, me, `select recovery_saved_at from public.account_keys`))[0].recovery_saved_at);
});

Deno.test("nothing is written before the key exists, nor with another key, nor readable", async () => {
  const pg = await schemaDB();
  const me = await newUser(pg);
  const stray = hex(8);
  await refused(note(pg, me, stray), "Set up encryption");
  const { key } = await withKey(pg, me);
  await refused(note(pg, me, stray), "old key");
  const id = await note(pg, me, key);
  // The readable columns are gone.
  await refused(app(pg, me, `update public.notes set body = 'hello' where id = $1`, [id]), "body");
  await refused(app(pg, me, `insert into public.folders (id, name) values ($1, 'Travel')`, [crypto.randomUUID()]), "name");
  await refused(app(pg, me, `update public.notes set head_ct = 'plain text' where id = $1`, [id]), "old key");
  await refused(app(pg, me, `update public.notes set head_ct = $2 where id = $1`, [id, `amb2.${key}.plain text`]), "notes_sealed");
  await refused(app(pg, me, `update public.notes set body_ct = null where id = $1`, [id]), "notes_sealed");
  // Folders and files are sealed with the key too, and a file's path is only whose and which.
  await refused(app(pg, me, `insert into public.folders (id, name_ct) values ($1, $2)`, [crypto.randomUUID(), box(stray)]), "old key");
  await app(pg, me, `insert into public.folders (id, name_ct) values ($1, $2)`, [crypto.randomUUID(), box(key)]);
  const file = crypto.randomUUID();
  await refused(app(pg, me, `insert into public.attachments (id, meta_ct, size, storage_path) values ($1, $2, 10, $3)`,
    [file, box(key), `${me}/${file}/ticket.pdf`]), "attachments_opaque_path");
  await app(pg, me, `insert into public.attachments (id, meta_ct, size, storage_path) values ($1, $2, 10, $3)`, [file, box(key), `${me}/${file}`]);
});

Deno.test("versions keep the ciphertext the note had, and restoring copies it back", async () => {
  const pg = await schemaDB();
  const me = await newUser(pg);
  const { key } = await withKey(pg, me);
  const id = await note(pg, me, key);
  const [before] = await app(pg, me, `select body_ct, head_ct, version from public.notes where id = $1`, [id]);
  await asUser(pg, me, `update public.notes set body_ct = $2, head_ct = $3 where id = $1`, [id, box(key), box(key)],
    { "pane.source": "mcp", "pane.client": "Claude" });
  const revs = await app(pg, me, `select body_ct, head_ct, version from public.note_revisions where note_id = $1`, [id]);
  assertEquals(revs.length, 1);
  assertEquals(revs[0].body_ct, before.body_ct);
  assertEquals(revs[0].head_ct, before.head_ct);
  // Unchanged boxes aren't a change: pinning adds no version.
  await asUser(pg, me, `update public.notes set is_pinned = true where id = $1`, [id], { "pane.source": "mcp" });
  assertEquals((await app(pg, me, `select 1 from public.note_revisions where note_id = $1`, [id])).length, 1);
  await app(pg, me, `select * from public.restore_note_version($1, $2)`, [id, Number(before.version)]);
  const [now] = await app(pg, me, `select body_ct, head_ct from public.notes where id = $1`, [id]);
  assertEquals(now.body_ct, before.body_ct);
});

Deno.test("an AI connection's wraps go when it's revoked", async () => {
  const pg = await schemaDB();
  const me = await newUser(pg);
  await refused(app(pg, me, `select public.create_mcp_token('Claude Code', true, $1, $2)`, [hex(32), box(hex(8))]), "Set up encryption");
  const { key } = await withKey(pg, me);
  await refused(app(pg, me, `select public.create_mcp_token('Claude Code', true, $1, $2)`, [hex(32), box(hex(8))]), "Invalid token");
  const [{ create_mcp_token: id }] = await app(pg, me, `select public.create_mcp_token('Claude Code', true, $1, $2)`, [hex(32), box(key)]);
  await pg.query(`insert into public.oauth_tokens (token_hash, grant_id, kind, resource, expires_at, dk_wrap) values ($1, $2, 'access', 'x', now() + interval '1 hour', $3)`,
    [hex(32), id, box(key)]);
  await app(pg, me, `update public.mcp_tokens set revoked_at = now() where id = $1`, [id]);
  const [t] = (await pg.query<any>(`select dk_wrap from public.mcp_tokens where id = $1`, [id])).rows;
  assertEquals(t.dk_wrap, null);
  assertEquals((await pg.query(`select 1 from public.oauth_tokens where grant_id = $1`, [id])).rows.length, 0);
});

Deno.test("start fresh deletes the notes, connections and key; a second device's attempt is a no-op", async () => {
  const pg = await schemaDB();
  const me = await newUser(pg);
  const { key } = await withKey(pg, me);
  await note(pg, me, key);
  await app(pg, me, `select public.create_mcp_token('Codex', false, $1, $2)`, [hex(32), box(key)]);
  // Only right after signing in: a refreshed old session can't wipe the account.
  const signedIn = (secondsAgo: number) => ({ "request.jwt.claims": JSON.stringify({ sub: me, role: "authenticated", amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) - secondsAgo }] }) });
  const startFresh = (keyId: string, secondsAgo = 30) => asUser<any>(pg, me, `select public.start_fresh($1) as done`, [keyId], signedIn(secondsAgo));
  await refused(app(pg, me, `select public.start_fresh($1) as done`, [key]), "Sign in again");
  await refused(startFresh(key, 3600), "Sign in again");
  assertEquals((await startFresh(hex(8)))[0].done, false);
  assertEquals((await app(pg, me, `select count(*)::int n from public.notes`))[0].n, 1);
  assertEquals((await startFresh(key))[0].done, true);
  // Every device is told, and the reset is counted: only now may a device holding a key make a new one.
  assertEquals((await app(pg, me, `select kind from public.account_notices`))[0].kind, "started_fresh");
  assertEquals((await app(pg, me, `select generation from public.account_key_resets`))[0].generation, 1);
  assertEquals((await app(pg, me, `select count(*)::int n from public.notes`))[0].n, 0);
  assertEquals((await app(pg, me, `select count(*)::int n from public.mcp_tokens`))[0].n, 0);
  assertEquals((await app(pg, me, `select count(*)::int n from public.account_keys`))[0].n, 0);
  // A new key can then be made, and the old one's boxes are refused.
  // A key made before the reset (generation 0) can't come back; the device reads the generation
  // with the key, in one call, and makes its key for it.
  await refused(withKey(pg, me), "reset on another device");
  const [state] = await app(pg, me, `select public.account_key_state() as s`);
  assertEquals([state.s.key, state.s.generation], [null, 1]);
  const fresh = await withKey(pg, me, hex(8), 1);
  assertEquals(fresh.row.created, true);
  await refused(note(pg, me, key), "old key");
});

async function shared(pg: PGlite, me: string, key: string) {
  const root = await note(pg, me, key);
  const sub = await note(pg, me, key, { parent_id: root });
  const subsub = await note(pg, me, key, { parent_id: sub });
  const file = crypto.randomUUID();
  await app(pg, me, `insert into public.attachments (id, meta_ct, size, storage_path) values ($1, $2, 10, $3)`, [file, box(key), `${me}/${file}`]);
  const copy = {
    title: "Lisbon", body: `# Lisbon\n[Day 1](pane-note:${sub})`,
    pages: [
      { id: sub, parent_id: root, title: "Day 1", body: `# Day 1\n![ticket](pane-file:${file})\n[Tram](pane-note:${subsub})` },
      { id: subsub, parent_id: sub, title: "Tram", body: "# Tram\n28" },
    ],
    files: [file],
  };
  const [{ share_note: r }] = await app(pg, me, `select public.share_note($1, public.share_slug($1), true, repeat('ab', 32), $2)`, [root, JSON.stringify(copy)]);
  assertEquals(r.missing_files, [file]);
  await app(pg, me, `select public.publish_share_file($1, $2, 'ticket.pdf', 'application/pdf', $3)`, [r.slug, file, btoa("%PDF-1.4 ticket")]);
  return { root, sub, subsub, file, slug: r.slug as string };
}

const page = async (pg: PGlite, slug: string, sub: string | null = null) =>
  (await pg.query<any>(`select public.shared_note($1, $2::uuid) as p`, [slug, sub])).rows[0].p;

Deno.test("a shared page shows its published copy, and only files the page embeds", async () => {
  const pg = await schemaDB();
  const me = await newUser(pg);
  const { key } = await withKey(pg, me);
  const s = await shared(pg, me, key);
  const p = await page(pg, s.slug);
  assertEquals(p.title, "Lisbon");
  assertEquals(p.subnotes, [{ id: s.sub, title: "Day 1" }]);
  assertEquals((await page(pg, s.slug, s.sub)).subnotes, [{ id: s.subsub, title: "Tram" }]);
  const file = (slugSub: string | null) => pg.query<any>(`select * from public.shared_file($1, $2::uuid, $3)`, [s.slug, slugSub, s.file]);
  assertEquals((await file(s.sub)).rows[0].filename, "ticket.pdf");
  assertEquals((await file(null)).rows.length, 0);
  // Republishing without the file drops its copy.
  await app(pg, me, `select public.publish_share($1, (select slug from public.note_shares where note_id = $1 and revoked_at is null), $2)`, [s.root, JSON.stringify({ title: "Lisbon", body: "# Lisbon", pages: [], files: [] })]);
  assertEquals((await pg.query(`select 1 from public.note_share_files`)).rows.length, 0);
});

for (const [what, change] of [
  ["locked", `update public.notes set locked_body = $2, body_ct = null where id = $1`],
  ["trashed", `update public.notes set trashed_at = now() where id = $1`],
  ["deleted", `update public.notes set deleted_at = now() where id = $1`],
  ["moved", `update public.notes set parent_id = null where id = $1`],
] as const) {
  Deno.test(`a sub-note ${what} leaves every shared copy, with the pages below it`, async () => {
    const pg = await schemaDB();
    const me = await newUser(pg);
    const { key } = await withKey(pg, me);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const lockKey = [...new Uint8Array(await crypto.subtle.digest("SHA-256", salt))].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
    await app(pg, me, `insert into public.note_locks (salt, iterations, key_id, verifier) values ($1, 600000, $2, 'v')`, [b64(salt), lockKey]);
    const a = await shared(pg, me, key);
    // The same sub-note is also shared on its own: a second link.
    const [{ share_note: b }] = await app(pg, me, `select public.share_note($1, public.share_slug($1), false, repeat('ab', 32), $2)`, [a.sub, JSON.stringify({ title: "Day 1", body: "# Day 1", pages: [], files: [] })]);
    await app(pg, me, change, what === "locked" ? [a.sub, box(lockKey)] : [a.sub]);
    const pages = await pg.query<any>(`select slug, note_id from public.note_share_pages`);
    assertEquals(pages.rows, []);
    assertEquals((await pg.query(`select 1 from public.note_share_files`)).rows.length, 0);
    assertEquals(await page(pg, a.slug, a.sub), null);
    assertEquals(await page(pg, a.slug, a.subsub), null);
    // Its own link's copy goes too (moving keeps it: the page shows the same note).
    const own = (await pg.query<any>(`select title, body from public.note_shares where slug = $1`, [b.slug])).rows[0];
    if (what === "moved") assertEquals(own.title, "Day 1"); else assertEquals([own.title, own.body], [null, null]);
    // The root's page stays.
    assertEquals((await page(pg, a.slug)).title, "Lisbon");
  });
}

Deno.test("stop sharing, and trashing the root, take the whole copy down", async () => {
  const pg = await schemaDB();
  const me = await newUser(pg);
  const { key } = await withKey(pg, me);
  const a = await shared(pg, me, key);
  await app(pg, me, `update public.notes set trashed_at = now() where id = $1`, [a.root]);
  assertEquals((await pg.query(`select 1 from public.note_share_pages`)).rows.length, 0);
  assertEquals((await pg.query<any>(`select body from public.note_shares`)).rows[0].body, null);
  const b = await shared(pg, me, key);
  await app(pg, me, `select public.unshare_note($1)`, [b.root]);
  // The stopped link's tag goes: it can't be replayed as a verified share, and it can't be tagged again.
  assertEquals((await pg.query<any>(`select share_tag from public.note_shares where slug = $1`, [b.slug])).rows[0].share_tag, null);
  await refused(app(pg, me, `select public.share_note($1, $2, false, repeat('cd', 32), $3)`,
    [b.root, b.slug, JSON.stringify({ title: "x", body: "x", pages: [], files: [] })]), "note_shares_pkey");
  assertEquals((await pg.query(`select 1 from public.note_share_pages`)).rows.length, 0);
  assertEquals((await pg.query(`select 1 from public.note_share_files`)).rows.length, 0);
  assertEquals(await page(pg, b.slug), null);
});

Deno.test("the AI scan budget refills and goes below zero only by what was spent", async () => {
  const pg = await schemaDB();
  const me = await newUser(pg);
  const left = async (ms: number) => (await app(pg, me, `select public.pane_scan_budget($1) as l`, [ms]))[0].l as number;
  assert((await left(0)) > 19000);
  assert((await left(25000)) < 0);
  assert((await left(0)) < 0);
  assert((await left(100000)) >= -20000);
});

Deno.test("a file deleted from the account leaves every shared copy of it", async () => {
  const pg = await schemaDB();
  const me = await newUser(pg);
  const { key } = await withKey(pg, me);
  const s = await shared(pg, me, key);
  assertEquals((await pg.query(`select 1 from public.note_share_files`)).rows.length, 1);
  await app(pg, me, `update public.attachments set deleted_at = now() where id = $1`, [s.file]);
  assertEquals((await pg.query(`select 1 from public.note_share_files`)).rows.length, 0);
});

Deno.test("publishing names the link, and a link the device didn't verify isn't touched", async () => {
  const pg = await schemaDB();
  const me = await newUser(pg);
  const { key } = await withKey(pg, me);
  const s = await shared(pg, me, key);
  const copy = JSON.stringify({ title: "New", body: "# New", pages: [], files: [] });
  assertEquals((await app(pg, me, `select public.publish_share($1, $2, $3) as r`, [s.root, "x".repeat(24), copy]))[0].r, null);
  // The AI server can't write shared copies at all: only devices publish.
  await refused(app(pg, me, `select public.republish_note_text($1, 'T', 'B', $2)`, [s.root, [s.slug]]), "does not exist");
});
