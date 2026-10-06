-- Note apps as projects (prototype): an AI edits an app file by file, often thirty writes in a few
-- minutes. Each would push an earlier app out of the last 10 versions. When the file tools say so
-- (pane.coalesce, set for their transaction only), a page that the same writer made in the last 10
-- minutes is replaced without being kept: Previous App goes back to the app as it was before that
-- session. Everything else is kept exactly as before (20261007100200_page_data.sql).
create or replace function public.pane_note_page_keep() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  page_changed boolean := old.page_ct is not null and old.page_ct is distinct from new.page_ct;
begin
  if not page_changed then
    if exists (select 1 from public.note_page_versions v where v.note_id = old.note_id and v.reason = 'data'
               and v.replaced_at > now() - interval '1 minute') then
      return new;
    end if;
  elsif current_setting('pane.coalesce', true) = 'on'
        and old.client is not distinct from new.client
        and old.updated_at > now() - interval '10 minutes' then
    return new;
  end if;
  insert into public.note_page_versions (note_id, user_id, page_ct, data_ct, client, made_at, reason)
  values (old.note_id, old.user_id, old.page_ct, old.data_ct, old.client, old.updated_at, case when page_changed then 'page' else 'data' end);
  delete from public.note_page_versions v
  where v.note_id = old.note_id
    and v.id not in (select id from public.note_page_versions where note_id = old.note_id order by id desc limit 10);
  return new;
end $$;
