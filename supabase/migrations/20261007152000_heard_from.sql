-- "How did you hear about Amber Notes?": one optional question, once per account, right after
-- sign-up. One tap answers it, one tap skips it; either way it's never asked again, on any device.
--
-- Only new accounts are asked: pane_heard_from_state() says to ask while the account has no answer
-- and was made in the last 7 days, so people who signed up before this shipped never see it.
-- The first answer stands. "Something else" can carry a few words of the person's own.
--
-- We read it only in aggregate, through pane_heard_from_summary (owner's tools only).

create table public.pane_heard_from (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  source text not null check (source in (
    'google', 'blog', 'ai_assistant', 'tiktok', 'youtube', 'instagram', 'friend', 'product_hunt_hn', 'other', 'skipped')),
  detail text check (char_length(detail) <= 120),
  answered_at timestamptz not null default now()
);
alter table public.pane_heard_from enable row level security;
create policy "own heard from read" on public.pane_heard_from for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.pane_heard_from from anon, authenticated;
grant select on public.pane_heard_from to authenticated;

-- Whether to ask the signed-in account now.
create or replace function public.pane_heard_from_state() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'ask', not exists (select 1 from public.pane_heard_from h where h.user_id = (select auth.uid()))
           and exists (select 1 from auth.users u where u.id = (select auth.uid()) and u.created_at > now() - interval '7 days'))
$$;
revoke all on function public.pane_heard_from_state() from public, anon;
grant execute on function public.pane_heard_from_state() to authenticated;

-- The signed-in account answered (or skipped). The first answer stands; later ones change nothing.
-- The words are kept only with "other", trimmed, and cut to 120 characters.
create or replace function public.pane_heard_from_answer(source text, detail text default null) returns void
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  words text := nullif(left(btrim(pane_heard_from_answer.detail), 120), '');
begin
  if uid is null then return; end if;
  insert into public.pane_heard_from (user_id, source, detail)
  values (uid, pane_heard_from_answer.source, case when pane_heard_from_answer.source = 'other' then words end)
  on conflict (user_id) do nothing;
end $$;
revoke all on function public.pane_heard_from_answer(text, text) from public, anon;
grant execute on function public.pane_heard_from_answer(text, text) to authenticated;

-- What we look at: answers per source and week, no accounts. Skips are counted too, so the share
-- that answered at all is visible. For the owner's SQL editor and scripts (service role) only.
create view public.pane_heard_from_summary as
  select date_trunc('week', answered_at)::date as week, source, count(*)::int as accounts
  from public.pane_heard_from
  group by 1, 2;
revoke all on public.pane_heard_from_summary from public, anon, authenticated;

-- The words people typed under "Something else", without who typed them.
create view public.pane_heard_from_other as
  select answered_at::date as day, detail
  from public.pane_heard_from
  where source = 'other' and detail is not null;
revoke all on public.pane_heard_from_other from public, anon, authenticated;
