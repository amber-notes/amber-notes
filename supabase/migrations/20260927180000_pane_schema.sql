-- Pane: one person's notes. Every row belongs to auth.uid(); RLS enforces it.

create extension if not exists pg_trgm with schema extensions;

create table public.folders (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  parent_id uuid references public.folders (id) on delete set null,
  sort_index double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Server clock for sync cursors; set by trigger, never by clients.
  server_updated_at timestamptz not null default clock_timestamp()
);

create table public.notes (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  folder_id uuid references public.folders (id) on delete set null,
  body text not null default '' check (octet_length(body) <= 5000000),
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  trashed_at timestamptz,
  deleted_at timestamptz,
  -- Bumped on every write; clients send the version they edited to detect conflicts.
  version bigint not null default 1,
  server_updated_at timestamptz not null default clock_timestamp(),
  title text generated always as (
    coalesce(nullif(btrim(regexp_replace(split_part(ltrim(body, E' \n\t'), E'\n', 1), '^#+\s*|[*_~`]', '', 'g')), ''), 'New Note')
  ) stored,
  search tsvector generated always as (to_tsvector('simple', body)) stored
);

-- Every body a note has had, so any edit (yours or an AI's) can be undone.
create table public.note_revisions (
  id bigint generated always as identity primary key,
  note_id uuid not null references public.notes (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null,
  version bigint not null,
  source text not null default 'app' check (source in ('app', 'mcp', 'import', 'restore')),
  client text,
  created_at timestamptz not null default now()
);

create index notes_user_sync on public.notes (user_id, server_updated_at);
create index folders_user_sync on public.folders (user_id, server_updated_at);
create index notes_search on public.notes using gin (search);
create index notes_body_trgm on public.notes using gin (body extensions.gin_trgm_ops);
create index notes_folder on public.notes (folder_id) where deleted_at is null;
create index note_revisions_note on public.note_revisions (note_id, created_at desc);

-- Stamps the server clock, bumps versions and records revisions.
create or replace function public.pane_touch() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.server_updated_at := clock_timestamp();
  if tg_table_name = 'notes' then
    if tg_op = 'UPDATE' then
      new.version := old.version + 1;
      if new.body is distinct from old.body and old.body <> '' then
        insert into public.note_revisions (note_id, user_id, body, version, source, client)
        values (old.id, old.user_id, old.body, old.version,
                coalesce(nullif(current_setting('pane.source', true), ''), 'app'),
                nullif(current_setting('pane.client', true), ''));
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger folders_touch before insert or update on public.folders
  for each row execute function public.pane_touch();
create trigger notes_touch before insert or update on public.notes
  for each row execute function public.pane_touch();

-- Keep 200 revisions per note.
create or replace function public.pane_trim_revisions() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.note_revisions r
  where r.note_id = new.note_id
    and r.id not in (select id from public.note_revisions where note_id = new.note_id order by id desc limit 200);
  return null;
end $$;

create trigger note_revisions_trim after insert on public.note_revisions
  for each row execute function public.pane_trim_revisions();

alter table public.folders enable row level security;
alter table public.notes enable row level security;
alter table public.note_revisions enable row level security;

create policy "own folders" on public.folders for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own notes" on public.notes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own revisions read" on public.note_revisions for select to authenticated
  using (user_id = (select auth.uid()));

-- Nothing is readable without signing in.
revoke all on public.folders, public.notes, public.note_revisions from anon;

-- Ranked search across titles and bodies, for the app and the AI tools.
create or replace function public.search_notes(q text, max_results int default 20)
returns table (id uuid, title text, folder_id uuid, updated_at timestamptz, snippet text, rank real)
language sql stable security invoker set search_path = '' as $$
  select n.id, n.title, n.folder_id, n.updated_at,
         ts_headline('simple', n.body, websearch_to_tsquery('simple', q),
           'MaxWords=24, MinWords=8, StartSel=«, StopSel=», MaxFragments=2') as snippet,
         (ts_rank(n.search, websearch_to_tsquery('simple', q)) * 2
           + extensions.similarity(n.body, q)
           + case when n.title ilike '%' || q || '%' then 1 else 0 end)::real as rank
  from public.notes n
  where n.deleted_at is null and n.trashed_at is null
    and (n.search @@ websearch_to_tsquery('simple', q) or n.body ilike '%' || q || '%')
  order by rank desc, n.updated_at desc
  limit least(greatest(max_results, 1), 100)
$$;
