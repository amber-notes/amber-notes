-- Share links: a note (and optionally its sub-notes) readable by anyone with the link.
-- The slug is the only secret: 144 random bits, URL-safe. Links are revoked, never reused.

create table public.note_shares (
  slug text primary key check (slug ~ '^[A-Za-z0-9_-]{24,64}$'),
  note_id uuid not null references public.notes (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  include_subnotes boolean not null default false,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- One live link per note.
create unique index note_shares_live on public.note_shares (note_id) where revoked_at is null;
create index note_shares_user on public.note_shares (user_id);

alter table public.note_shares enable row level security;
create policy "own shares read" on public.note_shares for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.note_shares from anon;
-- Writes go through the functions below, which check the note is yours.
revoke insert, update, delete on public.note_shares from authenticated;

-- Creates the note's link, or returns the live one (updating whether sub-notes are included).
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

-- Stops sharing: the link dies for good. Sharing again makes a new link.
create or replace function public.unshare_note(p_note uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  update public.note_shares set revoked_at = now()
    where note_id = p_note and user_id = auth.uid() and revoked_at is null;
end $$;

revoke all on function public.share_note(uuid, boolean), public.unshare_note(uuid) from public, anon;
grant execute on function public.share_note(uuid, boolean), public.unshare_note(uuid) to authenticated;

-- What a link shows. With p_sub, one of the shared note's sub-notes (any depth), when the
-- link includes sub-notes. Returns nothing for revoked links and trashed or deleted notes.
-- Only what the page needs: title, body, when it changed, and the included sub-notes' titles.
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
    'subnotes', case when s.include_subnotes then coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title) order by c.title)
        from public.notes c
        where c.parent_id = n.id and c.user_id = s.user_id and c.deleted_at is null and c.trashed_at is null
      ), '[]'::jsonb) else '[]'::jsonb end);
end $$;

revoke all on function public.shared_note(text, uuid) from public;
grant execute on function public.shared_note(text, uuid) to anon, authenticated;
