// The 72-hour pause on Delete Account and Start fresh, and a sign-up confirmed with the emailed
// code (migration 20261009233000_sign_up_code_is_not_a_reset.sql), on the whole schema in an
// in-process Postgres (PGlite):
//   deno test -A supabase/functions/account/sign_up_pause.pglite.test.ts
//
// The tests write what Supabase Auth writes. Confirming a sign-up with the code: it sets
// auth.users.email_confirmed_at, then makes the session with one amr claim, `otp`. A sign-in by
// emailed code or link, and a reset link being opened: a session with the claim `otp`, and
// email_confirmed_at left as it was.
import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { asUser, schemaDB, sqlFor } from "../mcp/pglite.ts";
import { deletePausedUntil } from "./pause.ts";

const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
/// A box as the app makes it. The server never opens one, so any bytes do.
const box = (key: string) => `amb2.${key}.${btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(48))))}`;

/// An email sign-up waiting for its code: the account exists, the address isn't confirmed.
async function signedUp(pg: PGlite, ago = "0 seconds"): Promise<string> {
  const id = crypto.randomUUID();
  await pg.query(`insert into auth.users (id, email, created_at, email_confirmed_at) values ($1, $2, now() - $3::interval, null)`, [id, `${id}@pane.local`, ago]);
  return id;
}
/// The code typed in the app: the address is confirmed and the first session is made, in one go.
async function confirmWithCode(pg: PGlite, me: string) {
  await pg.query(`update auth.users set email_confirmed_at = now() where id = $1`, [me]);
  return await session(pg, me, "otp");
}
async function session(pg: PGlite, me: string, method: string): Promise<string> {
  const [{ id }] = (await pg.query<{ id: string }>(`insert into auth.sessions (user_id) values ($1) returning id`, [me])).rows;
  await pg.query(`insert into auth.mfa_amr_claims (session_id, authentication_method) values ($1, $2)`, [id, method]);
  return id;
}
/// An account that has been in use: confirmed a month ago, with a key and a note.
async function existing(pg: PGlite) {
  const me = await signedUp(pg, "30 days");
  await pg.query(`update auth.users set email_confirmed_at = now() - interval '30 days', encrypted_password = 'hash' where id = $1`, [me]);
  await pg.query(`delete from public.account_recoveries where user_id = $1`, [me]);
  const key = await withKeyAndNote(pg, me);
  return { me, key };
}
const app = (pg: PGlite, me: string, sql: string, params: unknown[] = []) =>
  asUser<any>(pg, me, sql, params, { "request.headers": JSON.stringify({ "x-pane-device": "iPhone", "x-amber-client": "lock-aware/1 e2ee/1" }) });
async function withKeyAndNote(pg: PGlite, me: string): Promise<string> {
  const key = hex(8);
  await app(pg, me, `select * from public.create_account_key($1, $2, $3, $4)`, [key, hex(32), box(key), 0]);
  await app(pg, me, `insert into public.notes (id, head_ct, body_ct) values ($1, $2, $3)`, [crypto.randomUUID(), box(key), box(key)]);
  return key;
}
const startFresh = (pg: PGlite, me: string, key: string) =>
  asUser<any>(pg, me, `select public.start_fresh($1) as done`, [key],
    { "request.jwt.claims": JSON.stringify({ sub: me, role: "authenticated", amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) - 30 }] }) });
const notes = async (pg: PGlite, me: string) => (await pg.query<{ n: number }>(`select count(*)::int as n from public.notes where user_id = $1`, [me])).rows[0].n;
const paused = async (pg: PGlite, me: string) => {
  const until = await deletePausedUntil(sqlFor(pg), me);
  if (until) assert(Math.abs(new Date(until).getTime() - (Date.now() + 72 * 3600_000)) < 60_000, `72 hours from now: ${until}`);
  return until !== null;
};

Deno.test("a new account confirmed with the emailed code can delete itself and start fresh at once", async () => {
  const pg = await schemaDB();
  const me = await signedUp(pg);
  await confirmWithCode(pg, me);
  assertEquals(await paused(pg, me), false, "Delete Account is open");
  const key = await withKeyAndNote(pg, me);
  assertEquals((await startFresh(pg, me, key))[0].done, true);
  assertEquals(await notes(pg, me), 0);
});

Deno.test("the code typed days after signing up is still the sign-up's confirmation", async () => {
  const pg = await schemaDB();
  const me = await signedUp(pg, "5 days");
  await confirmWithCode(pg, me);
  assertEquals(await paused(pg, me), false);
});

Deno.test("an existing account: a completed password reset pauses Delete Account and Start fresh", async () => {
  const pg = await schemaDB();
  const { me, key } = await existing(pg);
  assertEquals(await paused(pg, me), false);
  // The reset link is opened (a session by `otp`), then the new password is saved.
  await session(pg, me, "otp");
  assertEquals(await paused(pg, me), true, "the link alone already pauses");
  await pg.query(`delete from public.account_recoveries where user_id = $1`, [me]);
  await pg.query(`update auth.users set encrypted_password = 'new hash' where id = $1`, [me]);
  assertEquals(await paused(pg, me), true, "and so does the new password");
  const err = await assertRejects(() => startFresh(pg, me, key)) as { message: string; hint?: string };
  assertStringIncludes(err.message, "paused for 72 hours after a password reset");
  assertEquals([err.hint, await notes(pg, me)], ["paused_after_reset", 1]);
});

for (const method of ["otp", "magiclink", "recovery"]) {
  Deno.test(`an existing account: signing in by emailed code or link (${method}) pauses Delete Account and Start fresh`, async () => {
    const pg = await schemaDB();
    const { me, key } = await existing(pg);
    await session(pg, me, method);
    assertEquals(await paused(pg, me), true);
    await assertRejects(() => startFresh(pg, me, key));
    assertEquals(await notes(pg, me), 1);
  });
}

Deno.test("someone in the mailbox can't skip the pause on an existing account", async () => {
  const pg = await schemaDB();
  // Signed out everywhere, so the emailed sign-in makes the account's only session: still paused,
  // because the address was confirmed long ago and nothing they can ask for confirms it again.
  const quiet = await existing(pg);
  await pg.query(`delete from auth.sessions where user_id = $1`, [quiet.me]);
  await session(pg, quiet.me, "otp");
  assertEquals(await paused(pg, quiet.me), true, "no other session");
  // An account that signed up minutes ago and is in use on a device: an emailed sign-in from
  // somewhere else is not its sign-up, and pauses.
  const fresh = await signedUp(pg);
  await confirmWithCode(pg, fresh);
  await withKeyAndNote(pg, fresh);
  assertEquals(await paused(pg, fresh), false);
  await session(pg, fresh, "otp");
  assertEquals(await paused(pg, fresh), true, "a second session by emailed code");
  // Three minutes after the code, signed out and in again by emailed code: paused.
  const later = await signedUp(pg);
  const first = await confirmWithCode(pg, later);
  await pg.query(`delete from auth.sessions where id = $1`, [first]);
  await pg.query(`update auth.users set email_confirmed_at = now() - interval '3 minutes' where id = $1`, [later]);
  await session(pg, later, "otp");
  assertEquals(await paused(pg, later), true, "the confirmation is over");
  // A password set on a new account is a password change like any other.
  const setter = await signedUp(pg);
  await confirmWithCode(pg, setter);
  await pg.query(`update auth.users set encrypted_password = 'new hash' where id = $1`, [setter]);
  assertEquals(await paused(pg, setter), true, "a password change always pauses");
});

Deno.test("a password or Apple sign-in never pauses, as before", async () => {
  const pg = await schemaDB();
  const { me } = await existing(pg);
  await session(pg, me, "password");
  await session(pg, me, "oauth");
  assertEquals(await paused(pg, me), false);
});

Deno.test("the migration clears pauses recorded at a sign-up, and no others", async () => {
  const pg = await schemaDB();
  const row = (me: string, at: string) => pg.query(`insert into public.account_recoveries (user_id, at) values ($1, ${at})
    on conflict (user_id) do update set at = excluded.at`, [me]);
  // Recorded by the old rule: the pause's moment is the moment the address was confirmed.
  const signUp = await signedUp(pg, "1 hour");
  await pg.query(`update auth.users set email_confirmed_at = now() - interval '1 hour' where id = $1`, [signUp]);
  await row(signUp, "now() - interval '1 hour' + interval '1 second'");
  // A reset on an account confirmed a month ago, and one made two minutes after a sign-up.
  const reset = (await existing(pg)).me;
  await row(reset, "now() - interval '1 hour'");
  const soon = await signedUp(pg, "1 hour");
  await pg.query(`update auth.users set email_confirmed_at = now() - interval '1 hour' where id = $1`, [soon]);
  await row(soon, "now() - interval '58 minutes'");
  const cleanup = (await Deno.readTextFile(new URL("../../migrations/20261009233000_sign_up_code_is_not_a_reset.sql", import.meta.url)))
    .match(/delete from public\.account_recoveries[\s\S]*?;/)![0];
  await pg.exec(cleanup);
  const still = async (me: string) => (await deletePausedUntil(sqlFor(pg), me)) !== null;
  assertEquals([await still(signUp), await still(reset), await still(soon)], [false, true, true]);
});
