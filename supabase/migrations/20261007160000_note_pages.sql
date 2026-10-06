-- Note pages (prototype): an optional view an AI writes over a note. The note's markdown stays the
-- data; a page is one self-contained HTML document that shows it, sealed like everything else
-- (context "page:<note id>"). Deleting a page loses no data, so it lives in its own table: the
-- note's text, its versions and its conflict handling don't change at all.
--
-- A removed page keeps its row with page_ct null, so devices pulling by server_updated_at see that
-- it went.
create table public.note_pages (
  note_id uuid primary key references public.notes (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- About 512 KB of HTML once sealed (base64 is 4/3 of what it holds).
  page_ct text check (page_ct is null or (page_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$' and octet_length(page_ct) <= 700000)),
  -- Who wrote it: the AI client's name, or the device.
  client text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp()
);
create index note_pages_user_updated on public.note_pages (user_id, server_updated_at);

alter table public.note_pages enable row level security;
create policy "own pages" on public.note_pages for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.notes n where n.id = note_id and n.user_id = (select auth.uid()) and n.locked_body is null));
revoke all on public.note_pages from anon;

-- Sealed with the account's current key, like the note itself; stamped for pulls.
create or replace function public.pane_note_page_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  k text;
begin
  if new.page_ct is not null then
    select key_id into k from public.account_keys where user_id = new.user_id;
    if k is null or split_part(new.page_ct, '.', 2) <> k then
      raise exception 'This device has an old key for your notes. Open Amber Notes again to get the current one.'
        using errcode = '42501', hint = 'wrong_key';
    end if;
  end if;
  new.client := left(coalesce(public.pane_writer(), new.client), 100);
  new.updated_at := now();
  new.server_updated_at := clock_timestamp();
  return new;
end $$;
create trigger note_pages_touch before insert or update on public.note_pages
  for each row execute function public.pane_note_page_touch();

-- Locking a note or deleting it for good takes its page too: a page could hold what it showed.
create or replace function public.pane_note_page_drop() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.note_pages where note_id = new.id;
  return new;
end $$;
create trigger notes_drop_page after update of locked_body, deleted_at on public.notes
  for each row when ((old.locked_body is null and new.locked_body is not null) or (old.deleted_at is null and new.deleted_at is not null))
  execute function public.pane_note_page_drop();
