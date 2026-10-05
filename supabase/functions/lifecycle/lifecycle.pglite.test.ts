// The lifecycle round against every migration, on an in-process Postgres (PGlite), with a fake
// Resend. Needs no Docker or local stack:
//   deno test -A supabase/functions/lifecycle/lifecycle.pglite.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { schemaDB, sqlFor } from "../mcp/pglite.ts";
import { account, note } from "../mcp/sealed.ts";
import type { Config } from "./logic.ts";
import { type Message, run, type SendResult } from "./run.ts";

const H = 3_600_000, D = 24 * H;
const NOW = new Date();
const at = (ms: number) => new Date(NOW.getTime() + ms);

const cfg = (o: Partial<Config> = {}): Config => ({
  enabled: true, since: at(-60 * D), only: null, resendKey: "re_test", unsubscribeSecret: "u".repeat(40), cronSecret: "c".repeat(40),
  from: "Emil at Amber Notes <emil@ambernotes.app>", replyTo: "emil@ambernotes.app", site: "https://ambernotes.app", ...o,
});

/// A fake Resend that remembers what it was given.
function outbox(answer: (m: Message) => SendResult = () => ({ ok: true, id: crypto.randomUUID() })) {
  const sent: Message[] = [];
  return { sent, send: async (m: Message) => { sent.push(m); return answer(m); } };
}

async function person(pg: PGlite, o: { age: number; notes?: number; ai?: boolean; aiEdit?: boolean; history?: boolean }) {
  const a = await account(pg);
  await pg.query(`update auth.users set created_at = $2 where id = $1`, [a.id, at(-o.age)]);
  for (let i = 0; i < (o.notes ?? 0); i++) await note(pg, a, `Note ${i}\n\nSomething private.`);
  if (o.ai) await pg.query(`insert into public.mcp_tokens (user_id, name, token_hash) values ($1, 'ChatGPT', $2)`, [a.id, crypto.randomUUID()]);
  if (o.aiEdit) await pg.query(`insert into public.pane_activity (user_id, day, kind, n) values ($1, current_date, 'ai_edit', 1)`, [a.id]);
  if (o.history) await pg.query(`insert into public.pane_feature_use (user_id, feature) values ($1, 'versionHistory')`, [a.id]);
  const email = (await pg.query<{ email: string }>(`select email from auth.users where id = $1`, [a.id])).rows[0].email;
  return { id: a.id, email, account: a };
}

const rows = async (pg: PGlite) => (await pg.query<{ user_id: string; kind: string; status: string }>(`select user_id, kind, status from public.email_sends order by id`)).rows;
const quick = { pause: async () => {} };

Deno.test("kill switch off: a round sends nothing and writes nothing, only counts", async () => {
  const pg = await schemaDB();
  await person(pg, { age: 2 * D, notes: 1 });
  await person(pg, { age: 2 * D });
  const box = outbox();
  const report = await run({ sql: sqlFor(pg), send: box.send, cfg: cfg({ enabled: false }), ...quick });
  assertEquals(box.sent.length, 0);
  assertEquals(await rows(pg), []);
  assertEquals(report.due, { ai_groceries: 1, stuck: 1 });
  assertEquals(report.sent, 0);
});

Deno.test("never sends twice: a second round, and two rounds at once, send each email once", async () => {
  const pg = await schemaDB();
  const sara = await person(pg, { age: 2 * D, notes: 2 });
  const box = outbox();
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick });
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick });
  await Promise.all([1, 2, 3].map(() => run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick })));
  assertEquals(box.sent.length, 1);
  assertEquals(box.sent[0].to, sara.email);
  assertEquals(box.sent[0].idempotencyKey, `lifecycle-ai_groceries-${sara.id}`);
  assertEquals((await rows(pg)).map((r) => [r.kind, r.status]), [["ai_groceries", "sent"]]);
  // Even a row from long ago keeps that email from going again.
  await pg.query(`update public.email_sends set created_at = now() - interval '20 days'`);
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), now: at(1 * D), ...quick });
  assertEquals(box.sent.filter((m) => m.subject === box.sent[0].subject).length, 1);
});

Deno.test("stops when its goal is met: no AI use cases once an AI is connected, then templates and Undo", async () => {
  const pg = await schemaDB();
  const done = await person(pg, { age: 2 * D, notes: 1 });
  await pg.query(`insert into public.mcp_tokens (user_id, name, token_hash, created_at) values ($1, 'ChatGPT', $2, now() - interval '30 hours')`, [done.id, crypto.randomUUID()]);
  const box = outbox();
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick });
  assertEquals(box.sent.map((m) => m.subject), ["Three notes your AI can keep for you"]);
  // The AI edits on three days: no more templates goal; a week on, Undo. Once history is opened, nothing.
  await pg.query(`insert into public.pane_activity (user_id, day, kind, n) select $1, current_date - g, 'ai_edit', 1 from generate_series(0, 2) g`, [done.id]);
  await pg.query(`update public.email_sends set created_at = created_at - interval '8 days'`);
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), now: at(1 * D), ...quick });
  assertEquals(box.sent.map((m) => m.subject), ["Three notes your AI can keep for you", "Every AI edit comes with Undo"]);
});

Deno.test("an account that connects mid-series gets no more use cases", async () => {
  const pg = await schemaDB();
  const a = await person(pg, { age: 1 * D, notes: 2 });
  const box = outbox();
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick });
  assertEquals(box.sent.map((m) => m.subject), ["Your grocery list, kept by ChatGPT"] );
  await pg.query(`insert into public.mcp_tokens (user_id, name, token_hash) values ($1, 'Claude', $2)`, [a.id, crypto.randomUUID()]);
  await pg.query(`update public.email_sends set created_at = created_at - interval '8 days'`);
  const report = await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick });
  assertEquals([box.sent.length, report.due], [1, {}]);
});

Deno.test("an imported library of many notes starts with the sorting email, with its number", async () => {
  const pg = await schemaDB();
  const a = await person(pg, { age: 1 * D, notes: 21 });
  const box = outbox();
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick });
  assertEquals(box.sent.map((m) => m.subject), ["Let ChatGPT sort your notes into folders"]);
  assertStringIncludes(box.sent[0].text, "21 notes");
  assertEquals(box.sent[0].to, a.email);
});

Deno.test("the stuck email goes to an account with no note after a day, and not once a note has arrived", async () => {
  const pg = await schemaDB();
  const empty = await person(pg, { age: 30 * H });
  const started = await person(pg, { age: 30 * H });
  await note(pg, started.account, "First note");
  const box = outbox();
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick });
  // The account with a note gets the next step instead.
  assertEquals(box.sent.map((m) => [m.to, m.subject]).sort(), [
    [empty.email, "Did something go wrong after signing in?"],
    [started.email, "Your grocery list, kept by ChatGPT"],
  ].sort());
});

Deno.test("respects unsubscribe: nothing after it, from the link or the header", async () => {
  const pg = await schemaDB();
  const a = await person(pg, { age: 2 * D, notes: 1 });
  const b = await person(pg, { age: 2 * D });
  await pg.query(`insert into public.email_unsubscribes (user_id, source) values ($1, 'link'), ($2, 'header')`, [a.id, b.id]);
  const box = outbox();
  const report = await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick });
  assertEquals(box.sent.length, 0);
  assertEquals(report.due, {});
});

Deno.test("one email a week: the second use case waits for the gap, then goes", async () => {
  const pg = await schemaDB();
  await person(pg, { age: 1 * D, notes: 1 });
  const box = outbox();
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick });
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), now: at(2 * D), ...quick });
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), now: at(6 * D + 23 * H), ...quick });
  assertEquals(box.sent.map((m) => m.subject), ["Your grocery list, kept by ChatGPT"]);
  await pg.query(`update public.email_sends set created_at = created_at - interval '7 days 1 minute'`);
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), now: at(7 * D), ...quick });
  assertEquals(box.sent.map((m) => m.subject), ["Your grocery list, kept by ChatGPT", "Turn a messy note into a to-do list"]);
});

Deno.test("accounts made before LIFECYCLE_SINCE, and accounts not on LIFECYCLE_ONLY, get nothing", async () => {
  const pg = await schemaDB();
  await person(pg, { age: 2 * D, notes: 1 });
  const box = outbox();
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg({ since: at(-1 * D) }), ...quick });
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg({ only: new Set(["00000000-0000-0000-0000-000000000000"]) }), ...quick });
  assertEquals(box.sent.length, 0);
});

Deno.test("each email carries an unsubscribe link and the one-click headers", async () => {
  const pg = await schemaDB();
  const a = await person(pg, { age: 2 * D, notes: 1 });
  const box = outbox();
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick });
  const m = box.sent[0];
  assertEquals(m.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert(m.headers["List-Unsubscribe"].startsWith(`<https://ambernotes.app/unsubscribe/confirm?u=${a.id}&t=`));
  assertStringIncludes(m.text, `https://ambernotes.app/unsubscribe?u=${a.id}&t=`);
  assertEquals(m.reply_to, "emil@ambernotes.app");
});

Deno.test("a refused send is kept and never retried; 'too many requests' is retried next round", async () => {
  const pg = await schemaDB();
  await person(pg, { age: 2 * D, notes: 1 });
  const refused = outbox(() => ({ ok: false, status: 422 }));
  await run({ sql: sqlFor(pg), send: refused.send, cfg: cfg(), ...quick });
  await run({ sql: sqlFor(pg), send: refused.send, cfg: cfg(), ...quick });
  assertEquals(refused.sent.length, 1);
  assertEquals((await rows(pg)).map((r) => r.status), ["failed"]);

  const pg2 = await schemaDB();
  await person(pg2, { age: 2 * D, notes: 1 });
  let first = true;
  const busy = outbox(() => { const r = first ? { ok: false as const, status: 429 } : { ok: true as const, id: "re_1" }; first = false; return r; });
  const r1 = await run({ sql: sqlFor(pg2), send: busy.send, cfg: cfg(), ...quick });
  assertEquals([r1.deferred, (await rows(pg2)).length], [1, 0]);
  await run({ sql: sqlFor(pg2), send: busy.send, cfg: cfg(), ...quick });
  assertEquals((await rows(pg2)).map((r) => r.status), ["sent"]);
  assertEquals(busy.sent.length, 2);
});

Deno.test("the decision reads activity only: lifecycle_facts never touches a note's text", async () => {
  const pg = await schemaDB();
  const def = (await pg.query<{ d: string }>(`select pg_get_functiondef('public.lifecycle_facts(timestamptz)'::regprocedure) as d`)).rows[0].d;
  for (const column of ["body", "title", "head_ct", "body_ct", "locked_body", "name"]) assert(!new RegExp(`\\b${column}\\b`).test(def), column);
});

Deno.test("deleting an account deletes its email rows", async () => {
  const pg = await schemaDB();
  const a = await person(pg, { age: 2 * D, notes: 1 });
  await run({ sql: sqlFor(pg), send: outbox().send, cfg: cfg(), ...quick });
  await pg.query(`insert into public.email_unsubscribes (user_id, source) values ($1, 'link')`, [a.id]);
  await pg.query(`delete from auth.users where id = $1`, [a.id]);
  assertEquals(await rows(pg), []);
  assertEquals((await pg.query(`select * from public.email_unsubscribes`)).rows, []);
});

Deno.test("clients can't read or write the email tables", async () => {
  const pg = await schemaDB();
  for (const table of ["email_sends", "email_unsubscribes"]) {
    for (const role of ["anon", "authenticated"]) {
      const ok = (await pg.query<{ ok: boolean }>(`select has_table_privilege($1, $2, 'select') or has_table_privilege($1, $2, 'insert') as ok`, [role, `public.${table}`])).rows[0].ok;
      assertEquals(ok, false, `${role} on ${table}`);
    }
  }
  for (const fn of ["public.lifecycle_facts(timestamptz)", "public.lifecycle_tick()"]) {
    for (const role of ["anon", "authenticated"]) {
      const ok = (await pg.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn])).rows[0].ok;
      assertEquals(ok, false, `${role} on ${fn}`);
    }
  }
});

Deno.test("lifecycle_tick does nothing without pg_net and the vault", async () => {
  const pg = await schemaDB();
  await pg.query(`select public.lifecycle_tick()`);
});
