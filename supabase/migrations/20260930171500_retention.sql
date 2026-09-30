-- Retention on the server, on a schedule, so what the privacy policy promises holds even for
-- accounts whose apps are never opened again.
--
-- pane_forget_hourly()  rate-limit rows (hashed addresses) after 2 hours, finished OAuth sign-ins
--                       and expired tokens a day after they expire, idle per-account rate buckets.
-- pane_forget_daily()   Recently Deleted notes after 30 days (as the apps do: body blanked, history
--                       and share links gone), who-reported hashes after 30 days, closed reports
--                       after 12 months, usage counts after 12 months, the auth server's audit log
--                       after 30 days, and version-history thinning for notes nobody edits.
--
-- Both run from pg_cron where it's available (Supabase has it; the in-process test database
-- doesn't), and can be run by hand from the SQL editor.

create or replace function public.pane_forget_hourly() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.oauth_rate where at < now() - interval '2 hours';
  delete from public.oauth_requests
    where expires_at < now() - interval '1 day' and (code_expires_at is null or code_expires_at < now() - interval '1 day');
  delete from public.oauth_tokens where expires_at < now() - interval '1 day';
  -- A bucket untouched for an hour has refilled; the row says nothing a fresh one wouldn't.
  delete from public.pane_rate where at < now() - interval '1 hour';
end $$;
revoke all on function public.pane_forget_hourly() from public, anon, authenticated;

create or replace function public.pane_forget_daily() returns void
language plpgsql security definer set search_path = '' as $$
declare
  purged uuid[];
begin
  -- Recently Deleted keeps a note for 30 days. The apps purge on launch; this covers the rest.
  with gone as (
    update public.notes set deleted_at = now(), body = '', locked_body = null
    where trashed_at < now() - interval '30 days' and deleted_at is null
    returning id)
  select coalesce(array_agg(id), '{}') into purged from gone;
  update public.note_shares set revoked_at = now() where note_id = any(purged) and revoked_at is null;

  -- Reports: who reported matters only while a report is fresh (one person counts once).
  update public.share_reports set reporter = repeat('0', 64)
    where created_at < now() - interval '30 days' and reporter <> repeat('0', 64);
  delete from public.share_reports where created_at < now() - interval '12 months' and status <> 'open';

  -- Usage counts the apps keep.
  delete from public.pane_activity where day < (now() at time zone 'utc')::date - 365;
  delete from public.pane_tip_activity where day < (now() at time zone 'utc')::date - 365;
  delete from public.pane_active_days where day < (now() at time zone 'utc')::date - 365;
  delete from public.pane_devices where last_seen < now() - interval '12 months';

  -- The auth server writes sign-in events (with email and network address) to this table.
  if to_regclass('auth.audit_log_entries') is not null then
    begin
      execute 'delete from auth.audit_log_entries where created_at < now() - interval ''30 days''';
    exception when insufficient_privilege then
      raise warning 'pane_forget_daily: no permission to trim auth.audit_log_entries';
    end;
  end if;

  perform public.pane_thin_all_revisions();
end $$;
revoke all on function public.pane_forget_daily() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('amber-forget-hourly', '7 * * * *', 'select public.pane_forget_hourly()');
    perform cron.schedule('amber-forget-daily', '23 3 * * *', 'select public.pane_forget_daily()');
  end if;
end $$;
