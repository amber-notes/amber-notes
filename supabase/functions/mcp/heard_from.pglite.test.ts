// "How did you hear about Amber Notes?" (20261007152000_heard_from.sql) on the whole schema in PGlite.
//   cd supabase/functions/mcp && deno test -A heard_from.pglite.test.ts
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { asUser, newUser, schemaDB } from "./pglite.ts";

const ask = async (pg: PGlite, me: string) => (await asUser<any>(pg, me, `select public.pane_heard_from_state() as s`))[0].s.ask as boolean;
const answer = (pg: PGlite, me: string, source: string, detail: string | null = null) =>
  asUser(pg, me, `select public.pane_heard_from_answer($1, $2)`, [source, detail]);
const row = async (pg: PGlite, me: string) => (await pg.query<any>(`select source, detail from public.pane_heard_from where user_id = $1`, [me])).rows;

Deno.test("a new account is asked once; an answer or a skip ends it on every device", async () => {
  const pg = await schemaDB();
  const me = await newUser(pg);
  assertEquals(await ask(pg, me), true);
  await answer(pg, me, "tiktok");
  assertEquals(await ask(pg, me), false);
  await answer(pg, me, "google");
  assertEquals(await row(pg, me), [{ source: "tiktok", detail: null }], "the first answer stands");

  const skipper = await newUser(pg);
  await answer(pg, skipper, "skipped");
  assertEquals(await ask(pg, skipper), false);
});

Deno.test("accounts made before the question existed are never asked", async () => {
  const pg = await schemaDB();
  const old = await newUser(pg);
  await pg.query(`update auth.users set created_at = now() - interval '8 days' where id = $1`, [old]);
  assertEquals(await ask(pg, old), false);
});

Deno.test("the words are kept only with Something else, trimmed and cut to 120 characters", async () => {
  const pg = await schemaDB();
  const a = await newUser(pg), b = await newUser(pg), c = await newUser(pg);
  await answer(pg, a, "other", "  a newsletter  ");
  await answer(pg, b, "friend", "my sister");
  await answer(pg, c, "other", "x".repeat(300));
  assertEquals(await row(pg, a), [{ source: "other", detail: "a newsletter" }]);
  assertEquals(await row(pg, b), [{ source: "friend", detail: null }]);
  assertEquals((await row(pg, c))[0].detail.length, 120);
});

Deno.test("only the listed sources are taken", async () => {
  const pg = await schemaDB();
  const me = await newUser(pg);
  await assertRejects(() => answer(pg, me, "billboard"));
});

Deno.test("each account sees only its own answer, and nobody signed in can read the totals", async () => {
  const pg = await schemaDB();
  const me = await newUser(pg), them = await newUser(pg);
  await answer(pg, me, "youtube");
  await answer(pg, them, "other", "a podcast");
  assertEquals((await asUser<any>(pg, me, `select source from public.pane_heard_from`)).map((r) => r.source), ["youtube"]);
  await assertRejects(() => asUser(pg, me, `insert into public.pane_heard_from (user_id, source) values ($1, 'google')`, [me]));
  await assertRejects(() => asUser(pg, me, `select * from public.pane_heard_from_summary`));
  await assertRejects(() => asUser(pg, me, `select * from public.pane_heard_from_other`));

  const totals = (await pg.query<any>(`select source, accounts from public.pane_heard_from_summary order by source`)).rows;
  assertEquals(totals, [{ source: "other", accounts: 1 }, { source: "youtube", accounts: 1 }]);
  assertEquals((await pg.query<any>(`select detail from public.pane_heard_from_other`)).rows, [{ detail: "a podcast" }]);
});
