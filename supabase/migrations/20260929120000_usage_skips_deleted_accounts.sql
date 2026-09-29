-- Deleting an account cascades to its folders and notes; their usage triggers then tried to
-- recreate the account's pane_usage row after it was gone, and the whole deletion failed
-- (so Delete Account never worked). The counters now skip accounts that no longer exist.

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
  -- The account itself is being deleted: nothing left to count (and no row to recreate).
  if not exists (select 1 from auth.users where id = owner) then return coalesce(new, old); end if;
  if d_notes = 0 and d_bytes = 0 then return coalesce(new, old); end if;
  insert into public.pane_usage as x (user_id, notes, notes_bytes) values (owner, greatest(d_notes, 0), greatest(d_bytes, 0))
  on conflict (user_id) do update set notes = greatest(x.notes + d_notes, 0), notes_bytes = greatest(x.notes_bytes + d_bytes, 0)
  returning * into u;
  if d_notes > 0 and u.notes > public.pane_limit('notes') then perform public.pane_over('notes'); end if;
  if d_bytes > 0 and u.notes_bytes > public.pane_limit('notes_bytes') then perform public.pane_over('notes_bytes'); end if;
  return coalesce(new, old);
end $$;

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
  -- The account itself is being deleted: nothing left to count (and no row to recreate).
  if not exists (select 1 from auth.users where id = owner) then return coalesce(new, old); end if;
  if d = 0 then return coalesce(new, old); end if;
  insert into public.pane_usage as x (user_id, folders) values (owner, greatest(d, 0))
  on conflict (user_id) do update set folders = greatest(x.folders + d, 0)
  returning * into u;
  if d > 0 and u.folders > public.pane_limit('folders') then perform public.pane_over('folders'); end if;
  return coalesce(new, old);
end $$;
