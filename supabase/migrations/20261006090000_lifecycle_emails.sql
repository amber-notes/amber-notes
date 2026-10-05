-- A few onboarding emails for new accounts, sent by the lifecycle function
-- (supabase/functions/lifecycle, docs/Technical/lifecycle-emails.md): a next-step ladder, one email
-- per step the account hasn't taken yet, at most 6 in the first 30 days and nothing after.
--
-- Who gets which email is decided from account activity only: how many notes the account has (a
-- count, never their contents), whether it imported, which kinds of device it uses, when an AI was
-- first connected and whether a connection is waiting, on how many days an AI edited a note, and
-- which features it has used. Nothing here reads a note's text, title or name.
--
-- email_sends        one row per account and email, written before the email goes out, so no
--                    email is sent twice. No address and no content: the kind, the outcome, the time.
-- email_unsubscribes accounts that said stop. Nothing is sent to them again.
-- lifecycle_facts()  the activity the function decides from, for accounts made since a date.
-- lifecycle_tick()   what pg_cron runs every hour: asks the function to do a round. It does nothing
--                    until pg_net is on and the vault holds the function's address and secret.
-- email_replies      a reply, noted by hand: a sign of life like a click.
-- email_clicks       a click on a link in one of these emails, when LIFECYCLE_TRACK_CLICKS is on:
--                    which email and the link's host and path. No address, no query, no device.
-- pane_devices       takes the device's UTC offset, so emails can go out at 9 in its morning.
--                    The apps don't report it yet.
-- pane_feature_use   takes two more first uses: 'template' (a template added from a link) and
--                    'appNote' (an app made in a note). The apps don't report them yet.
--
-- Nothing is sent until the function's LIFECYCLE_ENABLED is "true" as well.

alter table public.pane_feature_use drop constraint if exists pane_feature_use_feature_check;
alter table public.pane_feature_use add constraint pane_feature_use_feature_check
  check (feature in ('versionHistory', 'shareLink', 'menuBar', 'shareExtension', 'template', 'appNote'));

create table public.email_sends (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('stuck', 'import', 'connect', 'try', 'undo', 'apps', 'templates', 'iphone', 'mac', 'share')),
  -- Which of the email's two subject lines went out (0 unless LIFECYCLE_SUBJECT_TEST is on).
  variant smallint not null default 0 check (variant in (0, 1)),
  -- sending: claimed, the provider not answered yet (a crash leaves it here, and it is never retried);
  -- sent: the provider took it; failed: the provider refused it (not retried either).
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_id text check (provider_id is null or char_length(provider_id) <= 100),
  unique (user_id, kind)
);
alter table public.email_sends enable row level security;
revoke all on public.email_sends from anon, authenticated;

create table public.email_clicks (
  id bigint generated always as identity primary key,
  send_id bigint not null references public.email_sends (id) on delete cascade,
  link text not null check (char_length(link) <= 100),
  at timestamptz not null default now()
);
create index email_clicks_send on public.email_clicks (send_id);
alter table public.email_clicks enable row level security;
revoke all on public.email_clicks from anon, authenticated;

alter table public.pane_devices add column if not exists utc_offset_minutes smallint
  check (utc_offset_minutes is null or utc_offset_minutes between -720 and 840);

-- A reply to one of these emails, noted by hand for now (insert a row when someone writes back):
-- it counts as a sign of life, so the emails go on.
create table public.email_replies (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
alter table public.email_replies enable row level security;
revoke all on public.email_replies from anon, authenticated;

create table public.email_unsubscribes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- link: the page the email's link opens; header: a mail app's own unsubscribe button (RFC 8058).
  source text not null check (source in ('link', 'header')),
  at timestamptz not null default now()
);
alter table public.email_unsubscribes enable row level security;
revoke all on public.email_unsubscribes from anon, authenticated;

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
    (select count(*)::int from public.email_sends s where s.user_id = u.id and s.created_at > coalesce(act.at, '-infinity'))
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

create or replace function public.lifecycle_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare
  fn_url text;
  fn_secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  if to_regclass('vault.decrypted_secrets') is null then return; end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'lifecycle_url'$q$ into fn_url;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'lifecycle_cron_secret'$q$ into fn_secret;
  if coalesce(fn_url, '') = '' or coalesce(fn_secret, '') = '' then return; end if;
  execute $q$select net.http_post(url := $1, body := '{}'::jsonb,
      headers := jsonb_build_object('content-type', 'application/json', 'x-lifecycle-secret', $2),
      timeout_milliseconds := 120000)$q$
    using fn_url, fn_secret;
end $$;
revoke all on function public.lifecycle_tick() from public, anon, authenticated;

-- Every hour on the hour: each round sends only to accounts where it's 9 in the morning (08:00 UTC
-- for accounts whose time zone isn't known yet).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('amber-lifecycle-hourly', '0 * * * *', 'select public.lifecycle_tick()');
  end if;
end $$;
