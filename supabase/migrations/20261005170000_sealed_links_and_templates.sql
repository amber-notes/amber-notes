-- Read-only links and shared templates (prototype; docs/Technical/collaboration-design.md).
--
-- Sealed links: `https://ambernotes.app/s/<id>#<secret>`. The device seals the note (text, page,
-- the page's data) under a key derived from the secret, which lives only in the link's fragment,
-- so the server and the site's server never see it. The browser opens the copy itself. They sit
-- next to today's readable copies (note_shares), which keep working until their owner stops or
-- switches them.
--
-- Shared templates: `https://ambernotes.app/t/<id>`. Meant to be public, so they're stored
-- readable, and hold only what the person chose to put in them: the note's skeleton, its page,
-- the page's data layout, sample data if they chose to include it, and the names and hosts of any
-- keys the page needs (never a key itself).

create table public.sealed_links (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{22}$'),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The note it copies. In the product this references notes (or shared_notes) with on delete
  -- cascade, like note_shares; the prototype's notes live only on the device.
  note_id uuid not null,
  -- `amb3r.<b64 nonce ‖ ct ‖ tag>`: the copy, AES-256-GCM under HKDF(secret, info "share <id>"),
  -- AAD `amb3r|<id>`. At most about 3 MB once sealed.
  ct text not null check (ct ~ '^amb3r\.[A-Za-z0-9+/]+={0,2}$' and octet_length(ct) <= 4194304),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One live link per note, as with note_shares: a new link (rotation) replaces the old one.
create unique index sealed_links_note on public.sealed_links (note_id);

alter table public.sealed_links enable row level security;
create policy "own links" on public.sealed_links for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.sealed_links from anon, authenticated;
grant select, insert, update, delete on public.sealed_links to authenticated;

-- Publishing (and republishing after an edit) and rotating: a new id for the same note drops the
-- old link in the same statement, so the old address stops working at once.
create or replace function public.publish_sealed_link(p_id text, p_note uuid, p_ct text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.pane_take('write');
  delete from public.sealed_links where note_id = p_note and user_id = auth.uid() and id <> p_id;
  insert into public.sealed_links (id, user_id, note_id, ct) values (p_id, auth.uid(), p_note, p_ct)
  on conflict (id) do update set ct = excluded.ct, updated_at = now()
    where public.sealed_links.user_id = auth.uid();
end $$;

-- Stop sharing.
create or replace function public.stop_sealed_link(p_note uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.sealed_links where note_id = p_note and user_id = auth.uid()
$$;

-- What a visitor's browser gets: the sealed copy and when it changed, nothing about the account.
create or replace function public.sealed_link(p_id text) returns table (ct text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.ct, l.updated_at from public.sealed_links l where p_id ~ '^[A-Za-z0-9_-]{22}$' and l.id = p_id
$$;

create table public.shared_templates (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{16}$'),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  note_id uuid not null,
  -- The maker's name as they chose to show it on the page.
  maker text check (maker is null or char_length(maker) between 1 and 60),
  -- {v, title, description, note, sample, page, widget, layout, needs:{keys:[{name,host}],hosts}}.
  -- Checked again by the site; never a key's value.
  template jsonb not null check (octet_length(template::text) <= 1048576),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index shared_templates_note on public.shared_templates (note_id);

alter table public.shared_templates enable row level security;
create policy "own templates" on public.shared_templates for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.shared_templates from anon, authenticated;
grant select, insert, update, delete on public.shared_templates to authenticated;

create or replace function public.publish_template(p_id text, p_note uuid, p_maker text, p_template jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.pane_take('write');
  -- Key values must never be in a template: only {name, host} pairs.
  if exists (select 1 from jsonb_array_elements(coalesce(p_template #> '{needs,keys}', '[]'::jsonb)) k
             where jsonb_typeof(k) <> 'object' or not (k ? 'name')
                or exists (select 1 from jsonb_object_keys(k) f where f not in ('name', 'host'))) then
    raise exception 'A template names the keys it needs; it never carries them.' using errcode = '22023';
  end if;
  delete from public.shared_templates where note_id = p_note and user_id = auth.uid() and id <> p_id;
  insert into public.shared_templates (id, user_id, note_id, maker, template) values (p_id, auth.uid(), p_note, p_maker, p_template)
  on conflict (id) do update set template = excluded.template, maker = excluded.maker, updated_at = now()
    where public.shared_templates.user_id = auth.uid();
end $$;

create or replace function public.stop_template(p_note uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.shared_templates where note_id = p_note and user_id = auth.uid()
$$;

create or replace function public.shared_template(p_id text) returns table (maker text, template jsonb, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.maker, t.template, t.updated_at from public.shared_templates t where p_id ~ '^[A-Za-z0-9_-]{16}$' and t.id = p_id
$$;

revoke all on function public.publish_sealed_link(text, uuid, text), public.stop_sealed_link(uuid),
  public.publish_template(text, uuid, text, jsonb), public.stop_template(uuid) from public, anon;
grant execute on function public.publish_sealed_link(text, uuid, text), public.stop_sealed_link(uuid),
  public.publish_template(text, uuid, text, jsonb), public.stop_template(uuid) to authenticated;
revoke all on function public.sealed_link(text), public.shared_template(text) from public;
grant execute on function public.sealed_link(text), public.shared_template(text) to anon, authenticated;
