-- Sign-ups are on, but only for emails on this list. Everyone else is refused by
-- the auth server itself, so a public app or repo can't be used to register.
-- Add someone:  insert into public.signup_allowlist (email) values ('you@example.com');
-- An empty list means nobody can sign up.

create table public.signup_allowlist (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

alter table public.signup_allowlist enable row level security;
revoke all on public.signup_allowlist from anon, authenticated;

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  email text := lower(coalesce(event->'user'->>'email', ''));
begin
  if exists (select 1 from public.signup_allowlist a where a.email = hook_before_user_created.email) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'This Amber Notes server is private. Ask its owner to add your email.'));
end $$;

revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
grant select on public.signup_allowlist to supabase_auth_admin;
