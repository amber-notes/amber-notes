-- "Show Setup Guide" (Help menu on the Mac, Settings on iPhone) puts the first-run card back at
-- step 1: pane_setup_mark('reset') clears imported, dismissed and celebrated for the signed-in
-- account. Connecting an AI and its first edit are facts elsewhere, so they aren't touched.
create or replace function public.pane_setup_mark(step text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if step not in ('imported', 'dismissed', 'celebrated', 'reset') then
    raise exception 'unknown step' using errcode = '22023';
  end if;
  insert into public.pane_setup (user_id) values (uid) on conflict (user_id) do nothing;
  if step = 'reset' then
    update public.pane_setup set imported_at = null, dismissed_at = null, celebrated_at = null, updated_at = now()
    where user_id = uid;
    return;
  end if;
  update public.pane_setup set
    imported_at   = case when step = 'imported'   then coalesce(imported_at, now())   else imported_at end,
    dismissed_at  = case when step = 'dismissed'  then coalesce(dismissed_at, now())  else dismissed_at end,
    celebrated_at = case when step = 'celebrated' then coalesce(celebrated_at, now()) else celebrated_at end,
    updated_at = now()
  where user_id = uid;
end $$;
revoke all on function public.pane_setup_mark(text) from public, anon;
grant execute on function public.pane_setup_mark(text) to authenticated;
