-- "Did you know" tips in the apps: how often each is shown, and how often the feature it
-- points at is used after it. Counted on our own server like AI edits (pane_activity), with no
-- analytics SDK: per account, day, tip and event, a count. Never shared.
--
-- The apps call pane_tip_event(tip, event) once per tip and event per install:
--   'shown' when a tip first appears, 'used' when its feature is used after it was shown.
-- pane_tip_report() sums it up for the service role only.

create table public.pane_tip_activity (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  tip text not null check (tip in ('versionHistory', 'shareLink', 'checklistTidy', 'tableFromText', 'menuBar', 'shareExtension')),
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
