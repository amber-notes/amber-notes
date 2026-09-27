-- Files kept in Pane (PDFs, spreadsheets, images). Bytes live in the private "files"
-- bucket under <user id>/<attachment id>/<filename>; this table holds the metadata.

create table public.attachments (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  filename text not null check (char_length(filename) between 1 and 255),
  content_type text not null default 'public.data',
  size bigint not null default 0 check (size >= 0),
  storage_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);

create index attachments_user_sync on public.attachments (user_id, server_updated_at);

create trigger attachments_touch before insert or update on public.attachments
  for each row execute function public.pane_touch();

alter table public.attachments enable row level security;
create policy "own attachments" on public.attachments for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and storage_path like (select auth.uid())::text || '/%');
revoke all on public.attachments from anon;

alter publication supabase_realtime add table public.attachments;

-- Private bucket, 100 MB per file.
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 104857600)
on conflict (id) do nothing;

create policy "own files read" on storage.objects for select to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own files write" on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own files update" on storage.objects for update to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
