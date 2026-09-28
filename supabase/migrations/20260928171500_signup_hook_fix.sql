-- Name the email variable so it can't be confused with the table's column.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce(event->'user'->>'email', ''));
begin
  if exists (select 1 from public.signup_allowlist a where a.email = v_email) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'This Amber Notes server is private. Ask its owner to add your email.'));
end $$;
