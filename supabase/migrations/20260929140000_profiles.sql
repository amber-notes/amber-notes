-- Profiles: your own name and photo, shown in the app and on the notes you share.
--
-- The photo lives in a public `avatars` bucket under a random name (32 hex characters, no
-- user id in it). A share page can then show it with a plain, cacheable URL that reveals
-- nothing about the account; nobody can list the bucket, so a photo is only reachable
-- through a page that shows it. Ownership is the storage row's owner, not the path.

create table public.profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name text check (
    display_name is null
    or (char_length(display_name) between 1 and 60
        and display_name = btrim(display_name)
        and display_name !~ '[[:cntrl:]]')),
  avatar_path text check (avatar_path is null or avatar_path ~ '^[0-9a-f]{32}\.(jpg|png)$'),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "own profile read" on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own profile insert" on public.profiles for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own profile update" on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own profile delete" on public.profiles for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.profiles from anon;
grant select, insert, update, delete on public.profiles to authenticated;

-- Writes count against the account's write rate like everything else, and stamp the time.
create or replace function public.pane_profile_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.pane_take('write');
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_touch before insert or update on public.profiles
  for each row execute function public.pane_profile_touch();

-- Other devices pick up a new name or photo straight away.
alter publication supabase_realtime add table public.profiles;

-- Photos: JPEG or PNG, at most 1 MB, public to read by exact name, never listable.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- A handful of photos per account at most (the current one, and one being replaced).
create or replace function public.pane_avatars_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select count(*) < 4 from storage.objects o
  where o.bucket_id = 'avatars' and o.owner_id = (select auth.uid())::text
$$;
revoke all on function public.pane_avatars_ok() from public, anon;
grant execute on function public.pane_avatars_ok() to authenticated;

create policy "own avatar read" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and owner_id = (select auth.uid())::text);
create policy "own avatar write" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars'
              and name ~ '^[0-9a-f]{32}\.(jpg|png)$'
              and owner_id = (select auth.uid())::text
              and public.pane_avatars_ok());
create policy "own avatar delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and owner_id = (select auth.uid())::text);

-- A share page says who shared it: the name if you set one, and your email unless it's an
-- Apple private relay address (those are never shown). Never the account id.
create or replace function public.pane_sharer(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', p.display_name,
    'email', case when u.email is null or u.email ilike '%@privaterelay.appleid.com' then null else u.email end,
    'avatar', p.avatar_path)
  from auth.users u left join public.profiles p on p.user_id = u.id
  where u.id = p_user
$$;
revoke all on function public.pane_sharer(uuid) from public, anon, authenticated;

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
    where id = target and user_id = s.user_id and deleted_at is null and trashed_at is null;
  if not found then return null; end if;
  -- The root note itself must still be live for any of its pages to show.
  if target <> s.note_id and not exists (select 1 from public.notes r
      where r.id = s.note_id and r.deleted_at is null and r.trashed_at is null) then
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
      ), '[]'::jsonb) else '[]'::jsonb end);
end $$;

revoke all on function public.shared_note(text, uuid) from public;
grant execute on function public.shared_note(text, uuid) to anon, authenticated;
