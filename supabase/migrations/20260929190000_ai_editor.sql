-- Which AI last changed a note, and when, so the apps can show it: the changed lines tinted,
-- "ChatGPT changed 5 lines" with Undo, and "Edited by Claude" in the note list.
--
-- Set by the database in the same write as the edit itself. MCP calls run with
-- pane.source = 'mcp' (or 'restore' for restore_revision) and pane.client = the connection's
-- name (see functions/mcp/tools.ts). Any other write keeps whatever was there, so an edit in the
-- app neither clears nor forges these. Additive only: older apps ignore the columns.

alter table public.notes
  add column ai_editor text check (ai_editor is null or char_length(ai_editor) <= 100),
  add column ai_edited_at timestamptz;

create or replace function public.pane_mark_ai_editor() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  src text := coalesce(nullif(current_setting('pane.source', true), ''), 'app');
  who text := nullif(current_setting('pane.client', true), '');
begin
  if src in ('mcp', 'restore') and who is not null
     and (tg_op = 'INSERT' or new.body is distinct from old.body) then
    new.ai_editor := left(who, 100);
    new.ai_edited_at := clock_timestamp();
  elsif tg_op = 'INSERT' then
    new.ai_editor := null;
    new.ai_edited_at := null;
  else
    new.ai_editor := old.ai_editor;
    new.ai_edited_at := old.ai_edited_at;
  end if;
  return new;
end $$;

-- Runs before notes_touch (triggers of a kind fire in name order); neither depends on the other.
create trigger notes_ai_editor before insert or update on public.notes
  for each row execute function public.pane_mark_ai_editor();
