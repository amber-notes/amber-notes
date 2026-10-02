-- Start fresh is paused for 72 hours after a password reset (docs/Technical/password-reset.md).
-- Someone who can read the account's email could otherwise reset the password, sign in and delete
-- every note on the server.
--
-- When it last happened is kept here, by a trigger on auth.users, and read only on the server.
-- Supabase stamps auth.users.recovery_sent_at when it sends a reset email or a sign-in link (magic
-- link), and clears it again when the password is then changed, so it can't be read afterwards; the
-- trigger records the moment it's stamped, and every password change too.
create table public.account_recoveries (
  user_id uuid primary key references auth.users (id) on delete cascade,
  at      timestamptz not null default now()
);
alter table public.account_recoveries enable row level security;
revoke all on public.account_recoveries from public, anon, authenticated;

create or replace function public.pane_note_recovery() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.recovery_sent_at is not null and new.recovery_sent_at is distinct from old.recovery_sent_at)
     or new.encrypted_password is distinct from old.encrypted_password then
    insert into public.account_recoveries as r (user_id, at) values (new.id, now())
      on conflict (user_id) do update set at = now();
  end if;
  return new;
end $$;
revoke all on function public.pane_note_recovery() from public, anon, authenticated;

drop trigger if exists pane_note_recovery on auth.users;
create trigger pane_note_recovery after update of recovery_sent_at, encrypted_password on auth.users
  for each row execute function public.pane_note_recovery();

-- The pause comes before the recent sign-in check, so the app says it at once instead of asking
-- for a sign-in first.
create or replace function public.start_fresh(p_key_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  recovered timestamptz;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select greatest(r.at, u.recovery_sent_at) into recovered
    from auth.users u left join public.account_recoveries r on r.user_id = u.id where u.id = uid;
  if recovered is not null and recovered > now() - interval '72 hours' then
    raise exception 'Start fresh is paused for 72 hours after a password reset, to protect your notes.'
      using errcode = '42501', hint = 'paused_after_reset',
            detail = to_char((recovered + interval '72 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;
  if coalesce(public.pane_signed_in_at(), '-infinity') < now() - interval '10 minutes' then
    raise exception 'Sign in again to start fresh.' using errcode = '42501', hint = 'reauth';
  end if;
  perform 1 from public.account_keys where user_id = uid and key_id = p_key_id for update;
  if not found then return false; end if;
  delete from public.note_shares where user_id = uid;
  delete from public.notes where user_id = uid;
  delete from public.folders where user_id = uid;
  delete from public.attachments where user_id = uid;
  delete from public.mcp_tokens where user_id = uid;
  delete from public.account_keys where user_id = uid;
  insert into public.account_key_resets as r (user_id, generation) values (uid, 1)
    on conflict (user_id) do update set generation = r.generation + 1, reset_at = now();
  insert into public.account_notices (user_id, kind, what)
    values (uid, 'started_fresh', 'Your notes were deleted and a new key and recovery key were made');
  update public.pane_usage set notes = 0, notes_bytes = 0, folders = 0 where user_id = uid;
  return true;
end $$;
revoke all on function public.start_fresh(text) from public, anon;
grant execute on function public.start_fresh(text) to authenticated;
