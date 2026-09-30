-- End-to-end encryption (docs/Technical/e2ee-design.md).
--
-- Every account has one random data key (DK), made on its first device and kept in iCloud
-- Keychain. Note bodies, titles and previews, folder names, file names and file bytes, and every
-- version are sealed with it on the device (the amb2 box of locked notes). The database holds no
-- key material: account_keys has the key's id, a verifier (an HMAC under a subkey of DK) and DK
-- wrapped under the recovery key. An AI connection holds DK wrapped under its own tokens, which
-- only the AI has; the server keeps hashes of them.
--
-- No backward compatibility: there are no users yet and the notes are dummy data. Everything
-- readable is wiped and the plaintext columns are dropped, so nothing readable can be written
-- again. Builds from before this can't sync. Storage objects can't be deleted from SQL: run
-- scripts/e2ee-wipe-storage.ts once after this migration (it empties the files bucket).

-- MARK: Wipe

delete from public.note_shares;
delete from public.note_revisions;
delete from public.notes;
delete from public.folders;
delete from public.attachments;
-- AI connections can't open anything without a wrapped key: they connect again.
delete from public.mcp_tokens;
delete from public.oauth_requests;
update public.pane_usage set notes = 0, notes_bytes = 0, folders = 0;

-- MARK: The account's key

create table public.account_keys (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  -- The first 16 hex digits of SHA-256(DK). Never changes: no rotation in v1.
  key_id            text not null check (key_id ~ '^[0-9a-f]{16}$'),
  -- hex HMAC-SHA256 under HKDF(DK, "verifier") of "amber-notes verifier|<user id>".
  verifier          text not null check (verifier ~ '^[0-9a-f]{64}$'),
  -- DK sealed under HKDF(the recovery key). The recovery key itself never reaches the server.
  recovery_wrap     text not null check (char_length(recovery_wrap) <= 300),
  -- When the person last saved (printed, exported or copied) the recovery key, on any device.
  recovery_saved_at timestamptz,
  created_at        timestamptz not null default now(),
  constraint account_keys_wrap_names_key check (recovery_wrap ~ ('^amb2\.' || key_id || '\.[A-Za-z0-9+/]+={0,2}$'))
);
alter table public.account_keys enable row level security;
create policy "own account key read" on public.account_keys for select to authenticated
  using (user_id = (select auth.uid()));
-- Only the functions below write it.
revoke all on public.account_keys from anon;
revoke insert, update, delete, truncate on public.account_keys from authenticated;
grant select on public.account_keys to authenticated;

create or replace function public.pane_account_keys_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.key_id <> old.key_id or new.verifier <> old.verifier or new.user_id <> old.user_id
     or new.recovery_wrap <> old.recovery_wrap then
    raise exception 'An account''s key can''t be replaced.' using errcode = '23514', hint = 'key_change';
  end if;
  return new;
end $$;
create trigger account_keys_guard before update on public.account_keys
  for each row execute function public.pane_account_keys_guard();

-- The only place a key is made: insert-if-absent, so two devices racing can't both make one.
-- Returns the account's key, whoever made it, and whether this call did.
create or replace function public.create_account_key(p_key_id text, p_verifier text, p_recovery_wrap text)
returns table (key_id text, verifier text, recovery_wrap text, recovery_saved_at timestamptz, created boolean)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  made boolean;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  insert into public.account_keys as k (user_id, key_id, verifier, recovery_wrap)
  values (uid, p_key_id, p_verifier, p_recovery_wrap)
  on conflict (user_id) do nothing;
  made := found;
  return query select k.key_id, k.verifier, k.recovery_wrap, k.recovery_saved_at, made
    from public.account_keys k where k.user_id = uid;
end $$;
revoke all on function public.create_account_key(text, text, text) from public, anon;
grant execute on function public.create_account_key(text, text, text) to authenticated;

-- "Save a recovery key" finished on some device: every device shows Saved.
create or replace function public.mark_recovery_key_saved() returns timestamptz
language sql security definer set search_path = '' as $$
  update public.account_keys set recovery_saved_at = now() where user_id = auth.uid() returning recovery_saved_at
$$;
revoke all on function public.mark_recovery_key_saved() from public, anon;
grant execute on function public.mark_recovery_key_saved() to authenticated;

-- The last resort ("I don't have my key"): the notes can't be opened by anyone, so they go, with
-- every AI connection (their wraps hold the old key) and the key itself. The device then makes a
-- new key. `p_key_id` is the key the device gave up on; if another device already started fresh,
-- nothing is deleted twice. Files in Storage are removed by the app (the owner may delete them).
create or replace function public.start_fresh(p_key_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform 1 from public.account_keys where user_id = uid and key_id = p_key_id for update;
  if not found then return false; end if;
  delete from public.note_shares where user_id = uid;
  delete from public.notes where user_id = uid;
  delete from public.folders where user_id = uid;
  delete from public.attachments where user_id = uid;
  delete from public.mcp_tokens where user_id = uid;
  delete from public.account_keys where user_id = uid;
  update public.pane_usage set notes = 0, notes_bytes = 0, folders = 0 where user_id = uid;
  return true;
end $$;
revoke all on function public.start_fresh(text) from public, anon;
grant execute on function public.start_fresh(text) to authenticated;

-- MARK: Sealed columns replace readable ones

drop function if exists public.search_notes(text, int);
alter table public.notes drop column search, drop column title, drop column body;
drop function if exists public.note_title(text);
-- A live note always has a head, and its text unless it's locked. A note deleted for good (purged
-- from Recently Deleted) keeps neither.
alter table public.notes
  add column body_ct text,
  add column head_ct text,
  add constraint notes_sealed check (
    (head_ct is null or (head_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$' and octet_length(head_ct) <= 8000))
    and (body_ct is null or (body_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$' and octet_length(body_ct) <= 7000000))
    and (deleted_at is not null or (head_ct is not null and (locked_body is null) = (body_ct is not null))));

alter table public.note_revisions drop column body;
alter table public.note_revisions add column body_ct text, add column head_ct text;

alter table public.folders drop column name;
alter table public.folders add column name_ct text not null
  check (name_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$' and octet_length(name_ct) <= 2000);

-- A file's name and type are sealed; its path says nothing but whose it is and which file.
alter table public.attachments drop column filename, drop column content_type;
alter table public.attachments add column meta_ct text not null
  check (meta_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$' and octet_length(meta_ct) <= 4000);
alter table public.attachments add constraint attachments_opaque_path
  check (storage_path = user_id::text || '/' || id::text);

-- Whatever a device or the AI server writes must be sealed with the account's key: a device with
-- a stale key (after "Start fresh" elsewhere) is refused, not left to write boxes nobody can open.
create or replace function public.pane_sealed_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  k text;
  j jsonb;
  boxes text[];
  b text;
begin
  select key_id into k from public.account_keys where user_id = new.user_id;
  if k is null then
    raise exception 'Set up encryption on this device first.' using errcode = '42501', hint = 'no_key';
  end if;
  -- Whichever sealed columns this table has.
  j := to_jsonb(new);
  boxes := array[j ->> 'head_ct', j ->> 'body_ct', j ->> 'name_ct', j ->> 'meta_ct'];
  foreach b in array boxes loop
    if b is not null and split_part(b, '.', 2) <> k then
      raise exception 'This device has an old key for your notes. Open Amber Notes again to get the current one.'
        using errcode = '42501', hint = 'wrong_key';
    end if;
  end loop;
  return new;
end $$;
create trigger notes_sealed before insert or update of head_ct, body_ct on public.notes
  for each row execute function public.pane_sealed_guard();
create trigger folders_sealed before insert or update of name_ct on public.folders
  for each row execute function public.pane_sealed_guard();
create trigger attachments_sealed before insert or update of meta_ct on public.attachments
  for each row execute function public.pane_sealed_guard();

-- MARK: Triggers that compared or copied the text now compare and copy ciphertext

-- Sealed text is base64, 4/3 the size of what it holds: it counts as 3/4 of its length, so the
-- limits (and their messages, "2 MB of text") mean what they did.
create or replace function public.pane_sealed_bytes(t text) returns bigint
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(octet_length(t), 0)::bigint * 3 / 4
$$;

drop function if exists public.pane_note_size(text, text);
create or replace function public.pane_note_size(body_ct text, head_ct text, locked_body text) returns bigint
language sql immutable parallel safe set search_path = '' as $$
  select public.pane_sealed_bytes(body_ct) + public.pane_sealed_bytes(head_ct) + coalesce(octet_length(locked_body), 0)
$$;

-- As in 20260930150000, measuring sealed text.
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
          notes_bytes = greatest(x.notes_bytes - public.pane_note_size(old.body_ct, old.head_ct, old.locked_body), 0)
      where x.user_id = old.user_id;
    return old;
  else
    perform public.pane_take('write');
    if public.pane_sealed_bytes(new.body_ct) > public.pane_limit('note_bytes')
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
      d_bytes := public.pane_note_size(new.body_ct, new.head_ct, new.locked_body);
    else
      d_notes := (case when new.deleted_at is null then 1 else 0 end) - (case when old.deleted_at is null then 1 else 0 end);
      d_bytes := public.pane_note_size(new.body_ct, new.head_ct, new.locked_body) - public.pane_note_size(old.body_ct, old.head_ct, old.locked_body);
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

-- As in 20260930150000: a version keeps the ciphertext the note held, copied by the database,
-- which never reads it. Unchanged text keeps its box (the apps and the AI server reuse it), so a
-- different box means a change.
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
      changed := new.body_ct is distinct from old.body_ct or new.head_ct is distinct from old.head_ct
        or new.locked_body is distinct from old.locked_body;
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
        -- Locking: no version the AI server could open may stay behind.
        delete from public.note_revisions where note_id = old.id;
      elsif changed and (src <> 'app' or not exists (select 1 from public.note_revisions r
                        where r.note_id = old.id and r.source = 'app'
                          and r.created_at > clock_timestamp() - interval '1 minute')) then
        insert into public.note_revisions (note_id, user_id, body_ct, head_ct, locked_body, version, source, client, body_source, body_client, body_at)
        values (old.id, old.user_id, old.body_ct, old.head_ct, old.locked_body, old.version, src, who, old.body_source, old.body_client, old.body_at);
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
           public.pane_note_size(body_ct, head_ct, locked_body) as bytes,
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
    update public.notes n set body_ct = r.body_ct, head_ct = r.head_ct, locked_body = r.locked_body, updated_at = now()
    where n.id = p_note and n.deleted_at is null
    returning n.*;
end $$;
revoke all on function public.restore_note_version(uuid, bigint) from public, anon;
grant execute on function public.restore_note_version(uuid, bigint) to authenticated;

create or replace function public.pane_count_ai_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('pane.source', true), '') <> 'mcp' then return null; end if;
  if tg_op = 'UPDATE' and new.body_ct is not distinct from old.body_ct
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

create or replace function public.pane_mark_ai_editor() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  src text := coalesce(nullif(current_setting('pane.source', true), ''), 'app');
  who text := nullif(current_setting('pane.client', true), '');
begin
  if src in ('mcp', 'restore') and who is not null and (tg_op = 'INSERT' or new.body_ct is distinct from old.body_ct) then
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

-- As in 20260930150000. The server can't read a note to see whether it links files or sub-notes;
-- the apps refuse to lock one that does.
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
                                 or (old.locked_body is not null and (new.body_ct is distinct from old.body_ct
                                                                      or new.head_ct is distinct from old.head_ct))))) then
    raise exception 'This note is locked. Open it in Amber Notes to change it.' using errcode = '42501';
  end if;
  if new.locked_body is not null and (tg_op = 'INSERT' or new.locked_body is distinct from old.locked_body)
     and not exists (select 1 from public.note_locks l
                     where l.user_id = new.user_id and l.key_id = split_part(new.locked_body, '.', 2)) then
    raise exception 'This note was locked with a different notes password. Enter your current notes password in Amber Notes.'
      using errcode = '23514', hint = 'stale_lock_key';
  end if;
  if tg_op = 'UPDATE' and old.locked_body is null and new.locked_body is not null then
    update public.note_shares set revoked_at = now() where note_id = old.id and revoked_at is null;
  end if;
  return new;
end $$;

-- As in 20260930150000; a locked note's title is its sealed head.
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
    update public.notes set head_ct = coalesce(n ->> 'head_ct', head_ct), locked_body = n ->> 'locked_body', updated_at = now()
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

-- As in 20260930171500: Recently Deleted after 30 days, now clearing the sealed text.
create or replace function public.pane_forget_daily() returns void
language plpgsql security definer set search_path = '' as $$
declare
  purged uuid[];
begin
  with gone as (
    update public.notes set deleted_at = now(), body_ct = null, head_ct = null, locked_body = null
    where trashed_at < now() - interval '30 days' and deleted_at is null
    returning id)
  select coalesce(array_agg(id), '{}') into purged from gone;
  update public.note_shares set revoked_at = now() where note_id = any(purged) and revoked_at is null;

  update public.share_reports set reporter = repeat('0', 64)
    where created_at < now() - interval '30 days' and reporter <> repeat('0', 64);
  delete from public.share_reports where created_at < now() - interval '12 months' and status <> 'open';

  delete from public.pane_activity where day < (now() at time zone 'utc')::date - 365;
  delete from public.pane_tip_activity where day < (now() at time zone 'utc')::date - 365;
  delete from public.pane_active_days where day < (now() at time zone 'utc')::date - 365;
  delete from public.pane_devices where last_seen < now() - interval '12 months';

  if to_regclass('auth.audit_log_entries') is not null then
    begin
      execute 'delete from auth.audit_log_entries where created_at < now() - interval ''30 days''';
    exception when insufficient_privilege then
      raise warning 'pane_forget_daily: no permission to trim auth.audit_log_entries';
    end;
  end if;

  perform public.pane_thin_all_revisions();
end $$;
revoke all on function public.pane_forget_daily() from public, anon, authenticated;

-- MARK: AI connections hold a wrapped key

alter table public.oauth_requests add column code_wrap text check (code_wrap is null or char_length(code_wrap) <= 300);
alter table public.oauth_tokens add column dk_wrap text check (dk_wrap is null or char_length(dk_wrap) <= 300);
alter table public.mcp_tokens add column dk_wrap text check (dk_wrap is null or char_length(dk_wrap) <= 300);

-- Revoking a connection (from the app, the site or /revoke) deletes every wrap it had.
create or replace function public.mcp_token_stay_revoked() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.revoked_at is not null then
    new.revoked_at := old.revoked_at;
  end if;
  if new.revoked_at is not null then
    new.dk_wrap := null;
    delete from public.oauth_tokens where grant_id = new.id;
    update public.oauth_requests set code_wrap = null where grant_id = new.id and code_wrap is not null;
  end if;
  return new;
end $$;

drop function public.resolve_mcp_token(text);
create function public.resolve_mcp_token(token text)
returns table (user_id uuid, token_id uuid, name text, can_write boolean, dk_wrap text)
language sql security definer set search_path = '' as $$
  update public.mcp_tokens t set last_used_at = now()
  where t.token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
    and t.revoked_at is null and t.kind = 'token'
  returning t.user_id, t.id, t.name, t.can_write, t.dk_wrap
$$;
revoke all on function public.resolve_mcp_token(text) from public, anon, authenticated;

drop function public.resolve_oauth_token(text);
create function public.resolve_oauth_token(token text)
returns table (user_id uuid, token_id uuid, name text, can_write boolean, resource text, dk_wrap text)
language sql security definer set search_path = '' as $$
  update public.mcp_tokens g set last_used_at = now()
  from public.oauth_tokens t
  where t.token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
    and t.kind = 'access' and t.expires_at > now()
    and g.id = t.grant_id and g.revoked_at is null and g.kind = 'oauth'
  returning g.user_id, g.id, g.name, g.can_write, t.resource, t.dk_wrap
$$;
revoke all on function public.resolve_oauth_token(text) from public, anon, authenticated;

-- A pane_ token is made on the device, which wraps the key under it; the server would otherwise
-- hold a token it can't give a key to. The device sends the token's hash and the wrap.
drop function public.create_mcp_token(text, boolean);
create function public.create_mcp_token(token_name text, write_access boolean, token_hash text, dk_wrap text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  id uuid;
  k text;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select key_id into k from public.account_keys where user_id = auth.uid();
  if k is null then raise exception 'Set up encryption on this device first.' using errcode = '42501', hint = 'no_key'; end if;
  if token_hash !~ '^[0-9a-f]{64}$' or dk_wrap !~ ('^amb2\.' || k || '\.[A-Za-z0-9+/]+={0,2}$') then
    raise exception 'Invalid token.' using errcode = '22023';
  end if;
  insert into public.mcp_tokens (user_id, name, token_hash, can_write, dk_wrap)
  values (auth.uid(), token_name, token_hash, coalesce(write_access, false), dk_wrap)
  returning mcp_tokens.id into id;
  return id;
end $$;
revoke all on function public.create_mcp_token(text, boolean, text, text) from public, anon;
grant execute on function public.create_mcp_token(text, boolean, text, text) to authenticated;

-- Full scans by the AI server (search, sort by title, which notes embed a file) decrypt the whole
-- library in memory. Each account has a budget of scan time: 20 seconds, refilling at 20 ms a
-- second. Charges what was spent and returns what's left (below zero means wait).
create or replace function public.pane_scan_budget(p_spent_ms double precision default 0)
returns double precision language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  cap constant double precision := 20000;
  per_second constant double precision := 20;
  left_over double precision;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  insert into public.pane_rate as r (user_id, bucket, tokens, at)
  values (uid, 'scan', cap - greatest(p_spent_ms, 0), clock_timestamp())
  on conflict (user_id, bucket) do update
    set tokens = greatest(-cap, least(cap, r.tokens + extract(epoch from clock_timestamp() - r.at) * per_second) - greatest(p_spent_ms, 0)),
        at = clock_timestamp()
  returning tokens into left_over;
  return left_over;
end $$;
revoke all on function public.pane_scan_budget(double precision) from public, anon;
grant execute on function public.pane_scan_budget(double precision) to authenticated;

-- MARK: Shared pages show a published copy
--
-- A shared page is public, so it shows a readable copy the owner's device publishes (and the AI
-- server updates when an AI edits a shared note). The copy lives only while it's shared: it goes
-- when the link stops, and under every link when a note in it is locked, trashed, deleted or
-- moved out of its parent. File copies are stored here too, so they go in the same transaction.

alter table public.note_shares
  add column title text check (title is null or char_length(title) <= 300),
  add column body text check (body is null or octet_length(body) <= 2097152),
  add column published_at timestamptz;

create table public.note_share_pages (
  slug      text not null references public.note_shares (slug) on delete cascade,
  note_id   uuid not null references public.notes (id) on delete cascade,
  parent_id uuid,
  title     text not null check (char_length(title) <= 300),
  body      text not null check (octet_length(body) <= 2097152),
  primary key (slug, note_id)
);
create index note_share_pages_note on public.note_share_pages (note_id);

create table public.note_share_files (
  slug          text not null references public.note_shares (slug) on delete cascade,
  attachment_id uuid not null,
  filename      text not null check (char_length(filename) between 1 and 255),
  content_type  text not null default 'application/octet-stream' check (char_length(content_type) <= 200),
  size          bigint not null,
  content       bytea not null check (octet_length(content) <= 10485760),
  primary key (slug, attachment_id)
);
alter table public.note_share_pages enable row level security;
alter table public.note_share_files enable row level security;
revoke all on public.note_share_pages, public.note_share_files from anon, authenticated;

-- Files no page of the link embeds any more.
create or replace function public.pane_prune_share_files(p_slug text) returns void
language sql security definer set search_path = '' as $$
  delete from public.note_share_files f
  where f.slug = p_slug
    and not exists (select 1 from public.note_shares s
                    where s.slug = p_slug and strpos(coalesce(s.body, ''), 'pane-file:' || f.attachment_id::text) > 0)
    and not exists (select 1 from public.note_share_pages p
                    where p.slug = p_slug and strpos(p.body, 'pane-file:' || f.attachment_id::text) > 0)
$$;
revoke all on function public.pane_prune_share_files(text) from public, anon, authenticated;

-- A link that stops (Stop Sharing, locking, three reports, the admin) takes its copy with it.
create or replace function public.pane_share_forget_copy() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.revoked_at is not null and old.revoked_at is null then
    new.title := null;
    new.body := null;
    new.published_at := null;
    delete from public.note_share_pages where slug = new.slug;
    delete from public.note_share_files where slug = new.slug;
  end if;
  return new;
end $$;
create trigger note_shares_forget_copy before update on public.note_shares
  for each row execute function public.pane_share_forget_copy();

-- A note locked, trashed or deleted takes its copy down under every link: its own page and every
-- page below it, and, when it's a link's root, that link's whole copy (the link stays; the device
-- publishes it again if the note comes back). A sub-note moved to another parent leaves its old
-- page tree the same way.
create or replace function public.pane_note_forget_copies() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  gone boolean := (old.locked_body is null and new.locked_body is not null)
    or (old.trashed_at is null and new.trashed_at is not null)
    or (old.deleted_at is null and new.deleted_at is not null);
  pages text[];
  slugs text[];
  s text;
begin
  if not gone and new.parent_id is not distinct from old.parent_id then return null; end if;
  with recursive below(slug, note_id) as (
    select p.slug, p.note_id from public.note_share_pages p where p.note_id = new.id
    union
    select p.slug, p.note_id from public.note_share_pages p join below b on p.slug = b.slug and p.parent_id = b.note_id
  ) select coalesce(array_agg(b.slug || '|' || b.note_id::text), '{}'), coalesce(array_agg(distinct b.slug), '{}')
    into pages, slugs from below b;
  delete from public.note_share_pages p where p.slug || '|' || p.note_id::text = any(pages);
  foreach s in array slugs loop
    perform public.pane_prune_share_files(s);
  end loop;
  if gone then
    for s in update public.note_shares set title = null, body = null, published_at = null
             where note_id = new.id and published_at is not null returning slug loop
      delete from public.note_share_pages where slug = s;
      delete from public.note_share_files where slug = s;
    end loop;
  end if;
  return null;
end $$;
create trigger notes_forget_share_copies after update of locked_body, trashed_at, deleted_at, parent_id on public.notes
  for each row execute function public.pane_note_forget_copies();

-- Writes a live link's copy: {title, body, pages: [{id, parent_id, title, body}], files: [ids]}.
-- File copies not in `files` go; returns the ids in `files` whose copy isn't stored yet.
create or replace function public.pane_write_share_copy(p_slug text, p_copy jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid;
  wanted uuid[];
begin
  select user_id into owner from public.note_shares where slug = p_slug and revoked_at is null;
  if owner is null then return '[]'::jsonb; end if;
  if p_copy is null or jsonb_typeof(p_copy) <> 'object' or jsonb_typeof(p_copy -> 'body') <> 'string' then
    raise exception 'A shared page needs its text.' using errcode = '22023';
  end if;
  update public.note_shares set title = left(coalesce(p_copy ->> 'title', 'New Note'), 300), body = p_copy ->> 'body',
    published_at = now() where slug = p_slug;
  delete from public.note_share_pages where slug = p_slug;
  -- Only the owner's live, unlocked notes can be pages.
  insert into public.note_share_pages (slug, note_id, parent_id, title, body)
  select p_slug, n.id, nullif(p ->> 'parent_id', '')::uuid, left(coalesce(p ->> 'title', 'New Note'), 300), coalesce(p ->> 'body', '')
  from jsonb_array_elements(coalesce(p_copy -> 'pages', '[]'::jsonb)) p
  join public.notes n on n.id = (p ->> 'id')::uuid
  where n.user_id = owner and n.deleted_at is null and n.trashed_at is null and n.locked_body is null
  on conflict do nothing;
  select coalesce(array_agg(distinct (f #>> '{}')::uuid), '{}') into wanted
    from jsonb_array_elements(coalesce(p_copy -> 'files', '[]'::jsonb)) f;
  delete from public.note_share_files where slug = p_slug and not (attachment_id = any(wanted));
  return coalesce((select jsonb_agg(w) from unnest(wanted) w
                   where not exists (select 1 from public.note_share_files f where f.slug = p_slug and f.attachment_id = w)), '[]'::jsonb);
end $$;
revoke all on function public.pane_write_share_copy(text, jsonb) from public, anon, authenticated;

-- Creates the note's link (or keeps the live one) and publishes its copy. Returns {slug, missing_files}.
drop function public.share_note(uuid, boolean);
create function public.share_note(p_note uuid, p_include_subnotes boolean, p_copy jsonb)
returns jsonb
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
  return jsonb_build_object('slug', v_slug, 'missing_files', public.pane_write_share_copy(v_slug, p_copy));
end $$;
revoke all on function public.share_note(uuid, boolean, jsonb) from public, anon;
grant execute on function public.share_note(uuid, boolean, jsonb) to authenticated;

-- The note changed: its live link's copy is written again. Returns {slug, missing_files}, or null
-- when the note isn't shared.
create or replace function public.publish_share(p_note uuid, p_copy jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_slug text;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select slug into v_slug from public.note_shares
    where note_id = p_note and user_id = auth.uid() and revoked_at is null;
  if v_slug is null then return null; end if;
  if exists (select 1 from public.notes n where n.id = p_note and (n.locked_body is not null or n.trashed_at is not null or n.deleted_at is not null)) then
    return null;
  end if;
  perform public.pane_take('write');
  return jsonb_build_object('slug', v_slug, 'missing_files', public.pane_write_share_copy(v_slug, p_copy));
end $$;
revoke all on function public.publish_share(uuid, jsonb) from public, anon;
grant execute on function public.publish_share(uuid, jsonb) to authenticated;

-- An AI edited a shared note: the AI server has its text for that request, so the note's page is
-- rewritten under every live link it's on (as a link's root or as an included sub-note). Links and
-- page trees don't change here; the owner's device publishes those.
create or replace function public.republish_note_text(p_note uuid, p_title text, p_body text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer := 0;
  m integer := 0;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.notes where id = p_note and user_id = auth.uid() and deleted_at is null
                 and trashed_at is null and locked_body is null) then
    return 0;
  end if;
  update public.note_shares set title = left(coalesce(p_title, 'New Note'), 300), body = p_body, published_at = now()
    where note_id = p_note and user_id = auth.uid() and revoked_at is null and published_at is not null;
  get diagnostics n = row_count;
  update public.note_share_pages p set title = left(coalesce(p_title, 'New Note'), 300), body = p_body
    from public.note_shares s
    where p.note_id = p_note and s.slug = p.slug and s.user_id = auth.uid() and s.revoked_at is null;
  get diagnostics m = row_count;
  return n + m;
end $$;
revoke all on function public.republish_note_text(uuid, text, text) from public, anon;
grant execute on function public.republish_note_text(uuid, text, text) to authenticated;

-- A readable copy of one file a shared page embeds (base64, at most 10 MB).
create or replace function public.publish_share_file(p_slug text, p_attachment uuid, p_filename text, p_content_type text, p_content text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  bytes bytea;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.note_shares where slug = p_slug and user_id = auth.uid() and revoked_at is null) then
    raise exception 'That note isn''t shared.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.attachments a where a.id = p_attachment and a.user_id = auth.uid() and a.deleted_at is null) then
    raise exception 'no such file' using errcode = 'P0002';
  end if;
  perform public.pane_take('write', 10);
  bytes := decode(p_content, 'base64');
  insert into public.note_share_files (slug, attachment_id, filename, content_type, size, content)
  values (p_slug, p_attachment, left(coalesce(nullif(p_filename, ''), 'file'), 255),
          left(coalesce(nullif(p_content_type, ''), 'application/octet-stream'), 200), octet_length(bytes), bytes)
  on conflict (slug, attachment_id) do update
    set filename = excluded.filename, content_type = excluded.content_type, size = excluded.size, content = excluded.content;
  perform public.pane_prune_share_files(p_slug);
end $$;
revoke all on function public.publish_share_file(text, uuid, text, text, text) from public, anon;
grant execute on function public.publish_share_file(text, uuid, text, text, text) to authenticated;

-- What a link shows: the published copy, never the note itself.
create or replace function public.shared_note(p_slug text, p_sub uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.note_shares;
  pg public.note_share_pages;
begin
  if p_slug is null or p_slug !~ '^[A-Za-z0-9_-]{24,64}$' then return null; end if;
  select * into s from public.note_shares where slug = p_slug and revoked_at is null and published_at is not null;
  if not found then return null; end if;
  if not exists (select 1 from public.notes r where r.id = s.note_id and r.deleted_at is null
                 and r.trashed_at is null and r.locked_body is null) then
    return null;
  end if;
  if p_sub is null then
    return jsonb_build_object(
      'title', s.title, 'body', s.body, 'updated_at', s.published_at,
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
    'title', pg.title, 'body', pg.body, 'updated_at', s.published_at,
    'include_subnotes', true, 'is_sub', true, 'root_title', s.title,
    'shared_by', public.pane_sharer(s.user_id),
    'subnotes', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.note_id, 'title', p.title) order by p.title)
        from public.note_share_pages p where p.slug = s.slug and p.parent_id = pg.note_id), '[]'::jsonb));
end $$;
revoke all on function public.shared_note(text, uuid) from public;
grant execute on function public.shared_note(text, uuid) to anon, authenticated;

-- A file on a shared page: only one the page's copy embeds.
create or replace function public.shared_file(p_slug text, p_sub uuid, p_file uuid)
returns table (filename text, content_type text, size bigint, content bytea)
language sql stable security definer set search_path = '' as $$
  select f.filename, f.content_type, f.size, f.content
  from public.note_share_files f
  where f.slug = p_slug and f.attachment_id = p_file
    and strpos(coalesce((public.shared_note(p_slug, p_sub)) ->> 'body', ''), 'pane-file:' || p_file::text) > 0
$$;
revoke all on function public.shared_file(text, uuid, uuid) from public, anon, authenticated;
