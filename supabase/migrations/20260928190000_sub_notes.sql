-- Sub-notes: a note that belongs to another note and is reached through a link in it.
alter table public.notes add column parent_id uuid references public.notes (id) on delete set null;
create index notes_parent on public.notes (parent_id) where parent_id is not null;
