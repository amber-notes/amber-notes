-- Push notifications for AI connection asks (APNs). A push only wakes a device and says there's a
-- request: it carries the request id and generic words, never note data. The device still fetches
-- the ask itself and checks it (number matching) before anything can be allowed.
--
-- One row per signed-in device: the app writes its own, removes it when it signs out, and the
-- account's deletion takes them all. The MCP function reads them to send, and deletes a token
-- Apple says is no longer valid.

create table public.device_tokens (
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- The same random id the app uses for pane_devices.
  device_id   uuid not null,
  platform    text not null check (platform in ('ios', 'macos')),
  -- The APNs device token, lowercase hex.
  token       text not null check (token ~ '^[0-9a-f]{64,200}$'),
  -- Which APNs server the token belongs to: development-signed builds get sandbox tokens,
  -- TestFlight and App Store builds production ones.
  environment text not null check (environment in ('sandbox', 'production')),
  updated_at  timestamptz not null default now(),
  primary key (user_id, device_id)
);
create unique index device_tokens_token on public.device_tokens (token);
alter table public.device_tokens enable row level security;
create policy "own device tokens read" on public.device_tokens for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own device tokens delete" on public.device_tokens for delete to authenticated
  using (user_id = (select auth.uid()));
-- Written only through register_device_token (limits and all); read and removed directly.
revoke all on public.device_tokens from anon;
revoke insert, update, truncate on public.device_tokens from authenticated;

-- The app's upsert, on every launch while signed in (so updated_at says the device is alive: pushes
-- go only to tokens seen in the last 90 days). A token that moved to another account on this device
-- (sign out, then another account signs in) leaves the old one. At most 10 devices per account: the
-- longest unseen goes. Rate-limited like making an access token.
create or replace function public.register_device_token(p_device uuid, p_platform text, p_token text, p_environment text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform public.pane_take('token');
  delete from public.device_tokens where token = lower(p_token) and user_id <> auth.uid();
  insert into public.device_tokens (user_id, device_id, platform, token, environment)
  values (auth.uid(), p_device, p_platform, lower(p_token), p_environment)
  on conflict (user_id, device_id) do update
    set platform = excluded.platform, token = excluded.token, environment = excluded.environment, updated_at = now();
  delete from public.device_tokens
    where user_id = auth.uid() and device_id in (
      select device_id from public.device_tokens where user_id = auth.uid() order by updated_at desc, device_id offset 10);
end $$;
revoke all on function public.register_device_token(uuid, text, text, text) from public, anon;
grant execute on function public.register_device_token(uuid, text, text, text) to authenticated;

-- A device that signed out while offline couldn't delete its row then (and has no session after):
-- on its next launch it asks for its token to be forgotten. The APNs token is the proof: only the
-- device and this server know it.
create or replace function public.forget_device_token(p_token text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if p_token is null or p_token !~ '^[0-9a-fA-F]{64,200}$' then return 0; end if;
  delete from public.device_tokens where token = lower(p_token);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.forget_device_token(text) from public;
grant execute on function public.forget_device_token(text) to anon, authenticated;
