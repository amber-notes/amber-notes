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
create policy "own device tokens" on public.device_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.device_tokens from anon;

-- The app's upsert: a token that moved to another account on this device (sign out, then another
-- account signs in) leaves the old one.
create or replace function public.register_device_token(p_device uuid, p_platform text, p_token text, p_environment text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  delete from public.device_tokens where token = lower(p_token) and user_id <> auth.uid();
  insert into public.device_tokens (user_id, device_id, platform, token, environment)
  values (auth.uid(), p_device, p_platform, lower(p_token), p_environment)
  on conflict (user_id, device_id) do update
    set platform = excluded.platform, token = excluded.token, environment = excluded.environment, updated_at = now();
end $$;
revoke all on function public.register_device_token(uuid, text, text, text) from public, anon;
grant execute on function public.register_device_token(uuid, text, text, text) to authenticated;
