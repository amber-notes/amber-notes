// The lifecycle round against every migration, on an in-process Postgres (PGlite), with a fake
// Resend. Needs no Docker or local stack:
//   deno test -A supabase/functions/lifecycle/lifecycle.pglite.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { schemaDB, sqlFor } from "../mcp/pglite.ts";
import { account, note } from "../mcp/sealed.ts";
import { type Config, variantOf } from "./logic.ts";
import { type Message, recordClick, run, type SendResult, stats, welcome } from "./run.ts";

const H = 3_600_000, D = 24 * H;
const NOW = new Date();
const at = (ms: number) => new Date(NOW.getTime() + ms);

const cfg = (o: Partial<Config> = {}): Config => ({
  enabled: true, flags: { apps: false, appStore: false, sharing: false }, subjectTest: false, trackClicks: false, since: at(-60 * D), only: null, resendKey: "re_test", unsubscribeSecret: "u".repeat(40), cronSecret: "c".repeat(40),
  from: "Emil at Pinto Notes <emil@pintonotes.com>", replyTo: "emil@pintonotes.com", site: "https://pintonotes.com", open: "https://ambernotes.app", subjectPrefix: "", manualRounds: false, ...o,
});

/// A fake Resend that remembers what it was given.
function outbox(answer: (m: Message) => SendResult = () => ({ ok: true, id: crypto.randomUUID() })) {
  const sent: Message[] = [];
  return { sent, send: async (m: Message) => { sent.push(m); return answer(m); } };
}

type Person = { age: number; /** ms ago the email was confirmed; null: not confirmed (the default: at sign-up) */ confirmed?: number | null; notes?: number; mac?: boolean; iphone?: boolean; imported?: boolean; ai?: number; aiEdit?: boolean; history?: boolean; template?: boolean };

/// An account `age` ms old, with what it has done. `ai` is how long ago an AI was connected.
async function person(pg: PGlite, o: Person) {
  const a = await account(pg);
  await pg.query(`update auth.users set created_at = $2, email_confirmed_at = $3 where id = $1`,
    [a.id, at(-o.age), o.confirmed === null ? null : at(-(o.confirmed ?? o.age))]);
  for (let i = 0; i < (o.notes ?? 0); i++) await note(pg, a, `Note ${i}\n\nSomething private.`);
  if (o.mac) await pg.query(`insert into public.pane_devices (user_id, device_id, platform) values ($1, gen_random_uuid(), 'macos')`, [a.id]);
  if (o.iphone) await pg.query(`insert into public.pane_devices (user_id, device_id, platform) values ($1, gen_random_uuid(), 'ios')`, [a.id]);
  if (o.imported) await pg.query(`insert into public.pane_setup (user_id, imported_at) values ($1, now())`, [a.id]);
  if (o.ai !== undefined) await pg.query(`insert into public.mcp_tokens (user_id, name, token_hash, created_at) values ($1, 'ChatGPT', $2, $3)`, [a.id, crypto.randomUUID(), at(-o.ai)]);
  if (o.aiEdit) await pg.query(`insert into public.pane_activity (user_id, day, kind, n) values ($1, current_date, 'ai_edit', 1)`, [a.id]);
  if (o.history) await pg.query(`insert into public.pane_feature_use (user_id, feature) values ($1, 'versionHistory')`, [a.id]);
  if (o.template) await pg.query(`insert into public.pane_feature_use (user_id, feature) values ($1, 'template')`, [a.id]);
  const email = (await pg.query<{ email: string }>(`select email from auth.users where id = $1`, [a.id])).rows[0].email;
  return { id: a.id, email, account: a };
}

const rows = async (pg: PGlite) => (await pg.query<{ user_id: string; kind: string; status: string }>(`select user_id, kind, status from public.email_sends order by id`)).rows;
const quick = { pause: async () => {}, anyHour: true };
const kinds = (box: { sent: Message[] }) => box.sent.map((m) => m.subject);
/// Moves every email row back in time, as if the days between rounds had passed.
const age = (pg: PGlite, days: number) => pg.query(`update public.email_sends set created_at = created_at - make_interval(days => $1)`, [days]);

const S = {
  stuck: "Did something go wrong after signing in?",
  import: "Bring your Apple Notes over",
  connect: "Your grocery list, kept by ChatGPT",
  try: "Three things to ask your AI first",
  undo: "Every AI edit comes with Undo",
  templates: "Three notes your AI can keep for you",
};

Deno.test("kill switch off: a round sends nothing and writes nothing, only counts", async () => {
  const pg = await schemaDB();
  await person(pg, { age: 2 * D, notes: 1, mac: true });
  await person(pg, { age: 2 * D });
  const box = outbox();
  const report = await run({ sql: sqlFor(pg), send: box.send, cfg: cfg({ enabled: false }), ...quick });
  assertEquals(box.sent.length, 0);
  assertEquals(await rows(pg), []);
  assertEquals(report.due, { import: 1, stuck: 1 });
  assertEquals(report.sent, 0);
});

Deno.test("never sends twice: a second round, and rounds at once, send each email once", async () => {
  const pg = await schemaDB();
  const sara = await person(pg, { age: 2 * D, notes: 2, mac: true });
  const box = outbox();
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick });
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick });
  await Promise.all([1, 2, 3].map(() => run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick })));
  assertEquals(kinds(box), [S.import]);
  assertEquals(box.sent[0].to, sara.email);
  assertEquals(box.sent[0].idempotencyKey, `lifecycle-import-${sara.id}`);
  // Even long after, the same rung is never sent again: the next round moves up the ladder.
  await age(pg, 20);
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick });
  assertEquals(kinds(box), [S.import, S.connect]);
});

/// The app opened on the account's Mac just now: a sign of life after the emails so far.
const openApp = (pg: PGlite, id: string) => pg.query(`update public.pane_devices set last_seen = clock_timestamp() where user_id = $1`, [id]);

Deno.test("the ladder, a Mac account that keeps opening the app: stuck, import, connect, templates, 3 days apart", async () => {
  const pg = await schemaDB();
  const a = await person(pg, { age: 26 * H, mac: true });
  const box = outbox();
  const round = async (now = NOW) => await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), now, ...quick });
  await round();
  await round(at(2 * D));
  assertEquals(kinds(box), [S.stuck]);
  await note(pg, a.account, "First");
  await round(at(3 * D + H));
  assertEquals(kinds(box), [S.stuck, S.import]);
  await openApp(pg, a.id);
  await round(at(6 * D + 2 * H));
  assertEquals(kinds(box), [S.stuck, S.import, S.connect]);
  await openApp(pg, a.id);
  await round(at(9 * D + 3 * H));
  assertEquals(kinds(box), [S.stuck, S.import, S.connect, S.templates]);
});

Deno.test("silence: an account that never comes back gets two emails, then nothing", async () => {
  const pg = await schemaDB();
  await person(pg, { age: 2 * D, notes: 1, mac: true });
  const box = outbox();
  for (const d of [0, 3, 7, 8, 15, 22]) await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), now: at(d * D + H), ...quick });
  // The first goes; the second waits the long gap (not 3 days); then it stops.
  assertEquals(kinds(box), [S.import, S.connect]);
});

Deno.test("silence: an account that comes back picks up the ladder with the normal gaps", async () => {
  const pg = await schemaDB();
  const a = await person(pg, { age: 2 * D, notes: 1, mac: true });
  const box = outbox();
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), now: at(H), ...quick });
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), now: at(7 * D + 2 * H), ...quick });
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), now: at(14 * D + 3 * H), ...quick });
  assertEquals(box.sent.length, 2);
  await openApp(pg, a.id);
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), now: at(17 * D + 4 * H), ...quick });
  assertEquals(kinds(box), [S.import, S.connect, S.templates]);
});

Deno.test("silence: a click counts as coming back, so a reader who clicks keeps getting the ladder", async () => {
  const pg = await schemaDB();
  await person(pg, { age: 2 * D, notes: 1, mac: true });
  const box = outbox();
  const clickLast = async () => {
    const [row] = (await pg.query<{ id: number }>(`select id from public.email_sends order by id desc limit 1`)).rows;
    await recordClick(sqlFor(pg), Number(row.id), "https://ambernotes.app/open/import");
  };
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), now: at(H), ...quick });
  await clickLast();
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), now: at(3 * D + 2 * H), ...quick });
  await clickLast();
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), now: at(6 * D + 3 * H), ...quick });
  assertEquals(kinds(box), [S.import, S.connect, S.templates]);
});

Deno.test("stops at the goal: connecting skips connect; the first AI edit skips Try this first", async () => {
  const pg = await schemaDB();
  const a = await person(pg, { age: 2 * D, notes: 6, ai: 30 * H });
  const box = outbox();
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick });
  assertEquals(kinds(box), [S.try]);
  await pg.query(`insert into public.pane_activity (user_id, day, kind, n) values ($1, current_date, 'ai_edit', 1)`, [a.id]);
  await age(pg, 3);
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick });
  assertEquals(kinds(box), [S.try, S.undo]);
  await pg.query(`insert into public.pane_feature_use (user_id, feature) values ($1, 'versionHistory'), ($1, 'template')`, [a.id]);
  await age(pg, 3);
  const report = await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), now: at(2 * D), ...quick });
  assertEquals([box.sent.length, report.due], [2, {}]);
});

Deno.test("flags: the apps email waits for APPS_LIVE", async () => {
  const pg = await schemaDB();
  await person(pg, { age: 4 * D, notes: 6, ai: 3 * D, aiEdit: true, history: true, template: true });
  const off = outbox(), on = outbox();
  await run({ sql: sqlFor(pg), send: off.send, cfg: cfg(), ...quick });
  assertEquals(off.sent.length, 0);
  await run({ sql: sqlFor(pg), send: on.send, cfg: cfg({ flags: { apps: true, appStore: false, sharing: false } }), ...quick });
  assertEquals(kinds(on), ["Your notes can be apps"]);
});

Deno.test("at most 6 emails, even with every rung open", async () => {
  const pg = await schemaDB();
  const a = await person(pg, { age: 25 * D, notes: 1, mac: true, ai: 20 * D });
  await pg.query(`insert into public.email_sends (user_id, kind, status, created_at) select $1, k, 'sent', now() - interval '20 days'
    from unnest(array['stuck', 'import', 'connect', 'try', 'apps', 'iphone']) k`, [a.id]);
  const box = outbox();
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg({ flags: { apps: true, appStore: true, sharing: true } }), ...quick });
  assertEquals(box.sent.length, 0);
});

Deno.test("a big library mostly in one place gets the sorting example, with no number", async () => {
  const pg = await schemaDB();
  await person(pg, { age: 1 * D, notes: 21, imported: true });
  const box = outbox();
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick });
  assertEquals(kinds(box), ["Let ChatGPT sort your notes into folders"]);
  assert(!/\b21\b/.test(box.sent[0].subject + box.sent[0].text.split("--")[0].replace(/https:\S+/g, "")));
});

Deno.test("send time: an hourly round only sends where it's 9 in the morning", async () => {
  const pg = await schemaDB();
  const a = await person(pg, { age: 2 * D, notes: 6 });
  const box = outbox();
  const at10utc = new Date(NOW); at10utc.setUTCHours(10, 0, 0, 0);
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), now: at10utc, pause: quick.pause });
  assertEquals(box.sent.length, 0);
  await pg.query(`insert into public.pane_devices (user_id, device_id, platform, utc_offset_minutes) values ($1, gen_random_uuid(), 'ios', -60)`, [a.id]);
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), now: at10utc, pause: quick.pause });
  assertEquals(box.sent.length, 1);
});

Deno.test("measurement: the subject variant is kept, links go through /go, clicks and steps done are counted", async () => {
  const pg = await schemaDB();
  const a = await person(pg, { age: 2 * D, notes: 6 });
  const box = outbox();
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg({ subjectTest: true, trackClicks: true }), ...quick });
  const m = box.sent[0];
  const [row] = (await pg.query<{ id: number; variant: number }>(`select id, variant from public.email_sends`)).rows;
  assertEquals(row.variant, variantOf(a.id));
  const goes = [...m.html.matchAll(/href="(https:\/\/pintonotes\.com\/go\?[^"]+)"/g)];
  assert(goes.length >= 1, "links are counted");
  assertStringIncludes(m.html, "/unsubscribe?u=");
  assert(!/\/go\?[^"]*unsubscribe/.test(m.html), "the unsubscribe link isn't wrapped");
  assertEquals(await recordClick(sqlFor(pg), Number(row.id), "https://pintonotes.com/blog/connect-chatgpt-to-your-notes?x=1"), true);
  assertEquals((await pg.query<{ link: string }>(`select link from public.email_clicks`)).rows[0].link, "pintonotes.com/blog/connect-chatgpt-to-your-notes");
  await pg.query(`insert into public.mcp_tokens (user_id, name, token_hash) values ($1, 'Claude', $2)`, [a.id, crypto.randomUUID()]);
  assertEquals(await stats(sqlFor(pg)), [{ kind: "connect", variant: variantOf(a.id), sent: 1, clicked: 1, done: 1 }]);
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

Deno.test("accounts made before LIFECYCLE_SINCE, and accounts not on LIFECYCLE_ONLY, get nothing", async () => {
  const pg = await schemaDB();
  await person(pg, { age: 2 * D, notes: 1 });
  const box = outbox();
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg({ since: at(-1 * D) }), ...quick });
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg({ only: new Set(["00000000-0000-0000-0000-000000000000"]) }), ...quick });
  assertEquals(box.sent.length, 0);
});

Deno.test("the apps can now record a template added and an app made", async () => {
  const pg = await schemaDB();
  const a = await person(pg, { age: 1 * D });
  await pg.query(`insert into public.pane_feature_use (user_id, feature) values ($1, 'template'), ($1, 'appNote')`, [a.id]);
});

Deno.test("each email carries an unsubscribe link and the one-click headers", async () => {
  const pg = await schemaDB();
  const a = await person(pg, { age: 2 * D, notes: 1 });
  const box = outbox();
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick });
  const m = box.sent[0];
  assertEquals(m.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert(m.headers["List-Unsubscribe"].startsWith(`<https://pintonotes.com/unsubscribe/confirm?u=${a.id}&t=`));
  assertStringIncludes(m.text, `https://pintonotes.com/unsubscribe?u=${a.id}&t=`);
  assertEquals(m.reply_to, "emil@pintonotes.com");
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
  for (const table of ["email_sends", "email_unsubscribes", "email_replies", "email_clicks"]) {
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

Deno.test("staging: subjects carry the prefix and links open the staging site", async () => {
  const pg = await schemaDB();
  await person(pg, { age: 2 * D, notes: 1, mac: true });
  const box = outbox();
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg({ site: "https://amber-notes-staging.vercel.app", open: "https://amber-notes-staging.vercel.app", subjectPrefix: "[Staging] " }), ...quick });
  assertEquals(kinds(box), [`[Staging] ${S.import}`]);
  assert(box.sent[0].html.includes("https://amber-notes-staging.vercel.app/open/import"));
  assert(!box.sent[0].html.includes("https://ambernotes.app/open/"));
  assert(box.sent[0].headers["List-Unsubscribe"].startsWith("<https://amber-notes-staging.vercel.app/unsubscribe/confirm?"));
});

const MIN = 60_000;

Deno.test("welcome: once, a couple of minutes after sign-up, by any sign-up, never after an unsubscribe", async () => {
  const pg = await schemaDB();
  const sara = await person(pg, { age: 5 * MIN, iphone: true });
  const early = await person(pg, { age: 1 * MIN });
  const late = await person(pg, { age: 2 * H });
  const gone = await person(pg, { age: 5 * MIN });
  await pg.query(`insert into public.email_unsubscribes (user_id, source) values ($1, 'link')`, [gone.id]);
  const box = outbox();
  await welcome({ sql: sqlFor(pg), send: box.send, cfg: cfg(), pause: async () => {} });
  await welcome({ sql: sqlFor(pg), send: box.send, cfg: cfg(), pause: async () => {} });
  await Promise.all([1, 2, 3].map(() => welcome({ sql: sqlFor(pg), send: box.send, cfg: cfg(), pause: async () => {} })));
  assertEquals(box.sent.map((m) => m.to), [sara.email]);
  assertEquals(box.sent[0].subject, "Welcome to Pinto Notes");
  assertEquals(box.sent[0].idempotencyKey, `lifecycle-welcome-${sara.id}`);
  assertStringIncludes(box.sent[0].html, "https://ambernotes.app/open/connect-ai");
  assert(box.sent[0].headers["List-Unsubscribe"]);
  assertEquals((await rows(pg)).map((r) => [r.user_id, r.kind, r.status]), [[sara.id, "welcome", "sent"]]);
  assert(![early.id, late.id, gone.id].some((id) => box.sent.some((m) => m.idempotencyKey.endsWith(id))));
});

Deno.test("welcome: an account that connected its AI while signing up is told to get the app", async () => {
  const pg = await schemaDB();
  await person(pg, { age: 4 * MIN, ai: 2 * MIN });
  const box = outbox();
  await welcome({ sql: sqlFor(pg), send: box.send, cfg: cfg(), pause: async () => {} });
  assertStringIncludes(box.sent[0].html, "https://pintonotes.com/download");
});

Deno.test("welcome: off with the kill switch, and only for LIFECYCLE_ONLY accounts when it's set", async () => {
  const pg = await schemaDB();
  const a = await person(pg, { age: 5 * MIN });
  const b = await person(pg, { age: 5 * MIN });
  const box = outbox();
  const report = await welcome({ sql: sqlFor(pg), send: box.send, cfg: cfg({ enabled: false }), pause: async () => {} });
  assertEquals([box.sent.length, report.due.welcome], [0, 2]);
  await welcome({ sql: sqlFor(pg), send: box.send, cfg: cfg({ only: new Set([b.id]) }), pause: async () => {} });
  assertEquals(box.sent.map((m) => m.to), [b.email]);
  assert(a.id !== b.id);
});

Deno.test("welcome and the ladder: an unanswered welcome isn't part of the silence, and the ladder starts on day 3", async () => {
  const pg = await schemaDB();
  const sara = await person(pg, { age: 5 * MIN });
  const box = outbox();
  await welcome({ sql: sqlFor(pg), send: box.send, cfg: cfg(), pause: async () => {} });
  const facts = async () => (await pg.query<{ sent_since_active: number; sent: string[] }>(
    `select sent_since_active, sent from public.lifecycle_facts($1) where user_id = $2`, [at(-60 * D), sara.id])).rows[0];
  assertEquals((await facts()).sent_since_active, 0);
  assertEquals((await facts()).sent, ["welcome"]);
  // A day later: the stuck rung is ready, but the gap after the welcome holds it.
  await pg.query(`update auth.users set created_at = $2, email_confirmed_at = $2 where id = $1`, [sara.id, at(-1 * D - H)]);
  await age(pg, 1);
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick });
  assertEquals(box.sent.length, 1);
  // Day 3: the ladder's first email.
  await pg.query(`update auth.users set created_at = $2, email_confirmed_at = $2 where id = $1`, [sara.id, at(-3 * D - H)]);
  await age(pg, 2);
  await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick });
  assertEquals(box.sent.map((m) => m.subject), ["Welcome to Pinto Notes", S.stuck]);
});

Deno.test("lifecycle_welcome_tick does nothing without a waiting account, pg_net or the vault", async () => {
  const pg = await schemaDB();
  await pg.query(`select public.lifecycle_welcome_tick()`);
  await person(pg, { age: 5 * MIN });
  await pg.query(`select public.lifecycle_welcome_tick()`);
});

Deno.test("email confirmation: no welcome or ladder email before the code is typed; the welcome follows the code", async () => {
  const pg = await schemaDB();
  const waiting = await person(pg, { age: 5 * MIN, confirmed: null });
  const stale = await person(pg, { age: 2 * D, notes: 1, mac: true, confirmed: null });
  const box = outbox();
  const welcomed = await welcome({ sql: sqlFor(pg), send: box.send, cfg: cfg(), pause: async () => {} });
  const laddered = await run({ sql: sqlFor(pg), send: box.send, cfg: cfg(), ...quick });
  assertEquals([box.sent.length, welcomed.accounts, laddered.accounts], [0, 0, 0]);
  assertEquals(await rows(pg), []);

  // Confirmed 3 minutes ago, 2 hours after signing up: the welcome counts from the confirmation.
  await pg.query(`update auth.users set created_at = $2, email_confirmed_at = $3 where id = $1`, [waiting.id, at(-2 * H), at(-3 * MIN)]);
  await welcome({ sql: sqlFor(pg), send: box.send, cfg: cfg(), pause: async () => {} });
  assertEquals(box.sent.map((m) => m.to), [waiting.email]);
  assert(!box.sent.some((m) => m.to === stale.email));
});

Deno.test("email confirmation: lifecycle_welcome_tick ignores an account waiting for its code", async () => {
  const pg = await schemaDB();
  await person(pg, { age: 5 * MIN, confirmed: null });
  const due = `select exists (select 1 from auth.users u where u.email_confirmed_at is not null
    and greatest(u.created_at, u.email_confirmed_at) between now() - interval '60 minutes' and now() - interval '2 minutes') as due`;
  assertEquals((await pg.query<{ due: boolean }>(due)).rows[0].due, false);
  await pg.query(`select public.lifecycle_welcome_tick()`);
  const src = (await pg.query<{ src: string }>(`select prosrc as src from pg_proc where proname = 'lifecycle_welcome_tick'`)).rows[0].src;
  assertStringIncludes(src, "u.email_confirmed_at is not null");
});
