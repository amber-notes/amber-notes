// The share ask migration (20260930120000_share_ask.sql) on top of the tips one, on an in-process
// Postgres (PGlite), with the few tables and functions they rely on stubbed. Needs no Docker:
//   cd supabase/functions/mcp && deno test -A share_ask.pglite.test.ts
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const migrations = ["20260929230000_tip_events.sql", "20260930120000_share_ask.sql"]
  .map((m) => new URL(`../../migrations/${m}`, import.meta.url));

const stubs = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid $$;
  create table public.notes (id uuid primary key, user_id uuid not null references auth.users (id), body text not null default '',
    body_source text, body_client text);
  create table public.note_revisions (id bigint generated always as identity primary key, note_id uuid not null references public.notes (id),
    user_id uuid not null, body text not null, version bigint not null, source text not null default 'app', client text);
  create table public.note_shares (slug text primary key, note_id uuid not null references public.notes (id), user_id uuid not null,
    revoked_at timestamptz);
  create function public.pane_take(p_bucket text, p_cost double precision default 1) returns void language sql as $$ select $$;
  grant usage on schema public, auth to authenticated, service_role;
  grant execute on function auth.uid() to authenticated, service_role;
`;

async function db() {
  const pg = new PGlite();
  await pg.exec(stubs);
  for (const m of migrations) await pg.exec(await Deno.readTextFile(m));
  const me = crypto.randomUUID();
  await pg.query(`insert into auth.users (id) values ($1)`, [me]);
  return { pg, me };
}

async function asUser(pg: PGlite, me: string, sql: string, params: unknown[] = []) {
  return await pg.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: me })]);
    await tx.exec(`set local role authenticated`);
    return await tx.query<Record<string, unknown>>(sql, params);
  });
}

const decided = async (pg: PGlite, me: string) =>
  (await asUser(pg, me, `select public.pane_share_ask_decided() as d`)).rows[0].d;

Deno.test("share ask: undecided, then decided for good; the first answer stands", async () => {
  const { pg, me } = await db();
  assertEquals(await decided(pg, me), false);
  await asUser(pg, me, `select public.pane_share_ask_decide('shared_linkedin')`);
  assertEquals(await decided(pg, me), true);
  // Another device answering later changes nothing.
  await asUser(pg, me, `select public.pane_share_ask_decide('dismissed')`);
  const rows = await pg.query<{ choice: string }>(`select choice from public.pane_share_ask`);
  assertEquals(rows.rows.map((r) => r.choice), ["shared_linkedin"]);
});

Deno.test("share ask: someone else's answer isn't yours; unknown answers are refused", async () => {
  const { pg, me } = await db();
  const them = crypto.randomUUID();
  await pg.query(`insert into auth.users (id) values ($1)`, [them]);
  await asUser(pg, them, `select public.pane_share_ask_decide('shared_x')`);
  assertEquals(await decided(pg, me), false);
  let message = "";
  await asUser(pg, me, `select public.pane_share_ask_decide('rated')`).catch((e) => { message = (e as Error).message; });
  assertStringIncludes(message, "pane_share_ask_choice_check");
});

Deno.test("share ask: its events count with the tips, and the old tips still do", async () => {
  const { pg, me } = await db();
  for (const event of ["shown", "shared_x", "shared_linkedin", "dismissed"]) {
    await asUser(pg, me, `select public.pane_tip_event('shareAsk', $1)`, [event]);
  }
  await asUser(pg, me, `select public.pane_tip_event('shareLink', 'used')`);
  const report = await pg.query<Record<string, number>>(
    `select shown_accounts::int, shared_x::int, shared_linkedin::int, dismissed::int from public.pane_share_ask_report()`,
  );
  assertEquals(report.rows[0], { shown_accounts: 1, shared_x: 1, shared_linkedin: 1, dismissed: 1 });
  let message = "";
  await asUser(pg, me, `select public.pane_tip_event('shareAsk', 'rated')`).catch((e) => { message = (e as Error).message; });
  assertStringIncludes(message, "pane_tip_activity_event_check");
});

Deno.test("share ask: the report is for the service role only", async () => {
  const { pg, me } = await db();
  let message = "";
  await asUser(pg, me, `select * from public.pane_share_ask_report()`).catch((e) => { message = (e as Error).message; });
  assertStringIncludes(message, "permission denied");
});
