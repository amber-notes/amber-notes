-- Note apps: the touch trigger's key check covers an app's draft too (20261007100800_app_drafts.sql),
-- so a draft sealed with an old key is refused like a page. The keep trigger is unchanged: it fires
-- only on page_ct and data_ct, so a draft-only save never makes a version.
create or replace function public.pane_note_page_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  k text;
begin
  if new.page_ct is not null or new.data_ct is not null or new.draft_ct is not null then
    select key_id into k from public.account_keys where user_id = new.user_id;
    if k is null or (new.page_ct is not null and split_part(new.page_ct, '.', 2) <> k)
       or (new.data_ct is not null and split_part(new.data_ct, '.', 2) <> k)
       or (new.draft_ct is not null and split_part(new.draft_ct, '.', 2) <> k) then
      raise exception 'This device has an old key for your notes. Open Amber Notes again to get the current one.'
        using errcode = '42501', hint = 'wrong_key';
    end if;
  end if;
  new.client := left(coalesce(public.pane_writer(), new.client), 100);
  new.updated_at := now();
  new.server_updated_at := clock_timestamp();
  return new;
end $$;
