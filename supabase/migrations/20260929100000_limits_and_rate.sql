-- Limits for an app anyone can join.
--
-- Row-level security already keeps people out of each other's notes; this keeps one
-- account from filling the project or hammering it. Everything is enforced here, in the
-- database, so it holds for the app, the MCP server and direct API calls alike.
--
--   per note:        2 MB of text
--   per account:     50,000 notes, 100 MB of note text, 2,000 folders,
--                    10,000 files, 500 MB of files, 50 active AI connections
--   nesting:         folders 30 deep, sub-notes 50 deep, never in a loop
--   rate:            writes 5,000 at once, then 50 a second; MCP calls 600, then 5 a second
--   history:         typing keeps at most one revision a minute; every AI edit keeps one; 100 and 10 MB per note
--
-- Going over a limit fails that one write with a plain message: HTTP 413 for "too big /
-- too many", 429 for "too fast". Anything that shrinks usage always goes through.

create or replace function public.pane_limit(k text) returns bigint
language sql immutable set search_path = '' as $$
  select case k
    when 'note_bytes'      then 2 * 1024 * 1024
    when 'notes'           then 50000
    when 'notes_bytes'     then 100 * 1024 * 1024
    when 'folders'         then 2000
    when 'folder_depth'    then 30
    when 'subnote_depth'   then 50
    when 'files'           then 10000
    when 'files_bytes'     then 500 * 1024 * 1024
    when 'tokens'          then 50
    when 'revisions'       then 100
    when 'revision_bytes'  then 10 * 1024 * 1024
  end
$$;

-- One text limit for new writes. NOT VALID: rows already stored are left alone.
alter table public.notes add constraint notes_body_2mb check (octet_length(body) <= 2097152) not valid;

-- What each account uses, kept up to date by triggers (summing bodies on every write would be slow).
create table public.pane_usage (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  notes       integer not null default 0,
  notes_bytes bigint  not null default 0,
  folders     integer not null default 0
);
alter table public.pane_usage enable row level security;
create policy "own usage read" on public.pane_usage for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.pane_usage from anon;
revoke insert, update, delete, truncate on public.pane_usage from authenticated;

insert into public.pane_usage (user_id, notes, notes_bytes)
select user_id, count(*) filter (where deleted_at is null), coalesce(sum(octet_length(body)), 0)
from public.notes group by user_id
on conflict (user_id) do nothing;
update public.pane_usage u set folders = f.n
from (select user_id, count(*) n from public.folders where deleted_at is null group by user_id) f where f.user_id = u.user_id;
insert into public.pane_usage (user_id, folders)
select user_id, count(*) from public.folders where deleted_at is null group by user_id
on conflict (user_id) do nothing;

-- Token buckets for "too fast". Only the definer functions below touch it.
create table public.pane_rate (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket  text not null,
  tokens  double precision not null,
  at      timestamptz not null default clock_timestamp(),
  primary key (user_id, bucket)
);
alter table public.pane_rate enable row level security;
revoke all on public.pane_rate from anon, authenticated;

-- Takes `cost` from a bucket, or fails with 429. A failed take is rolled back with the
-- write, so being refused never costs anything.
create or replace function public.pane_take(p_bucket text, p_cost double precision default 1)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  cap double precision;
  per_second double precision;
  left_over double precision;
begin
  if uid is null then return; end if; -- server-side maintenance, not a person
  select v.cap, v.rate into cap, per_second
  from (values ('write', 5000::float8, 50::float8), ('mcp', 600, 5), ('token', 30, 0.05)) v(bucket, cap, rate)
  where v.bucket = p_bucket;
  if cap is null then return; end if;
  insert into public.pane_rate as r (user_id, bucket, tokens, at)
  values (uid, p_bucket, cap - p_cost, clock_timestamp())
  on conflict (user_id, bucket) do update
    set tokens = least(cap, r.tokens + extract(epoch from clock_timestamp() - r.at) * per_second) - p_cost,
        at = clock_timestamp()
  returning tokens into left_over;
  if left_over < 0 then
    raise exception 'Too many changes too quickly. Wait a moment and try again.'
      using errcode = 'PT429', hint = 'rate_limited';
  end if;
end $$;
revoke all on function public.pane_take(text, double precision) from public, anon;
grant execute on function public.pane_take(text, double precision) to authenticated, service_role;

create or replace function public.pane_over(what text) returns void
language plpgsql volatile set search_path = '' as $$
begin
  raise exception '%', case what
      when 'note_bytes'    then 'This note is too long (the limit is 2 MB of text). Split it into smaller notes.'
      when 'notes'         then 'You have reached 50,000 notes. Delete some to add more.'
      when 'notes_bytes'   then 'Your notes have reached 100 MB of text. Delete some to add more.'
      when 'folders'       then 'You have reached 2,000 folders.'
      when 'folder_depth'  then 'Folders can be nested at most 30 deep.'
      when 'folder_loop'   then 'A folder can''t be moved inside itself.'
      when 'subnote_depth' then 'Sub-notes can be nested at most 50 deep.'
      when 'subnote_loop'  then 'A note can''t be its own sub-note.'
      when 'files'         then 'You have reached 10,000 files. Delete some to add more.'
      when 'files_bytes'   then 'Your files have reached 500 MB. Delete some to add more.'
      when 'tokens'        then 'You have 50 active AI connections. Disconnect one to add another.'
      when 'not_yours'     then 'That folder or note doesn''t exist.'
    end
    using errcode = 'PT413', hint = what;
end $$;

-- Notes: rate, size, ownership of what it points at, nesting, and the account's totals.
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
  if tg_op = 'DELETE' then
    update public.pane_usage x
      set notes = greatest(x.notes - case when old.deleted_at is null then 1 else 0 end, 0),
          notes_bytes = greatest(x.notes_bytes - octet_length(old.body), 0)
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
      d_bytes := octet_length(new.body);
    else
      d_notes := (case when new.deleted_at is null then 1 else 0 end) - (case when old.deleted_at is null then 1 else 0 end);
      d_bytes := octet_length(new.body) - octet_length(old.body);
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

create trigger notes_account before insert or update or delete on public.notes
  for each row execute function public.pane_account_note();

-- Folders: rate, ownership of the parent, nesting without loops, and the count.
create or replace function public.pane_account_folder() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := coalesce(new.user_id, old.user_id);
  d int := 0;
  u public.pane_usage;
  p uuid;
  depth int := 0;
begin
  if tg_op = 'DELETE' then
    update public.pane_usage x set folders = greatest(x.folders - case when old.deleted_at is null then 1 else 0 end, 0)
      where x.user_id = old.user_id;
    return old;
  else
    perform public.pane_take('write');
    if new.parent_id is not null and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
      p := new.parent_id;
      while p is not null loop
        if p = new.id then perform public.pane_over('folder_loop'); end if;
        depth := depth + 1;
        if depth >= public.pane_limit('folder_depth') then perform public.pane_over('folder_depth'); end if;
        select f.parent_id into p from public.folders f where f.id = p and f.user_id = new.user_id;
        if not found then
          if depth = 1 then perform public.pane_over('not_yours'); end if;
          exit;
        end if;
      end loop;
    end if;
    d := (case when new.deleted_at is null then 1 else 0 end)
       - (case when tg_op = 'UPDATE' and old.deleted_at is null then 1 else 0 end);
  end if;
  if d = 0 then return coalesce(new, old); end if;
  insert into public.pane_usage as x (user_id, folders) values (owner, greatest(d, 0))
  on conflict (user_id) do update set folders = greatest(x.folders + d, 0)
  returning * into u;
  if d > 0 and u.folders > public.pane_limit('folders') then perform public.pane_over('folders'); end if;
  return coalesce(new, old);
end $$;

create trigger folders_account before insert or update or delete on public.folders
  for each row execute function public.pane_account_folder();

-- Attachment rows only get the rate limit; the bytes are counted where they really
-- land, in storage (below), so skipping the metadata row doesn't dodge the limit.
create or replace function public.pane_account_attachment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.pane_take('write');
  return new;
end $$;
create trigger attachments_account before insert or update on public.attachments
  for each row execute function public.pane_account_attachment();

-- Files: checked against what storage actually holds under the account's folder, in the
-- upload policy itself. (Storage's tables belong to the storage service, so a trigger
-- there isn't possible; a policy is.) A new upload is refused once the account is at
-- 10,000 files or 500 MB, so the most one account can hold is that plus one upload.
create or replace function public.pane_files_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select count(*) < public.pane_limit('files')
     and coalesce(sum((o.metadata->>'size')::bigint), 0) < public.pane_limit('files_bytes')
  from storage.objects o
  where o.bucket_id = 'files' and o.name like (select auth.uid())::text || '/%'
$$;
revoke all on function public.pane_files_ok() from public, anon;
grant execute on function public.pane_files_ok() to authenticated;

drop policy "own files write" on storage.objects;
create policy "own files write" on storage.objects for insert to authenticated
  with check (bucket_id = 'files'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and public.pane_files_ok());

-- One upload is at most 50 MB (was 100 MB).
update storage.buckets set file_size_limit = 52428800 where id = 'files';

-- AI connections: at most 50 active per account, and new ones are rate-limited.
create or replace function public.pane_account_token() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.pane_take('token');
  if (select count(*) from public.mcp_tokens t where t.user_id = new.user_id and t.revoked_at is null) >= public.pane_limit('tokens') then
    perform public.pane_over('tokens');
  end if;
  return new;
end $$;
create trigger mcp_tokens_account before insert on public.mcp_tokens
  for each row execute function public.pane_account_token();

-- History: the app saves at every pause in typing, so its revisions are kept at most one a
-- minute per note; every AI edit, import and restore still keeps its own. A note never has
-- more than 100 revisions or 10 MB of them.
create or replace function public.pane_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  src text := coalesce(nullif(current_setting('pane.source', true), ''), 'app');
begin
  new.server_updated_at := clock_timestamp();
  if tg_table_name = 'notes' then
    if tg_op = 'UPDATE' then
      new.version := old.version + 1;
      if new.deleted_at is not null then
        delete from public.note_revisions where note_id = old.id;
      elsif new.body is distinct from old.body and old.body <> ''
        and (src <> 'app' or not exists (select 1 from public.note_revisions r
                        where r.note_id = old.id and r.source = 'app'
                          and r.created_at > clock_timestamp() - interval '1 minute')) then
        insert into public.note_revisions (note_id, user_id, body, version, source, client)
        values (old.id, old.user_id, old.body, old.version, src,
                nullif(current_setting('pane.client', true), ''));
      end if;
    end if;
  end if;
  return new;
end $$;

create or replace function public.pane_trim_revisions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.note_revisions r
  using (
    select id, row_number() over w as n, sum(octet_length(body)) over w as bytes
    from public.note_revisions where note_id = new.note_id
    window w as (order by id desc)
  ) k
  where r.id = k.id
    and (k.n > public.pane_limit('revisions') or (k.n > 1 and k.bytes > public.pane_limit('revision_bytes')));
  return null;
end $$;
