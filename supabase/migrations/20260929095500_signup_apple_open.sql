-- Anyone may join, but only with Sign in with Apple. Email accounts can still sign in
-- (the owner's account needs it once to link its Apple ID); new ones can't be made,
-- except for addresses on the allowlist.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_provider text := coalesce(event->'user'->'app_metadata'->>'provider', '');
  v_email text := lower(coalesce(event->'user'->>'email', ''));
begin
  if v_provider = 'apple' then
    return '{}'::jsonb;
  end if;
  if exists (select 1 from public.signup_allowlist a where a.email = v_email) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'New accounts are made with Sign in with Apple.'));
end $$;
