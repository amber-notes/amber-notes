-- The first-run "Get set up" card, and the adoption measure from the launch plan.
--
-- Setup: which steps an account has done (import, dismissed, celebrated), so the card looks
-- the same on every device. Connecting an AI and the first AI edit aren't stored here: they're
-- facts the server already knows (mcp_tokens, and the activity counter below).
--
-- Adoption, counted on our own server and never shared:
--   * pane_activity: per account and day, how many notes an AI created or changed.
--   * pane_devices:  a random id per app install (not a device identifier), to count devices.
--   * pane_adoption(): weekly MVR/MVA numbers, callable by the service role only.
--     MVR = first AI edit within 24 h of sign-up.
--     MVA = 10+ AI edits on 3+ different days within 14 days of sign-up, and 2+ devices.

create table public.pane_setup (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  imported_at timestamptz,
  dismissed_at timestamptz,
  celebrated_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.pane_setup enable row level security;
create policy "own setup read" on public.pane_setup for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.pane_setup from anon, authenticated;
grant select on public.pane_setup to authenticated;

create table public.pane_activity (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('ai_edit')),
  n integer not null default 0,
  first_at timestamptz not null default now(),
  primary key (user_id, day, kind)
);
alter table public.pane_activity enable row level security;
create policy "own activity read" on public.pane_activity for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.pane_activity from anon, authenticated;
grant select on public.pane_activity to authenticated;

create table public.pane_devices (
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id uuid not null,
  platform text not null check (platform in ('ios', 'macos')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, device_id)
);
alter table public.pane_devices enable row level security;
revoke all on public.pane_devices from anon, authenticated;

-- Every note an AI creates or changes counts once, whatever tool it used. MCP calls run with
-- pane.source = 'mcp' (see functions/mcp/tools.ts), which is how an AI edit is told apart.
create or replace function public.pane_count_ai_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('pane.source', true), '') <> 'mcp' then return null; end if;
  if tg_op = 'UPDATE' and new.body is not distinct from old.body
     and new.deleted_at is not distinct from old.deleted_at
     and new.trashed_at is not distinct from old.trashed_at
     and new.folder_id is not distinct from old.folder_id then
    return null;
  end if;
  -- An account that's being deleted has nothing left to count.
  if not exists (select 1 from auth.users where id = new.user_id) then return null; end if;
  insert into public.pane_activity as a (user_id, day, kind, n)
  values (new.user_id, (now() at time zone 'utc')::date, 'ai_edit', 1)
  on conflict (user_id, day, kind) do update set n = a.n + 1;
  return null;
end $$;
create trigger notes_count_ai_edit after insert or update on public.notes
  for each row execute function public.pane_count_ai_edit();

-- The card's state, for the signed-in account.
create or replace function public.pane_setup_state() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'imported',   s.imported_at is not null,
    'dismissed',  s.dismissed_at is not null,
    'celebrated', s.celebrated_at is not null,
    'connected',  exists (select 1 from public.mcp_tokens t where t.user_id = (select auth.uid())),
    'ai_edits',   coalesce((select sum(a.n) from public.pane_activity a
                            where a.user_id = (select auth.uid()) and a.kind = 'ai_edit'), 0))
  from (select 1) one
  left join public.pane_setup s on s.user_id = (select auth.uid())
$$;
revoke all on function public.pane_setup_state() from public, anon;
grant execute on function public.pane_setup_state() to authenticated;

-- Marks one step for the signed-in account. Only these three names are accepted.
create or replace function public.pane_setup_mark(step text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if step not in ('imported', 'dismissed', 'celebrated') then
    raise exception 'unknown step' using errcode = '22023';
  end if;
  insert into public.pane_setup (user_id) values (uid) on conflict (user_id) do nothing;
  update public.pane_setup set
    imported_at   = case when step = 'imported'   then coalesce(imported_at, now())   else imported_at end,
    dismissed_at  = case when step = 'dismissed'  then coalesce(dismissed_at, now())  else dismissed_at end,
    celebrated_at = case when step = 'celebrated' then coalesce(celebrated_at, now()) else celebrated_at end,
    updated_at = now()
  where user_id = uid;
end $$;
revoke all on function public.pane_setup_mark(text) from public, anon;
grant execute on function public.pane_setup_mark(text) to authenticated;

-- An app install says hello once per launch: a random id it made itself, and its platform.
-- At most 20 installs are kept per account (the oldest go).
create or replace function public.pane_seen_device(device uuid, platform text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if platform not in ('ios', 'macos') then raise exception 'unknown platform' using errcode = '22023'; end if;
  insert into public.pane_devices as d (user_id, device_id, platform) values (uid, device, platform)
  on conflict (user_id, device_id) do update set last_seen = now(), platform = excluded.platform;
  delete from public.pane_devices d where d.user_id = uid and d.device_id in (
    select device_id from public.pane_devices where user_id = uid order by last_seen desc offset 20);
end $$;
revoke all on function public.pane_seen_device(uuid, text) from public, anon;
grant execute on function public.pane_seen_device(uuid, text) to authenticated;

-- Weekly adoption, by sign-up week (Monday, UTC). Service role only.
create or replace function public.pane_adoption(weeks integer default 8)
returns table (
  week date, new_accounts bigint, mvr bigint, mva bigint,
  mvr_pct numeric, mva_pct numeric, median_hours_to_first_ai numeric)
language sql stable security definer set search_path = '' as $$
  with users as (
    select u.id, u.created_at, date_trunc('week', u.created_at at time zone 'utc')::date as week
    from auth.users u
    where u.created_at >= date_trunc('week', now() at time zone 'utc') - make_interval(weeks => greatest(weeks, 1) - 1)
  ),
  per as (
    select us.id, us.week, us.created_at,
      (select min(a.first_at) from public.pane_activity a where a.user_id = us.id and a.kind = 'ai_edit') as first_ai,
      (select coalesce(sum(a.n), 0) from public.pane_activity a where a.user_id = us.id and a.kind = 'ai_edit'
         and a.day < (us.created_at at time zone 'utc')::date + 14) as edits14,
      (select count(distinct a.day) from public.pane_activity a where a.user_id = us.id and a.kind = 'ai_edit'
         and a.day < (us.created_at at time zone 'utc')::date + 14) as days14,
      (select count(*) from public.pane_devices d where d.user_id = us.id) as devices
    from users us
  )
  select week,
    count(*) as new_accounts,
    count(*) filter (where first_ai is not null and first_ai < created_at + interval '24 hours') as mvr,
    count(*) filter (where edits14 >= 10 and days14 >= 3 and devices >= 2) as mva,
    round(100.0 * count(*) filter (where first_ai is not null and first_ai < created_at + interval '24 hours') / nullif(count(*), 0), 1),
    round(100.0 * count(*) filter (where edits14 >= 10 and days14 >= 3 and devices >= 2) / nullif(count(*), 0), 1),
    round((percentile_cont(0.5) within group (order by extract(epoch from first_ai - created_at) / 3600.0)
           filter (where first_ai is not null))::numeric, 1)
  from per
  group by week
  order by week
$$;
revoke all on function public.pane_adoption(integer) from public, anon, authenticated;
grant execute on function public.pane_adoption(integer) to service_role;
