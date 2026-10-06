// Delete Account, Export My Data and the retention jobs on the whole schema in an in-process
// Postgres (PGlite). Needs no Docker or local stack:
//   deno test -A supabase/functions/account/account.pglite.test.ts
// account.e2e.test.ts covers the storage side (files and photos) against the real local stack.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { strFromU8, unzipSync } from "npm:fflate@0.8.2";
import { asUser, newUser, schemaDB, sqlFor } from "../mcp/pglite.ts";
import { collect, zip } from "./export.ts";
import * as sealed from "../mcp/sealed.ts";
import { forget } from "./forget.ts";
import { deletePausedUntil } from "./pause.ts";

// What the auth server keeps in the database, beyond the stub pglite.ts makes.
const authTables = `
  alter table auth.users add column last_sign_in_at timestamptz;
  create table auth.audit_log_entries (id uuid primary key default gen_random_uuid(), payload json, created_at timestamptz default now(), ip_address varchar(64));
`;

// Public tables that aren't the account's own rows, and why they don't cascade from auth.users.
const NOT_PER_ACCOUNT: Record<string, string> = {
  share_reports: "written by visitors; linked to a page by its link, deleted with the account in forget.ts",
  signup_allowlist: "the owner's list; the account's email is removed in forget.ts",
  oauth_clients: "registered by AI apps, not people",
  oauth_rate: "hashed addresses, no account",
  oauth_tokens: "cascades from mcp_tokens",
  note_share_pages: "a shared page's copy; cascades from note_shares and notes",
  note_share_files: "a shared page's file copy; cascades from note_shares",
  site_downloads: "aggregate daily download totals, no account or personal data",
  email_clicks: "a click on an onboarding email; cascades from email_sends",
};

/** An account with a row in every table an account can have rows in. */
async function seed(pg: PGlite, me: string) {
  const a = await sealed.account(pg, me);
  const app = sealed.app;
  const lockKey = await sealed.notesPassword(pg, a);
  await pg.query(`update public.note_locks set hint = 'Blue' where user_id = $1`, [me]);
  const folder = await sealed.folder(pg, a, "Work");
  const sub = await sealed.folder(pg, a, "Clients/2026", folder);
  const note = await sealed.note(pg, a, "Acme kickoff\n\nAgenda", { folder: sub });
  await sealed.edit(pg, a, note, "Acme kickoff\n\nAgenda\n- budget", { "pane.source": "mcp", "pane.client": "Claude" });
  const trashed = await sealed.note(pg, a, "Old list");
  await app(pg, me, `update public.notes set trashed_at = now() where id = $1`, [trashed]);
  const locked = await sealed.lockedNote(pg, a, lockKey, "Bank");
  await sealed.file(pg, a, "plan.pdf", "com.adobe.pdf", new TextEncoder().encode("%PDF"));
  // The note's app: a project, its data and a held-back draft; a second save keeps the first as a version.
  const project = (html: string) => JSON.stringify({ amberApp: 1, files: { "/index.html": html } });
  await pg.query(`insert into public.note_pages (note_id, user_id, page_ct, data_ct, draft_ct, draft_problems, client) values ($1, $2, $3, $4, $5, 'today.test.tsx failed', 'Claude')`,
    [note, me, await a.vault.sealPage(note, project("<p>1</p>")), await a.vault.sealPageData(note, "{}"), await a.vault.sealPage(note, project("<p>3</p>"))]);
  await pg.query(`update public.note_pages set page_ct = $2 where note_id = $1`, [note, await a.vault.sealPage(note, project("<p>2</p>"))]);
  await pg.query(`insert into public.app_load_failures (note_id, user_id, message, device) values ($1, $2, 'ReferenceError: x is not defined', 'iPhone')`, [note, me]);
  const keyName = crypto.randomUUID();
  await pg.query(`insert into public.api_key_names (id, user_id, meta_ct) values ($1, $2, $3)`,
    [keyName, me, await a.vault.sealAPIKeyMeta(keyName, JSON.stringify({ name: "Weather", hosts: ["api.example.com"] }))]);
  await sealed.app(pg, me, `insert into public.profiles (user_id, display_name) values ($1, 'Sara Lind')`, [me]);
  const tokenHash = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await pg.query(`insert into public.mcp_tokens (user_id, name, token_hash, can_write) values ($1, 'Claude', $2, true)`, [me, tokenHash]);
  const [{ id: grant }] = (await pg.query<{ id: string }>(`select id from public.mcp_tokens where user_id = $1`, [me])).rows;
  await pg.query(`insert into public.oauth_tokens (token_hash, grant_id, kind, resource, expires_at) values ($1, $2, 'access', 'r', now() + interval '1 hour')`, [crypto.randomUUID(), grant]);
  const [{ share_note: shared }] = await sealed.app(pg, me, `select public.share_note($1, public.share_slug($1), false, repeat('ab', 32), $2)`,
    [note, JSON.stringify({ title: "Acme kickoff", body: "Acme kickoff\n\nAgenda\n- budget", pages: [], files: [] })]);
  const slug = shared.slug as string;
  await pg.query(`insert into public.share_reports (slug, reason, reporter) values ($1, 'spam', $2)`, [slug, "a".repeat(64)]);
  const client = `amb_client_${crypto.randomUUID()}`;
  await pg.query(`insert into public.oauth_clients (id, client_name, redirect_uris) values ($1, 'ChatGPT', '{https://chatgpt.com/cb}')`, [client]);
  const [{ id: asked }] = (await pg.query<{ id: string }>(`insert into public.oauth_requests (client_id, redirect_uri, code_challenge, resource, claimed_by)
    values ($1, 'https://chatgpt.com/cb', 'x', 'r', $2) returning id`, [client, me])).rows;
  await pg.query(`insert into public.connect_asks (request_id, user_id, browser_key, started_from, expires_at, pickup_hash, match_commit) values ($1, $2, $3, 'Chrome on a Mac', now() + interval '10 minutes', repeat('0', 64), repeat('0', 64))`,
    [asked, me, "B" + "A".repeat(86) + "="]);
  await pg.query(`insert into public.account_notices (user_id, kind, what) values ($1, 'started_fresh', 'x')`, [me]);
  await pg.query(`insert into public.account_key_resets (user_id, generation) values ($1, 1)`, [me]);
  await pg.query(`insert into public.account_recoveries (user_id) values ($1)`, [me]);
  await pg.query(`insert into public.device_tokens (user_id, device_id, platform, token, environment) values ($1, gen_random_uuid(), 'ios', $2, 'sandbox')`, [me, crypto.randomUUID().replaceAll('-', '').repeat(2)]);
  await pg.query(`insert into public.device_adds (id, user_id, device_id, platform, public_key, key_id, scan_hash, scan_tag, scan_name, code_hash, code_tag, code_name, pickup_hash)
    select gen_random_uuid(), $1, gen_random_uuid(), 'macos', $2, k.key_id, $3, repeat('1', 64), 'amb2n.AAAA', $4, repeat('2', 64), 'amb2n.AAAA', repeat('3', 64)
    from public.account_keys k where k.user_id = $1`,
    [me, "B" + "A".repeat(86) + "=", crypto.randomUUID().replaceAll("-", "").repeat(2), crypto.randomUUID().replaceAll("-", "").repeat(2)]);
  await pg.query(`insert into public.key_devices (user_id, device_id, platform, how, backed_up, key_id, epoch, name_ct, tag)
    select $1, gen_random_uuid(), 'macos', 'added', false, k.key_id, repeat('5', 32), 'amb2.' || k.key_id || '.AAAA', repeat('4', 64) from public.account_keys k where k.user_id = $1`, [me]);
  await pg.query(`insert into public.connect_blocks (user_id, blocked_until) values ($1, now() - interval '1 day')`, [me]);
  await pg.query(`insert into public.pane_setup (user_id, imported_at) values ($1, now())`, [me]);
  await pg.query(`insert into public.pane_activity (user_id, day, kind, n) values ($1, current_date, 'ai_edit', 3) on conflict do nothing`, [me]);
  await pg.query(`insert into public.pane_tip_activity (user_id, day, tip, event, n) values ($1, current_date, 'shareLink', 'shown', 1)`, [me]);
  await pg.query(`insert into public.pane_active_days (user_id, day) values ($1, current_date)`, [me]);
  await pg.query(`insert into public.pane_devices (user_id, device_id, platform) values ($1, gen_random_uuid(), 'ios')`, [me]);
  await pg.query(`insert into public.pane_share_ask (user_id, choice) values ($1, 'dismissed')`, [me]);
  await pg.query(`insert into public.pane_heard_from (user_id, source, detail) values ($1, 'other', 'a podcast')`, [me]);
  await pg.query(`insert into public.pane_feature_use (user_id, feature) values ($1, 'shareLink')`, [me]);
  await pg.query(`insert into public.pane_rate (user_id, bucket, tokens) values ($1, 'write', 10) on conflict do nothing`, [me]);
  await pg.query(`insert into public.signup_allowlist (email) select lower(email) from auth.users where id = $1`, [me]);
  await pg.query(`insert into public.email_sends (user_id, kind, status, sent_at) values ($1, 'connect', 'sent', now())`, [me]);
  await pg.query(`insert into public.email_unsubscribes (user_id, source) values ($1, 'link')`, [me]);
  await pg.query(`insert into public.email_replies (user_id) values ($1)`, [me]);
  await pg.query(`insert into auth.sessions (user_id, user_agent, ip) values ($1, 'Amber Notes/1.0 iPhone', '203.0.113.9')`, [me]);
  await pg.query(`insert into auth.audit_log_entries (payload, ip_address) values (json_build_object('actor_id', $1::text, 'actor_username', 'sara@example.com'), '203.0.113.9')`, [me]);
  return { folder, note, trashed, locked, slug, tokenHash, acct: a };
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

Deno.test("the export has everything the server can read, no note text or names, no one else's and no secrets", async () => {
  const { pg, a, as } = await setUp();
  const e = await collect(sqlFor(pg), a, new Date("2026-09-30T12:00:00Z"));
  assertEquals(e.name, "amber-notes-export-2026-09-30.zip");

  const files = Object.fromEntries(Object.entries(unzipSync(zip(e))).map(([p, b]) => [p, strFromU8(b)]));
  assertEquals(Object.keys(files).sort(), ["README.txt", "data.json"]);
  assertStringIncludes(files["README.txt"], "Export Your Notes");

  const data = JSON.parse(files["data.json"]);
  assertEquals(data.account.id, a);
  assertEquals(data.profile.display_name, "Sara Lind");
  assertEquals(data.folders.length, 2);
  assertEquals(data.notes.length, 3);
  assertEquals(data.versions.length, 1, "the version the AI edit kept");
  assertEquals([data.apps.apps.length, data.apps.versions.length, data.apps.load_failures.length, data.apps.api_keys.length], [1, 1, 1, 1], "the note's app, without its project");
  assertEquals(data.apps.apps[0].has_draft, true);
  assertEquals(data.files.length, 1);
  assertEquals(data.ai_connections[0].name, "Claude");
  assertEquals(data.share_links[0].slug, as.slug);
  assertEquals(data.share_links[0].title, "Acme kickoff", "a shared page's published copy is readable, so it's included");
  assertEquals(data.locked_notes.hint, "Blue");
  assertEquals(data.usage.ai_edits_per_day.length, 1);
  assertEquals(data.usage.heard_from.source, "other");
  assertEquals(data.usage.heard_from.detail, "a podcast");
  assertEquals(data.usage.devices.length, 1);
  assertEquals([data.usage.key_devices.length, data.usage.key_devices[0].how, data.usage.key_devices[0].name_ct], [1, "added", undefined], "the devices that hold the key, without their sealed names");
  assertEquals([data.onboarding_emails.sent.length, data.onboarding_emails.sent[0].kind, data.onboarding_emails.unsubscribed.source], [1, "connect", "link"]);
  assertEquals(data.sign_ins[0].ip, "203.0.113.9");
  assert(data.notes.find((n: { id: string }) => n.id === as.locked).locked, "locked notes are marked");

  const all = JSON.stringify(files);
  for (const secret of ["Clients/2026", "plan.pdf", "Old list", "Bank", "amb2."]) assertEquals(all.includes(secret), false, `no ${secret}`);
  assertEquals(all.includes(as.tokenHash), false, "no token hash");
  assertEquals(all.includes("storage_path"), false, "no internal storage paths");
  assertEquals(all.includes("spam"), false, "no reports by other people");
});

Deno.test("retention: Recently Deleted after 30 days, hashes, counts and logs after their time, fresh ones stay", async () => {
  const { pg, a, as } = await setUp();
  const old = await sealed.note(pg, as.acct, "Receipts\n\nv1");
  await sealed.edit(pg, as.acct, old, "Receipts\n\nv2", { "pane.source": "mcp", "pane.client": "Claude" });
  await pg.query(`update public.notes set trashed_at = now() - interval '31 days' where id = $1`, [old]);
  await pg.query(`insert into public.note_shares (slug, note_id, user_id) values ($1, $2, $3)`, ["s".repeat(24), old, a]);
  await pg.query(`update public.share_reports set created_at = now() - interval '31 days'`);
  await pg.query(`insert into public.share_reports (slug, reason, reporter, status, created_at) values ($1, 'x', $2, 'dismissed', now() - interval '13 months')`, [as.slug, "b".repeat(64)]);
  await pg.query(`insert into public.pane_activity (user_id, day, kind, n) values ($1, current_date - 400, 'ai_edit', 1)`, [a]);
  await pg.query(`insert into auth.audit_log_entries (payload, created_at) values ('{}', now() - interval '31 days')`);
  await pg.query(`insert into public.oauth_rate (bucket, ip_hash, at) values ('token', 'h', now() - interval '3 hours'), ('token', 'h', now())`);

  await pg.query(`select public.pane_forget_hourly()`);
  await pg.query(`select public.pane_forget_daily()`);

  const [gone] = (await pg.query<{ body_ct: string | null; head_ct: string | null; deleted_at: string | null }>(`select body_ct, head_ct, deleted_at from public.notes where id = $1`, [old])).rows;
  assertEquals([gone.body_ct, gone.head_ct], [null, null]);
  assert(gone.deleted_at, "deleted for good");
  const n = async (sql: string, p: unknown[] = []) => (await pg.query<{ n: number }>(sql, p)).rows[0].n;
  assertEquals(await n(`select count(*)::int as n from public.note_revisions where note_id = $1`, [old]), 0);
  assertEquals(await n(`select count(*)::int as n from public.note_shares where note_id = $1 and revoked_at is null`, [old]), 0);
  const [trashedYesterday] = (await pg.query<{ body_ct: string | null }>(`select body_ct from public.notes where id = $1`, [as.trashed])).rows;
  assert(trashedYesterday.body_ct, "a note deleted today is still recoverable");

  assertEquals(await n(`select count(*)::int as n from public.share_reports where reporter <> repeat('0', 64)`), 0, "reporter hashes blanked");
  assertEquals(await n(`select count(*)::int as n from public.share_reports`), 2, "open reports stay; the closed 13-month-old one goes");
  assertEquals(await n(`select count(*)::int as n from public.pane_activity where day < current_date - 365`), 0);
  assertEquals(await n(`select count(*)::int as n from public.pane_activity`), 2, "this year's counts stay");
  assertEquals(await n(`select count(*)::int as n from auth.audit_log_entries where created_at < now() - interval '30 days'`), 0);
  assertEquals(await n(`select count(*)::int as n from auth.audit_log_entries`), 2);
  assertEquals(await n(`select count(*)::int as n from public.oauth_rate`), 1);
});

Deno.test("Delete Account is paused for 72 hours after a completed reset or an email-link sign-in, never by a request", async () => {
  const pg = await schemaDB();
  const sql = sqlFor(pg);
  const until = (me: string) => deletePausedUntil(sql, me);
  const back = (me: string, hours: number) =>
    pg.query(`update public.account_recoveries set at = now() - make_interval(secs => $2::double precision * 3600) where user_id = $1`, [me, String(hours)]);

  const asked = await newUser(pg);
  await pg.query(`update auth.users set recovery_sent_at = now() where id = $1`, [asked]);
  assertEquals(await until(asked), null, "a reset or link request alone pauses nothing");

  const reset = await newUser(pg);
  await pg.query(`update auth.users set encrypted_password = 'new hash' where id = $1`, [reset]);
  const linked = await newUser(pg);
  const [{ id: session }] = (await pg.query<any>(`insert into auth.sessions (user_id) values ($1) returning id`, [linked])).rows;
  await pg.query(`insert into auth.mfa_amr_claims (session_id, authentication_method) values ($1, 'otp')`, [session]);
  for (const me of [reset, linked]) {
    const at = await until(me);
    assert(at && Math.abs(new Date(at).getTime() - (Date.now() + 72 * 3600_000)) < 60_000, `paused for 72 hours: ${at}`);
    await back(me, 71.9);
    assert(await until(me), "still paused at 71.9 hours");
    await back(me, 72.1);
    assertEquals(await until(me), null, "open again at 72.1 hours");
  }
});
