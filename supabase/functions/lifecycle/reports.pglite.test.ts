// The email to support about reports of shared pages, against every migration on an in-process
// Postgres (PGlite), with a fake Resend:
//   deno test -A supabase/functions/lifecycle/reports.pglite.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { schemaDB, sqlFor } from "../mcp/pglite.ts";
import { account, note, share } from "../mcp/sealed.ts";
import { MAX_PAGES, MAX_REPORTS_PER_PAGE, notice, NOTICE_GAP_MINUTES, reportNotices, type ReportRow } from "./reports.ts";
import type { Message, SendResult } from "./run.ts";

const cfg = { site: "https://pintonotes.com", subjectPrefix: "" };

function outbox(answer: (m: Message) => SendResult = () => ({ ok: true, id: crypto.randomUUID() })) {
  const sent: Message[] = [];
  return { sent, send: async (m: Message) => { sent.push(m); return answer(m); } };
}

/// A shared page, as the app makes one.
async function page(pg: PGlite, title = "Groceries") {
  const a = await account(pg);
  const id = await note(pg, a, `${title}\n\nPaella rice`);
  return (await share(pg, a, id, { title, body: `# ${title}` })).slug;
}

const who = (n: number) => n.toString(16).padStart(64, "0");
/// A report, as the site sends one (web/lib/report.ts).
const report = async (pg: PGlite, slug: string, reason: string, reporter = 1, contact: string | null = null) =>
  (await pg.query<{ v: string }>(`select public.report_share($1, $2, $3, $4) as v`, [slug, reason, who(reporter), contact])).rows[0].v;
const told = async (pg: PGlite) => (await pg.query<{ n: number }>(`select count(*)::int as n from public.share_reports where notified_at is not null`)).rows[0].n;
/// As if `minutes` had passed since the last email.
const later = (pg: PGlite, minutes: number) => pg.query(`update public.share_reports set notified_at = notified_at - make_interval(mins => $1) where notified_at is not null`, [minutes]);

Deno.test("a report sends one plain email to support: the page, the time, the reason, how to act, and nothing about who", async () => {
  const pg = await schemaDB();
  const slug = await page(pg);
  assertEquals(await report(pg, slug, "It shows my\nhome address.", 7), "received");
  const box = outbox();
  const r = await reportNotices({ sql: sqlFor(pg), send: box.send, cfg });
  assertEquals(r, { new: 1, pages: 1, sent: true, waiting: false, failed: false });
  const [m] = box.sent;
  assertEquals([m.to, m.from, m.subject], ["hello@pintonotes.com", "Pinto Notes <hello@pintonotes.com>", "A shared page was reported"]);
  assertStringIncludes(m.text, `https://pintonotes.com/n/${slug}`);
  assertStringIncludes(m.text, "It shows my home address.");
  assert(/Reported \d{1,2} [A-Z][a-z]+ \d{4}, \d\d:\d\d UTC/.test(m.text), m.text);
  assertStringIncludes(m.text, "The page is still up. 1 person has reported it");
  assertStringIncludes(m.text, `select public.admin_take_down('${slug}');`);
  assertStringIncludes(m.text, `select public.admin_dismiss_reports('${slug}');`);
  // Not the hash of the reporter's address, and no line about an answer when none was asked for.
  assert(!m.text.includes(who(7)) && !m.html.includes(who(7)));
  assert(!m.text.includes("Wants an answer"));
  assert(!/[–—]/.test(m.subject + m.text));
  assertEquals(await told(pg), 1);
});

Deno.test("the address a reporter left for an answer is passed on, and the reason can't put markup in the email", async () => {
  const pg = await schemaDB();
  const slug = await page(pg);
  await report(pg, slug, `<img src=x onerror=alert(1)> & more`, 1, "sara.lind@example.com");
  const box = outbox();
  await reportNotices({ sql: sqlFor(pg), send: box.send, cfg });
  assertStringIncludes(box.sent[0].text, "Wants an answer at: sara.lind@example.com");
  assertStringIncludes(box.sent[0].html, "&lt;img src=x onerror=alert(1)&gt; &amp; more");
  assert(!box.sent[0].html.includes("<img"));
});

Deno.test("nothing new: no email. Told once: never again, also for rounds at the same moment", async () => {
  const pg = await schemaDB();
  const box = outbox();
  assertEquals((await reportNotices({ sql: sqlFor(pg), send: box.send, cfg })).sent, false);
  const slug = await page(pg);
  await report(pg, slug, "Spam");
  await Promise.all([1, 2, 3].map(() => reportNotices({ sql: sqlFor(pg), send: box.send, cfg })));
  await later(pg, 60);
  await reportNotices({ sql: sqlFor(pg), send: box.send, cfg });
  assertEquals(box.sent.length, 1);
});

Deno.test("a flood is one email every 15 minutes: reports that come in between wait, then go together", async () => {
  const pg = await schemaDB();
  const a = await page(pg, "One"), b = await page(pg, "Two");
  const box = outbox();
  await report(pg, a, "First");
  await reportNotices({ sql: sqlFor(pg), send: box.send, cfg });
  await report(pg, a, "Second", 2);
  await report(pg, b, "Third", 3);
  const wait = await reportNotices({ sql: sqlFor(pg), send: box.send, cfg });
  assertEquals([wait.sent, wait.waiting, wait.new, box.sent.length], [false, true, 2, 1]);
  await later(pg, NOTICE_GAP_MINUTES - 1);
  assertEquals((await reportNotices({ sql: sqlFor(pg), send: box.send, cfg })).waiting, true);
  await later(pg, 2);
  const r = await reportNotices({ sql: sqlFor(pg), send: box.send, cfg });
  assertEquals([r.sent, r.new, r.pages, box.sent.length], [true, 2, 2, 2]);
  assertEquals(box.sent[1].subject, "2 shared pages were reported");
  for (const s of ["Second", "Third", `/n/${a}`, `/n/${b}`, "2 people have reported it"]) assertStringIncludes(box.sent[1].text, s);
  assert(!box.sent[1].text.includes("First"));
  assertEquals(await told(pg), 3);
});

Deno.test("a page three people reported is down, and the email says so", async () => {
  const pg = await schemaDB();
  const slug = await page(pg);
  await report(pg, slug, "One", 1);
  await report(pg, slug, "Two", 2);
  assertEquals(await report(pg, slug, "Three", 3), "taken_down");
  const box = outbox();
  await reportNotices({ sql: sqlFor(pg), send: box.send, cfg });
  assertStringIncludes(box.sent[0].text, "The page is no longer shared");
  assertEquals((box.sent[0].text.match(/Reported /g) ?? []).length, 3);
});

Deno.test("a send that fails marks nothing, so the next round tries again; reports already dealt with are left out", async () => {
  const pg = await schemaDB();
  const a = await page(pg, "One"), b = await page(pg, "Two");
  await report(pg, a, "Bad");
  await report(pg, b, "Handled");
  await pg.query(`select public.admin_dismiss_reports($1)`, [b]);
  const down = outbox(() => ({ ok: false, status: 500 }));
  const r = await reportNotices({ sql: sqlFor(pg), send: down.send, cfg });
  assertEquals([r.sent, r.failed, await told(pg)], [false, true, 0]);
  const box = outbox();
  await reportNotices({ sql: sqlFor(pg), send: box.send, cfg });
  assertEquals(box.sent.length, 1);
  assert(box.sent[0].text.includes(a) && !box.sent[0].text.includes(b));
  // The same email asked for twice is the same email to Resend.
  assertEquals(box.sent[0].idempotencyKey, down.sent[0].idempotencyKey);
});

Deno.test("staging says so in the subject", async () => {
  const pg = await schemaDB();
  await report(pg, await page(pg), "Test");
  const box = outbox();
  await reportNotices({ sql: sqlFor(pg), send: box.send, cfg: { site: "https://amber-notes-staging.vercel.app", subjectPrefix: "[Staging] " } });
  assertEquals(box.sent[0].subject, "[Staging] A shared page was reported");
  assertStringIncludes(box.sent[0].text, "https://amber-notes-staging.vercel.app/n/");
});

Deno.test("one email stays short: at most 20 pages and 5 reports a page, the rest counted", () => {
  const row = (id: number, slug: string): ReportRow => ({ id, slug, reason: `Reason ${id}`, contact: null, created_at: new Date("2026-10-09T21:14:00Z"), down: false, people: 2 });
  const many = [...Array(MAX_PAGES + 3)].map((_, i) => row(i, `page${String(i).padStart(22, "0")}`));
  const pages = notice(many, "https://pintonotes.com");
  assertEquals((pages.text.match(/https:\/\/pintonotes\.com\/n\//g) ?? []).length, MAX_PAGES);
  assertStringIncludes(pages.text, "And 3 more pages.");
  const one = notice([...Array(MAX_REPORTS_PER_PAGE + 4)].map((_, i) => row(i, "a".repeat(24))), "https://pintonotes.com");
  assertEquals((one.text.match(/Reported 9 October 2026, 21:14 UTC/g) ?? []).length, MAX_REPORTS_PER_PAGE);
  assertStringIncludes(one.text, "And 4 more reports of this page.");
});

Deno.test("the tick asks for an email only when a report waits and none went out in the last 15 minutes", async () => {
  const pg = await schemaDB();
  // No pg_net here, so the tick can't post; what it would do is the same test the function makes.
  const due = async () => (await pg.query<{ due: boolean }>(`select
    exists (select 1 from public.share_reports r where r.status = 'open' and r.notified_at is null)
    and not exists (select 1 from public.share_reports r where r.notified_at > now() - interval '15 minutes') as due`)).rows[0].due;
  await pg.query(`select public.share_report_tick()`);
  assertEquals(await due(), false);
  const slug = await page(pg);
  await report(pg, slug, "One");
  assertEquals(await due(), true);
  await reportNotices({ sql: sqlFor(pg), send: outbox().send, cfg });
  await report(pg, slug, "Two", 2);
  assertEquals(await due(), false);
  await later(pg, 16);
  assertEquals(await due(), true);
  const def = (await pg.query<{ def: string }>(`select pg_get_functiondef('public.share_report_tick()'::regprocedure) as def`)).rows[0].def;
  assertStringIncludes(def, `interval '${NOTICE_GAP_MINUTES} minutes'`);
});
