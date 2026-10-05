-- Note page widgets (prototype): a note's home-screen widget, a small JSON spec of native blocks
-- that bind to the note's data (supabase/functions/mcp/widget.ts). It holds no data itself but is
-- sealed like the page (context "widget:<note id>"), in the page's row: locking or deleting the
-- note drops both, and a pull of note_pages brings both.
alter table public.note_pages
  add column widget_ct text check (widget_ct is null or (widget_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$' and octet_length(widget_ct) <= 16000));

-- The key check covers the widget too.
create or replace function public.pane_note_page_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  k text;
begin
  if new.page_ct is not null or new.widget_ct is not null then
    select key_id into k from public.account_keys where user_id = new.user_id;
    if k is null
      or (new.page_ct is not null and split_part(new.page_ct, '.', 2) <> k)
      or (new.widget_ct is not null and split_part(new.widget_ct, '.', 2) <> k) then
      raise exception 'This device has an old key for your notes. Open Amber Notes again to get the current one.'
        using errcode = '42501', hint = 'wrong_key';
    end if;
  end if;
  new.client := left(coalesce(public.pane_writer(), new.client), 100);
  new.updated_at := now();
  new.server_updated_at := clock_timestamp();
  return new;
end $$;
