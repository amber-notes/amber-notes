-- Note pages (prototype): each page's own data, next to it and never in the note's markdown. One
-- JSON document, sealed with the account key (context "page-data:<note id>"):
--   {"values": {...}, "collections": {"<name>": [{"id", "created", "updated", ...}]}}
-- Up to 4 MB of JSON (5.6 MB sealed): whole-document syncs stay quick on a phone; photos,
-- recordings and other files go to the encrypted file storage and are referenced as {"$file": id}.
alter table public.note_pages
  add column data_ct text check (data_ct is null or (data_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$' and octet_length(data_ct) <= 5600000));

-- Kept pages carry the data they had; a version made by a data change alone has the same page.
alter table public.note_page_versions alter column page_ct drop not null;
alter table public.note_page_versions
  add column data_ct text check (data_ct is null or (data_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$' and octet_length(data_ct) <= 5600000)),
  add column reason text not null default 'page' check (reason in ('page', 'data'));

-- The key check covers the data too.
create or replace function public.pane_note_page_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  k text;
begin
  if new.page_ct is not null or new.data_ct is not null then
    select key_id into k from public.account_keys where user_id = new.user_id;
    if k is null or (new.page_ct is not null and split_part(new.page_ct, '.', 2) <> k)
       or (new.data_ct is not null and split_part(new.data_ct, '.', 2) <> k) then
      raise exception 'This device has an old key for your notes. Open Amber Notes again to get the current one.'
        using errcode = '42501', hint = 'wrong_key';
    end if;
  end if;
  new.client := left(coalesce(public.pane_writer(), new.client), 100);
  new.updated_at := now();
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

-- A new page keeps the one before it, always. Data changes keep at most one version a minute, so
-- ticking through a list doesn't push every page out of the last 10.
drop trigger note_pages_keep on public.note_pages;
create or replace function public.pane_note_page_keep() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  page_changed boolean := old.page_ct is not null and old.page_ct is distinct from new.page_ct;
begin
  if not page_changed then
    if exists (select 1 from public.note_page_versions v where v.note_id = old.note_id and v.reason = 'data'
               and v.replaced_at > now() - interval '1 minute') then
      return new;
    end if;
  end if;
  insert into public.note_page_versions (note_id, user_id, page_ct, data_ct, client, made_at, reason)
  values (old.note_id, old.user_id, old.page_ct, old.data_ct, old.client, old.updated_at, case when page_changed then 'page' else 'data' end);
  delete from public.note_page_versions v
  where v.note_id = old.note_id
    and v.id not in (select id from public.note_page_versions where note_id = old.note_id order by id desc limit 10);
  return new;
end $$;
create trigger note_pages_keep after update of page_ct, data_ct on public.note_pages
  for each row when ((old.page_ct is not null and old.page_ct is distinct from new.page_ct)
                     or (old.data_ct is not null and old.data_ct is distinct from new.data_ct))
  execute function public.pane_note_page_keep();
