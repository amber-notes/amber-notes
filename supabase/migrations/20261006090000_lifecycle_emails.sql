-- A few onboarding emails for new accounts, sent by the lifecycle function
-- (supabase/functions/lifecycle, docs/Technical/lifecycle-emails.md).
--
-- Who gets which email is decided from account activity only, following the app's setup steps
-- (Bring your notes, Connect your AI, Try it): how many notes the account has (a count, never their
-- contents), whether it imported, when an AI was first connected and whether a connection was
-- started but not finished, on how many days an AI edited a note, and whether version history was
-- ever opened. Nothing here reads a note's text, title or name.
--
-- email_sends        one row per account and email, written before the email goes out, so no
--                    email is sent twice. No address and no content: the kind, the outcome, the time.
-- email_unsubscribes accounts that said stop. Nothing is sent to them again.
-- lifecycle_facts()  the activity the function decides from, for accounts made since a date.
-- lifecycle_tick()   what pg_cron runs once a day: asks the function to do a round. It does nothing
--                    until pg_net is on and the vault holds the function's address and secret.
--
-- Nothing is sent until the function's LIFECYCLE_ENABLED is "true" as well.

create table public.email_sends (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('stuck', 'ai_sort', 'ai_groceries', 'ai_meeting', 'templates', 'undo')),
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

create table public.email_unsubscribes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- link: the page the email's link opens; header: a mail app's own unsubscribe button (RFC 8058).
  source text not null check (source in ('link', 'header')),
  at timestamptz not null default now()
);
alter table public.email_unsubscribes enable row level security;
revoke all on public.email_unsubscribes from anon, authenticated;

-- Accounts made at or after `since` and in the last 45 days, with what the emails are decided from.
create or replace function public.lifecycle_facts(since timestamptz)
returns table (
  user_id uuid, email text, signed_up_at timestamptz,
  note_count integer, imported boolean, ai_connected_at timestamptz, connect_tried boolean,
  ai_edit_days integer, history_opened boolean,
  unsubscribed boolean, last_sent_at timestamptz, sent text[]
)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email, u.created_at,
    (select count(*)::int from public.notes n where n.user_id = u.id and n.deleted_at is null),
    exists (select 1 from public.pane_setup p where p.user_id = u.id and p.imported_at is not null),
    (select min(t.created_at) from public.mcp_tokens t where t.user_id = u.id),
    exists (select 1 from public.connect_asks c where c.user_id = u.id),
    (select count(distinct a.day)::int from public.pane_activity a where a.user_id = u.id and a.kind = 'ai_edit'),
    exists (select 1 from public.pane_feature_use f where f.user_id = u.id and f.feature = 'versionHistory'),
    exists (select 1 from public.email_unsubscribes x where x.user_id = u.id),
    (select max(s.created_at) from public.email_sends s where s.user_id = u.id),
    coalesce((select array_agg(s.kind order by s.kind) from public.email_sends s where s.user_id = u.id), '{}')
  from auth.users u
  where u.created_at >= since
    and u.created_at >= now() - interval '45 days'
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

-- Once a day at 08:00 UTC (10:00 in Sweden), so an email arrives in the morning in Europe.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('amber-lifecycle-daily', '0 8 * * *', 'select public.lifecycle_tick()');
  end if;
end $$;
