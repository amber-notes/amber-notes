-- A report of a shared page was only a row in share_reports: nobody was told, while the report page
-- and the terms promise a review within 24 hours. Now support gets an email
-- (supabase/functions/lifecycle/reports.ts).
--
-- share_reports.notified_at   when the email that told support about this report went out. Null:
--                             not told yet. Reports from before this migration are null too, so
--                             the first email lists every report that is still open.
-- share_report_tick           every 5 minutes, and only when an open report hasn't been mailed and
--                             no email went out in the last 15 minutes: posts to the lifecycle
--                             function's /reports, which sends one email with everything new. So a
--                             single report arrives within minutes, and a flood of reports is at
--                             most one email every 15 minutes. It uses the lifecycle function's
--                             vault entries (lifecycle_url, lifecycle_cron_secret); nothing new.

alter table public.share_reports add column if not exists notified_at timestamptz;
create index if not exists share_reports_unnotified on public.share_reports (created_at) where notified_at is null and status = 'open';

create or replace function public.share_report_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare
  fn_url text;
  fn_secret text;
begin
  if not exists (select 1 from public.share_reports r where r.status = 'open' and r.notified_at is null) then return; end if;
  if exists (select 1 from public.share_reports r where r.notified_at > now() - interval '15 minutes') then return; end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  if to_regclass('vault.decrypted_secrets') is null then return; end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'lifecycle_url'$q$ into fn_url;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'lifecycle_cron_secret'$q$ into fn_secret;
  if coalesce(fn_url, '') = '' or coalesce(fn_secret, '') = '' then return; end if;
  execute $q$select net.http_post(url := regexp_replace($1, '(/run)?/*$', '') || '/reports', body := '{}'::jsonb,
      headers := jsonb_build_object('content-type', 'application/json', 'x-lifecycle-secret', $2),
      timeout_milliseconds := 60000)$q$
    using fn_url, fn_secret;
end $$;
revoke all on function public.share_report_tick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('share-report-notice', '*/5 * * * *', 'select public.share_report_tick()');
  end if;
end $$;
