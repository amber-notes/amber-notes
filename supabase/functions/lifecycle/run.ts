// One round of lifecycle emails: read the activity, decide, claim, send, record.
//
// Never twice: before an email goes out, its row in email_sends is written (unique per account and
// email) inside a transaction that also takes a per-account lock and checks the spacing and the cap
// again, so two rounds at once can't both send. A row is only removed again when Resend says
// "too many requests", which means it took nothing; any other failure keeps the row, so an email
// whose fate is unknown is never sent a second time. Resend also gets an idempotency key per
// account and email. A failed email counts toward the spacing and the cap too, so a bad address isn't
// tried with the next email the same day.
import type { Sql } from "npm:postgres@3.4.5";
import { render } from "./emails.ts";
import { clickable, type Config, decide, type Facts, gapFor, type Kind, LADDER, linkName, localMorning, MAX_EMAILS, sortable, trackedLink, unsubscribeLinks, unsubscribeToken, variantOf, welcomeDue, welcomeStep } from "./logic.ts";

export type Message = {
  from: string;
  to: string;
  reply_to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  idempotencyKey: string;
};
export type SendResult = { ok: true; id: string } | { ok: false; status: number };
export type Send = (m: Message) => Promise<SendResult>;

export type Report = { enabled: boolean; accounts: number; due: Partial<Record<Kind, number>>; sent: number; failed: number; deferred: number };

type Row = Omit<Facts, "signed_up_at" | "last_sent_at" | "ai_connected_at"> & { last_active_at?: Date | string | null; signed_up_at: Date | string; last_sent_at: Date | string | null; ai_connected_at: Date | string | null };

const asFacts = (r: Row): Facts => ({
  ...r,
  signed_up_at: new Date(r.signed_up_at),
  last_sent_at: r.last_sent_at ? new Date(r.last_sent_at) : null,
  ai_connected_at: r.ai_connected_at ? new Date(r.ai_connected_at) : null,
  note_count: Number(r.note_count ?? 0),
  biggest_folder_share: Number(r.biggest_folder_share ?? 0),
  utc_offset_minutes: r.utc_offset_minutes === null || r.utc_offset_minutes === undefined ? null : Number(r.utc_offset_minutes),
  ai_edit_days: Number(r.ai_edit_days ?? 0),
  sent_since_active: Number(r.sent_since_active ?? 0),
  sent: r.sent ?? [],
});

/// Claims the email for the account, or says it can't go (already sent, sent something within the
/// gap, unsubscribed meanwhile). Returns the row's id.
async function claim(sql: Sql, f: Facts, kind: Kind, variant: number, now: Date): Promise<number | null> {
  const userId = f.user_id;
  return await sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    await t`select pg_advisory_xact_lock(hashtext(${"lifecycle:" + userId}))`;
    const since = new Date(now.getTime() - gapFor(f, now));
    const [row] = await t<{ id: number }[]>`
      insert into public.email_sends (user_id, kind, variant)
      select ${userId}::uuid, ${kind}, ${variant}
      where not exists (select 1 from public.email_unsubscribes x where x.user_id = ${userId}::uuid)
        and not exists (select 1 from public.email_sends s where s.user_id = ${userId}::uuid
                        and s.created_at > ${since})
        and (select count(*) from public.email_sends s where s.user_id = ${userId}::uuid and s.kind <> 'welcome') < ${MAX_EMAILS}
      on conflict (user_id, kind) do nothing
      returning id`;
    return row ? Number(row.id) : null;
  });
}

/// Puts every link that may be counted through pintonotes.com/go (only with LIFECYCLE_TRACK_CLICKS).
async function track(html: string, cfg: Config, sendId: number, skip: string[]): Promise<string> {
  const urls = [...new Set([...html.matchAll(/href="(https:[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")))]
    .filter((u) => clickable(u) && !skip.includes(u));
  for (const u of urls) {
    const to = (await trackedLink(cfg.site, cfg.unsubscribeSecret, sendId, u)).replace(/&/g, "&amp;");
    html = html.split(`href="${u.replace(/&/g, "&amp;")}"`).join(`href="${to}"`);
  }
  return html;
}

/// A round. Hourly in production; each account gets its email in the round where it's 9 in its
/// morning. `anyHour` is for tests and manual rounds.
export async function run({ sql, send, cfg, now = new Date(), anyHour = false, pause = (ms: number) => new Promise((r) => setTimeout(r, ms)) }:
  { sql: Sql; send: Send; cfg: Config; now?: Date; anyHour?: boolean; pause?: (ms: number) => Promise<unknown> }): Promise<Report> {
  const report: Report = { enabled: cfg.enabled, accounts: 0, due: {}, sent: 0, failed: 0, deferred: 0 };
  const rows = await sql<Row[]>`select * from public.lifecycle_facts(${cfg.since})`;
  report.accounts = rows.length;
  for (const r of rows) {
    const f = asFacts(r);
    const kind = decide(f, now, cfg.flags);
    if (!kind || !f.email) continue;
    if (!anyHour && !localMorning(now, f.utc_offset_minutes)) continue;
    if (cfg.only && !cfg.only.has(f.user_id.toLowerCase())) continue;
    report.due[kind] = (report.due[kind] ?? 0) + 1;
    // The kill switch: with sending off, a round only counts what would go.
    if (!cfg.enabled) continue;

    const variant = cfg.subjectTest ? variantOf(f.user_id) : 0;
    const id = await claim(sql, f, kind, variant, now);
    if (id === null) continue;
    await deliver(sql, send, cfg, f, kind, id, variant, report);
    // Resend allows a couple of requests a second.
    await pause(600);
  }
  return report;
}

/// Renders, sends and records one claimed email.
async function deliver(sql: Sql, send: Send, cfg: Config, f: Facts, kind: Kind, id: number, variant: 0 | 1, report: Report) {
  const links = unsubscribeLinks(cfg.site, f.user_id, await unsubscribeToken(cfg.unsubscribeSecret, f.user_id));
  const email = render(kind, { site: cfg.site, open: cfg.open, assets: `${cfg.site}/email`, unsubscribe: links.page, sortable: sortable(f), connectTried: f.connect_tried, variant, step: welcomeStep(f) });
  if (cfg.trackClicks) email.html = await track(email.html, cfg, id, [links.page, `${cfg.site}/privacy`]);
  let result: SendResult;
  try {
    result = await send({
      from: cfg.from, to: f.email!, reply_to: cfg.replyTo, subject: cfg.subjectPrefix + email.subject, html: email.html, text: email.text,
      headers: { "List-Unsubscribe": `<${links.oneClick}>, <mailto:${cfg.replyTo}?subject=Unsubscribe>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      idempotencyKey: `lifecycle-${kind}-${f.user_id}`,
    });
  } catch {
    result = { ok: false, status: 0 };
  }
  if (result.ok) {
    await sql`update public.email_sends set status = 'sent', sent_at = now(), provider_id = ${result.id.slice(0, 100)} where id = ${id}`;
    report.sent++;
  } else if (result.status === 429) {
    await sql`delete from public.email_sends where id = ${id}`;
    report.deferred++;
  } else {
    await sql`update public.email_sends set status = 'failed' where id = ${id}`;
    report.failed++;
  }
}

/// The welcome round: every account made 2 to 60 minutes ago that hasn't had its welcome, at any
/// hour. Called every minute by lifecycle_welcome_tick, but only when such an account exists. Once
/// per account (the row is unique per account and kind), never after an unsubscribe, and outside the
/// ladder's gap and cap: the ladder's first email then waits its usual gap after the welcome.
export async function welcome({ sql, send, cfg, now = new Date(), pause = (ms: number) => new Promise((r) => setTimeout(r, ms)) }:
  { sql: Sql; send: Send; cfg: Config; now?: Date; pause?: (ms: number) => Promise<unknown> }): Promise<Report> {
  const report: Report = { enabled: cfg.enabled, accounts: 0, due: {}, sent: 0, failed: 0, deferred: 0 };
  const rows = await sql<Row[]>`select * from public.lifecycle_facts(${cfg.since})
    where signed_up_at > ${new Date(now.getTime() - 3_600_000)}`;
  report.accounts = rows.length;
  for (const r of rows) {
    const f = asFacts(r);
    if (!welcomeDue(f, now) || !f.email) continue;
    if (cfg.only && !cfg.only.has(f.user_id.toLowerCase())) continue;
    report.due.welcome = (report.due.welcome ?? 0) + 1;
    if (!cfg.enabled) continue;
    const [row] = await sql<{ id: number }[]>`
      insert into public.email_sends (user_id, kind, variant)
      select ${f.user_id}::uuid, 'welcome', 0
      where not exists (select 1 from public.email_unsubscribes x where x.user_id = ${f.user_id}::uuid)
      on conflict (user_id, kind) do nothing
      returning id`;
    if (!row) continue;
    await deliver(sql, send, cfg, f, "welcome", Number(row.id), 0, report);
    await pause(600);
  }
  return report;
}

/// Sends through Resend's API (https://resend.com/docs/api-reference/emails/send-email).
export function resend(key: string, fetcher: typeof fetch = fetch): Send {
  return async (m) => {
    const res = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": m.idempotencyKey },
      body: JSON.stringify({ from: m.from, to: [m.to], reply_to: m.reply_to, subject: m.subject, html: m.html, text: m.text, headers: m.headers }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) { await res.body?.cancel(); return { ok: false, status: res.status }; }
    const body = await res.json().catch(() => ({})) as { id?: unknown };
    return { ok: true, id: typeof body.id === "string" ? body.id : "" };
  };
}

/// Records a click from pintonotes.com/go: which email and the link's host and path. Returns false
/// for an email row that doesn't exist (an account deleted since).
export async function recordClick(sql: Sql, sendId: number, url: string): Promise<boolean> {
  const rows = await sql`insert into public.email_clicks (send_id, link)
    select id, ${linkName(url)} from public.email_sends where id = ${sendId} returning id`;
  return rows.length > 0;
}

export type Stats = { kind: Kind; variant: number; sent: number; clicked: number; done: number }[];

/// Per email and subject line: how many went out, how many accounts clicked a link in it, and how
/// many have since done the step it was about (accounts from the last 30 days, which is when these
/// emails go). Counts only; never who.
export async function stats(sql: Sql): Promise<Stats> {
  const rows = await sql<Row[]>`select * from public.lifecycle_facts(${new Date(0)})`;
  const facts = new Map(rows.map((r) => [r.user_id, asFacts(r)]));
  const sends = await sql<{ user_id: string; kind: Kind; variant: number; clicked: boolean }[]>`
    select s.user_id, s.kind, s.variant, exists (select 1 from public.email_clicks c where c.send_id = s.id) as clicked
    from public.email_sends s where s.status = 'sent'`;
  const out = new Map<string, Stats[number]>();
  for (const s of sends) {
    const key = `${s.kind}:${s.variant}`;
    const row = out.get(key) ?? { kind: s.kind, variant: Number(s.variant), sent: 0, clicked: 0, done: 0 };
    row.sent++;
    if (s.clicked) row.clicked++;
    const f = facts.get(s.user_id);
    if (f && LADDER.find((r) => r.kind === s.kind)?.done(f)) row.done++;
    out.set(key, row);
  }
  return [...out.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.variant - b.variant);
}
