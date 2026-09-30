// The tip migration (20260929230000_tip_events.sql) on an in-process Postgres (PGlite), with the
// few tables and functions it relies on stubbed. Needs no Docker or local stack:
//   cd supabase/functions/mcp && deno test -A tips.pglite.test.ts
// tips.e2e.test.ts runs the same checks against the real local stack.
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const migration = new URL("../../migrations/20260929230000_tip_events.sql", import.meta.url);

const stubs = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid $$;
  -- As 20261001090000_e2ee.sql leaves them: text is sealed (body_ct, head_ct), never readable.
  create table public.notes (id uuid primary key, user_id uuid not null references auth.users (id), body_ct text, head_ct text not null default 'amb2.0000000000000000.AAAA',
    body_source text, body_client text);
  create table public.note_revisions (id bigint generated always as identity primary key, note_id uuid not null references public.notes (id),
    user_id uuid not null, body_ct text, head_ct text, version bigint not null, source text not null default 'app', client text);
  create table public.note_shares (slug text primary key, note_id uuid not null references public.notes (id), user_id uuid not null,
    revoked_at timestamptz);
  create function public.pane_take(p_bucket text, p_cost double precision default 1) returns void language sql as $$ select $$;
  grant usage on schema public, auth to authenticated, service_role;
  grant execute on function auth.uid() to authenticated, service_role;
`;

async function db() {
  const pg = new PGlite();
  await pg.exec(stubs);
  await pg.exec(await Deno.readTextFile(migration));
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

const used = async (pg: PGlite, me: string) => (await asUser(pg, me, `select public.pane_features_used() as f`)).rows[0].f;

Deno.test("features used: nothing yet, then a flag, counted once", async () => {
  const { pg, me } = await db();
  assertEquals(await used(pg, me), []);
  await asUser(pg, me, `select public.pane_feature_used('menuBar')`);
  await asUser(pg, me, `select public.pane_feature_used('menuBar')`);
  assertEquals(await used(pg, me), ["menuBar"]);
  const n = await pg.query<{ n: number }>(`select count(*)::int as n from public.pane_feature_use`);
  assertEquals(n.rows[0].n, 1);
});

Deno.test("features used: any share link ever (even stopped) means the share link tip never shows", async () => {
  const { pg, me } = await db();
  const note = crypto.randomUUID();
  await pg.query(`insert into public.notes (id, user_id, body_ct) values ($1, $2, 'amb2.0000000000000000.U2hhcmVk')`, [note, me]);
  await pg.query(`insert into public.note_shares (slug, note_id, user_id, revoked_at) values ('abc', $1, $2, now())`, [note, me]);
  assertEquals(await used(pg, me), ["shareLink"]);
});

Deno.test("features used: a version restored from an app counts; an AI's restore doesn't", async () => {
  const { pg, me } = await db();
  const note = crypto.randomUUID();
  await pg.query(`insert into public.notes (id, user_id, body_ct) values ($1, $2, 'amb2.0000000000000000.eA==')`, [note, me]);
  await pg.query(`insert into public.note_revisions (note_id, user_id, body_ct, version, source, client) values ($1, $2, 'amb2.0000000000000000.YQ==', 1, 'restore', 'ChatGPT')`, [note, me]);
  assertEquals(await used(pg, me), []);
  await pg.query(`insert into public.note_revisions (note_id, user_id, body_ct, version, source, client) values ($1, $2, 'amb2.0000000000000000.Yg==', 2, 'restore', 'iPhone')`, [note, me]);
  assertEquals(await used(pg, me), ["versionHistory"]);
  // Or the current text itself was written by a restore on a device.
  const other = await db();
  const n2 = crypto.randomUUID();
  await other.pg.query(`insert into public.notes (id, user_id, body_ct, body_source, body_client) values ($1, $2, 'amb2.0000000000000000.eQ==', 'restore', 'Mac')`, [n2, other.me]);
  assertEquals(await used(other.pg, other.me), ["versionHistory"]);
});

Deno.test("features used: someone else's use isn't yours; unknown features are refused", async () => {
  const { pg, me } = await db();
  const them = crypto.randomUUID();
  await pg.query(`insert into auth.users (id) values ($1)`, [them]);
  await asUser(pg, them, `select public.pane_feature_used('shareExtension')`);
  assertEquals(await used(pg, me), []);
  let message = "";
  await asUser(pg, me, `select public.pane_feature_used('checklistTidy')`).catch((e) => { message = (e as Error).message; });
  assertStringIncludes(message, "pane_feature_use_feature_check");
});

Deno.test("tip events: only the four tips remain, counted per day", async () => {
  const { pg, me } = await db();
  await asUser(pg, me, `select public.pane_tip_event('shareLink', 'shown')`);
  await asUser(pg, me, `select public.pane_tip_event('shareLink', 'shown')`);
  const rows = await pg.query<{ n: number }>(`select n from public.pane_tip_activity where tip = 'shareLink' and event = 'shown'`);
  assertEquals(rows.rows[0].n, 2);
  for (const gone of ["checklistTidy", "tableFromText"]) {
    let message = "";
    await asUser(pg, me, `select public.pane_tip_event($1, 'shown')`, [gone]).catch((e) => { message = (e as Error).message; });
    assertStringIncludes(message, "pane_tip_activity_tip_check");
  }
});
