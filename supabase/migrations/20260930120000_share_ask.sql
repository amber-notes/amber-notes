-- "Enjoying Amber Notes?": a one-time ask, after a week of use, to share the app on X or LinkedIn.
--
-- A week of use is 7 different days with notes opened or edited, on any of the account's devices,
-- not necessarily in a row. Each device sends its days (pane_active_days_add, once a day, in the
-- device's own calendar) and they're kept once per account and day in pane_active_days.
--
-- Asked once per account, on whichever device gets there first: the first choice (shared on X,
-- shared on LinkedIn, or not now) is kept in pane_share_ask, and every device asks
-- pane_share_ask_state() before it asks you.
--
-- How often it's shown and what people choose is counted with the tips (pane_tip_activity, tip
-- 'shareAsk'), so the checks there widen to take its events. Old apps never send them.

alter table public.pane_tip_activity drop constraint pane_tip_activity_tip_check;
alter table public.pane_tip_activity add constraint pane_tip_activity_tip_check
  check (tip in ('versionHistory', 'shareLink', 'menuBar', 'shareExtension', 'shareAsk'));
alter table public.pane_tip_activity drop constraint pane_tip_activity_event_check;
alter table public.pane_tip_activity add constraint pane_tip_activity_event_check
  check (event in ('shown', 'used', 'shared_x', 'shared_linkedin', 'dismissed'));

create table public.pane_share_ask (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  choice text not null check (choice in ('shared_x', 'shared_linkedin', 'dismissed')),
  decided_at timestamptz not null default now()
);
alter table public.pane_share_ask enable row level security;
create policy "own share ask read" on public.pane_share_ask for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.pane_share_ask from anon, authenticated;
grant select on public.pane_share_ask to authenticated;

-- The signed-in account answered the ask. The first answer stands; later ones change nothing.
create or replace function public.pane_share_ask_decide(choice text) returns void
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
begin
  if uid is null then return; end if;
  insert into public.pane_share_ask (user_id, choice) values (uid, pane_share_ask_decide.choice)
  on conflict (user_id) do nothing;
end $$;
revoke all on function public.pane_share_ask_decide(text) from public, anon;
grant execute on function public.pane_share_ask_decide(text) to authenticated;

-- Days the account used its notes: one row per day, whichever devices it was on.
create table public.pane_active_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  primary key (user_id, day)
);
alter table public.pane_active_days enable row level security;
create policy "own active days read" on public.pane_active_days for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.pane_active_days from anon, authenticated;
grant select on public.pane_active_days to authenticated;

-- Days of use from a device, including ones it couldn't send while offline. Only days from the
-- last 60 up to tomorrow (time zones) are taken; days already kept change nothing.
create or replace function public.pane_active_days_add(days date[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
begin
  if uid is null then return; end if;
  perform public.pane_take('write');
  insert into public.pane_active_days (user_id, day)
  select distinct uid, d from unnest(days) d
  where d between today - 60 and today + 1
  on conflict (user_id, day) do nothing;
end $$;
revoke all on function public.pane_active_days_add(date[]) from public, anon;
grant execute on function public.pane_active_days_add(date[]) to authenticated;

-- For the signed-in account: whether it has answered, on any device, and its days of use.
create or replace function public.pane_share_ask_state() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'decided', exists (select 1 from public.pane_share_ask a where a.user_id = (select auth.uid())),
    'days',    (select count(*) from public.pane_active_days d where d.user_id = (select auth.uid())))
$$;
revoke all on function public.pane_share_ask_state() from public, anon;
grant execute on function public.pane_share_ask_state() to authenticated;

-- Over the last `days`: accounts shown the ask, and how many of them chose each answer.
create or replace function public.pane_share_ask_report(days integer default 30)
returns table (shown_accounts bigint, shared_x bigint, shared_linkedin bigint, dismissed bigint)
language sql stable security definer set search_path = '' as $$
  with w as (
    select * from public.pane_tip_activity
    where tip = 'shareAsk' and day >= (now() at time zone 'utc')::date - greatest(days, 1)
  )
  select count(distinct user_id) filter (where event = 'shown'),
         count(distinct user_id) filter (where event = 'shared_x'),
         count(distinct user_id) filter (where event = 'shared_linkedin'),
         count(distinct user_id) filter (where event = 'dismissed')
  from w
$$;
revoke all on function public.pane_share_ask_report(integer) from public, anon, authenticated;
grant execute on function public.pane_share_ask_report(integer) to service_role;
