-- End-to-end encryption (docs/Technical/e2ee-design.md).
--
-- Each account gets one random data key, made on the user's first device and never stored here
-- in the clear. Note bodies, titles and previews, folder names, file names and file bytes, and
-- every version are sealed with it on the device (the amb2 box of locked notes, with the data key
-- instead of the notes password key). The server keeps the data key only wrapped:
--
--   account_keys.password_wrap   under the encryption password (PBKDF2, like the notes password)
--   account_keys.recovery_wrap   under the recovery key shown once, if the user kept one
--   oauth_requests.code_wrap     under an authorization code the approving device made (60 s)
--   oauth_tokens.dk_wrap         under each OAuth access or refresh token
--   mcp_tokens.dk_wrap           under a pane_ access token the app made
--   mcp_file_links.dk_wrap       under a 10-minute file link for an AI
--
-- Only hashes of those tokens are stored, so a wrap opens only while a request carries its token.
-- Revoking a connection deletes its wraps.
--
-- An account is encrypted once it has an account_keys row. From then on:
--   * nothing readable may be written into it: a note's body, a folder's name and a file's name
--     must be null (the sealed columns carry them);
--   * apps that can't read sealed notes (no "e2ee/" in x-amber-client) can neither read nor write
--     its notes, folders, files or versions, and are told to update;
--   * version history keeps what the note held before: ciphertext, copied by the database;
--   * a shared note's page shows a readable copy the owner's device (or the AI server, during an
--     AI edit) published, never the note itself.
--
-- Additive: accounts without keys work exactly as before, and the plaintext columns stay until
-- every account has moved (a later migration drops them).

create table public.account_keys (
  user_id        uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- The data key's id: the first 16 hex digits of SHA-256(data key). Never changes.
  key_id         text not null check (key_id ~ '^[0-9a-f]{16}$'),
  -- PBKDF2-SHA256 of the encryption password, as note_locks does it.
  salt           text not null check (salt ~ '^[A-Za-z0-9+/]{22,88}={0,2}$'),
  iterations     integer not null check (iterations between 100000 and 10000000),
  password_wrap  text not null check (char_length(password_wrap) <= 300),
  recovery_wrap  text check (recovery_wrap is null or char_length(recovery_wrap) <= 300),
  -- Set once nothing readable is left in the account (finish_e2ee_migration).
  migrated_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.account_keys enable row level security;
create policy "own account keys read" on public.account_keys for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own account keys insert" on public.account_keys for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own account keys update" on public.account_keys for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.account_keys from anon;
revoke update, delete on public.account_keys from authenticated;
-- A new password or recovery key wraps the same data key again; nothing else changes here.
grant update (salt, iterations, password_wrap, recovery_wrap) on public.account_keys to authenticated;

create or replace function public.pane_account_keys_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.key_id <> old.key_id or new.user_id <> old.user_id then
      raise exception 'An account''s data key can''t be replaced' using errcode = '23514';
    end if;
    new.updated_at := now();
  end if;
  if new.password_wrap !~ ('^amb2\.' || new.key_id || '\.[A-Za-z0-9+/]+={0,2}$')
     or (new.recovery_wrap is not null and new.recovery_wrap !~ ('^amb2\.' || new.key_id || '\.[A-Za-z0-9+/]+={0,2}$')) then
    raise exception 'A wrap must hold this account''s data key' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger account_keys_guard before insert or update on public.account_keys
  for each row execute function public.pane_account_keys_guard();

-- Whether an account is encrypted. Definer: triggers and policies ask it for any account.
create or replace function public.pane_e2ee_account(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.account_keys k where k.user_id = p_user)
$$;
revoke all on function public.pane_e2ee_account(uuid) from public, anon;
grant execute on function public.pane_e2ee_account(uuid) to authenticated, service_role;

-- Whether this request may see sealed rows: an app that reads them (x-amber-client "… e2ee/…"),
-- or no API request at all (realtime, the database itself, the MCP server).
create or replace function public.pane_e2ee_client() returns boolean
language plpgsql stable set search_path = '' as $$
declare
  headers text := nullif(current_setting('request.headers', true), '');
begin
  if headers is null then return true; end if;
  begin
    return coalesce(headers::json ->> 'x-amber-client', '') ~ '(^|\s)e2ee/';
  exception when others then
    return false;
  end;
end $$;
grant execute on function public.pane_e2ee_client() to anon, authenticated, service_role;

-- MARK: Sealed columns

alter table public.notes
  alter column body drop not null,
  add column body_ct text check (body_ct is null or (octet_length(body_ct) <= 3000000 and body_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$')),
  add column head_ct text check (head_ct is null or (octet_length(head_ct) <= 8000 and head_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$'));

alter table public.note_revisions
  alter column body drop not null,
  add column body_ct text,
  add column head_ct text;

alter table public.folders
  alter column name drop not null,
  add column name_ct text check (name_ct is null or (octet_length(name_ct) <= 2000 and name_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$'));

alter table public.attachments
  alter column filename drop not null,
  add column meta_ct text check (meta_ct is null or (octet_length(meta_ct) <= 4000 and meta_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$'));

-- MARK: The guard: an encrypted account takes only sealed writes, from apps that know how

create or replace function public.pane_e2ee_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  readable boolean;
begin
  if not public.pane_e2ee_account(new.user_id) then return new; end if;
  if not public.pane_e2ee_client() then
    raise exception 'Update Amber Notes to keep syncing. Your notes are now end-to-end encrypted, and this version of the app can''t read them.'
      using errcode = '42501', hint = 'update_app';
  end if;
  readable := case tg_table_name
    when 'notes' then new.body is not null and new.body <> ''
      and (tg_op = 'INSERT' or new.body is distinct from old.body)
    when 'folders' then new.name is not null and (tg_op = 'INSERT' or new.name is distinct from old.name)
    when 'attachments' then new.filename is not null and (tg_op = 'INSERT' or new.filename is distinct from old.filename)
  end;
  if readable then
    raise exception 'This account is end-to-end encrypted: only sealed text can be saved.'
      using errcode = '42501', hint = 'plaintext';
  end if;
  return new;
end $$;

create trigger notes_e2ee before insert or update on public.notes
  for each row execute function public.pane_e2ee_guard();
create trigger folders_e2ee before insert or update on public.folders
  for each row execute function public.pane_e2ee_guard();
create trigger attachments_e2ee before insert or update on public.attachments
  for each row execute function public.pane_e2ee_guard();

-- Reading: an app that can't read sealed rows sees none of an encrypted account's (it keeps what
-- it has and asks to be updated). The check is constant per request, so it's evaluated once.
drop policy "own notes" on public.notes;
create policy "own notes" on public.notes for all to authenticated
  using (user_id = (select auth.uid())
         and ((select public.pane_e2ee_client()) or not (select public.pane_e2ee_account(auth.uid()))))
  with check (user_id = (select auth.uid()));
drop policy "own folders" on public.folders;
create policy "own folders" on public.folders for all to authenticated
  using (user_id = (select auth.uid())
         and ((select public.pane_e2ee_client()) or not (select public.pane_e2ee_account(auth.uid()))))
  with check (user_id = (select auth.uid()));
drop policy "own attachments" on public.attachments;
create policy "own attachments" on public.attachments for all to authenticated
  using (user_id = (select auth.uid())
         and ((select public.pane_e2ee_client()) or not (select public.pane_e2ee_account(auth.uid()))))
  with check (user_id = (select auth.uid()) and storage_path like (select auth.uid())::text || '/%');
drop policy "own revisions read" on public.note_revisions;
create policy "own revisions read" on public.note_revisions for select to authenticated
  using (user_id = (select auth.uid())
         and ((select public.pane_e2ee_client()) or not (select public.pane_e2ee_account(auth.uid()))));

-- MARK: Triggers that compare or copy the text

-- Sealed text is base64, 4/3 the size of what it holds; it counts as 3/4 of its length so the
-- limits (and their messages, "100 MB of text") mean the same in an encrypted account.
create or replace function public.pane_sealed_bytes(t text) returns bigint
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(octet_length(t), 0)::bigint * 3 / 4
$$;

-- A note's size: its text, sealed or not, and its locked text.
create or replace function public.pane_note_bytes(n public.notes) returns bigint
language sql immutable set search_path = '' as $$
  select coalesce(octet_length(n.body), 0)::bigint + public.pane_sealed_bytes(n.body_ct)
       + public.pane_sealed_bytes(n.head_ct) + coalesce(octet_length(n.locked_body), 0)
$$;

-- One more limit: a sealed note's size, the 2 MB of text it may hold once sealed and encoded.
create or replace function public.pane_limit(k text) returns bigint
language sql immutable set search_path = '' as $$
  select case k
    when 'note_bytes'        then 2 * 1024 * 1024
    when 'sealed_note_bytes' then 2800 * 1024
    when 'notes'             then 50000
    when 'notes_bytes'       then 100 * 1024 * 1024
    when 'folders'           then 2000
    when 'folder_depth'      then 30
    when 'subnote_depth'     then 50
    when 'files'             then 10000
    when 'files_bytes'       then 500 * 1024 * 1024
    when 'tokens'            then 50
    when 'revisions'         then 500
    when 'revision_bytes'    then 10 * 1024 * 1024
  end
$$;

-- As in 20260930150000, counting sealed text too.
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
  if not exists (select 1 from auth.users where id = owner) then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    update public.pane_usage x
      set notes = greatest(x.notes - case when old.deleted_at is null then 1 else 0 end, 0),
          notes_bytes = greatest(x.notes_bytes - public.pane_note_bytes(old), 0)
      where x.user_id = old.user_id;
    return old;
  else
    perform public.pane_take('write');
    if coalesce(octet_length(new.body), 0) > public.pane_limit('note_bytes')
       and (tg_op = 'INSERT' or octet_length(new.body) > coalesce(octet_length(old.body), 0)) then
      perform public.pane_over('note_bytes');
    end if;
    if coalesce(octet_length(new.body_ct), 0) > public.pane_limit('sealed_note_bytes')
       and (tg_op = 'INSERT' or octet_length(new.body_ct) > coalesce(octet_length(old.body_ct), 0)) then
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
      d_bytes := public.pane_note_bytes(new);
    else
      d_notes := (case when new.deleted_at is null then 1 else 0 end) - (case when old.deleted_at is null then 1 else 0 end);
      d_bytes := public.pane_note_bytes(new) - public.pane_note_bytes(old);
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

-- As in 20260930150000: a change to the sealed text is a change to the text, and a version keeps
-- whatever the note held (sealed or not). The database never needs to read it.
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
      changed := new.body is distinct from old.body or new.locked_body is distinct from old.locked_body
        or new.body_ct is distinct from old.body_ct;
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
        delete from public.note_revisions where note_id = old.id;
      elsif old.body is not null and old.body <> '' and new.body is null and new.body_ct is not null then
        -- Sealing a readable note (the move to encryption) keeps no readable copy.
        null;
      elsif changed and (coalesce(old.body, '') <> '' or old.locked_body is not null or old.body_ct is not null)
        and (src <> 'app' or not exists (select 1 from public.note_revisions r
                        where r.note_id = old.id and r.source = 'app'
                          and r.created_at > clock_timestamp() - interval '1 minute')) then
        insert into public.note_revisions (note_id, user_id, body, body_ct, head_ct, locked_body, version, source, client, body_source, body_client, body_at)
        values (old.id, old.user_id, old.body, old.body_ct, old.head_ct, old.locked_body, old.version, src, who, old.body_source, old.body_client, old.body_at);
      end if;
    end if;
  end if;
  return new;
end $$;

create or replace function public.pane_thin_revisions(p_note uuid, p_now timestamptz default clock_timestamp())
returns integer language plpgsql security definer set search_path = '' as $$
declare
  gone integer;
begin
  with r as (
    select id, created_at,
           coalesce(octet_length(body), 0) + public.pane_sealed_bytes(body_ct) + public.pane_sealed_bytes(head_ct)
             + coalesce(octet_length(locked_body), 0) as bytes,
           p_now - created_at as age,
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

create or replace function public.restore_note_version(p_note uuid, p_version bigint)
returns setof public.notes language plpgsql security invoker set search_path = '' as $$
declare
  r public.note_revisions;
begin
  select * into r from public.note_revisions
  where note_id = p_note and version = p_version
  order by id desc limit 1;
  if not found then
    raise exception 'That version is no longer kept.' using errcode = 'PT404', hint = 'no_such_version';
  end if;
  perform set_config('pane.source', 'restore', true);
  return query
    update public.notes n set body = r.body, body_ct = r.body_ct, head_ct = r.head_ct, locked_body = r.locked_body, updated_at = now()
    where n.id = p_note and n.deleted_at is null
    returning n.*;
end $$;
revoke all on function public.restore_note_version(uuid, bigint) from public, anon;
grant execute on function public.restore_note_version(uuid, bigint) to authenticated;

-- As in 20260929170000, counting a change to the sealed text.
create or replace function public.pane_count_ai_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('pane.source', true), '') <> 'mcp' then return null; end if;
  if tg_op = 'UPDATE' and new.body is not distinct from old.body
     and new.body_ct is not distinct from old.body_ct
     and new.deleted_at is not distinct from old.deleted_at
     and new.trashed_at is not distinct from old.trashed_at
     and new.folder_id is not distinct from old.folder_id then
    return null;
  end if;
  if not exists (select 1 from auth.users where id = new.user_id) then return null; end if;
  insert into public.pane_activity as a (user_id, day, kind, n)
  values (new.user_id, (now() at time zone 'utc')::date, 'ai_edit', 1)
  on conflict (user_id, day, kind) do update set n = a.n + 1;
  return null;
end $$;

-- As in 20260929210000, counting a change to the sealed text.
create or replace function public.pane_mark_ai_editor() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  src text := coalesce(nullif(current_setting('pane.source', true), ''), 'app');
  who text := nullif(current_setting('pane.client', true), '');
begin
  if src in ('mcp', 'restore') and who is not null
     and (tg_op = 'INSERT' or new.body is distinct from old.body or new.body_ct is distinct from old.body_ct) then
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

-- As in 20260930150000. An AI can't change a locked note's sealed title either; locking a shared
-- note takes its readable copy down with the link.
create or replace function public.pane_note_lock() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.pane_old_client() and exists (select 1 from public.note_locks l where l.user_id = new.user_id) then
    raise exception 'Update Amber Notes to keep syncing. This account has locked notes, and this version of the app can''t keep them safe.'
      using errcode = '42501', hint = 'update_app';
  end if;
  if (current_setting('pane.agent', true) = 'mcp' or current_setting('pane.source', true) = 'mcp') and (
       (tg_op = 'INSERT' and new.locked_body is not null)
       or (tg_op = 'UPDATE' and (new.locked_body is distinct from old.locked_body
                                 or (old.locked_body is not null and (new.body is distinct from old.body
                                     or new.body_ct is distinct from old.body_ct or new.head_ct is distinct from old.head_ct))))) then
    raise exception 'This note is locked. Open it in Amber Notes to change it.' using errcode = '42501';
  end if;
  if new.locked_body is not null and (tg_op = 'INSERT' or new.locked_body is distinct from old.locked_body)
     and not exists (select 1 from public.note_locks l
                     where l.user_id = new.user_id and l.key_id = split_part(new.locked_body, '.', 2)) then
    raise exception 'This note was locked with a different notes password. Enter your current notes password in Amber Notes.'
      using errcode = '23514', hint = 'stale_lock_key';
  end if;
  if tg_op = 'UPDATE' and old.locked_body is null and new.locked_body is not null then
    -- Sealed notes can't be checked here; the apps refuse to lock a note with files or sub-notes.
    if strpos(coalesce(old.body, ''), 'pane-file:') > 0 or strpos(coalesce(old.body, ''), 'pane-note:') > 0 then
      raise exception 'Notes with files or sub-notes can''t be locked.' using errcode = '23514', hint = 'lock_files';
    end if;
    update public.note_shares set revoked_at = now() where note_id = old.id and revoked_at is null;
  end if;
  return new;
end $$;

-- As in 20260930150000; a locked note's title is sealed in head_ct in an encrypted account.
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
    update public.notes set body = n ->> 'body', head_ct = coalesce(n ->> 'head_ct', head_ct),
        locked_body = n ->> 'locked_body', updated_at = now()
      where id = (n ->> 'id')::uuid and user_id = uid and version = (n ->> 'version')::bigint
        and locked_body is not null and deleted_at is null
      returning version into v;
    if not found then
      raise exception 'Your notes changed on another device. Try again in a moment.' using errcode = '40001', hint = 'notes_changed';
    end if;
    versions := versions || jsonb_build_array(jsonb_build_object('id', n ->> 'id', 'version', v));
  end loop;
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

-- MARK: Moving an account to encryption

-- The account's versions from before it was encrypted, sealed again by the device: [{id, body_ct, head_ct}].
-- Only readable versions of the caller's own notes change. Returns how many did.
create or replace function public.reseal_revisions(p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  n integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not public.pane_e2ee_account(uid) then raise exception 'Set up encryption first.' using errcode = '42501'; end if;
  update public.note_revisions r set body = null, body_ct = x.body_ct, head_ct = x.head_ct
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(id bigint, body_ct text, head_ct text)
  where r.id = x.id and r.user_id = uid and r.body is not null and r.locked_body is null
    and x.body_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$'
    and x.head_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.reseal_revisions(jsonb) from public, anon;
grant execute on function public.reseal_revisions(jsonb) to authenticated;

-- The device has sealed everything it has. Readable versions still left are deleted; the account
-- counts as moved once no readable note, folder or file name is left. Returns what's left.
create or replace function public.finish_e2ee_migration() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  left_notes integer;
  left_folders integer;
  left_files integer;
  versions_removed integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not public.pane_e2ee_account(uid) then raise exception 'Set up encryption first.' using errcode = '42501'; end if;
  delete from public.note_revisions where user_id = uid and body is not null and body <> '';
  get diagnostics versions_removed = row_count;
  select count(*) into left_notes from public.notes where user_id = uid and body is not null and body <> '';
  select count(*) into left_folders from public.folders where user_id = uid and name is not null;
  select count(*) into left_files from public.attachments where user_id = uid and filename is not null;
  if left_notes = 0 and left_folders = 0 and left_files = 0 then
    update public.account_keys set migrated_at = coalesce(migrated_at, now()) where user_id = uid;
  end if;
  return jsonb_build_object('notes', left_notes, 'folders', left_folders, 'files', left_files,
    'versions_removed', versions_removed, 'done', left_notes = 0 and left_folders = 0 and left_files = 0);
end $$;
revoke all on function public.finish_e2ee_migration() from public, anon;
grant execute on function public.finish_e2ee_migration() to authenticated;

-- MARK: AI connections hold a wrapped data key

alter table public.oauth_requests add column code_wrap text check (code_wrap is null or char_length(code_wrap) <= 300);
alter table public.oauth_tokens add column dk_wrap text check (dk_wrap is null or char_length(dk_wrap) <= 300);
alter table public.mcp_tokens add column dk_wrap text check (dk_wrap is null or char_length(dk_wrap) <= 300);

-- Revoking a connection (from the app, the site or /revoke) deletes every wrap it had.
create or replace function public.mcp_token_forget_key() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.revoked_at is not null then
    new.dk_wrap := null;
    delete from public.oauth_tokens where grant_id = new.id;
  end if;
  return new;
end $$;
create trigger mcp_tokens_forget_key before update on public.mcp_tokens
  for each row execute function public.mcp_token_forget_key();

-- As before, plus the connection's wrap and whether the account is encrypted.
drop function public.resolve_mcp_token(text);
create function public.resolve_mcp_token(token text)
returns table (user_id uuid, token_id uuid, name text, can_write boolean, dk_wrap text, sealed boolean)
language sql security definer set search_path = '' as $$
  update public.mcp_tokens t set last_used_at = now()
  where t.token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
    and t.revoked_at is null and t.kind = 'token'
  returning t.user_id, t.id, t.name, t.can_write, t.dk_wrap, public.pane_e2ee_account(t.user_id)
$$;
revoke all on function public.resolve_mcp_token(text) from public, anon, authenticated;

drop function public.resolve_oauth_token(text);
create function public.resolve_oauth_token(token text)
returns table (user_id uuid, token_id uuid, name text, can_write boolean, resource text, dk_wrap text, sealed boolean)
language sql security definer set search_path = '' as $$
  update public.mcp_tokens g set last_used_at = now()
  from public.oauth_tokens t
  where t.token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
    and t.kind = 'access' and t.expires_at > now()
    and g.id = t.grant_id and g.revoked_at is null and g.kind = 'oauth'
  returning g.user_id, g.id, g.name, g.can_write, t.resource, t.dk_wrap, public.pane_e2ee_account(g.user_id)
$$;
revoke all on function public.resolve_oauth_token(text) from public, anon, authenticated;

-- An encrypted account's tokens are made on the device, which wraps the data key for them; the
-- server would otherwise hold a token it can't give a key to.
create or replace function public.create_mcp_token(token_name text, write_access boolean default true)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  raw text := 'pane_' || encode(extensions.gen_random_bytes(32), 'hex');
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if public.pane_e2ee_account(auth.uid()) then
    raise exception 'Update Amber Notes to make an access token.' using errcode = '42501', hint = 'update_app';
  end if;
  insert into public.mcp_tokens (user_id, name, token_hash, can_write)
  values (auth.uid(), token_name, encode(extensions.digest(raw, 'sha256'), 'hex'), write_access);
  return raw;
end $$;
revoke all on function public.create_mcp_token(text, boolean) from public, anon;
grant execute on function public.create_mcp_token(text, boolean) to authenticated;

-- The app made `pane_…` itself and sends its hash and the data key wrapped under it.
create or replace function public.create_mcp_token_sealed(token_name text, write_access boolean, token_hash text, dk_wrap text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  id uuid;
  k public.account_keys;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into k from public.account_keys where user_id = auth.uid();
  if not found then raise exception 'Set up encryption first.' using errcode = '42501'; end if;
  if token_hash !~ '^[0-9a-f]{64}$' or dk_wrap !~ ('^amb2\.' || k.key_id || '\.[A-Za-z0-9+/]+={0,2}$') then
    raise exception 'Invalid token.' using errcode = '22023';
  end if;
  insert into public.mcp_tokens (user_id, name, token_hash, can_write, dk_wrap)
  values (auth.uid(), token_name, token_hash, write_access, dk_wrap)
  returning mcp_tokens.id into id;
  return id;
end $$;
revoke all on function public.create_mcp_token_sealed(text, boolean, text, text) from public, anon;
grant execute on function public.create_mcp_token_sealed(text, boolean, text, text) to authenticated;

-- A file an AI asked for: a 10-minute link whose secret opens the data key for this one file.
create table public.mcp_file_links (
  link_hash     text primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  attachment_id uuid not null references public.attachments (id) on delete cascade,
  dk_wrap       text not null,
  expires_at    timestamptz not null
);
alter table public.mcp_file_links enable row level security;
revoke all on public.mcp_file_links from anon, authenticated;

-- MARK: Shared pages show a published copy

alter table public.note_shares
  add column title text check (title is null or char_length(title) <= 300),
  add column body text check (body is null or octet_length(body) <= 2097152),
  add column published_at timestamptz;

create table public.note_share_pages (
  slug      text not null references public.note_shares (slug) on delete cascade,
  note_id   uuid not null,
  parent_id uuid,
  title     text not null check (char_length(title) <= 300),
  body      text not null check (octet_length(body) <= 2097152),
  primary key (slug, note_id)
);
create table public.note_share_files (
  slug          text not null references public.note_shares (slug) on delete cascade,
  attachment_id uuid not null,
  storage_path  text not null,
  filename      text not null check (char_length(filename) between 1 and 255),
  content_type  text not null default 'public.data',
  size          bigint not null default 0,
  primary key (slug, attachment_id)
);
alter table public.note_share_pages enable row level security;
alter table public.note_share_files enable row level security;
revoke all on public.note_share_pages, public.note_share_files from anon, authenticated;

-- Private bucket for readable copies of a shared note's files: <slug>/<attachment id>.
insert into storage.buckets (id, name, public, file_size_limit)
values ('shared', 'shared', false, 52428800)
on conflict (id) do nothing;

create or replace function public.pane_owns_share(p_slug text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.note_shares s
                 where s.slug = p_slug and s.user_id = (select auth.uid()) and s.revoked_at is null)
$$;
revoke all on function public.pane_owns_share(text) from public, anon;
grant execute on function public.pane_owns_share(text) to authenticated;

create policy "own shared copies write" on storage.objects for insert to authenticated
  with check (bucket_id = 'shared' and public.pane_owns_share((storage.foldername(name))[1]));
create policy "own shared copies update" on storage.objects for update to authenticated
  using (bucket_id = 'shared' and public.pane_owns_share((storage.foldername(name))[1]));
create policy "own shared copies delete" on storage.objects for delete to authenticated
  using (bucket_id = 'shared' and exists (select 1 from public.note_shares s
         where s.slug = (storage.foldername(name))[1] and s.user_id = (select auth.uid())));

-- A link that stops (Stop Sharing, locking, three reports, the admin) takes its copy with it.
create or replace function public.pane_share_forget_copy() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.revoked_at is not null and old.revoked_at is null then
    new.title := null;
    new.body := null;
    delete from public.note_share_pages where slug = new.slug;
    delete from public.note_share_files where slug = new.slug;
  end if;
  return new;
end $$;
create trigger note_shares_forget_copy before update on public.note_shares
  for each row execute function public.pane_share_forget_copy();

-- Writes a live link's copy: {title, body, pages: [{id, parent_id, title, body}], files: [{id, filename, content_type, size}]}.
create or replace function public.pane_write_share_copy(p_slug text, p_copy jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_copy is null or coalesce(p_copy ->> 'body', '') = '' and coalesce(p_copy ->> 'title', '') = '' then
    raise exception 'A shared page needs its text.' using errcode = '22023';
  end if;
  update public.note_shares set title = left(coalesce(p_copy ->> 'title', 'New Note'), 300), body = coalesce(p_copy ->> 'body', ''),
    published_at = now() where slug = p_slug;
  delete from public.note_share_pages where slug = p_slug;
  insert into public.note_share_pages (slug, note_id, parent_id, title, body)
  select p_slug, (p ->> 'id')::uuid, nullif(p ->> 'parent_id', '')::uuid, left(coalesce(p ->> 'title', 'New Note'), 300), coalesce(p ->> 'body', '')
  from jsonb_array_elements(coalesce(p_copy -> 'pages', '[]'::jsonb)) p
  on conflict do nothing;
  delete from public.note_share_files where slug = p_slug;
  insert into public.note_share_files (slug, attachment_id, storage_path, filename, content_type, size)
  select p_slug, (f ->> 'id')::uuid, p_slug || '/' || lower(f ->> 'id'), left(coalesce(nullif(f ->> 'filename', ''), 'file'), 255),
         coalesce(nullif(f ->> 'content_type', ''), 'public.data'), coalesce((f ->> 'size')::bigint, 0)
  from jsonb_array_elements(coalesce(p_copy -> 'files', '[]'::jsonb)) f
  on conflict do nothing;
end $$;
revoke all on function public.pane_write_share_copy(text, jsonb) from public, anon, authenticated;

-- Creates the note's link (or keeps the live one) and, for an encrypted account, its readable copy.
drop function public.share_note(uuid, boolean);
create function public.share_note(p_note uuid, p_include_subnotes boolean default false, p_copy jsonb default null)
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
  if p_copy is null and public.pane_e2ee_account(v_user) then
    raise exception 'Update Amber Notes to share this note.' using errcode = '42501', hint = 'update_app';
  end if;
  update public.note_shares set include_subnotes = coalesce(p_include_subnotes, false)
    where note_id = p_note and revoked_at is null
    returning slug into v_slug;
  if v_slug is null then
    v_slug := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
    insert into public.note_shares (slug, note_id, user_id, include_subnotes)
      values (v_slug, p_note, v_user, coalesce(p_include_subnotes, false));
  end if;
  if p_copy is not null then perform public.pane_write_share_copy(v_slug, p_copy); end if;
  return v_slug;
end $$;
revoke all on function public.share_note(uuid, boolean, jsonb) from public, anon;
grant execute on function public.share_note(uuid, boolean, jsonb) to authenticated;

-- The note changed: its live link's copy is written again. Returns the slug, or null (not shared).
create or replace function public.publish_share(p_note uuid, p_copy jsonb)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_slug text;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select slug into v_slug from public.note_shares
    where note_id = p_note and user_id = auth.uid() and revoked_at is null;
  if v_slug is null then return null; end if;
  perform public.pane_take('write');
  perform public.pane_write_share_copy(v_slug, p_copy);
  return v_slug;
end $$;
revoke all on function public.publish_share(uuid, jsonb) from public, anon;
grant execute on function public.publish_share(uuid, jsonb) to authenticated;

-- What a link shows. A published copy when there is one; an encrypted account's note itself never.
create or replace function public.shared_note(p_slug text, p_sub uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.note_shares;
  n public.notes;
  pg public.note_share_pages;
  target uuid;
begin
  if p_slug is null or p_slug !~ '^[A-Za-z0-9_-]{24,64}$' then return null; end if;
  select * into s from public.note_shares where slug = p_slug and revoked_at is null;
  if not found then return null; end if;
  -- The root note must still be live (and not locked) for any of its pages to show.
  if not exists (select 1 from public.notes r where r.id = s.note_id and r.deleted_at is null
                 and r.trashed_at is null and r.locked_body is null) then
    return null;
  end if;
  if s.body is not null then
    if p_sub is null then
      return jsonb_build_object(
        'title', s.title, 'body', s.body, 'updated_at', coalesce(s.published_at, s.created_at),
        'include_subnotes', s.include_subnotes, 'is_sub', false, 'root_title', s.title,
        'shared_by', public.pane_sharer(s.user_id),
        'subnotes', case when s.include_subnotes then coalesce((
            select jsonb_agg(jsonb_build_object('id', p.note_id, 'title', p.title) order by p.title)
            from public.note_share_pages p where p.slug = s.slug and p.parent_id = s.note_id), '[]'::jsonb) else '[]'::jsonb end);
    end if;
    if not s.include_subnotes then return null; end if;
    select * into pg from public.note_share_pages where slug = s.slug and note_id = p_sub;
    if not found then return null; end if;
    return jsonb_build_object(
      'title', pg.title, 'body', pg.body, 'updated_at', coalesce(s.published_at, s.created_at),
      'include_subnotes', true, 'is_sub', true, 'root_title', s.title,
      'shared_by', public.pane_sharer(s.user_id),
      'subnotes', coalesce((
          select jsonb_agg(jsonb_build_object('id', p.note_id, 'title', p.title) order by p.title)
          from public.note_share_pages p where p.slug = s.slug and p.parent_id = pg.note_id), '[]'::jsonb));
  end if;
  if public.pane_e2ee_account(s.user_id) then return null; end if;
  -- An account not yet encrypted: as in 20260930150000.
  target := s.note_id;
  if p_sub is not null then
    if not s.include_subnotes then return null; end if;
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
