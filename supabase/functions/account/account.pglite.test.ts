// Delete Account, Export My Data and the retention jobs on the whole schema in an in-process
// Postgres (PGlite). Needs no Docker or local stack:
//   deno test -A supabase/functions/account/account.pglite.test.ts
// account.e2e.test.ts covers the storage side (files and photos) against the real local stack.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { strFromU8, unzipSync } from "npm:fflate@0.8.2";
import { asUser, newUser, schemaDB, sqlFor } from "../mcp/pglite.ts";
import { collect, safeName, zip } from "./export.ts";
import { forget } from "./forget.ts";

// What the auth server keeps in the database, beyond the stub pglite.ts makes.
const authTables = `
  alter table auth.users add column last_sign_in_at timestamptz;
  create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade,
    created_at timestamptz default now(), refreshed_at timestamp, user_agent text, ip inet);
  create table auth.audit_log_entries (id uuid primary key default gen_random_uuid(), payload json, created_at timestamptz default now(), ip_address varchar(64));
`;

// Public tables that aren't the account's own rows, and why they don't cascade from auth.users.
const NOT_PER_ACCOUNT: Record<string, string> = {
  share_reports: "written by visitors; linked to a page by its link, deleted with the account in forget.ts",
  signup_allowlist: "the owner's list; the account's email is removed in forget.ts",
  oauth_clients: "registered by AI apps, not people",
  oauth_rate: "hashed addresses, no account",
  oauth_tokens: "cascades from mcp_tokens",
};

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
async function saltAndKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return { salt: b64(bytes), key: [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("") };
}
const app = (pg: PGlite, me: string, sql: string, params: unknown[] = []) =>
  asUser(pg, me, sql, params, { "request.headers": JSON.stringify({ "x-pane-device": "Mac", "x-amber-client": "lock-aware/1" }) });

/** An account with a row in every table an account can have rows in. */
async function seed(pg: PGlite, me: string) {
  const folder = crypto.randomUUID(), sub = crypto.randomUUID(), note = crypto.randomUUID(), trashed = crypto.randomUUID(), locked = crypto.randomUUID();
  const { salt, key } = await saltAndKey();
  await app(pg, me, `insert into public.note_locks (salt, iterations, key_id, verifier, hint) values ($1, 600000, $2, 'v', 'Blue')`, [salt, key]);
  await app(pg, me, `insert into public.folders (id, name) values ($1, 'Work')`, [folder]);
  await app(pg, me, `insert into public.folders (id, name, parent_id) values ($1, 'Clients/2026', $2)`, [sub, folder]);
  await app(pg, me, `insert into public.notes (id, body, folder_id) values ($1, 'Acme kickoff\n\nAgenda', $2)`, [note, sub]);
  await asUser(pg, me, `update public.notes set body = 'Acme kickoff\n\nAgenda\n- budget' where id = $1`, [note], { "pane.source": "mcp", "pane.client": "Claude" });
  await app(pg, me, `insert into public.notes (id, body, trashed_at) values ($1, 'Old list', now())`, [trashed]);
  await app(pg, me, `insert into public.notes (id, body, locked_body) values ($1, 'Bank', $2)`, [locked, `amb2.${key}.${b64(new Uint8Array(48))}`]);
  await app(pg, me, `insert into public.attachments (id, user_id, filename, content_type, size, storage_path) values (gen_random_uuid(), $1, 'plan.pdf', 'application/pdf', 1200, $2)`,
    [me, `${me}/${crypto.randomUUID()}/plan.pdf`]);
  await app(pg, me, `insert into public.profiles (user_id, display_name) values ($1, 'Sara Lind')`, [me]);
  const tokenHash = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await pg.query(`insert into public.mcp_tokens (user_id, name, token_hash, can_write) values ($1, 'Claude', $2, true)`, [me, tokenHash]);
  const [{ id: grant }] = (await pg.query<{ id: string }>(`select id from public.mcp_tokens where user_id = $1`, [me])).rows;
  await pg.query(`insert into public.oauth_tokens (token_hash, grant_id, kind, resource, expires_at) values ($1, $2, 'access', 'r', now() + interval '1 hour')`, [crypto.randomUUID(), grant]);
  const slug = crypto.randomUUID().replaceAll("-", "");
  await pg.query(`insert into public.note_shares (slug, note_id, user_id) values ($1, $2, $3)`, [slug, note, me]);
  await pg.query(`insert into public.share_reports (slug, reason, reporter) values ($1, 'spam', $2)`, [slug, "a".repeat(64)]);
  await pg.query(`insert into public.pane_setup (user_id, imported_at) values ($1, now())`, [me]);
  await pg.query(`insert into public.pane_activity (user_id, day, kind, n) values ($1, current_date, 'ai_edit', 3) on conflict do nothing`, [me]);
  await pg.query(`insert into public.pane_tip_activity (user_id, day, tip, event, n) values ($1, current_date, 'shareLink', 'shown', 1)`, [me]);
  await pg.query(`insert into public.pane_active_days (user_id, day) values ($1, current_date)`, [me]);
  await pg.query(`insert into public.pane_devices (user_id, device_id, platform) values ($1, gen_random_uuid(), 'ios')`, [me]);
  await pg.query(`insert into public.pane_share_ask (user_id, choice) values ($1, 'dismissed')`, [me]);
  await pg.query(`insert into public.pane_feature_use (user_id, feature) values ($1, 'shareLink')`, [me]);
  await pg.query(`insert into public.pane_rate (user_id, bucket, tokens) values ($1, 'write', 10) on conflict do nothing`, [me]);
  await pg.query(`insert into public.signup_allowlist (email) select lower(email) from auth.users where id = $1`, [me]);
  await pg.query(`insert into auth.sessions (user_id, user_agent, ip) values ($1, 'Amber Notes/1.0 iPhone', '203.0.113.9')`, [me]);
  await pg.query(`insert into auth.audit_log_entries (payload, ip_address) values (json_build_object('actor_id', $1::text, 'actor_username', 'sara@example.com'), '203.0.113.9')`, [me]);
  return { folder, note, trashed, locked, slug, tokenHash };
}

async function setUp() {
  const pg = await schemaDB();
  await pg.exec(authTables);
  const a = await newUser(pg), b = await newUser(pg);
  return { pg, a, b, as: await seed(pg, a), bs: await seed(pg, b) };
}

/** Per public table, how many rows name `uid`. */
async function rowsOf(pg: PGlite, uid: string) {
  const tables = (await pg.query<{ table_name: string }>(
    `select table_name from information_schema.columns where table_schema = 'public' and column_name = 'user_id'`)).rows;
  const out: Record<string, number> = {};
  for (const { table_name: t } of tables) {
    out[t] = (await pg.query<{ n: number }>(`select count(*)::int as n from public.${t} where user_id = $1`, [uid])).rows[0].n;
  }
  return out;
}

Deno.test("every public table either cascades from the account or is listed with a reason", async () => {
  const pg = await schemaDB();
  const all = (await pg.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`)).rows.map((r) => r.table_name);
  const cascaded = new Set((await pg.query<{ t: string }>(`
    select c.conrelid::regclass::text as t from pg_constraint c
    where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.confdeltype = 'c'`)).rows.map((r) => r.t.replace(/^public\./, "")));
  const unaccounted = all.filter((t) => !cascaded.has(t) && !(t in NOT_PER_ACCOUNT) && t !== "oauth_requests" && t !== "note_revisions");
  assertEquals(unaccounted, [], "a new table must cascade from auth.users or be handled in forget.ts");
});

Deno.test("deleting an account leaves no row of it anywhere, and nothing of anyone else's goes", async () => {
  const { pg, a, b, as } = await setUp();
  const before = await rowsOf(pg, a);
  assert(Object.values(before).every((n) => n > 0), `the seed fills every table: ${JSON.stringify(before)}`);

  await forget(sqlFor(pg), a);

  const after = await rowsOf(pg, a);
  assert(Object.values(after).every((n) => n === 0), JSON.stringify(after));
  const q = async (sql: string, p: unknown[]) => (await pg.query<{ n: number }>(sql, p)).rows[0].n;
  assertEquals(await q(`select count(*)::int as n from auth.users where id = $1`, [a]), 0);
  assertEquals(await q(`select count(*)::int as n from auth.sessions where user_id = $1`, [a]), 0);
  assertEquals(await q(`select count(*)::int as n from auth.audit_log_entries where payload ->> 'actor_id' = $1`, [a]), 0);
  assertEquals(await q(`select count(*)::int as n from public.share_reports where slug = $1`, [as.slug]), 0, "reports about A's page");
  assertEquals(await q(`select count(*)::int as n from public.signup_allowlist where email = $1`, [`${a}@pane.local`]), 0);
  assertEquals(await q(`select count(*)::int as n from public.oauth_tokens t join public.mcp_tokens g on g.id = t.grant_id where g.user_id = $1`, [a]), 0);

  const untouched = await rowsOf(pg, b);
  assert(Object.values(untouched).every((n) => n > 0), JSON.stringify(untouched));
  assertEquals(await q(`select count(*)::int as n from auth.audit_log_entries where payload ->> 'actor_id' = $1`, [b]), 1);
  assertEquals(await q(`select count(*)::int as n from public.share_reports`, []), 1, "B's report stays");
});

Deno.test("the export has every note as Markdown in its folder, and data.json has the rest, but no one else's and no secrets", async () => {
  const { pg, a, as } = await setUp();
  const e = await collect(sqlFor(pg), a, new Date("2026-09-30T12:00:00Z"));
  assertEquals(e.name, "amber-notes-export-2026-09-30.zip");

  const files = Object.fromEntries(Object.entries(unzipSync(zip(e))).map(([p, b]) => [p, strFromU8(b)]));
  assertEquals(Object.keys(files).sort(), [
    "README.txt",
    "data.json",
    "notes/Bank.md",
    "notes/Recently Deleted/Old list.md",
    "notes/Work/Clients 2026/Acme kickoff.md",
  ]);
  assertEquals(files["notes/Work/Clients 2026/Acme kickoff.md"], "Acme kickoff\n\nAgenda\n- budget");
  assertStringIncludes(files["notes/Bank.md"], "This note is locked.");

  const data = JSON.parse(files["data.json"]);
  assertEquals(data.account.id, a);
  assertEquals(data.profile.display_name, "Sara Lind");
  assertEquals(data.folders.length, 2);
  assertEquals(data.notes.length, 3);
  assertEquals(data.versions.length, 1, "the version the AI edit kept");
  assertEquals(data.versions[0].body, "Acme kickoff\n\nAgenda");
  assertEquals(data.files.map((f: { filename: string }) => f.filename), ["plan.pdf"]);
  assertEquals(data.ai_connections[0].name, "Claude");
  assertEquals(data.share_links[0].slug, as.slug);
  assertEquals(data.locked_notes.hint, "Blue");
  assertEquals(data.usage.ai_edits_per_day.length, 1);
  assertEquals(data.usage.devices.length, 1);
  assertEquals(data.sign_ins[0].ip, "203.0.113.9");
  assert(data.notes.find((n: { id: string }) => n.id === as.locked).locked_body.startsWith("amb2."), "locked notes stay encrypted");

  const all = JSON.stringify(files);
  assertEquals(all.includes(as.tokenHash), false, "no token hash");
  assertEquals(all.includes("storage_path"), false, "no internal storage paths");
  assertEquals(all.includes("spam"), false, "no reports by other people");
});

Deno.test("file names are safe on every system", () => {
  assertEquals(safeName("a/b\\c:d*e?f\"g<h>i|j"), "a b c d e f g h i j");
  assertEquals(safeName("..hidden"), "hidden");
  assertEquals(safeName("   "), "Untitled");
  assertEquals(safeName("x".repeat(200)).length, 80);
});

Deno.test("retention: Recently Deleted after 30 days, hashes, counts and logs after their time, fresh ones stay", async () => {
  const { pg, a, as } = await setUp();
  const old = crypto.randomUUID();
  await app(pg, a, `insert into public.notes (id, body) values ($1, 'Receipts\n\nv1')`, [old]);
  await asUser(pg, a, `update public.notes set body = 'Receipts\n\nv2' where id = $1`, [old], { "pane.source": "mcp", "pane.client": "Claude" });
  await pg.query(`update public.notes set trashed_at = now() - interval '31 days' where id = $1`, [old]);
  await pg.query(`insert into public.note_shares (slug, note_id, user_id) values ($1, $2, $3)`, ["s".repeat(24), old, a]);
  await pg.query(`update public.share_reports set created_at = now() - interval '31 days'`);
  await pg.query(`insert into public.share_reports (slug, reason, reporter, status, created_at) values ($1, 'x', $2, 'dismissed', now() - interval '13 months')`, [as.slug, "b".repeat(64)]);
  await pg.query(`insert into public.pane_activity (user_id, day, kind, n) values ($1, current_date - 400, 'ai_edit', 1)`, [a]);
  await pg.query(`insert into auth.audit_log_entries (payload, created_at) values ('{}', now() - interval '31 days')`);
  await pg.query(`insert into public.oauth_rate (bucket, ip_hash, at) values ('token', 'h', now() - interval '3 hours'), ('token', 'h', now())`);

  await pg.query(`select public.pane_forget_hourly()`);
  await pg.query(`select public.pane_forget_daily()`);

  const [gone] = (await pg.query<{ body: string; deleted_at: string | null }>(`select body, deleted_at from public.notes where id = $1`, [old])).rows;
  assertEquals(gone.body, "");
  assert(gone.deleted_at, "deleted for good");
  const n = async (sql: string, p: unknown[] = []) => (await pg.query<{ n: number }>(sql, p)).rows[0].n;
  assertEquals(await n(`select count(*)::int as n from public.note_revisions where note_id = $1`, [old]), 0);
  assertEquals(await n(`select count(*)::int as n from public.note_shares where note_id = $1 and revoked_at is null`, [old]), 0);
  const [trashedYesterday] = (await pg.query<{ body: string }>(`select body from public.notes where id = $1`, [as.trashed])).rows;
  assertEquals(trashedYesterday.body, "Old list", "a note deleted today is still recoverable");

  assertEquals(await n(`select count(*)::int as n from public.share_reports where reporter <> repeat('0', 64)`), 0, "reporter hashes blanked");
  assertEquals(await n(`select count(*)::int as n from public.share_reports`), 2, "open reports stay; the closed 13-month-old one goes");
  assertEquals(await n(`select count(*)::int as n from public.pane_activity where day < current_date - 365`), 0);
  assertEquals(await n(`select count(*)::int as n from public.pane_activity`), 2, "this year's counts stay");
  assertEquals(await n(`select count(*)::int as n from auth.audit_log_entries where created_at < now() - interval '30 days'`), 0);
  assertEquals(await n(`select count(*)::int as n from auth.audit_log_entries`), 2);
  assertEquals(await n(`select count(*)::int as n from public.oauth_rate`), 1);
});
