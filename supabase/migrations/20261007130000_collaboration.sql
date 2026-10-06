-- Collaboration (prototype; docs/Technical/collaboration-design.md): notes shared between
-- accounts, edited at the same time, still end-to-end encrypted.
--
-- A shared note has its own random key (the note key, NK). Each member gets NK sealed to their
-- identity public key (`key_wrap`, ECDH P-256) and, once they accept, re-sealed under their own
-- data key (`self_wrap`), which is also what their AI connection opens. The text is an Automerge
-- document: devices send sealed changes (`note_updates`) and now and then a sealed snapshot
-- (`note_snapshots`); the server stores and relays them and can read neither.
--
-- What the server sees: who is a member of which shared note and with which role, when and how
-- much each member writes, and the sizes. Never the text, the title, the page, or a cursor.

-- Identity keys: one P-256 key pair per account. The public half is here so others can share
-- with you; the private half is sealed under your data key (context `identity:<user id>`), so any
-- device that has the data key (iCloud Keychain, Add a device, the recovery key) has it too.
create table public.identity_keys (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- base64 of the 65-byte uncompressed point.
  public_key text not null check (public_key ~ '^[A-Za-z0-9+/]{87}=$'),
  private_wrap text not null check (private_wrap ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$' and octet_length(private_wrap) < 400),
  created_at timestamptz not null default now()
);
alter table public.identity_keys enable row level security;
create policy "own identity" on public.identity_keys for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.identity_keys from anon, authenticated;
grant select on public.identity_keys to authenticated;

-- Publishing it again with a different key is refused: a changed key is what an attack looks
-- like to the people you share with. Start fresh deletes the row with the account's data.
create or replace function public.collab_publish_identity(p_public_key text, p_private_wrap text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  have text;
begin
  perform public.pane_take('write');
  select public_key into have from public.identity_keys where user_id = auth.uid();
  if have is not null and have <> p_public_key then
    raise exception 'This account already has a different identity key.' using errcode = '42501', hint = 'identity_exists';
  end if;
  insert into public.identity_keys (user_id, public_key, private_wrap) values (auth.uid(), p_public_key, p_private_wrap)
  on conflict (user_id) do nothing;
end $$;

-- Finding someone to share with, by their exact email. Rate limited (the token bucket: 30, then one
-- every 20 seconds) because it says whether an address has an account.
create or replace function public.collab_find_person(p_email text)
returns table (user_id uuid, display_name text, avatar_path text, public_key text)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.pane_take('token');
  return query
    select u.id, p.display_name, p.avatar_path, k.public_key
    from auth.users u
    join public.identity_keys k on k.user_id = u.id
    left join public.profiles p on p.user_id = u.id
    where lower(u.email) = lower(btrim(p_email)) and u.id <> auth.uid();
end $$;

create table public.shared_notes (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The note key's generation; a removal makes a new key.
  epoch int not null default 1 check (epoch >= 1),
  -- Title and preview for the note list, sealed under the note key.
  head_ct text check (head_ct is null or octet_length(head_ct) < 4000),
  -- The note's page (note pages), sealed under the note key.
  page_ct text check (page_ct is null or octet_length(page_ct) <= 700000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.note_members (
  note_id uuid not null references public.shared_notes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  epoch int not null,
  -- NK sealed to the member's identity key: `amb3k.<base64 ephemeral key (65) ‖ nonce ‖ ct ‖ tag>`.
  key_wrap text not null check (key_wrap ~ '^amb3k\.[A-Za-z0-9+/]+={0,2}$' and octet_length(key_wrap) < 400),
  -- NK sealed under the member's data key once they accepted: an `amb2` box, context `notekey:<note id>:<epoch>`.
  self_wrap text check (self_wrap is null or (self_wrap ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$' and octet_length(self_wrap) < 400)),
  -- Whose identity key sealed key_wrap: the owner for invites and new keys, the member themselves
  -- after an invite link. Their device checks the wrap against that person's public key.
  wrapped_by uuid not null references auth.users (id) on delete cascade,
  invited_by uuid references auth.users (id) on delete set null,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (note_id, user_id)
);
create index note_members_user on public.note_members (user_id);

-- Someone's role in a note, or null. Definer, so policies can ask without recursing.
create or replace function public.collab_role(p_note uuid, p_user uuid default auth.uid()) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.note_members where note_id = p_note and user_id = p_user
$$;

alter table public.shared_notes enable row level security;
create policy "members read" on public.shared_notes for select to authenticated
  using (public.collab_role(id) is not null);
-- Editors keep the sealed title and the page current. The epoch only moves through collab_remove.
create policy "editors write head" on public.shared_notes for update to authenticated
  using (public.collab_role(id) in ('owner', 'editor'))
  with check (public.collab_role(id) in ('owner', 'editor'));
revoke all on public.shared_notes from anon, authenticated;
grant select on public.shared_notes to authenticated;
grant update (head_ct, page_ct) on public.shared_notes to authenticated;

alter table public.note_members enable row level security;
-- Your own row in full (it has your wraps). Other members only through collab_members.
create policy "own membership" on public.note_members for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.note_members from anon, authenticated;
grant select on public.note_members to authenticated;

-- Who is in a note: names, photos, roles and public keys (for the safety code), never wraps.
create or replace function public.collab_members(p_note uuid)
returns table (user_id uuid, role text, display_name text, avatar_path text, public_key text, accepted boolean)
language sql stable security definer set search_path = '' as $$
  select m.user_id, m.role, p.display_name, p.avatar_path, k.public_key, m.accepted_at is not null
  from public.note_members m
  left join public.profiles p on p.user_id = m.user_id
  left join public.identity_keys k on k.user_id = m.user_id
  where m.note_id = p_note and public.collab_role(p_note) is not null
  order by m.invited_at
$$;

-- Sharing a note: the owner becomes its first member, with NK already under their own data key.
create or replace function public.collab_share(p_note uuid, p_key_wrap text, p_self_wrap text, p_head_ct text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.pane_take('write');
  insert into public.shared_notes (id, owner_id, head_ct) values (p_note, auth.uid(), p_head_ct);
  insert into public.note_members (note_id, user_id, role, epoch, key_wrap, wrapped_by, self_wrap, invited_by, accepted_at)
  values (p_note, auth.uid(), 'owner', 1, p_key_wrap, auth.uid(), p_self_wrap, auth.uid(), now());
end $$;

-- Inviting: only the owner, with NK sealed to the invitee's identity key at the current epoch.
create or replace function public.collab_invite(p_note uuid, p_user uuid, p_role text, p_key_wrap text, p_epoch int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  current_epoch int;
begin
  perform public.pane_take('write');
  if public.collab_role(p_note) is distinct from 'owner' then
    raise exception 'Only the owner can invite people to this note.' using errcode = '42501', hint = 'not_owner';
  end if;
  if p_role not in ('editor', 'viewer') then raise exception 'Unknown role.' using errcode = '22023'; end if;
  select epoch into current_epoch from public.shared_notes where id = p_note;
  if p_epoch <> current_epoch then
    raise exception 'The note''s key changed. Try again.' using errcode = '40001', hint = 'stale_epoch';
  end if;
  insert into public.note_members (note_id, user_id, role, epoch, key_wrap, wrapped_by, invited_by)
  values (p_note, p_user, p_role, p_epoch, p_key_wrap, auth.uid(), auth.uid())
  on conflict (note_id, user_id) do update set role = excluded.role;
end $$;

-- Accepting: the invitee opened key_wrap with their identity key and re-sealed NK under their data key.
create or replace function public.collab_accept(p_note uuid, p_self_wrap text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.note_members set self_wrap = p_self_wrap, accepted_at = coalesce(accepted_at, now())
  where note_id = p_note and user_id = auth.uid();
  if not found then raise exception 'That invitation is gone.' using errcode = 'P0002'; end if;
end $$;

-- Removing someone (or leaving, or Reset Link with p_user null): a new key for everyone who stays. The owner's device makes NK',
-- seals it to each remaining member, and sends the wraps in one call, so there is never a moment
-- where the removed person could read new text. p_wraps: [{user_id, key_wrap}] for every member
-- who stays, the owner included; self_wraps are made again by each member when they next open it.
create or replace function public.collab_remove(p_note uuid, p_user uuid, p_epoch int, p_wraps jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  current_epoch int;
  stay int;
begin
  perform public.pane_take('write');
  if public.collab_role(p_note) is distinct from 'owner' then
    raise exception 'Only the owner can remove people.' using errcode = '42501', hint = 'not_owner';
  end if;
  if p_user is not null and p_user = auth.uid() then raise exception 'The owner can''t remove themselves.' using errcode = '22023'; end if;
  select epoch into current_epoch from public.shared_notes where id = p_note for update;
  if p_epoch <> current_epoch + 1 then
    raise exception 'The note''s key changed. Try again.' using errcode = '40001', hint = 'stale_epoch';
  end if;
  -- p_user null: only a new key (Reset Link). Every live link was made for the old key and stops.
  delete from public.note_members where note_id = p_note and user_id = p_user;
  delete from public.note_invite_links where note_id = p_note;
  select count(*) into stay from public.note_members where note_id = p_note;
  if (select count(*) from jsonb_array_elements(p_wraps) w
      join public.note_members m on m.note_id = p_note and m.user_id = (w->>'user_id')::uuid) <> stay then
    raise exception 'Every remaining member needs the new key.' using errcode = '22023', hint = 'wraps_incomplete';
  end if;
  update public.note_members m set key_wrap = w->>'key_wrap', wrapped_by = auth.uid(), self_wrap = null, epoch = p_epoch
  from jsonb_array_elements(p_wraps) w
  where m.note_id = p_note and m.user_id = (w->>'user_id')::uuid;
  update public.shared_notes set epoch = p_epoch, updated_at = now() where id = p_note;
  return p_epoch;
end $$;

-- The document: sealed Automerge changes, in order. A change sealed with an old key is refused,
-- so a removed member's device can't keep writing.
create table public.note_updates (
  id bigint generated always as identity primary key,
  note_id uuid not null references public.shared_notes (id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  epoch int not null,
  -- `amb3u.<epoch>.<base64 nonce ‖ ct ‖ tag>`, AAD `amb3u|<note id>|<epoch>|<author id>`.
  ct text not null check (octet_length(ct) <= 262144),
  -- Which AI wrote it, when one did (its client name); null for a person on a device.
  client text check (client is null or char_length(client) <= 100),
  created_at timestamptz not null default now()
);
create index note_updates_note on public.note_updates (note_id, id);

create table public.note_snapshots (
  note_id uuid not null references public.shared_notes (id) on delete cascade,
  -- The last update this snapshot includes; updates up to it can be dropped.
  upto bigint not null,
  epoch int not null,
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ct text not null check (octet_length(ct) <= 4194304),
  created_at timestamptz not null default now(),
  -- A new key re-seals the document at the same point: one snapshot per point and key.
  primary key (note_id, upto, epoch)
);

create or replace function public.collab_update_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.pane_take('write');
  if public.collab_role(new.note_id) not in ('owner', 'editor') then
    raise exception 'You can view this note but not change it.' using errcode = '42501', hint = 'read_only';
  end if;
  if new.epoch <> (select epoch from public.shared_notes where id = new.note_id) then
    raise exception 'The note''s key changed. Open it again.' using errcode = '40001', hint = 'stale_epoch';
  end if;
  new.author_id := auth.uid();
  new.created_at := now();
  if tg_table_name = 'note_updates' then
    -- An AI's change says which AI (pane.client, set by the MCP server); the author is still the
    -- person whose connection it is, so the note can say "Sara's Claude".
    new.client := left(coalesce(public.pane_writer(), new.client), 100);
  end if;
  return new;
end $$;
create trigger note_updates_guard before insert on public.note_updates for each row execute function public.collab_update_guard();
create trigger note_snapshots_guard before insert on public.note_snapshots for each row execute function public.collab_update_guard();

alter table public.note_updates enable row level security;
create policy "members read" on public.note_updates for select to authenticated using (public.collab_role(note_id) is not null);
create policy "editors add" on public.note_updates for insert to authenticated with check (public.collab_role(note_id) in ('owner', 'editor'));
revoke all on public.note_updates from anon, authenticated;
grant select, insert on public.note_updates to authenticated;

alter table public.note_snapshots enable row level security;
create policy "members read" on public.note_snapshots for select to authenticated using (public.collab_role(note_id) is not null);
create policy "editors add" on public.note_snapshots for insert to authenticated with check (public.collab_role(note_id) in ('owner', 'editor'));
revoke all on public.note_snapshots from anon, authenticated;
grant select, insert on public.note_snapshots to authenticated;

-- Compaction: once a snapshot covers them, the updates before it go (the newest snapshot stays,
-- plus the ones version history keeps).
create or replace function public.collab_compact() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.note_updates where note_id = new.note_id and id <= new.upto;
  return new;
end $$;
create trigger note_snapshots_compact after insert on public.note_snapshots for each row execute function public.collab_compact();

-- Edit links: `https://ambernotes.app/s/<link id>#<secret>` with Edit on. The secret stays in the fragment,
-- which browsers never send. The server keeps a hash of a value derived from it (to find the
-- link) and NK sealed under another value derived from it; it can open neither.
create table public.note_invite_links (
  -- The same id as the note's sealed link: one link, View or Edit (ambernotes.app/s/<id>#<secret>).
  id text primary key check (id ~ '^[A-Za-z0-9_-]{22}$'),
  note_id uuid not null references public.shared_notes (id) on delete cascade,
  role text not null check (role in ('editor', 'viewer')),
  epoch int not null,
  answer_hash text not null check (answer_hash ~ '^[0-9a-f]{64}$'),
  key_wrap text not null check (octet_length(key_wrap) < 400),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);
alter table public.note_invite_links enable row level security;
revoke all on public.note_invite_links from anon, authenticated;

-- A link opened: the caller proves they hold the secret (the answer) and gets NK sealed under the
-- link's key. Their device opens it, seals NK to its own identity key and data key, and joins with
-- the link's role (collab_join_link). Links make a member of whoever holds them, like any
-- "anyone with the link" share; the owner sees who joined and can remove them.
create or replace function public.collab_open_link(p_link text, p_answer text)
returns table (note_id uuid, role text, epoch int, key_wrap text)
language plpgsql security definer set search_path = '' as $$
declare
  l public.note_invite_links;
begin
  perform public.pane_take('token');
  select * into l from public.note_invite_links where id = p_link and expires_at > now();
  if l.id is null or l.answer_hash <> encode(sha256(decode(p_answer, 'hex')), 'hex')
     or l.epoch <> (select s.epoch from public.shared_notes s where s.id = l.note_id) then
    raise exception 'That link has expired or was stopped.' using errcode = 'P0002';
  end if;
  return query select l.note_id, l.role, l.epoch, l.key_wrap;
end $$;

create or replace function public.collab_join_link(p_link text, p_answer text, p_key_wrap text, p_self_wrap text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  l record;
begin
  select * into l from public.collab_open_link(p_link, p_answer);
  insert into public.note_members (note_id, user_id, role, epoch, key_wrap, wrapped_by, self_wrap, invited_by, accepted_at)
  select l.note_id, auth.uid(), l.role, l.epoch, p_key_wrap, auth.uid(), p_self_wrap, k.created_by, now()
  from public.note_invite_links k where k.id = p_link
  on conflict (note_id, user_id) do nothing;
end $$;

create or replace function public.collab_create_link(p_link text, p_note uuid, p_role text, p_epoch int, p_answer_hash text, p_key_wrap text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.pane_take('write');
  if public.collab_role(p_note) is distinct from 'owner' then
    raise exception 'Only the owner can make an invite link.' using errcode = '42501', hint = 'not_owner';
  end if;
  delete from public.note_invite_links where note_id = p_note and id <> p_link;
  insert into public.note_invite_links (id, note_id, role, epoch, answer_hash, key_wrap)
  values (p_link, p_note, p_role, p_epoch, p_answer_hash, p_key_wrap)
  on conflict (id) do update set role = excluded.role, epoch = excluded.epoch, answer_hash = excluded.answer_hash, key_wrap = excluded.key_wrap;
end $$;

-- Edit turned off (the link goes back to View): opening it no longer adds anyone.
create or replace function public.collab_stop_link(p_note uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.collab_role(p_note) is distinct from 'owner' then
    raise exception 'Only the owner can change the link.' using errcode = '42501', hint = 'not_owner';
  end if;
  delete from public.note_invite_links where note_id = p_note;
end $$;

revoke all on function public.collab_role(uuid, uuid), public.collab_members(uuid), public.collab_share(uuid, text, text, text),
  public.collab_invite(uuid, uuid, text, text, int), public.collab_accept(uuid, text), public.collab_remove(uuid, uuid, int, jsonb),
  public.collab_publish_identity(text, text), public.collab_find_person(text), public.collab_open_link(text, text),
  public.collab_join_link(text, text, text, text), public.collab_create_link(text, uuid, text, int, text, text), public.collab_stop_link(uuid) from public, anon;
grant execute on function public.collab_role(uuid, uuid), public.collab_members(uuid), public.collab_share(uuid, text, text, text),
  public.collab_invite(uuid, uuid, text, text, int), public.collab_accept(uuid, text), public.collab_remove(uuid, uuid, int, jsonb),
  public.collab_publish_identity(text, text), public.collab_find_person(text), public.collab_open_link(text, text),
  public.collab_join_link(text, text, text, text), public.collab_create_link(text, uuid, text, int, text, text), public.collab_stop_link(uuid) to authenticated;

-- Live: new updates reach members through Realtime, and presence (who's here, where their cursor
-- is, sealed under NK) goes over a private channel `note:<id>` only members may join.
alter publication supabase_realtime add table public.note_updates;
alter publication supabase_realtime add table public.note_members;
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'realtime') then
    execute $p$
      create policy "note members join" on realtime.messages for select to authenticated
        using (realtime.topic() like 'note:%' and public.collab_role(split_part(realtime.topic(), ':', 2)::uuid) is not null)
    $p$;
    execute $p$
      create policy "note members send" on realtime.messages for insert to authenticated
        with check (realtime.topic() like 'note:%' and public.collab_role(split_part(realtime.topic(), ':', 2)::uuid) is not null)
    $p$;
  end if;
end $$;
