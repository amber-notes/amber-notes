// One round of lifecycle emails: read the activity, decide, claim, send, record.
//
// Never twice: before an email goes out, its row in email_sends is written (unique per account and
// email) inside a transaction that also takes a per-account lock and checks the seven-day gap
// again, so two rounds at once can't both send. A row is only removed again when Resend says
// "too many requests", which means it took nothing; any other failure keeps the row, so an email
// whose fate is unknown is never sent a second time. Resend also gets an idempotency key per
// account and email.
import type { Sql } from "npm:postgres@3.4.5";
import { render } from "./emails.ts";
import { type Config, decide, type Facts, GAP_MS, type Kind, unsubscribeLinks, unsubscribeToken } from "./logic.ts";

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

type Row = Omit<Facts, "signed_up_at" | "last_sent_at"> & { signed_up_at: Date | string; last_sent_at: Date | string | null };

const asFacts = (r: Row): Facts => ({
  ...r,
  signed_up_at: new Date(r.signed_up_at),
  last_sent_at: r.last_sent_at ? new Date(r.last_sent_at) : null,
  sent: r.sent ?? [],
});

/// Claims the email for the account, or says it can't go (already sent, sent something within the
/// gap, unsubscribed meanwhile). Returns the row's id.
async function claim(sql: Sql, userId: string, kind: Kind, now: Date): Promise<number | null> {
  return await sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    await t`select pg_advisory_xact_lock(hashtext(${"lifecycle:" + userId}))`;
    const since = new Date(now.getTime() - GAP_MS);
    const [row] = await t<{ id: number }[]>`
      insert into public.email_sends (user_id, kind)
      select ${userId}::uuid, ${kind}
      where not exists (select 1 from public.email_unsubscribes x where x.user_id = ${userId}::uuid)
        and not exists (select 1 from public.email_sends s where s.user_id = ${userId}::uuid
                        and s.status <> 'failed' and s.created_at > ${since})
      on conflict (user_id, kind) do nothing
      returning id`;
    return row ? Number(row.id) : null;
  });
}

export async function run({ sql, send, cfg, now = new Date(), pause = (ms: number) => new Promise((r) => setTimeout(r, ms)) }:
  { sql: Sql; send: Send; cfg: Config; now?: Date; pause?: (ms: number) => Promise<unknown> }): Promise<Report> {
  const report: Report = { enabled: cfg.enabled, accounts: 0, due: {}, sent: 0, failed: 0, deferred: 0 };
  const rows = await sql<Row[]>`select * from public.lifecycle_facts(${cfg.since})`;
  report.accounts = rows.length;
  for (const r of rows) {
    const f = asFacts(r);
    const kind = decide(f, now);
    if (!kind || !f.email) continue;
    if (cfg.only && !cfg.only.has(f.user_id.toLowerCase())) continue;
    report.due[kind] = (report.due[kind] ?? 0) + 1;
    // The kill switch: with sending off, a round only counts what would go.
    if (!cfg.enabled) continue;

    const id = await claim(sql, f.user_id, kind, now);
    if (id === null) continue;
    const links = unsubscribeLinks(cfg.site, f.user_id, await unsubscribeToken(cfg.unsubscribeSecret, f.user_id));
    const email = render(kind, { site: cfg.site, assets: `${cfg.site}/email`, unsubscribe: links.page, aiConnected: f.ai_connected });
    let result: SendResult;
    try {
      result = await send({
        from: cfg.from, to: f.email, reply_to: cfg.replyTo, subject: email.subject, html: email.html, text: email.text,
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
    // Resend allows a couple of requests a second.
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
