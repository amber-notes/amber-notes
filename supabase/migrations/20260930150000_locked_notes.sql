-- Locked notes, like Apple Notes: a note's text is encrypted on the device with a key made from
-- the notes password, so the server, the MCP tools and any AI only ever see ciphertext.
--
-- What the server holds for a locked note:
--   notes.body         its title only (one line, plain text), so the list, the AI tools and the
--                      title column keep working. Never more: a check below makes sure.
--   notes.locked_body  "amb2.<key id>.<base64 AES-GCM box>": the whole markdown, sealed, with the
--                      header and the note's id authenticated, so a box can't be moved to another
--                      note.
--   note_locks         one row per account: the random salt and iteration count the key is
--                      derived with (PBKDF2-SHA256), a sealed known text to check a password
--                      against, the hint, the key id, and every earlier password's salt, count,
--                      key id and proof (its key sealed with the next key). Never a password or
--                      a key in the clear.
--
-- The key id is the first 16 hex digits of SHA-256(salt); the database checks it. Changing the
-- password goes through change_notes_password(), which swaps the setup, writes every note the
-- app sealed again, and deletes the versions sealed with other keys, in one transaction. A new
-- setup must carry the old one forward in `previous`, with a proof the changer knew the old key;
-- the apps check that proof before they trust a new setup. A note sealed with another key can't
-- be written.
--
-- Old builds: once an account has a notes password, every write to its notes through the API
-- must come from an app that knows about locked notes (header x-amber-client: lock-aware/…).
-- Anything older is refused, so it can't upload a readable copy of a locked note.
--
-- Version history never keeps readable text of a locked note. Locking a note deletes every
-- earlier version (the app says so when you lock); while it's locked, versions keep the
-- ciphertext (note_revisions.locked_body) and the title only.
--
-- Locking a shared note stops its link, and a locked note can't be shared. A note that links a
-- file or a sub-note can't be locked. AI tools (pane.agent 'mcp', set once per call by the MCP
-- server; or pane.source 'mcp', which the MCP server deployed before this sets) can't change a
-- locked note's text or lock one; the MCP server also skips locked notes
-- in search and says "This note is locked" when asked to read one.
--
-- Additive: a note without locked_body behaves as before.

create table public.note_locks (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  salt text not null check (salt ~ '^[A-Za-z0-9+/]{22,88}={0,2}$'),
  iterations integer not null check (iterations between 100000 and 10000000),
  key_id text not null check (key_id ~ '^[0-9a-f]{16}$'),
  verifier text not null check (char_length(verifier) <= 300),
  hint text check (hint is null or char_length(hint) <= 200),
  -- Earlier passwords, oldest first: {salt, iterations, key_id, proof}. `proof` is that password's
  -- key sealed with the next one's, so a device that knew any earlier password can check a new
  -- setup, and open notes sealed before the change.
  previous jsonb not null default '[]'::jsonb check (jsonb_typeof(previous) = 'array' and jsonb_array_length(previous) <= 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.note_locks enable row level security;
create policy "own note lock" on public.note_locks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.note_locks from anon;
-- Set up once from the app; changed only through change_notes_password(). Forgetting the password
-- can't be undone by deleting the row: the notes stay sealed with it.
revoke update, delete on public.note_locks from authenticated;

-- The rules for a setup and any change to it, whoever writes it.
create or replace function public.pane_note_locks_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  expected jsonb;
  last jsonb;
  n integer;
begin
  if new.key_id <> left(encode(sha256(decode(new.salt, 'base64')), 'hex'), 16) then
    raise exception 'key_id must be the first 16 hex digits of SHA-256(salt)' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and new.previous <> '[]'::jsonb then
    raise exception 'A first notes password has no earlier ones' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id then
      raise exception 'note_locks.user_id can''t change' using errcode = '23514';
    end if;
    if new.key_id = old.key_id then
      -- The same password: only the hint may change.
      if new.salt <> old.salt or new.iterations <> old.iterations or new.verifier <> old.verifier
         or new.previous <> old.previous then
        raise exception 'Only the hint can change without a new password' using errcode = '23514';
      end if;
    else
      -- A new password carries the old one forward, with its proof.
      last := new.previous -> -1;
      if last is null or coalesce(char_length(last ->> 'proof'), 0) not between 1 and 300 then
        raise exception 'A new notes password needs a proof of the old one' using errcode = '23514';
      end if;
      expected := old.previous || jsonb_build_array(jsonb_build_object(
        'salt', old.salt, 'iterations', old.iterations, 'key_id', old.key_id, 'proof', last ->> 'proof'));
      n := jsonb_array_length(expected);
      if n > 50 then
        select jsonb_agg(e order by i) into expected
        from jsonb_array_elements(expected) with ordinality as t(e, i) where i > n - 50;
      end if;
      if new.previous <> expected then
        raise exception 'A new notes password must keep every earlier one, the last being the old one' using errcode = '23514';
      end if;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

create trigger note_locks_guard before insert or update on public.note_locks
  for each row execute function public.pane_note_locks_guard();

alter table public.notes
  add column locked_body text check (locked_body is null or (
    octet_length(locked_body) <= 3000000
    and locked_body ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$')),
  -- A locked note's body is its title and nothing else.
  add constraint notes_locked_title_only check (locked_body is null or (strpos(body, E'\n') = 0 and char_length(body) <= 300));

alter table public.note_revisions add column locked_body text;

-- True when this write came through the API (PostgREST) from an app that doesn't know about
-- locked notes. Writes from the database itself and the MCP server carry no request headers.
create or replace function public.pane_old_client() returns boolean
language plpgsql stable set search_path = '' as $$
declare
  headers text := nullif(current_setting('request.headers', true), '');
begin
  if headers is null then return false; end if;
  begin
    return coalesce(headers::json ->> 'x-amber-client', '') !~ '^lock-aware/';
  exception when others then
    return true;
  end;
end $$;

-- Guards on locked notes, before notes_touch (triggers of a kind fire in name order).
create or replace function public.pane_note_lock() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.pane_old_client() and exists (select 1 from public.note_locks l where l.user_id = new.user_id) then
    raise exception 'Update Amber Notes to keep syncing. This account has locked notes, and this version of the app can''t keep them safe.'
      using errcode = '42501', hint = 'update_app';
  end if;
  -- pane.agent is set once per MCP call by the server, and no tool changes it (a restore sets
  -- pane.source, not this). pane.source = 'mcp' covers the MCP server from before pane.agent,
  -- between applying this migration and deploying the new function.
  if (current_setting('pane.agent', true) = 'mcp' or current_setting('pane.source', true) = 'mcp') and (
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
    -- Files and sub-notes live outside the note's text, so they'd stay readable.
    if strpos(old.body, 'pane-file:') > 0 or strpos(old.body, 'pane-note:') > 0 then
      raise exception 'Notes with files or sub-notes can''t be locked.' using errcode = '23514', hint = 'lock_files';
    end if;
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

-- Change Password: the new setup, every locked note the app sealed again, and no versions left
-- sealed with another key, all at once or not at all. `p_notes` is [{id, version, body,
-- locked_body}]: each must still be at `version` (else nothing changes and the app syncs and
-- tries again). Returns the notes' new versions, the locked notes still sealed with an earlier
-- key (the app opens them with the proof chain later), and how many versions went.
create or replace function public.change_notes_password(p_settings jsonb, p_expected_key_id text, p_notes jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  new_key text := p_settings ->> 'key_id';
  n jsonb;
  v bigint;
  versions jsonb := '[]'::jsonb;
  gone integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  update public.note_locks set
      salt = p_settings ->> 'salt',
      iterations = (p_settings ->> 'iterations')::integer,
      key_id = new_key,
      verifier = p_settings ->> 'verifier',
      hint = nullif(p_settings ->> 'hint', ''),
      previous = coalesce(p_settings -> 'previous', '[]'::jsonb)
    where user_id = uid and key_id = p_expected_key_id;
  if not found then
    raise exception 'Your notes password was changed on another device.' using errcode = 'PT409', hint = 'changed_elsewhere';
  end if;
  for n in select * from jsonb_array_elements(coalesce(p_notes, '[]'::jsonb)) loop
    update public.notes set body = n ->> 'body', locked_body = n ->> 'locked_body', updated_at = now()
      where id = (n ->> 'id')::uuid and user_id = uid and version = (n ->> 'version')::bigint
        and locked_body is not null and deleted_at is null
      returning version into v;
    if not found then
      raise exception 'Your notes changed on another device. Try again in a moment.' using errcode = '40001', hint = 'notes_changed';
    end if;
    versions := versions || jsonb_build_array(jsonb_build_object('id', n ->> 'id', 'version', v));
  end loop;
  -- No version stays sealed with a password that's no longer yours.
  delete from public.note_revisions
    where user_id = uid and locked_body is not null and split_part(locked_body, '.', 2) <> new_key;
  get diagnostics gone = row_count;
  return jsonb_build_object(
    'notes', versions,
    'stale', coalesce((select jsonb_agg(id) from public.notes
                       where user_id = uid and deleted_at is null and locked_body is not null
                         and split_part(locked_body, '.', 2) <> new_key), '[]'::jsonb),
    'versions_removed', gone);
end $$;
revoke all on function public.change_notes_password(jsonb, text, jsonb) from public, anon;
grant execute on function public.change_notes_password(jsonb, text, jsonb) to authenticated;

-- Storage: a locked note's sealed text counts toward the account's quota (pane_usage.notes_bytes)
-- and toward its history's 10 MB like any text; otherwise locking would be a way around both.
-- No note has locked_body before this migration, so there is nothing to recount.
create or replace function public.pane_note_size(body text, locked_body text) returns bigint
language sql immutable parallel safe set search_path = '' as $$
  select octet_length(body)::bigint + coalesce(octet_length(locked_body), 0)
$$;

-- As in 20260929120100, counting a note's size with pane_note_size.
create or replace function public.pane_account_note() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := coalesce(new.user_id, old.user_id);
  d_notes int := 0;
  d_bytes bigint := 0;
  u public.pane_usage;
  p uuid;
  depth int := 0;
begin
  -- The account itself is being deleted: nothing left to count (and no row to recreate).
  if not exists (select 1 from auth.users where id = owner) then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    update public.pane_usage x
      set notes = greatest(x.notes - case when old.deleted_at is null then 1 else 0 end, 0),
          notes_bytes = greatest(x.notes_bytes - public.pane_note_size(old.body, old.locked_body), 0)
      where x.user_id = old.user_id;
    return old;
  else
    perform public.pane_take('write');
    if octet_length(new.body) > public.pane_limit('note_bytes')
       and (tg_op = 'INSERT' or octet_length(new.body) > octet_length(old.body)) then
      perform public.pane_over('note_bytes');
    end if;
    if new.folder_id is not null and (tg_op = 'INSERT' or new.folder_id is distinct from old.folder_id)
       and not exists (select 1 from public.folders f where f.id = new.folder_id and f.user_id = new.user_id) then
      perform public.pane_over('not_yours');
    end if;
    if new.parent_id is not null and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
      p := new.parent_id;
      while p is not null loop
        if p = new.id then perform public.pane_over('subnote_loop'); end if;
        depth := depth + 1;
        if depth > public.pane_limit('subnote_depth') then perform public.pane_over('subnote_depth'); end if;
        select n.parent_id into p from public.notes n where n.id = p and n.user_id = new.user_id;
        if not found then
          if depth = 1 then perform public.pane_over('not_yours'); end if;
          exit;
        end if;
      end loop;
    end if;
    if tg_op = 'INSERT' then
      d_notes := case when new.deleted_at is null then 1 else 0 end;
      d_bytes := public.pane_note_size(new.body, new.locked_body);
    else
      d_notes := (case when new.deleted_at is null then 1 else 0 end) - (case when old.deleted_at is null then 1 else 0 end);
      d_bytes := public.pane_note_size(new.body, new.locked_body) - public.pane_note_size(old.body, old.locked_body);
    end if;
  end if;
  if d_notes = 0 and d_bytes = 0 then return coalesce(new, old); end if;
  insert into public.pane_usage as x (user_id, notes, notes_bytes) values (owner, greatest(d_notes, 0), greatest(d_bytes, 0))
  on conflict (user_id) do update set notes = greatest(x.notes + d_notes, 0), notes_bytes = greatest(x.notes_bytes + d_bytes, 0)
  returning * into u;
  if d_notes > 0 and u.notes > public.pane_limit('notes') then perform public.pane_over('notes'); end if;
  if d_bytes > 0 and u.notes_bytes > public.pane_limit('notes_bytes') then perform public.pane_over('notes_bytes'); end if;
  return coalesce(new, old);
end $$;


-- As in 20260929200000, counting a version's size with its sealed text.
create or replace function public.pane_thin_revisions(p_note uuid, p_now timestamptz default clock_timestamp())
returns integer language plpgsql security definer set search_path = '' as $$
declare
  gone integer;
begin
  with r as (
    select id, created_at, octet_length(body) + coalesce(octet_length(locked_body), 0) as bytes, p_now - created_at as age,
           'mcp' in (source, coalesce(body_source, '')) as ai,
           row_number() over (partition by date_trunc('hour', created_at at time zone 'utc') order by created_at desc, id desc) as in_hour,
           row_number() over (partition by date_trunc('day', created_at at time zone 'utc') order by created_at desc, id desc) as in_day
    from public.note_revisions where note_id = p_note
  ), kept as (
    select id, bytes, created_at from r
    where age < interval '24 hours'
       or (age < interval '7 days' and in_hour = 1)
       or (age < interval '90 days' and (in_day = 1 or ai))
  ), capped as (
    select id, row_number() over w as n, sum(bytes) over w as total
    from kept window w as (order by created_at desc, id desc)
  )
  delete from public.note_revisions d
  where d.note_id = p_note
    and not exists (select 1 from capped c
                    where c.id = d.id and c.n <= public.pane_limit('revisions')
                      and (c.n = 1 or c.total <= public.pane_limit('revision_bytes')));
  get diagnostics gone = row_count;
  return gone;
end $$;
revoke all on function public.pane_thin_revisions(uuid, timestamptz) from public, anon, authenticated;
