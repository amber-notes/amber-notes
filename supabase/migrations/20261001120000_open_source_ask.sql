-- The share ask, for developers: "Enjoying Amber Notes? It's open source." with Star on GitHub.
--
-- Same rules as before (7 days of use, once per account, any answer ends it). Who counts as a
-- developer is read from the account's AI connections, ever made (a disconnected one stays in
-- mcp_tokens with revoked_at): an access token (Claude Code, Codex and other tools that take a
-- header token), or an OAuth connection that returned to this computer (a loopback redirect:
-- Claude Code, Codex, Gemini CLI and Incredible sign in that way). Everyone else gets the ask as
-- it was.

alter table public.pane_share_ask drop constraint pane_share_ask_choice_check;
alter table public.pane_share_ask add constraint pane_share_ask_choice_check
  check (choice in ('shared_x', 'shared_linkedin', 'starred_github', 'dismissed'));
alter table public.pane_tip_activity drop constraint pane_tip_activity_event_check;
alter table public.pane_tip_activity add constraint pane_tip_activity_event_check
  check (event in ('shown', 'used', 'shared_x', 'shared_linkedin', 'starred_github', 'dismissed'));

-- Whether the signed-in account has ever connected a developer tool.
create or replace function public.pane_is_developer(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.mcp_tokens t
    where t.user_id = p_user
      and (t.kind = 'token' or (t.kind = 'oauth' and t.redirect_host in ('localhost', '127.0.0.1', '[::1]'))))
$$;
revoke all on function public.pane_is_developer(uuid) from public, anon, authenticated;

-- As in 20260930120000, plus whether the ask is the developers' one.
create or replace function public.pane_share_ask_state() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'decided',   exists (select 1 from public.pane_share_ask a where a.user_id = (select auth.uid())),
    'days',      (select count(*) from public.pane_active_days d where d.user_id = (select auth.uid())),
    'developer', public.pane_is_developer((select auth.uid())))
$$;
revoke all on function public.pane_share_ask_state() from public, anon;
grant execute on function public.pane_share_ask_state() to authenticated;

-- As in 20260930120000, with the stars.
drop function public.pane_share_ask_report(integer);
create function public.pane_share_ask_report(days integer default 30)
returns table (shown_accounts bigint, shared_x bigint, shared_linkedin bigint, starred_github bigint, dismissed bigint)
language sql stable security definer set search_path = '' as $$
  with w as (
    select * from public.pane_tip_activity
    where tip = 'shareAsk' and day >= (now() at time zone 'utc')::date - greatest(days, 1)
  )
  select count(distinct user_id) filter (where event = 'shown'),
         count(distinct user_id) filter (where event = 'shared_x'),
         count(distinct user_id) filter (where event = 'shared_linkedin'),
         count(distinct user_id) filter (where event = 'starred_github'),
         count(distinct user_id) filter (where event = 'dismissed')
  from w
$$;
revoke all on function public.pane_share_ask_report(integer) from public, anon, authenticated;
