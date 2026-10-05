// Sign in with Google joining an existing account (migration 20261005120000_google_sign_in.sql,
// docs/Technical/google-sign-in.md), on the whole schema in an in-process Postgres (PGlite):
//   deno test -A supabase/functions/account/google.pglite.test.ts
// Supabase's auth server inserts the identity, as supabase_auth_admin; the test does the same.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { newUser, schemaDB } from "../mcp/pglite.ts";

async function withPassword(pg: PGlite): Promise<string> {
  const me = await newUser(pg);
  await pg.query(`update auth.users set encrypted_password = '$2a$10$abcdefghijklmnopqrstuv' where id = $1`, [me]);
  // A device signed in with that password.
  const [{ id }] = (await pg.query<{ id: string }>(`insert into auth.sessions (user_id) values ($1) returning id`, [me])).rows;
  await pg.query(`insert into auth.mfa_amr_claims (session_id, authentication_method) values ($1, 'password')`, [id]);
  await pg.query(`delete from public.account_recoveries where user_id = $1`, [me]);
  return me;
}

async function addIdentity(pg: PGlite, user: string, provider: string) {
  await pg.query(`insert into auth.identities (user_id, provider, provider_id, identity_data, email)
    select $1, $2, gen_random_uuid()::text, jsonb_build_object('email', u.email, 'email_verified', true), u.email from auth.users u where u.id = $1`, [user, provider]);
}

const state = async (pg: PGlite, user: string) => (await pg.query<{ password: string; sessions: number; paused: boolean }>(`
  select coalesce(u.encrypted_password, '') as password,
         (select count(*)::int from auth.sessions s where s.user_id = u.id) as sessions,
         exists (select 1 from public.account_recoveries r where r.user_id = u.id) as paused
  from auth.users u where u.id = $1`, [user])).rows[0];

Deno.test("Google joining a password account ends the password and every earlier session, and starts the pause", async () => {
  const pg = await schemaDB();
  const me = await withPassword(pg);
  assertEquals(await state(pg, me), { password: "$2a$10$abcdefghijklmnopqrstuv", sessions: 1, paused: false });
  await addIdentity(pg, me, "google");
  assertEquals(await state(pg, me), { password: "", sessions: 0, paused: true });
  // The new Google session comes after the identity, and stays.
  await pg.query(`insert into auth.sessions (user_id) values ($1)`, [me]);
  assertEquals((await state(pg, me)).sessions, 1);
  await pg.close();
});

Deno.test("a new Google account, and Apple joining a password account, change nothing", async () => {
  const pg = await schemaDB();
  const fresh = await newUser(pg);
  await addIdentity(pg, fresh, "google");
  assertEquals(await state(pg, fresh), { password: "", sessions: 0, paused: false });

  const withApple = await withPassword(pg);
  await addIdentity(pg, withApple, "apple");
  assertEquals(await state(pg, withApple), { password: "$2a$10$abcdefghijklmnopqrstuv", sessions: 1, paused: false });

  // Another account with a password is left alone when Google joins someone else's.
  const other = await withPassword(pg);
  const mine = await withPassword(pg);
  await addIdentity(pg, mine, "google");
  assertEquals((await state(pg, other)).sessions, 1);
  assert((await state(pg, other)).password !== "");
  await pg.close();
});

Deno.test("the sign-up hook lets Google make accounts, as it lets Apple, and refuses other new emails", async () => {
  const pg = await schemaDB();
  const hook = async (provider: string, email: string) =>
    (await pg.query<{ r: Record<string, unknown> }>(`select public.hook_before_user_created($1::jsonb) as r`,
      [JSON.stringify({ user: { email, app_metadata: { provider } } })])).rows[0].r;
  assertEquals(await hook("google", "sara@gmail.com"), {});
  assertEquals(await hook("apple", "x@privaterelay.appleid.com"), {});
  const refused = await hook("email", "stranger@example.com") as { error: { http_code: number; message: string } };
  assertEquals(refused.error.http_code, 403);
  assertStringIncludes(refused.error.message, "Apple or Google");
  await pg.close();
});
