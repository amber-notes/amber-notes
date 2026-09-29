-- Share links: at most 1,000 live links per account, made at the write rate.
-- (One live link per note already holds; this bounds the table for an account with
-- tens of thousands of notes and a script.)
create or replace function public.pane_account_share() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.pane_take('write');
  if (select count(*) from public.note_shares s where s.user_id = new.user_id and s.revoked_at is null) >= 1000 then
    raise exception 'You have 1,000 shared links. Stop sharing some notes to share more.'
      using errcode = 'PT413', hint = 'shares';
  end if;
  return new;
end $$;
create trigger note_shares_account before insert on public.note_shares
  for each row execute function public.pane_account_share();

-- The limit helpers are for the database's own triggers, not for callers.
revoke all on function public.pane_limit(text) from public, anon, authenticated;
revoke all on function public.pane_over(text) from public, anon, authenticated;
