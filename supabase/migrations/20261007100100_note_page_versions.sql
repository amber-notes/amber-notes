-- Note pages (prototype): the last 10 pages of each note, so a page an AI replaces or removes can
-- always be read back and restored. Only the database writes here: when a page's box changes, the
-- box it had is kept as it was (the database never reads it).
create table public.note_page_versions (
  id bigint generated always as identity primary key,
  note_id uuid not null references public.notes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  page_ct text not null check (page_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$' and octet_length(page_ct) <= 700000),
  client text,
  -- When that page was set, and when it was replaced or removed.
  made_at timestamptz not null,
  replaced_at timestamptz not null default now()
);
create index note_page_versions_note on public.note_page_versions (note_id, id desc);

alter table public.note_page_versions enable row level security;
create policy "own page versions read" on public.note_page_versions for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.note_page_versions from anon;
revoke insert, update, delete on public.note_page_versions from authenticated;

create or replace function public.pane_note_page_keep() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.note_page_versions (note_id, user_id, page_ct, client, made_at)
  values (old.note_id, old.user_id, old.page_ct, old.client, old.updated_at);
  delete from public.note_page_versions v
  where v.note_id = old.note_id
    and v.id not in (select id from public.note_page_versions where note_id = old.note_id order by id desc limit 10);
  return new;
end $$;
create trigger note_pages_keep after update of page_ct on public.note_pages
  for each row when (old.page_ct is not null and old.page_ct is distinct from new.page_ct)
  execute function public.pane_note_page_keep();

-- Locking or purging a note takes its old pages too.
create or replace function public.pane_note_page_drop() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.note_pages where note_id = new.id;
  delete from public.note_page_versions where note_id = new.id;
  return new;
end $$;
