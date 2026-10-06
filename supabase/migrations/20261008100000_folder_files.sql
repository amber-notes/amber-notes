-- Files as folder items (docs/Technical/folder-files.md).
--
-- A file can now sit in a folder on its own, next to notes and apps ("To read/Paper.pdf"), as well
-- as be embedded in a note's text (pane-file:<id>) as before. folder_id says which folder; null is
-- a file that only lives inside notes. A file in a folder goes to Recently Deleted like a note
-- (trashed_at), and is deleted for good 30 days later (deleted_at, as before).
--
-- Expand/coexist: older apps don't send folder_id or trashed_at, and an upsert only sets the
-- columns it sends, so their writes keep both. They pull these rows like any file and show none of
-- them (they only show files a note embeds). Deleting a folder in an older app still takes its
-- files to Recently Deleted: the trigger below does it, not the app.

alter table public.attachments
  add column folder_id uuid references public.folders (id) on delete set null,
  add column trashed_at timestamptz;

create index attachments_folder on public.attachments (folder_id) where folder_id is not null;

-- A file can only go into one of the owner's own folders.
create or replace function public.pane_attachment_folder() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.folder_id is not null and (tg_op = 'INSERT' or new.folder_id is distinct from old.folder_id)
     and not exists (select 1 from public.folders f where f.id = new.folder_id and f.user_id = new.user_id) then
    perform public.pane_over('not_yours');
  end if;
  return new;
end $$;
create trigger attachments_folder before insert or update of folder_id on public.attachments
  for each row execute function public.pane_attachment_folder();

-- Deleting a folder sends its files to Recently Deleted, whoever deleted it (an app of any
-- version, the AI). Restoring one later puts it back in its folder, or in Notes if that's gone.
create or replace function public.pane_folder_trash_files() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.attachments set trashed_at = now(), updated_at = now()
    where folder_id = new.id and user_id = new.user_id and trashed_at is null and deleted_at is null;
  end if;
  return null;
end $$;
create trigger folders_trash_files after update of deleted_at on public.folders
  for each row execute function public.pane_folder_trash_files();

-- Recently Deleted keeps a file for 30 days, like a note. The apps purge on launch and remove the
-- bytes from Storage; this covers accounts whose apps aren't opened (the next device to sync
-- removes the bytes of a file it sees deleted).
create or replace function public.pane_forget_files_daily() returns void
language sql security definer set search_path = '' as $$
  update public.attachments set deleted_at = now()
  where trashed_at < now() - interval '30 days' and deleted_at is null
$$;
revoke all on function public.pane_forget_files_daily() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('amber-forget-files-daily', '29 3 * * *', 'select public.pane_forget_files_daily()');
  end if;
end $$;
