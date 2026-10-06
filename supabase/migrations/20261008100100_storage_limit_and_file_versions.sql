-- Storage per person, file versions, and files the AI can change (docs/Technical/folder-files.md).
--
-- 1. Every account has room for 2 GB, measured on what's stored (sealed): note text and heads,
--    their earlier versions, files and their earlier versions, apps (code, data, drafts and their
--    versions). Recently Deleted counts until it's deleted for good. The limits live in
--    pane_limit, the one place to change them. Only growth is refused: an account over the
--    limit keeps everything and can still shrink, delete and edit down, but can't add.
-- 2. A file can be replaced (the AI writes a new version of it): the version it replaces is kept
--    in attachment_versions, with its sealed bytes copied in Storage to <user id>/<id>.v<n>.
--    content_version counts replacements, so devices fetch the bytes again.
-- 3. One file is at most 100 MB (the app); the AI sends and receives files up to 10 MB.
--
-- Expand/coexist: older apps don't read content_version (they keep a replaced file's old bytes
-- until it's downloaded again) and get the storage refusal like any other refused write.

-- MARK: Limits, in one place

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
    -- Files alone may use the whole room; storage_bytes is what holds.
    when 'files_bytes'     then 2048::bigint * 1024 * 1024
    when 'tokens'          then 50
    when 'revisions'       then 500
    when 'revision_bytes'  then 10 * 1024 * 1024
    -- Everything one person stores, sealed: 2 GB.
    when 'storage_bytes'   then 2048::bigint * 1024 * 1024
    -- One file added in the app, and one file the AI sends or receives.
    when 'file_bytes'      then 100 * 1024 * 1024
    when 'ai_file_bytes'   then 10 * 1024 * 1024
    -- Earlier versions kept per file.
    when 'file_versions'   then 10
  end
$$;
revoke all on function public.pane_limit(text) from public, anon, authenticated;

update storage.buckets set file_size_limit = 104857600 where id = 'files';

-- MARK: File versions

alter table public.attachments add column content_version integer not null default 0;

create table public.attachment_versions (
  id            bigint generated always as identity primary key,
  attachment_id uuid not null references public.attachments (id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The name, type and size it had, sealed as attachments.meta_ct is.
  meta_ct       text not null check (meta_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$' and octet_length(meta_ct) <= 4000),
  size          bigint not null check (size >= 0),
  -- Its sealed bytes: <user id>/<attachment id>.v<n>.
  storage_path  text not null,
  client        text,
  made_at       timestamptz not null,
  replaced_at   timestamptz not null default now(),
  constraint attachment_versions_path check (storage_path ~ ('^' || user_id::text || '/' || attachment_id::text || '\.v[0-9]+$'))
);
create index attachment_versions_file on public.attachment_versions (attachment_id, id desc);
alter table public.attachment_versions enable row level security;
create policy "own file versions" on public.attachment_versions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.attachment_versions from anon;
create trigger attachment_versions_sealed before insert or update of meta_ct on public.attachment_versions
  for each row execute function public.pane_sealed_guard();

-- MARK: What's stored

alter table public.pane_usage add column storage_bytes bigint, add column storage_at timestamptz;

-- Everything an account stores, sealed, by kind. Recently Deleted is its own kind (notes in it and
-- files in it); earlier versions of notes, files and apps are "versions".
create or replace function public.pane_storage_parts(p_user uuid)
returns table (notes bigint, files bigint, apps bigint, deleted bigint, versions bigint)
language sql stable security definer set search_path = '' as $$
  select
    (select coalesce(sum(coalesce(octet_length(body_ct), 0) + coalesce(octet_length(head_ct), 0) + coalesce(octet_length(locked_body), 0)), 0)
       from public.notes where user_id = p_user and deleted_at is null and trashed_at is null)::bigint,
    (select coalesce(sum(size), 0) from public.attachments where user_id = p_user and deleted_at is null and trashed_at is null)::bigint,
    (select coalesce(sum(coalesce(octet_length(page_ct), 0) + coalesce(octet_length(data_ct), 0) + coalesce(octet_length(draft_ct), 0)), 0)
       from public.note_pages where user_id = p_user)::bigint,
    ((select coalesce(sum(coalesce(octet_length(body_ct), 0) + coalesce(octet_length(head_ct), 0) + coalesce(octet_length(locked_body), 0)), 0)
        from public.notes where user_id = p_user and deleted_at is null and trashed_at is not null)
     + (select coalesce(sum(size), 0) from public.attachments where user_id = p_user and deleted_at is null and trashed_at is not null))::bigint,
    ((select coalesce(sum(coalesce(octet_length(body_ct), 0) + coalesce(octet_length(head_ct), 0) + coalesce(octet_length(locked_body), 0)), 0)
        from public.note_revisions where user_id = p_user)
     + (select coalesce(sum(size), 0) from public.attachment_versions where user_id = p_user)
     + (select coalesce(sum(coalesce(octet_length(page_ct), 0) + coalesce(octet_length(data_ct), 0)), 0)
        from public.note_page_versions where user_id = p_user))::bigint
$$;
revoke all on function public.pane_storage_parts(uuid) from public, anon, authenticated;

-- The total, from a minute-old count while it's well under the limit, counted again otherwise.
create or replace function public.pane_storage_used(p_user uuid, p_fresh boolean default false) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  u public.pane_usage;
  total bigint;
begin
  select * into u from public.pane_usage where user_id = p_user;
  if not p_fresh and u.storage_at > clock_timestamp() - interval '60 seconds'
     and u.storage_bytes < public.pane_limit('storage_bytes') * 0.9 then
    return u.storage_bytes;
  end if;
  select p.notes + p.files + p.apps + p.deleted + p.versions into total from public.pane_storage_parts(p_user) p;
  insert into public.pane_usage as x (user_id, storage_bytes, storage_at) values (p_user, total, clock_timestamp())
  on conflict (user_id) do update set storage_bytes = total, storage_at = clock_timestamp();
  return total;
end $$;
revoke all on function public.pane_storage_used(uuid, boolean) from public, anon, authenticated;

-- Refuses growth once the account is at its limit.
create or replace function public.pane_storage_check(p_user uuid, p_more bigint default 0) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then return; end if;
  if public.pane_storage_used(p_user) + greatest(p_more, 0) > public.pane_limit('storage_bytes') then
    raise exception 'Amber Notes is full: you use all 2 GB. Empty Recently Deleted or delete large files, then try again.'
      using errcode = 'PT413', hint = 'storage';
  end if;
  -- What this write adds counts at once, so a burst can't outrun the minute-old count. (What's
  -- removed counts when the total is next counted.)
  update public.pane_usage set storage_bytes = storage_bytes + greatest(p_more, 0) where user_id = p_user and storage_bytes is not null;
end $$;
revoke all on function public.pane_storage_check(uuid, bigint) from public, anon, authenticated;

-- Room left for the caller, for writes that don't pass the triggers first (the AI server uploads
-- a file's bytes before its row changes).
create or replace function public.storage_room(p_more bigint default 0) returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  perform public.pane_storage_check(auth.uid(), p_more);
  return public.pane_limit('storage_bytes') - public.pane_storage_used(auth.uid());
end $$;
revoke all on function public.storage_room(bigint) from public, anon;
grant execute on function public.storage_room(bigint) to authenticated;

-- Writes that make an account bigger: refused at the limit. Shrinking always works.
create or replace function public.pane_storage_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  j jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  grow bigint := 0;
  k text;
begin
  if tg_table_name = 'attachments' then
    grow := coalesce((j ->> 'size')::bigint, 0) - coalesce((o ->> 'size')::bigint, 0);
  else
    foreach k in array array['body_ct', 'head_ct', 'locked_body', 'page_ct', 'data_ct', 'draft_ct'] loop
      grow := grow + coalesce(octet_length(j ->> k), 0) - coalesce(octet_length(o ->> k), 0);
    end loop;
  end if;
  if grow > 0 then perform public.pane_storage_check(new.user_id, grow); end if;
  return new;
end $$;
create trigger notes_storage before insert or update of body_ct, head_ct, locked_body on public.notes
  for each row execute function public.pane_storage_guard();
create trigger note_pages_storage before insert or update of page_ct, data_ct, draft_ct on public.note_pages
  for each row execute function public.pane_storage_guard();
create trigger attachments_storage before insert or update of size on public.attachments
  for each row execute function public.pane_storage_guard();

-- Storage itself: an upload is refused once the account is full (as at 10,000 files), checked in
-- the policy because Storage's tables belong to the storage service.
create or replace function public.pane_storage_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.pane_storage_used((select auth.uid())) < public.pane_limit('storage_bytes')
$$;
revoke all on function public.pane_storage_ok() from public, anon;
grant execute on function public.pane_storage_ok() to authenticated;

drop policy "own files write" on storage.objects;
create policy "own files write" on storage.objects for insert to authenticated
  with check (bucket_id = 'files'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and public.pane_files_ok()
              and public.pane_storage_ok());

-- What Settings shows: "X of 2 GB used", by kind. Counted now, not from the cache.
create or replace function public.storage_usage() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  p record;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into p from public.pane_storage_parts(uid);
  perform public.pane_storage_used(uid, true);
  return jsonb_build_object(
    'used', p.notes + p.files + p.apps + p.deleted + p.versions, 'limit', public.pane_limit('storage_bytes'),
    'notes', p.notes, 'files', p.files, 'apps', p.apps, 'deleted', p.deleted, 'versions', p.versions,
    'file_limit', public.pane_limit('file_bytes'), 'ai_file_limit', public.pane_limit('ai_file_bytes'));
end $$;
revoke all on function public.storage_usage() from public, anon;
grant execute on function public.storage_usage() to authenticated;
