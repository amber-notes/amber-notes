-- Start fresh and Delete account are paused for 72 hours after a password reset
-- (docs/Technical/password-reset.md). Someone who can read the account's email could otherwise reset
-- the password, or sign in with an emailed link, and delete every note on the server.
--
-- The pause starts only when something actually happened, never on a request: anyone who knows an
-- address can ask for a reset or a sign-in link, and that alone must not block the account's owner.
-- It starts when
--   - the password changes (auth.users.encrypted_password), or
--   - a session is made from an emailed link: a reset link or a magic link signs in with the `otp`
--     method (auth.mfa_amr_claims; `recovery` and `magiclink` are counted too, should Supabase name
--     them so).
-- Triggers record the moment in account_recoveries, which no client can read or write; the server
-- reads it (start_fresh here, the account function for Delete account).
create table public.account_recoveries (
  user_id uuid primary key references auth.users (id) on delete cascade,
  at      timestamptz not null default now()
);
alter table public.account_recoveries enable row level security;
revoke all on public.account_recoveries from public, anon, authenticated;

create or replace function public.pane_mark_recovery(p_user uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.account_recoveries as r (user_id, at) values (p_user, now())
    on conflict (user_id) do update set at = now()
$$;
revoke all on function public.pane_mark_recovery(uuid) from public, anon, authenticated;

create or replace function public.pane_note_password_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    perform public.pane_mark_recovery(new.id);
  end if;
  return new;
end $$;
revoke all on function public.pane_note_password_change() from public, anon, authenticated;
drop trigger if exists pane_note_password_change on auth.users;
create trigger pane_note_password_change after update of encrypted_password on auth.users
  for each row execute function public.pane_note_password_change();

create or replace function public.pane_note_email_link_sign_in() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid;
begin
  if new.authentication_method in ('otp', 'recovery', 'magiclink') then
    select s.user_id into owner from auth.sessions s where s.id = new.session_id;
    if owner is not null then perform public.pane_mark_recovery(owner); end if;
  end if;
  return new;
end $$;
revoke all on function public.pane_note_email_link_sign_in() from public, anon, authenticated;
drop trigger if exists pane_note_email_link_sign_in on auth.mfa_amr_claims;
create trigger pane_note_email_link_sign_in after insert or update on auth.mfa_amr_claims
  for each row execute function public.pane_note_email_link_sign_in();

-- Until when the account's destructive actions are paused, or null.
create or replace function public.pane_reset_pause_until(p_user uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select r.at + interval '72 hours' from public.account_recoveries r
  where r.user_id = p_user and r.at > now() - interval '72 hours'
$$;
revoke all on function public.pane_reset_pause_until(uuid) from public, anon, authenticated;

-- The pause comes before the recent sign-in check, so the app says it at once instead of asking
-- for a sign-in first.
create or replace function public.start_fresh(p_key_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  paused_until timestamptz;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  paused_until := public.pane_reset_pause_until(uid);
  if paused_until is not null then
    raise exception 'Start fresh is paused for 72 hours after a password reset, to protect your notes.'
      using errcode = '42501', hint = 'paused_after_reset',
            detail = to_char(paused_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
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
