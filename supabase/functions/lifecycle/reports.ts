// Tells support when a shared page is reported (web/app/report, public.share_reports). Before this
// a report was a row nobody saw, while the report page promises a review within 24 hours.
//
// One plain email to the support inbox with everything that is new: each page's address, whether it
// is still up, when each report came and what it says, and the two lines of SQL that take the page
// down or keep it. Who reported is never in it: the database holds only a hash of their network
// address, and that stays there. The one thing a reporter can add is an address to be answered at,
// and that is passed on, because it was given for exactly this.
//
// Never a flood: one email covers every report that hasn't been mailed, and the next one waits
// NOTICE_GAP_MINUTES. The database already caps reports at 5 an hour per reporter and 50 a day per
// page (report_share). A failed send leaves the reports unmarked, so the next round tries again.
import type { Sql } from "npm:postgres@3.4.5";
import { HELLO, SENDER_NAME, SUPPORT_INBOX } from "../_shared/sender.ts";
import type { Config } from "./logic.ts";
import type { Message, Send } from "./run.ts";

/// The same number is in share_report_tick (20261009230000_share_report_notices.sql).
export const NOTICE_GAP_MINUTES = 15;
/// What one email holds at most. The rest is counted in a line at the end, and is in the table.
export const MAX_PAGES = 20;
export const MAX_REPORTS_PER_PAGE = 5;
const MAX_ROWS = 500;

export type ReportRow = {
  id: number;
  slug: string;
  reason: string;
  /// An address the reporter left to be answered at, if they did.
  contact: string | null;
  created_at: Date;
  /// The page is no longer shared: taken down after three reports, or its owner stopped sharing.
  down: boolean;
  /// How many different reporters have an open report on this page.
  people: number;
};

export type NoticeReport = { new: number; pages: number; sent: boolean; waiting: boolean; failed: boolean };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const two = (n: number) => String(n).padStart(2, "0");
const when = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/// The email for these reports (oldest first), as subject and text.
export function notice(rows: ReportRow[], site: string): { subject: string; text: string } {
  const pages = new Map<string, ReportRow[]>();
  for (const r of rows) pages.set(r.slug, [...(pages.get(r.slug) ?? []), r]);
  const out: string[] = [];
  const shown = [...pages].slice(0, MAX_PAGES);
  out.push(pages.size === 1 ? "A shared page was reported." : `${pages.size} shared pages were reported.`, "");
  for (const [slug, reports] of shown) {
    const { down, people } = reports[0];
    out.push(`${site}/n/${slug}`);
    out.push(down
      ? "The page is no longer shared: it was taken down after three reports, or its owner stopped sharing it."
      : `The page is still up. ${people === 1 ? "1 person has" : `${people} people have`} reported it; at 3 it comes down on its own.`);
    out.push("");
    for (const r of reports.slice(0, MAX_REPORTS_PER_PAGE)) {
      out.push(`Reported ${when(r.created_at)}`, `  ${oneLine(r.reason)}`);
      if (r.contact) out.push(`  Wants an answer at: ${oneLine(r.contact)}`);
      out.push("");
    }
    if (reports.length > MAX_REPORTS_PER_PAGE) out.push(`And ${reports.length - MAX_REPORTS_PER_PAGE} more reports of this page.`, "");
    out.push(`Take it down:  select public.admin_take_down('${slug}');`);
    out.push(`Keep it up:    select public.admin_dismiss_reports('${slug}');`, "", "");
  }
  if (pages.size > MAX_PAGES) out.push(`And ${pages.size - MAX_PAGES} more pages. All of them:`, "  select * from public.share_reports where status = 'open' order by created_at;", "");
  out.push("Run the SQL in the Supabase SQL editor. Either line closes the page's reports.",
    "The report page says we review reports within 24 hours.");
  return { subject: pages.size === 1 ? "A shared page was reported" : `${pages.size} shared pages were reported`, text: out.join("\n") + "\n" };
}

/// One round: if there are open reports support hasn't been told about, and no email went out in
/// the last NOTICE_GAP_MINUTES, send one email with all of them and mark them told.
export async function reportNotices({ sql, send, cfg }: { sql: Sql; send: Send; cfg: Pick<Config, "site" | "subjectPrefix"> }): Promise<NoticeReport> {
  return await sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    // Two rounds at once: the second waits here, then finds the reports marked.
    await t`select pg_advisory_xact_lock(hashtext('share-report-notice'))`;
    const [{ recent }] = await t<{ recent: boolean }[]>`select exists (
      select 1 from public.share_reports where notified_at > now() - make_interval(mins => ${NOTICE_GAP_MINUTES})) as recent`;
    const rows = (await t<(Omit<ReportRow, "created_at" | "id"> & { id: number | string; created_at: Date | string })[]>`
      select r.id, r.slug, r.reason, r.contact, r.created_at,
        (s.slug is null or s.revoked_at is not null) as down,
        (select count(distinct x.reporter)::int from public.share_reports x where x.slug = r.slug and x.status = 'open') as people
      from public.share_reports r left join public.note_shares s on s.slug = r.slug
      where r.status = 'open' and r.notified_at is null
      order by r.id limit ${MAX_ROWS}`).map((r) => ({ ...r, id: Number(r.id), created_at: new Date(r.created_at), people: Number(r.people) }));
    const report: NoticeReport = { new: rows.length, pages: new Set(rows.map((r) => r.slug)).size, sent: false, waiting: false, failed: false };
    if (!rows.length) return report;
    if (recent) return { ...report, waiting: true };
    const last = rows[rows.length - 1].id;
    const { subject, text } = notice(rows, cfg.site);
    const message: Message = {
      from: `${SENDER_NAME} <${HELLO}>`, to: SUPPORT_INBOX, reply_to: SUPPORT_INBOX,
      subject: cfg.subjectPrefix + subject, text,
      html: `<pre style="font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;white-space:pre-wrap;margin:0;">${esc(text)}</pre>`,
      headers: {}, idempotencyKey: `share-report-notice-${last}`,
    };
    const result = await send(message);
    if (!result.ok) return { ...report, failed: true };
    await t`update public.share_reports set notified_at = now() where status = 'open' and notified_at is null and id <= ${last}`;
    return { ...report, sent: true };
  }) as NoticeReport;
}
