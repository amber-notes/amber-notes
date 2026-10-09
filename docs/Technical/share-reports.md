# Reports of shared pages

Every shared page ends with "Report this page" (`web/lib/NotePage.tsx`). The form
(`web/app/report/[slug]/page.tsx`) sends the report to the `report_share` function in the database
(`supabase/migrations/20260929160000_share_reports.sql`), which keeps it in `share_reports`. Three
reports from different people take the page down at once. The report page and the terms say reports
are reviewed within 24 hours.

## Who is told

Support gets an email at `hello@pintonotes.com` (`SUPPORT_INBOX` in
`supabase/functions/_shared/sender.ts`), from `Pinto Notes <hello@ambernotes.app>`.

- `share_report_tick` runs every 5 minutes (pg_cron, `20261009230000_share_report_notices.sql`). It
  does nothing unless an open report has no `notified_at` and no email went out in the last 15
  minutes. Then it posts to the lifecycle function's `/reports`.
- The function (`supabase/functions/lifecycle/reports.ts`) sends one plain email with every report
  not yet mailed, and stamps their `notified_at`. A send that fails stamps nothing, so the next
  round tries again.
- So one report arrives within about 5 minutes, and a flood is at most one email every 15 minutes
  (96 a day), each holding at most 20 pages and 5 reports a page with the rest counted. The
  database's own limits stay: 5 reports an hour per reporter, 50 a day per page.
- It uses what the onboarding emails already have: the `RESEND_LIFECYCLE_KEY` secret and the vault
  entries `lifecycle_url` and `lifecycle_cron_secret`. No new secret. It does not look at
  `LIFECYCLE_ENABLED`, which is the switch for onboarding emails only.

The email holds the page's address, whether it is still up, when each report came, what it says,
and the two lines below. It never holds who reported: the database keeps only a hash of the
reporter's network address, and that stays there. If the reporter left an address to be answered
at, that is passed on.

    Subject: A shared page was reported

    A shared page was reported.

    https://pintonotes.com/n/<slug>
    The page is still up. 1 person has reported it; at 3 it comes down on its own.

    Reported 9 October 2026, 21:14 UTC
      It shows my home address and phone number.
      Wants an answer at: sara.lind@example.com

    Take it down:  select public.admin_take_down('<slug>');
    Keep it up:    select public.admin_dismiss_reports('<slug>');

`scripts/ops/daily-digest.ts` also says how many reports are open, so a missed email shows up the
next morning.

## Acting on one

In the Supabase SQL editor:

    select * from public.share_reports where status = 'open' order by created_at;
    select public.admin_take_down('<slug>');        -- the page comes down, its reports are closed
    select public.admin_dismiss_reports('<slug>');  -- the page stays, its reports are closed

## Testing

`deno test -A supabase/functions/lifecycle/reports.pglite.test.ts`: one email per report, nothing
about who, the 15 minutes, a failed send, a page that is already down, and the tick's condition.
