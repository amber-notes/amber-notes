-- "Did you know" tips in the apps: how often each is shown, and how often the feature it
-- points at is used after it. Counted on our own server like AI edits (pane_activity), with no
-- analytics SDK: per account, day, tip and event, a count. Never shared.
--
-- The apps call pane_tip_event(tip, event) once per tip and event per install:
--   'shown' when a tip first appears, 'used' when its feature is used after it was shown.
-- pane_tip_report() sums it up for the service role only.
--
-- A tip is never shown for a feature the account has ever used. pane_features_used() answers
-- that, from the account's own data where it can (any share link ever made; any version restored
-- from an app) and otherwise from a per-account flag the apps set (pane_feature_used), so it holds
-- on every device and after a reinstall.

create table public.pane_tip_activity (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  tip text not null check (tip in ('versionHistory', 'shareLink', 'menuBar', 'shareExtension')),
  event text not null check (event in ('shown', 'used')),
  n integer not null default 0,
  first_at timestamptz not null default now(),
  primary key (user_id, day, tip, event)
);
alter table public.pane_tip_activity enable row level security;
create policy "own tip activity read" on public.pane_tip_activity for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.pane_tip_activity from anon, authenticated;
grant select on public.pane_tip_activity to authenticated;

-- One tip event for the signed-in account. Unknown tips or events are refused by the checks
-- above; the write bucket keeps it from being hammered.
create or replace function public.pane_tip_event(tip text, event text) returns void
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
begin
  if uid is null then return; end if;
  perform public.pane_take('write');
  insert into public.pane_tip_activity as a (user_id, day, tip, event, n)
  values (uid, (now() at time zone 'utc')::date, pane_tip_event.tip, pane_tip_event.event, 1)
  on conflict (user_id, day, tip, event) do update set n = a.n + 1;
end $$;
revoke all on function public.pane_tip_event(text, text) from public, anon;
grant execute on function public.pane_tip_event(text, text) to authenticated;

-- Per tip, over the last `days`: accounts it was shown to, and how many of them then used it.
create or replace function public.pane_tip_report(days integer default 30)
returns table (tip text, shown_accounts bigint, used_accounts bigint, used_share numeric)
language sql stable security definer set search_path = '' as $$
  with w as (
    select * from public.pane_tip_activity
    where day >= (now() at time zone 'utc')::date - greatest(days, 1)
  )
  select s.tip,
         count(distinct s.user_id) as shown_accounts,
         count(distinct u.user_id) as used_accounts,
         round(count(distinct u.user_id)::numeric / nullif(count(distinct s.user_id), 0), 3) as used_share
  from w s
  left join w u on u.user_id = s.user_id and u.tip = s.tip and u.event = 'used'
  where s.event = 'shown'
  group by s.tip
  order by s.tip
$$;
revoke all on function public.pane_tip_report(integer) from public, anon, authenticated;
grant execute on function public.pane_tip_report(integer) to service_role;

-- Features an account has used, where its data can't tell: version history opened, the Mac menu
-- bar panel opened, a note saved through the share extension. First use only.
create table public.pane_feature_use (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  feature text not null check (feature in ('versionHistory', 'shareLink', 'menuBar', 'shareExtension')),
  first_at timestamptz not null default now(),
  primary key (user_id, feature)
);
alter table public.pane_feature_use enable row level security;
create policy "own feature use read" on public.pane_feature_use for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.pane_feature_use from anon, authenticated;
grant select on public.pane_feature_use to authenticated;

create or replace function public.pane_feature_used(feature text) returns void
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
begin
  if uid is null then return; end if;
  insert into public.pane_feature_use (user_id, feature) values (uid, pane_feature_used.feature)
  on conflict (user_id, feature) do nothing;
end $$;
revoke all on function public.pane_feature_used(text) from public, anon;
grant execute on function public.pane_feature_used(text) to authenticated;

-- Every feature the signed-in account has ever used, as tip ids.
create or replace function public.pane_features_used() returns text[]
language sql stable security definer set search_path = '' as $$
  with me as (select (select auth.uid()) as uid),
  flags as (select f.feature from public.pane_feature_use f, me where f.user_id = me.uid)
  select coalesce(array_agg(x order by x), '{}') from (
    select feature as x from flags
    union
    -- Any share link, even one since stopped.
    select 'shareLink' from public.note_shares s, me where s.user_id = me.uid
    union
    -- A version restored from an app (its device is the restorer; an AI's restore names the AI).
    select 'versionHistory' from public.note_revisions r, me
    where r.user_id = me.uid and r.source = 'restore' and r.client in ('iPhone', 'iPad', 'Mac')
    union
    select 'versionHistory' from public.notes n, me
    where n.user_id = me.uid and n.body_source = 'restore' and n.body_client in ('iPhone', 'iPad', 'Mac')
  ) used
$$;
revoke all on function public.pane_features_used() from public, anon;
grant execute on function public.pane_features_used() to authenticated;
