-- A new account made with an email address, and confirmed with the 6-digit code from the email,
-- could not delete itself or start fresh for 72 hours: "Deleting your account is paused for 72
-- hours after a password reset". The pause (20261002200000_start_fresh_after_reset.sql) starts
-- whenever a session is made with the `otp` method, and Supabase Auth makes the first session of a
-- confirmed sign-up with that method too.
--
-- A sign-up's confirmation is told from a sign-in by emailed link or code by what the auth server
-- does in the same transaction, just before it makes the session: it sets
-- auth.users.email_confirmed_at, once, the first time the address is proven. So the session is a
-- sign-up's when both hold:
--   - the address was confirmed in the last 2 minutes (the auth server stamps it with its own
--     clock, a moment before the session; 2 minutes is room for the two clocks to differ), and
--   - the account has no other session.
--
-- Why this opens nothing for someone who has taken over a mailbox: the pause protects the notes of
-- an account that exists, and such an account's address was confirmed when it was made (by its
-- code, or at once while confirmation was off, or by Apple or Google). Nothing a person can ask the
-- auth server for sets email_confirmed_at again: a reset link, a sign-in link or code and an email
-- change all leave it as it is on a confirmed account. So for every account with notes the first
-- condition is false, and an emailed link or code starts the pause exactly as before. An account
-- that was never confirmed has never had a session, so it has no notes, no key and no device: there
-- is nothing behind it to protect. The second condition only narrows it further.
--
-- A password change still starts the pause on any account, new or old (pane_note_password_change
-- is untouched), and so does Google joining an account.
create or replace function public.pane_note_email_link_sign_in() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid;
  confirmed timestamptz;
begin
  if new.authentication_method in ('otp', 'recovery', 'magiclink') then
    select s.user_id into owner from auth.sessions s where s.id = new.session_id;
    if owner is null then return new; end if;
    select u.email_confirmed_at into confirmed from auth.users u where u.id = owner;
    -- The sign-up's own confirmation: the address was proven just now, and this is the only session.
    if confirmed is not null and confirmed > now() - interval '2 minutes'
       and not exists (select 1 from auth.sessions s where s.user_id = owner and s.id <> new.session_id) then
      return new;
    end if;
    perform public.pane_mark_recovery(owner);
  end if;
  return new;
end $$;
revoke all on function public.pane_note_email_link_sign_in() from public, anon, authenticated;

-- Pauses that were recorded at a sign-up before this (staging has some). They can be told for
-- certain: the pause's moment is the moment the address was confirmed, to within 5 seconds, which
-- only a sign-up's confirmation gives. A reset's or a sign-in's pause on an existing account is
-- hours to years after its confirmation, and a password typed after confirming takes longer than
-- that. Pauses older than 72 hours do nothing and are left alone.
delete from public.account_recoveries r using auth.users u
where u.id = r.user_id
  and r.at > now() - interval '72 hours'
  and u.email_confirmed_at is not null
  and abs(extract(epoch from (r.at - u.email_confirmed_at))) < 5;
