-- Version history in the apps: who made each version and when, restoring one from the app,
-- and thinning old history instead of cutting it off at a fixed count.
--
-- Who made a version:
--   notes.body_source / body_client / body_at say who wrote the note's current text and when.
--   A revision copies them from the text it keeps, so every version in the list has an author:
--   'app' + the device ("iPhone", "Mac"), or 'mcp' + the AI connection's name ("ChatGPT").
--   The apps send their device in the x-pane-device request header; MCP calls set pane.client.
--   The database sets all three on every write; clients can't forge them. Existing rows stay
--   null until their next edit (no backfill: touching every note would make every device
--   pull every note again), and the apps fall back to the neighbouring revision.
--
-- Retention (per note, checked every time a revision is kept):
--   everything from the last 24 hours
--   then the last version of each hour, for 7 days
--   then the last version of each day, for 90 days
--   every AI edit (the text before it and the text it wrote) for 90 days
--   and never more than 500 revisions or 10 MB of them, newest kept first
--
-- Restoring: restore_note_version(note, version) writes that version as a new edit, with
-- pane.source = 'restore' so the text it replaces is always kept. Nothing is lost.
--
-- A purged note still forgets its history (20260928221000); that part of pane_touch is unchanged.

alter table public.notes
  add column body_source text check (body_source is null or char_length(body_source) <= 20),
  add column body_client text check (body_client is null or char_length(body_client) <= 100),
  add column body_at timestamptz;

alter table public.note_revisions
  add column body_source text check (body_source is null or char_length(body_source) <= 20),
  add column body_client text check (body_client is null or char_length(body_client) <= 100),
  add column body_at timestamptz;

-- A thinned note is read version by version.
create index note_revisions_note_version on public.note_revisions (note_id, version desc);

-- Who is writing: an MCP connection's name, or the device the app says it runs on.
create or replace function public.pane_writer() returns text
language plpgsql stable set search_path = '' as $$
declare
  who text := nullif(current_setting('pane.client', true), '');
  headers text := nullif(current_setting('request.headers', true), '');
begin
  if who is null and headers is not null then
    begin
      who := nullif(btrim(headers::json->>'x-pane-device'), '');
    exception when others then
      who := null;
    end;
  end if;
  return left(who, 100);
end $$;

-- As in 20260929100000, plus who wrote each text. Typing keeps at most one revision a minute.
create or replace function public.pane_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  src text := coalesce(nullif(current_setting('pane.source', true), ''), 'app');
  who text := public.pane_writer();
begin
  new.server_updated_at := clock_timestamp();
  if tg_table_name = 'notes' then
    if tg_op = 'INSERT' then
      new.body_source := left(src, 20);
      new.body_client := who;
      new.body_at := clock_timestamp();
    elsif tg_op = 'UPDATE' then
      new.version := old.version + 1;
      if new.body is distinct from old.body then
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
      elsif new.body is distinct from old.body and old.body <> ''
        and (src <> 'app' or not exists (select 1 from public.note_revisions r
                        where r.note_id = old.id and r.source = 'app'
                          and r.created_at > clock_timestamp() - interval '1 minute')) then
        insert into public.note_revisions (note_id, user_id, body, version, source, client, body_source, body_client, body_at)
        values (old.id, old.user_id, old.body, old.version, src, who, old.body_source, old.body_client, old.body_at);
      end if;
    end if;
  end if;
  return new;
end $$;

-- The ceiling moves from 100 to 500 revisions per note: thinning keeps it well under that
-- for most notes, and 10 MB per note still bounds the bytes.
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
    when 'revisions'       then 500
    when 'revision_bytes'  then 10 * 1024 * 1024
  end
$$;

-- Thins one note's history (see the top of this file). Returns how many revisions went.
-- `p_now` is for tests; everything else uses the clock.
create or replace function public.pane_thin_revisions(p_note uuid, p_now timestamptz default clock_timestamp())
returns integer language plpgsql security definer set search_path = '' as $$
declare
  gone integer;
begin
  with r as (
    select id, created_at, octet_length(body) as bytes, p_now - created_at as age,
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

create or replace function public.pane_trim_revisions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.pane_thin_revisions(new.note_id);
  return null;
end $$;

-- Notes nobody edits keep their history until their next edit. This thins every note whose
-- history has something old enough to go; run it from a schedule (not set up here):
--   select public.pane_thin_all_revisions();
create or replace function public.pane_thin_all_revisions() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n uuid;
  total integer := 0;
begin
  for n in select distinct note_id from public.note_revisions where created_at < clock_timestamp() - interval '24 hours' loop
    total := total + public.pane_thin_revisions(n);
  end loop;
  return total;
end $$;
revoke all on function public.pane_thin_all_revisions() from public, anon, authenticated;

-- Restore This Version, from the apps: writes the kept text as a new edit. The text it replaces
-- becomes a revision of its own (source 'restore' is never throttled), so a restore can be undone
-- the same way. Runs as the caller, so row-level security decides whose notes it can touch.
create or replace function public.restore_note_version(p_note uuid, p_version bigint)
returns setof public.notes language plpgsql security invoker set search_path = '' as $$
declare
  kept text;
begin
  select r.body into kept from public.note_revisions r
  where r.note_id = p_note and r.version = p_version
  order by r.id desc limit 1;
  if not found then
    raise exception 'That version is no longer kept.' using errcode = 'PT404', hint = 'no_such_version';
  end if;
  perform set_config('pane.source', 'restore', true);
  return query
    update public.notes n set body = kept, updated_at = now()
    where n.id = p_note and n.deleted_at is null
    returning n.*;
end $$;
revoke all on function public.restore_note_version(uuid, bigint) from public, anon;
grant execute on function public.restore_note_version(uuid, bigint) to authenticated;
