-- Deleting a note forever (the app blanks the body and sets deleted_at) used to save the
-- last body as a revision, and kept every earlier revision too. A purged note now leaves
-- no text behind: its revisions go, and the purge itself records none.
create or replace function public.pane_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.server_updated_at := clock_timestamp();
  if tg_table_name = 'notes' then
    if tg_op = 'UPDATE' then
      new.version := old.version + 1;
      if new.deleted_at is not null then
        delete from public.note_revisions where note_id = old.id;
      elsif new.body is distinct from old.body and old.body <> '' then
        insert into public.note_revisions (note_id, user_id, body, version, source, client)
        values (old.id, old.user_id, old.body, old.version,
                coalesce(nullif(current_setting('pane.source', true), ''), 'app'),
                nullif(current_setting('pane.client', true), ''));
      end if;
    end if;
  end if;
  return new;
end $$;

-- History of notes purged before this change is left alone here; clearing it is a separate,
-- deliberate step:
--   delete from public.note_revisions r using public.notes n
--   where n.id = r.note_id and n.deleted_at is not null;
