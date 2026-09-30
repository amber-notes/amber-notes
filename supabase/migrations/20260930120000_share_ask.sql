-- "Enjoying Amber Notes?": a one-time ask, after a week of use, to share the app on X or LinkedIn.
-- Asked once per account, on whichever device gets there first: the first choice (shared on X,
-- shared on LinkedIn, or not now) is kept here, and every device asks pane_share_ask_decided()
-- before it asks you.
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

-- Whether the signed-in account has answered it, on any device.
create or replace function public.pane_share_ask_decided() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.pane_share_ask a where a.user_id = (select auth.uid()))
$$;
revoke all on function public.pane_share_ask_decided() from public, anon;
grant execute on function public.pane_share_ask_decided() to authenticated;

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
