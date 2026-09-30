-- Locked notes, like Apple Notes: a note's text is encrypted on the device with a key made from
-- the notes password, so the server, the MCP tools and any AI only ever see ciphertext.
--
-- What the server holds for a locked note:
--   notes.body         its title only (one line, plain text), so the list, the AI tools and the
--                      title column keep working. Never more: a check below makes sure.
--   notes.locked_body  "amb1.<key id>.<base64 AES-GCM box>": the whole markdown, sealed.
--   note_locks         one row per account: the random salt and iteration count the key is
--                      derived with (PBKDF2-SHA256), a sealed known text to check a password
--                      against, the hint, and the key id. Never the password or the key.
--
-- The key id is the first 16 hex digits of SHA-256(salt). Changing the password makes a new
-- salt (so a new key id) and the app re-encrypts every locked note. A device that still has the
-- old key can't write a note sealed with it: the write is refused until it has the new password.
--
-- Version history never keeps readable text of a locked note. Locking a note deletes every
-- earlier version (the app says so when you lock); while it's locked, versions keep the
-- ciphertext (note_revisions.locked_body) and the title only.
--
-- Locking a shared note stops its link, and a locked note can't be shared. AI tools (pane.source
-- 'mcp') can't change a locked note's text or lock one; the MCP server also skips locked notes
-- in search and says "This note is locked" when asked to read one.
--
-- Additive: older apps never send locked_body, and a note without it behaves as before.

create table public.note_locks (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  salt text not null check (salt ~ '^[A-Za-z0-9+/]{22,88}={0,2}$'),
  iterations integer not null check (iterations between 100000 and 10000000),
  key_id text not null check (key_id ~ '^[0-9a-f]{16}$'),
  verifier text not null check (char_length(verifier) <= 300),
  hint text check (hint is null or char_length(hint) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.note_locks enable row level security;
create policy "own note lock" on public.note_locks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.note_locks from anon;
-- Forgetting the password can't be undone by deleting the row: the notes stay sealed with it.
revoke delete on public.note_locks from authenticated;

alter table public.notes
  add column locked_body text check (locked_body is null or (
    octet_length(locked_body) <= 3000000
    and locked_body ~ '^amb1\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$')),
  -- A locked note's body is its title and nothing else.
  add constraint notes_locked_title_only check (locked_body is null or (strpos(body, E'\n') = 0 and char_length(body) <= 300));

alter table public.note_revisions add column locked_body text;

-- Guards on locked notes, before notes_touch (triggers of a kind fire in name order).
create or replace function public.pane_note_lock() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  src text := coalesce(nullif(current_setting('pane.source', true), ''), 'app');
begin
  if src = 'mcp' and (
       (tg_op = 'INSERT' and new.locked_body is not null)
       or (tg_op = 'UPDATE' and (new.locked_body is distinct from old.locked_body
                                 or (old.locked_body is not null and new.body is distinct from old.body)))) then
    raise exception 'This note is locked. Open it in Amber Notes to change it.' using errcode = '42501';
  end if;
  if new.locked_body is not null and (tg_op = 'INSERT' or new.locked_body is distinct from old.locked_body)
     and not exists (select 1 from public.note_locks l
                     where l.user_id = new.user_id and l.key_id = split_part(new.locked_body, '.', 2)) then
    raise exception 'This note was locked with a different notes password. Enter your current notes password in Amber Notes.'
      using errcode = '23514', hint = 'stale_lock_key';
  end if;
  if tg_op = 'UPDATE' and old.locked_body is null and new.locked_body is not null then
    -- Locking a shared note stops its link.
    update public.note_shares set revoked_at = now() where note_id = old.id and revoked_at is null;
  end if;
  return new;
end $$;

create trigger notes_lock before insert or update on public.notes
  for each row execute function public.pane_note_lock();

-- As in 20260929200000, plus: locking a note deletes its history, a locked note's versions keep
-- only ciphertext, and a change to the sealed text counts as a change to the note's text.
create or replace function public.pane_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  src text := coalesce(nullif(current_setting('pane.source', true), ''), 'app');
  who text := public.pane_writer();
  changed boolean;
begin
  new.server_updated_at := clock_timestamp();
  if tg_table_name = 'notes' then
    if tg_op = 'INSERT' then
      new.body_source := left(src, 20);
      new.body_client := who;
      new.body_at := clock_timestamp();
    elsif tg_op = 'UPDATE' then
      new.version := old.version + 1;
      changed := new.body is distinct from old.body or new.locked_body is distinct from old.locked_body;
      if changed then
        new.body_source := left(src, 20);
        new.body_client := who;
        new.body_at := clock_timestamp();
      else
        new.body_source := old.body_source;
        new.body_client := old.body_client;
        new.body_at := old.body_at;
      end if;
      if new.deleted_at is not null then
        delete from public.note_revisions where note_id = old.id;
      elsif old.locked_body is null and new.locked_body is not null then
        -- Locking: no readable copy of the note may stay behind, and none is made now.
        delete from public.note_revisions where note_id = old.id;
      elsif changed and (old.body <> '' or old.locked_body is not null)
        and (src <> 'app' or not exists (select 1 from public.note_revisions r
                        where r.note_id = old.id and r.source = 'app'
                          and r.created_at > clock_timestamp() - interval '1 minute')) then
        insert into public.note_revisions (note_id, user_id, body, locked_body, version, source, client, body_source, body_client, body_at)
        values (old.id, old.user_id, old.body, old.locked_body, old.version, src, who, old.body_source, old.body_client, old.body_at);
      end if;
    end if;
  end if;
  return new;
end $$;

-- Restore This Version: as in 20260929200000, and a version saved while the note was locked
-- comes back locked (its ciphertext with it).
create or replace function public.restore_note_version(p_note uuid, p_version bigint)
returns setof public.notes language plpgsql security invoker set search_path = '' as $$
declare
  kept text;
  kept_lock text;
begin
  select r.body, r.locked_body into kept, kept_lock from public.note_revisions r
  where r.note_id = p_note and r.version = p_version
  order by r.id desc limit 1;
  if not found then
    raise exception 'That version is no longer kept.' using errcode = 'PT404', hint = 'no_such_version';
  end if;
  perform set_config('pane.source', 'restore', true);
  return query
    update public.notes n set body = kept, locked_body = kept_lock, updated_at = now()
    where n.id = p_note and n.deleted_at is null
    returning n.*;
end $$;
revoke all on function public.restore_note_version(uuid, bigint) from public, anon;
grant execute on function public.restore_note_version(uuid, bigint) to authenticated;

-- As in 20260929090000, but a locked note can't be shared.
create or replace function public.share_note(p_note uuid, p_include_subnotes boolean default false)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_slug text;
begin
  if v_user is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.notes n
                 where n.id = p_note and n.user_id = v_user and n.deleted_at is null and n.trashed_at is null) then
    raise exception 'no such note' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.notes n where n.id = p_note and n.locked_body is not null) then
    raise exception 'A locked note can''t be shared. Remove its lock first.' using errcode = '42501', hint = 'note_locked';
  end if;
  update public.note_shares set include_subnotes = coalesce(p_include_subnotes, false)
    where note_id = p_note and revoked_at is null
    returning slug into v_slug;
  if v_slug is null then
    v_slug := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
    insert into public.note_shares (slug, note_id, user_id, include_subnotes)
      values (v_slug, p_note, v_user, coalesce(p_include_subnotes, false));
  end if;
  return v_slug;
end $$;
revoke all on function public.share_note(uuid, boolean) from public, anon;
grant execute on function public.share_note(uuid, boolean) to authenticated;

-- As in 20260929140000, but a locked note never shows through a link, not even as a sub-note
-- of a shared note, and isn't listed among its sub-notes.
create or replace function public.shared_note(p_slug text, p_sub uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.note_shares;
  n public.notes;
  target uuid;
begin
  if p_slug is null or p_slug !~ '^[A-Za-z0-9_-]{24,64}$' then return null; end if;
  select * into s from public.note_shares where slug = p_slug and revoked_at is null;
  if not found then return null; end if;
  target := s.note_id;
  if p_sub is not null then
    if not s.include_subnotes then return null; end if;
    -- The sub-note must sit under the shared note.
    if not exists (
      with recursive tree(id) as (
        select c.id from public.notes c
          where c.parent_id = s.note_id and c.user_id = s.user_id and c.deleted_at is null and c.trashed_at is null
        union
        select c.id from public.notes c join tree t on c.parent_id = t.id
          where c.user_id = s.user_id and c.deleted_at is null and c.trashed_at is null
      ) select 1 from tree where id = p_sub) then
      return null;
    end if;
    target := p_sub;
  end if;
  select * into n from public.notes
    where id = target and user_id = s.user_id and deleted_at is null and trashed_at is null and locked_body is null;
  if not found then return null; end if;
  -- The root note itself must still be live for any of its pages to show.
  if target <> s.note_id and not exists (select 1 from public.notes r
      where r.id = s.note_id and r.deleted_at is null and r.trashed_at is null and r.locked_body is null) then
    return null;
  end if;
  return jsonb_build_object(
    'title', n.title,
    'body', n.body,
    'updated_at', n.updated_at,
    'include_subnotes', s.include_subnotes,
    'is_sub', target <> s.note_id,
    'root_title', (select r.title from public.notes r where r.id = s.note_id),
    'shared_by', public.pane_sharer(s.user_id),
    'subnotes', case when s.include_subnotes then coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title) order by c.title)
        from public.notes c
        where c.parent_id = n.id and c.user_id = s.user_id and c.deleted_at is null and c.trashed_at is null
          and c.locked_body is null
      ), '[]'::jsonb) else '[]'::jsonb end);
end $$;
revoke all on function public.shared_note(text, uuid) from public;
grant execute on function public.shared_note(text, uuid) to anon, authenticated;

-- As in 20260928220000, but locked notes are left out: their text is sealed, and search is
-- what the AI tools use to find notes to read.
create or replace function public.search_notes(q text, max_results int default 20)
returns table (id uuid, title text, folder_id uuid, updated_at timestamptz, snippet text, rank real)
language sql stable security invoker set search_path = '' as $$
  with p as (
    select websearch_to_tsquery('simple', q) as tsq,
           '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  ),
  hits as (
    select n.id, n.title, n.folder_id, n.updated_at, n.body,
           (ts_rank(n.search, p.tsq) * 2
             + extensions.word_similarity(q, n.title)
             + case when n.title ilike p.pattern then 1 else 0 end)::real as rank
    from public.notes n, p
    where n.deleted_at is null and n.trashed_at is null and n.locked_body is null
      and (n.search @@ p.tsq or n.body ilike p.pattern)
    order by rank desc, n.updated_at desc
    limit least(greatest(max_results, 1), 100)
  )
  select h.id, h.title, h.folder_id, h.updated_at,
         ts_headline('simple', h.body, p.tsq,
           'MaxWords=24, MinWords=8, StartSel=«, StopSel=», MaxFragments=2') as snippet,
         h.rank
  from hits h, p
  order by h.rank desc, h.updated_at desc
$$;
