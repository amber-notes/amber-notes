-- The welcome email (docs/Technical/lifecycle-emails.md): sent a couple of minutes after an account
-- is made, once, by any way of signing up (email, Apple, Google), from the lifecycle function's
-- /welcome round.
--
-- email_sends    takes the kind 'welcome'. It stays out of the ladder's silence count below (and out
--                of its cap, in the function), so an unanswered welcome doesn't make the ladder wait
--                its long gap. The ladder's first email waits its usual gap after the welcome.
-- lifecycle_welcome_tick
--                every minute, and only when an account made 2 to 60 minutes ago has no welcome row
--                and hasn't unsubscribed: posts to the function's /welcome. Otherwise it does nothing,
--                so the function isn't called every minute for nothing.

alter table public.email_sends drop constraint if exists email_sends_kind_check;
alter table public.email_sends add constraint email_sends_kind_check
  check (kind in ('welcome', 'stuck', 'import', 'connect', 'try', 'undo', 'apps', 'templates', 'iphone', 'mac', 'share'));

-- Accounts made at or after `since` and in the last 30 days, with what the emails are decided from.
create or replace function public.lifecycle_facts(since timestamptz)
returns table (
  user_id uuid, email text, signed_up_at timestamptz,
  note_count integer, imported boolean, biggest_folder_share integer, utc_offset_minutes integer,
  on_mac boolean, on_iphone boolean,
  ai_connected_at timestamptz, connect_tried boolean, ai_edit_days integer,
  history_opened boolean, used_template boolean, has_app boolean, shared boolean,
  unsubscribed boolean, last_sent_at timestamptz, sent text[],
  last_active_at timestamptz, sent_since_active integer
)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email, u.created_at,
    (select count(*)::int from public.notes n where n.user_id = u.id and n.deleted_at is null),
    exists (select 1 from public.pane_setup p where p.user_id = u.id and p.imported_at is not null),
    coalesce((select (100 * max(c.n) / nullif(sum(c.n), 0))::int from (
      select count(*) as n from public.notes n where n.user_id = u.id and n.deleted_at is null group by n.folder_id) c), 0),
    (select d.utc_offset_minutes::int from public.pane_devices d where d.user_id = u.id and d.utc_offset_minutes is not null
      order by d.last_seen desc limit 1),
    exists (select 1 from public.pane_devices d where d.user_id = u.id and d.platform = 'macos'),
    exists (select 1 from public.pane_devices d where d.user_id = u.id and d.platform = 'ios'),
    (select min(t.created_at) from public.mcp_tokens t where t.user_id = u.id),
    exists (select 1 from public.connect_asks c where c.user_id = u.id),
    (select count(distinct a.day)::int from public.pane_activity a where a.user_id = u.id and a.kind = 'ai_edit'),
    exists (select 1 from public.pane_feature_use f where f.user_id = u.id and f.feature = 'versionHistory'),
    exists (select 1 from public.pane_feature_use f where f.user_id = u.id and f.feature = 'template'),
    exists (select 1 from public.pane_feature_use f where f.user_id = u.id and f.feature = 'appNote'),
    exists (select 1 from public.pane_feature_use f where f.user_id = u.id and f.feature = 'shareLink'),
    exists (select 1 from public.email_unsubscribes x where x.user_id = u.id),
    (select max(s.created_at) from public.email_sends s where s.user_id = u.id),
    coalesce((select array_agg(s.kind order by s.kind) from public.email_sends s where s.user_id = u.id), '{}'),
    act.at,
    (select count(*)::int from public.email_sends s where s.user_id = u.id and s.kind <> 'welcome'
      and s.created_at > coalesce(act.at, '-infinity'))
  from auth.users u
  -- The last sign of life: the app opened or a note changed (when, never what), an AI connected,
  -- used or editing, a click on one of these emails, or a reply noted in email_replies.
  cross join lateral (select greatest(
    (select max(d.last_seen) from public.pane_devices d where d.user_id = u.id),
    (select max(n.server_updated_at) from public.notes n where n.user_id = u.id),
    (select max(greatest(t.created_at, coalesce(t.last_used_at, t.created_at))) from public.mcp_tokens t where t.user_id = u.id),
    (select max(a.first_at) from public.pane_activity a where a.user_id = u.id),
    (select max(c.at) from public.email_clicks c join public.email_sends s on s.id = c.send_id where s.user_id = u.id),
    (select max(r.at) from public.email_replies r where r.user_id = u.id)
  ) as at) act
  where u.created_at >= since
    and u.created_at >= now() - interval '30 days'
    and coalesce(u.email, '') <> ''
$$;
revoke all on function public.lifecycle_facts(timestamptz) from public, anon, authenticated;

create or replace function public.lifecycle_welcome_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare
  fn_url text;
  fn_secret text;
begin
  if not exists (
    select 1 from auth.users u
    where u.created_at between now() - interval '60 minutes' and now() - interval '2 minutes'
      and coalesce(u.email, '') <> ''
      and not exists (select 1 from public.email_sends s where s.user_id = u.id and s.kind = 'welcome')
      and not exists (select 1 from public.email_unsubscribes x where x.user_id = u.id)
  ) then return; end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  if to_regclass('vault.decrypted_secrets') is null then return; end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'lifecycle_url'$q$ into fn_url;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'lifecycle_cron_secret'$q$ into fn_secret;
  if coalesce(fn_url, '') = '' or coalesce(fn_secret, '') = '' then return; end if;
  -- lifecycle_url is the function's address (…/functions/v1/lifecycle, or …/lifecycle/run).
  execute $q$select net.http_post(url := regexp_replace($1, '(/run)?/*$', '') || '/welcome', body := '{}'::jsonb,
      headers := jsonb_build_object('content-type', 'application/json', 'x-lifecycle-secret', $2),
      timeout_milliseconds := 60000)$q$
    using fn_url, fn_secret;
end $$;
revoke all on function public.lifecycle_welcome_tick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('amber-lifecycle-welcome', '* * * * *', 'select public.lifecycle_welcome_tick()');
  end if;
end $$;
