-- Sign in with Google (docs/Technical/google-sign-in.md).
--
-- 1. The sign-up hook lets Google make new accounts, as it lets Apple. Whether the hook is on is the
--    project's setting ([auth.hook.before_user_created]); this only keeps the two in step.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_provider text := coalesce(event->'user'->'app_metadata'->>'provider', '');
  v_email text := lower(coalesce(event->'user'->>'email', ''));
begin
  if v_provider in ('apple', 'google') then
    return '{}'::jsonb;
  end if;
  if exists (select 1 from public.signup_allowlist a where a.email = v_email) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'New accounts are made with Sign in with Apple or Google.'));
end $$;

-- 2. A Google sign-in whose email already has an account joins that account: Supabase links a new
--    identity to the user with the same address when the provider says the address is verified.
--    Email sign-up here doesn't confirm the address, so a password on that account proves nothing:
--    anyone could have typed the address and chosen it. Without this, someone could make an account
--    with another person's email and a password, wait for that person to sign in with Google, and
--    then sign in to the same account with the password.
--
--    So when Google joins an account that has a password, Google has just proven the address and
--    the password stops working: it's cleared, and every session made before is ended (the new
--    Google session is made after this insert). Clearing it is a password change, so the 72-hour
--    pause on Start fresh and Delete account starts too (20261002200000_start_fresh_after_reset).
--    "Forgot password?" sets a new one, through the same inbox Google just vouched for.
--
--    This is what Supabase itself does when the existing address was never confirmed; here every
--    address counts as unconfirmed, because confirmation is off.
create or replace function public.pane_google_joins_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.provider = 'google'
     and exists (select 1 from auth.users u where u.id = new.user_id and coalesce(u.encrypted_password, '') <> '') then
    update auth.users set encrypted_password = '' where id = new.user_id;
    delete from auth.sessions where user_id = new.user_id;
  end if;
  return new;
end $$;
revoke all on function public.pane_google_joins_account() from public, anon, authenticated;
drop trigger if exists pane_google_joins_account on auth.identities;
create trigger pane_google_joins_account after insert on auth.identities
  for each row execute function public.pane_google_joins_account();
